type TurnstileWidgetId = string;

interface TurnstileApi {
  execute(widgetId: TurnstileWidgetId): void;
  render(
    container: HTMLElement,
    options: Record<string, unknown>,
  ): TurnstileWidgetId;
  reset(widgetId: TurnstileWidgetId): void;
}

type PendingChallenge = {
  resolve: (token: string) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const apiTimeoutMessage =
  "Security verification could not start. Allow challenges.cloudflare.com, then try again.";
const challengeErrorMessage =
  "Security verification could not be completed. Please try again.";

function turnstileApi(): TurnstileApi | undefined {
  return (window as Window & { turnstile?: TurnstileApi }).turnstile;
}

async function waitForTurnstile(timeoutMs = 10_000): Promise<TurnstileApi> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const api = turnstileApi();
    if (api) return api;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error(apiTimeoutMessage);
}

export class TurnstileController {
  private widgetPromise: Promise<{
    api: TurnstileApi;
    id: TurnstileWidgetId;
  }> | null = null;
  private pending: PendingChallenge | null = null;
  private queuedError: string | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly sitekey: string,
    private readonly action: string,
  ) {}

  private async render(container: HTMLElement, sitekey: string, action: string) {
    const api = await waitForTurnstile();
    const id = api.render(container, {
      sitekey,
      action,
      execution: "execute",
      appearance: "interaction-only",
      size: "flexible",
      callback: (token: string) => this.complete(token),
      "error-callback": () => this.fail(challengeErrorMessage),
      "expired-callback": () =>
        this.fail("Security verification expired. Please try again."),
      "timeout-callback": () =>
        this.fail("Security verification timed out. Please try again."),
      "unsupported-callback": () => this.fail(apiTimeoutMessage),
    });
    return { api, id };
  }

  async token(): Promise<string> {
    const { api, id } = await this.widget();
    if (this.pending) this.fail(challengeErrorMessage);
    if (this.queuedError) {
      const message = this.queuedError;
      this.queuedError = null;
      throw new Error(message);
    }

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(
        () => this.fail("Security verification timed out. Please try again."),
        30_000,
      );
      this.pending = { resolve, reject, timeout };
      try {
        api.reset(id);
        api.execute(id);
      } catch {
        this.fail(challengeErrorMessage);
      }
    });
  }

  async reset(): Promise<void> {
    if (!this.widgetPromise) return;
    try {
      const { api, id } = await this.widgetPromise;
      api.reset(id);
    } catch {
      // A blocked Turnstile script is already surfaced by token().
    }
  }

  private widget(): Promise<{ api: TurnstileApi; id: TurnstileWidgetId }> {
    this.widgetPromise ??= this.render(this.container, this.sitekey, this.action);
    return this.widgetPromise;
  }

  private complete(token: string): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    clearTimeout(pending.timeout);
    if (token) pending.resolve(token);
    else pending.reject(new Error(challengeErrorMessage));
  }

  private fail(message: string): void {
    const pending = this.pending;
    if (!pending) {
      this.queuedError = message;
      return;
    }
    this.pending = null;
    clearTimeout(pending.timeout);
    pending.reject(new Error(message));
  }
}

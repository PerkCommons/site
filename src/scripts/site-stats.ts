/** Consent-gated first-party website analytics. No identifier before opt-in. */
const panel = document.querySelector<HTMLElement>("#site-activity-stats");
if (panel) {
  type Counts = { month: string; monthlyBrowsers: number; onlineNow: number; listingOpens: number };
  type Choice = "accepted" | "rejected";
  type Preference = { version: 1; choice: Choice; at: number };
  const PREF_KEY = "perkcommons-analytics-consent-v1";
  const LEGACY_OPT_OUT = "perkcommons-stats-opt-out";
  const ID_PREFIX = "perkcommons-stats-browser-";
  const PENDING_KEY = "perkcommons-analytics-deletion-pending-v1";
  const MAX_AGE = 180 * 24 * 60 * 60 * 1000;
  const banner = document.querySelector<HTMLElement>("#analytics-consent-banner");
  const status = document.querySelector<HTMLElement>("#analytics-consent-state");
  const countingStatus = panel.querySelector<HTMLElement>("[data-analytics-counting-status]");
  const setCountingStatus = (message: string): void => { if (countingStatus) countingStatus.textContent = message; };
  const privacySignal = navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  const monthlyNodes = {
    monthlyBrowsers: panel.querySelector<HTMLElement>("[data-stat='monthlyBrowsers']"),
    onlineNow: panel.querySelector<HTMLElement>("[data-stat='onlineNow']"),
    listingOpens: panel.querySelector<HTMLElement>("[data-stat='listingOpens']"),
  };
  const monthLabel = panel.querySelector<HTMLElement>("[data-stat-month]");
  const updatedAt = panel.querySelector<HTMLElement>("[data-stats-updated-at]");
  let deletionInFlight = false;
  let requestInFlight = false;
  let refreshAfterCurrent = false;
  let openedThisPage = false;
  let choice: Choice | null = null;

  const safeRead = (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const safeWrite = (key: string, value: string): boolean => {
    try { localStorage.setItem(key, value); return true; } catch { return false; }
  };
  function cleanIdentifiers(queueDeletion: boolean): void {
    try {
      const pending: string[] = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "[]") as string[];
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (!key?.startsWith(ID_PREFIX)) continue;
        const value = localStorage.getItem(key);
        if (queueDeletion && value && /^[a-f0-9-]{36}$/i.test(value) && !pending.includes(value)) pending.push(value);
        localStorage.removeItem(key);
      }
      if (queueDeletion && pending.length) localStorage.setItem(PENDING_KEY, JSON.stringify(pending.slice(-12)));
    } catch { /* Browsers blocking storage cannot persist visitor IDs. */ }
  }
  function readChoice(): Choice | null {
    if (safeRead(LEGACY_OPT_OUT) === "1") return "rejected";
    try {
      const value = safeRead(PREF_KEY);
      if (!value) return null;
      const preference = JSON.parse(value) as Partial<Preference>;
      if (preference.version !== 1 || (preference.choice !== "accepted" && preference.choice !== "rejected") ||
        typeof preference.at !== "number" || !Number.isFinite(preference.at) || preference.at > Date.now() || Date.now() - preference.at > MAX_AGE)
        return null;
      return preference.choice;
    } catch { return null; }
  }
  function optedIn(): boolean { return choice === "accepted" && !privacySignal; }
  function updateConsentControls(showPrompt = false): void {
    // A first-time visitor must be able to see and dismiss the choice even
    // when browser-level privacy signals already disable tracking.
    const show = showPrompt || choice === null;
    banner?.classList.toggle("hidden", !show);
    if (status) status.textContent = privacySignal
      ? choice === "accepted"
        ? "Preference saved. Your browser privacy signal keeps analytics disabled."
        : "Your browser requests privacy, so analytics stay disabled even if you accept."
      : choice === "accepted" ? "Optional analytics enabled."
      : choice === "rejected" ? "Optional analytics rejected."
      : "Optional analytics not selected. No tracking is active.";
    setCountingStatus(privacySignal
      ? "Not counted on this browser: Do Not Track or Global Privacy Control is enabled."
      : choice === "accepted" ? "Analytics accepted. Checking whether this browser's activity was recorded…"
      : choice === "rejected" ? "Not counted on this browser: optional analytics were rejected."
      : "Not counted on this browser until optional analytics are accepted.");
  }
  function present(data: Counts): void {
    for (const key of ["monthlyBrowsers", "onlineNow", "listingOpens"] as const) {
      if (Number.isSafeInteger(data[key]) && data[key] >= 0 && monthlyNodes[key])
        monthlyNodes[key]!.textContent = new Intl.NumberFormat().format(data[key]);
    }
    if (monthLabel && /^\d{4}-\d{2}$/.test(data.month))
      monthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${data.month}-01T12:00:00Z`));
    if (updatedAt) updatedAt.textContent = `Last refreshed ${new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date())}`;
  }
  function visitorId(): string | null {
    if (!optedIn()) return null;
    try {
      const key = ID_PREFIX + new Date().toISOString().slice(0, 7);
      let value = localStorage.getItem(key);
      if (!value) { value = crypto.randomUUID(); localStorage.setItem(key, value); }
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const old = localStorage.key(i);
        if (old?.startsWith(ID_PREFIX) && old !== key) localStorage.removeItem(old);
      }
      return value;
    } catch { return null; }
  }
  async function flushDeletionQueue(): Promise<void> {
    // A revoked browser might still have a tracking POST in flight. Never
    // delete before that request finishes or the late POST can recreate it.
    if (requestInFlight || deletionInFlight) return;
    deletionInFlight = true;
    let attempted = 0;
    try {
      const pending = JSON.parse(safeRead(PENDING_KEY) ?? "[]") as unknown;
      if (!Array.isArray(pending)) return;
      const ids = pending.filter((id): id is string => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id)).slice(-12);
      attempted = ids.length;
      const failures = new Set<string>();
      for (const visitorId of ids) {
        try {
          const response = await fetch("/api/site-stats", {
            method: "DELETE", headers: { "content-type": "application/json" },
            body: JSON.stringify({ visitorId }), credentials: "omit", cache: "no-store",
          });
          if (!response.ok) failures.add(visitorId);
        } catch { failures.add(visitorId); }
      }
      // Preserve IDs queued while a deletion was in flight, rather than
      // overwriting them with the old snapshot of the deletion queue.
      const current = JSON.parse(safeRead(PENDING_KEY) ?? "[]") as unknown;
      const remaining = Array.isArray(current)
        ? current.filter((id): id is string => typeof id === "string" && (!ids.includes(id) || failures.has(id)))
        : [];
      if (remaining.length) safeWrite(PENDING_KEY, JSON.stringify(remaining.slice(-12)));
      else try { localStorage.removeItem(PENDING_KEY); } catch {}
      if (failures.size && choice !== "accepted") setCountingStatus("Tracking disabled. Previous browser data could not be erased yet; deletion will retry on the next visit.");
    } catch { /* Retry on the next page visit. */ }
    finally {
      deletionInFlight = false;
      // Re-read counts after a successful withdrawal so a temporarily stale
      // GET cannot leave this browser's old contribution on screen.
      if (attempted && document.visibilityState === "visible") void refresh();
    }
  }

  async function refresh(): Promise<void> {
    if (document.visibilityState !== "visible") return;
    if (requestInFlight) {
      // A visitor may accept analytics while the initial read-only GET is
      // still pending. Run an immediate follow-up so their first visit counts.
      refreshAfterCurrent = true;
      return;
    }
    requestInFlight = true;
    const id = visitorId();
    if (optedIn() && !id) setCountingStatus("Not counted: this browser couldn't store its optional analytics ID. Check storage permissions.");
    const open = !openedThisPage && /^\/opportunities\/[a-z0-9-]+\/?$/.test(location.pathname);
    try {
      const response = await fetch("/api/site-stats", id ? {
        method: "POST", headers: { "content-type": "application/json" },
        credentials: "omit", cache: "no-store", body: JSON.stringify({ visitorId: id, open }),
      } : { method: "GET", credentials: "omit", cache: "no-store" });
      if (response.ok) {
        const data = await response.json() as Counts;
        present(data);
        if (id && optedIn()) {
          if (open) openedThisPage = true;
          setCountingStatus(data.monthlyBrowsers > 0
            ? "Confirmed: this browser's activity was recorded. Repeat visits count as the same monthly browser."
            : "Tracking request succeeded, but the monthly total is still zero. Please report this counting issue.");
        }
      }
      else if (id) {
        if (optedIn()) setCountingStatus(response.status === 403
          ? "Not counted: this browser's activity request was blocked (HTTP 403)."
          : response.status === 429 ? "Not counted yet: too many activity requests (HTTP 429). Retrying automatically."
          : `Not counted: activity update failed (HTTP ${response.status}). Retrying automatically.`);
        const fallback = await fetch("/api/site-stats", { credentials: "omit", cache: "no-store" });
        if (fallback.ok) present(await fallback.json() as Counts);
      }
    } catch {
      if (id && optedIn()) setCountingStatus("Activity update couldn't reach the server. This browser is not confirmed as counted; retrying automatically.");
      if (updatedAt && updatedAt.textContent === "Awaiting first update") updatedAt.textContent = "Counters unavailable; retrying automatically";
      // Leave last known counters or dashes; never invent numbers.
    }
    finally {
      requestInFlight = false;
      // Only now is it safe to erase a visitor that withdrew consent during
      // an in-flight activity POST.
      void flushDeletionQueue();
      if (refreshAfterCurrent) {
        refreshAfterCurrent = false;
        void refresh();
      }
    }
  }
  function selectPreference(next: Choice): void {
    // Explicit consent can be saved, but never overrides Do Not Track or GPC.
    // A browser-level privacy signal continues to block tracking events.
    const saved = safeWrite(PREF_KEY, JSON.stringify({ version: 1, choice: next, at: Date.now() } satisfies Preference));
    if (!saved) {
      // The controls should remain usable with blocked storage. Without a
      // durable preference or visitor ID, no analytics tracking can occur.
      choice = "rejected";
      updateConsentControls();
      return;
    }
    try { localStorage.removeItem(LEGACY_OPT_OUT); } catch {}
    choice = next;
    if (next === "rejected") { cleanIdentifiers(true); void flushDeletionQueue(); }
    updateConsentControls();
    void refresh();
  }
  document.querySelectorAll<HTMLButtonElement>("[data-analytics-accept]").forEach(b => b.addEventListener("click", () => selectPreference("accepted")));
  document.querySelectorAll<HTMLButtonElement>("[data-analytics-reject]").forEach(b => b.addEventListener("click", () => selectPreference("rejected")));
  document.querySelectorAll<HTMLButtonElement>("[data-open-analytics-settings]").forEach(b => b.addEventListener("click", () => { updateConsentControls(true); banner?.querySelector<HTMLButtonElement>("[data-analytics-reject]")?.focus(); }));
  // Existing pre-consent IDs from the old site must not confer consent.
  choice = readChoice();
  if (choice !== "accepted" || privacySignal) cleanIdentifiers(choice === "rejected" || (privacySignal && choice === "accepted"));
  updateConsentControls();
  void flushDeletionQueue();
  void refresh();
  function syncChoice(): void {
    const current = readChoice();
    if (current !== choice) {
      if (choice === "accepted" && current !== "accepted") { cleanIdentifiers(true); void flushDeletionQueue(); }
      choice = current;
      updateConsentControls();
    }
  }
  const interval = window.setInterval(() => { syncChoice(); void refresh(); }, 60_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { syncChoice(); void refresh(); } });
  window.addEventListener("storage", event => {
    if (event.key === PREF_KEY || event.key === LEGACY_OPT_OUT) {
      choice = readChoice(); if (!optedIn()) cleanIdentifiers(true);
      updateConsentControls(); void flushDeletionQueue(); void refresh();
    }
  });
  window.addEventListener("pagehide", () => window.clearInterval(interval), { once: true });
}

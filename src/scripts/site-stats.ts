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
  const privacySignal = navigator.doNotTrack === "1" ||
    (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
  const monthlyNodes = {
    monthlyBrowsers: panel.querySelector<HTMLElement>("[data-stat='monthlyBrowsers']"),
    onlineNow: panel.querySelector<HTMLElement>("[data-stat='onlineNow']"),
    listingOpens: panel.querySelector<HTMLElement>("[data-stat='listingOpens']"),
  };
  const monthLabel = panel.querySelector<HTMLElement>("[data-stat-month]");
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
  }
  function present(data: Counts): void {
    for (const key of ["monthlyBrowsers", "onlineNow", "listingOpens"] as const) {
      if (Number.isSafeInteger(data[key]) && data[key] >= 0 && monthlyNodes[key])
        monthlyNodes[key]!.textContent = new Intl.NumberFormat().format(data[key]);
    }
    if (monthLabel && /^\d{4}-\d{2}$/.test(data.month))
      monthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${data.month}-01T12:00:00Z`));
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
    try {
      const pending = JSON.parse(safeRead(PENDING_KEY) ?? "[]") as string[];
      if (!Array.isArray(pending)) return;
      const failed: string[] = [];
      for (const visitorId of pending.slice(-12)) {
        try {
          const response = await fetch("/api/site-stats", {
            method: "DELETE", headers: { "content-type": "application/json" },
            body: JSON.stringify({ visitorId }), credentials: "omit", cache: "no-store",
          });
          if (!response.ok) failed.push(visitorId);
        } catch { failed.push(visitorId); }
      }
      if (failed.length) safeWrite(PENDING_KEY, JSON.stringify(failed));
      else localStorage.removeItem(PENDING_KEY);
    } catch { /* Retry on the next page visit. */ }
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
    const open = !openedThisPage && /^\/opportunities\/[a-z0-9-]+\/?$/.test(location.pathname);
    try {
      const response = await fetch("/api/site-stats", id ? {
        method: "POST", headers: { "content-type": "application/json" },
        credentials: "omit", cache: "no-store", body: JSON.stringify({ visitorId: id, open }),
      } : { method: "GET", credentials: "omit", cache: "no-store" });
      if (response.ok) { present(await response.json() as Counts); if (id && open) openedThisPage = true; }
      else if (id) {
        const fallback = await fetch("/api/site-stats", { credentials: "omit", cache: "no-store" });
        if (fallback.ok) present(await fallback.json() as Counts);
      }
    } catch { /* Leave last known counters or dashes; never invent numbers. */ }
    finally {
      requestInFlight = false;
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

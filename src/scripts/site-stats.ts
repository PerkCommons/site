/** Public, first-party, pseudonymous and approximate activity counters. */
const container = document.querySelector<HTMLElement>("#site-activity-stats");
if (container) {
  type Counts = { month: string; monthlyBrowsers: number; onlineNow: number; listingOpens: number };
  const nodes = {
    monthlyBrowsers: container.querySelector<HTMLElement>("[data-stat='monthlyBrowsers']"),
    onlineNow: container.querySelector<HTMLElement>("[data-stat='onlineNow']"),
    listingOpens: container.querySelector<HTMLElement>("[data-stat='listingOpens']"),
  };
  const monthLabel = container.querySelector<HTMLElement>("[data-stat-month]");
  const optOutStorageKey = "perkcommons-stats-opt-out";
  const visitorKeyPrefix = "perkcommons-stats-browser-";

  function present(data: Counts): void {
    for (const name of ["monthlyBrowsers", "onlineNow", "listingOpens"] as const) {
      if (typeof data[name] === "number" && Number.isSafeInteger(data[name]) && data[name] >= 0)
        if (nodes[name]) nodes[name]!.textContent = new Intl.NumberFormat().format(data[name]);
    }
    if (monthLabel && /^\d{4}-\d{2}$/.test(data.month)) {
      monthLabel.textContent = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${data.month}-01T12:00:00Z`));
    }
  }

  function consentPermits(): boolean {
    if (navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true) return false;
    try { return localStorage.getItem(optOutStorageKey) !== "1"; }
    catch { return false; }
  }

  function browserId(): string | null {
    if (!consentPermits()) return null;
    try {
      const key = visitorKeyPrefix + new Date().toISOString().slice(0, 7);
      let value = localStorage.getItem(key);
      if (!value) {
        value = crypto.randomUUID();
        localStorage.setItem(key, value);
        // Old identifiers aren't needed after month rollover.
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const old = localStorage.key(i);
          if (old?.startsWith(visitorKeyPrefix) && old !== key) localStorage.removeItem(old);
        }
      }
      return value;
    } catch { return null; }
  }

  let openedThisPage = false;
  let requestInFlight = false;
  async function refresh(): Promise<void> {
    if (requestInFlight) return;
    if (document.visibilityState !== "visible") return;
    requestInFlight = true;
    const id = browserId();
    const open = !openedThisPage && /^\/opportunities\/[a-z0-9-]+\/?$/.test(location.pathname);
    try {
      const response = await fetch("/api/site-stats", id ? {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "omit",
        cache: "no-store",
        body: JSON.stringify({ visitorId: id, open }),
      } : { method: "GET", credentials: "omit", cache: "no-store" });
      if (response.ok) {
        present(await response.json() as Counts);
        if (id && open) openedThisPage = true;
      }
      else if (id) { // Read-only fallback when a write is rate-limited or unavailable.
        const fallback = await fetch("/api/site-stats", { cache: "no-store", credentials: "omit" });
        if (fallback.ok) present(await fallback.json() as Counts);
      }
    } catch { /* Leave the last known counters or a dash; never invent numbers. */ }
    finally { requestInFlight = false; }
  }
  void refresh();
  const interval = window.setInterval(() => { void refresh(); }, 60_000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void refresh(); });
  window.addEventListener("pagehide", () => window.clearInterval(interval), { once: true });
}

import type { Env } from "./lib/types.js";

interface Stats { month: string; monthlyBrowsers: number; onlineNow: number; listingOpens: number; }

// One durable, strongly consistent SQLite-backed counter for the public site.
// IDs are HMACed by the Worker; no raw browser identifiers or IPs are persisted.
export class SiteStats {
  private readonly ctx: DurableObjectState;
  private lastPrune = 0;

  constructor(ctx: DurableObjectState, _env: Env) {
    this.ctx = ctx;
    const sql = this.ctx.storage.sql;
    sql.exec("CREATE TABLE IF NOT EXISTS monthly_visitors (month TEXT NOT NULL, visitor TEXT NOT NULL, first_seen INTEGER NOT NULL, PRIMARY KEY (month, visitor))");
    sql.exec("CREATE TABLE IF NOT EXISTS presence (visitor TEXT PRIMARY KEY, last_seen INTEGER NOT NULL)");
    sql.exec("CREATE TABLE IF NOT EXISTS recent_opens (visitor TEXT NOT NULL, listing TEXT NOT NULL, last_seen INTEGER NOT NULL, PRIMARY KEY (visitor, listing))");
    sql.exec("CREATE TABLE IF NOT EXISTS totals (name TEXT PRIMARY KEY, value INTEGER NOT NULL DEFAULT 0)");
    sql.exec("INSERT OR IGNORE INTO totals (name, value) VALUES ('listing_opens', 0)");
  }

  private prune(now: number): void {
    if (now - this.lastPrune < 60_000) return;
    this.lastPrune = now;
    const sql = this.ctx.storage.sql;
    sql.exec("DELETE FROM presence WHERE last_seen < ?", now - 5 * 60_000);
    sql.exec("DELETE FROM recent_opens WHERE last_seen < ?", now - 30 * 60_000);
    // Keep 13 months of browser counts; the lifetime listing total remains.
    const expiryMonth = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth() - 12, 1)).toISOString().slice(0, 7);
    sql.exec("DELETE FROM monthly_visitors WHERE month < ?", expiryMonth);
  }

  private snapshot(now: number): Stats {
    const sql = this.ctx.storage.sql;
    const month = new Date(now).toISOString().slice(0, 7);
    const monthlyBrowsers = sql.exec<{ total: number }>("SELECT count(*) AS total FROM monthly_visitors WHERE month = ?", month).toArray()[0]?.total ?? 0;
    const onlineNow = sql.exec<{ total: number }>("SELECT count(*) AS total FROM presence WHERE last_seen >= ?", now - 5 * 60_000).toArray()[0]?.total ?? 0;
    const listingOpens = sql.exec<{ value: number }>("SELECT value FROM totals WHERE name = 'listing_opens'").toArray()[0]?.value ?? 0;
    return { month, monthlyBrowsers, onlineNow, listingOpens };
  }

  async fetch(request: Request): Promise<Response> {
    const now = Date.now();
    this.prune(now);
    if (new URL(request.url).pathname === "/record" && request.method === "POST") {
      const value = await request.json() as { visitor?: unknown; listing?: unknown };
      if (typeof value.visitor !== "string" || !/^[a-f0-9]{64}$/.test(value.visitor))
        return new Response("Invalid event", { status: 400 });
      const visitor = value.visitor;
      const sql = this.ctx.storage.sql;
      const month = new Date(now).toISOString().slice(0, 7);
      sql.exec("INSERT OR IGNORE INTO monthly_visitors (month, visitor, first_seen) VALUES (?, ?, ?)", month, visitor, now);
      sql.exec("INSERT INTO presence (visitor, last_seen) VALUES (?, ?) ON CONFLICT(visitor) DO UPDATE SET last_seen = excluded.last_seen", visitor, now);
      if (typeof value.listing === "string" && /^[a-z0-9-]{2,140}$/.test(value.listing)) {
        const previous = sql.exec<{ last_seen: number }>("SELECT last_seen FROM recent_opens WHERE visitor = ? AND listing = ?", visitor, value.listing).toArray()[0];
        if (!previous || previous.last_seen < now - 30 * 60_000) {
          sql.exec("INSERT INTO recent_opens (visitor, listing, last_seen) VALUES (?, ?, ?) ON CONFLICT(visitor, listing) DO UPDATE SET last_seen = excluded.last_seen", visitor, value.listing, now);
          sql.exec("UPDATE totals SET value = value + 1 WHERE name = 'listing_opens'");
        }
      }
    } else if (request.method !== "GET" || new URL(request.url).pathname !== "/read") {
      return new Response("Not found", { status: 404 });
    }
    return Response.json(this.snapshot(now), { headers: { "cache-control": "no-store" } });
  }
}

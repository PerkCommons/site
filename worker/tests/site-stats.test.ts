import assert from "node:assert/strict";
import test from "node:test";
import { handleSiteStats } from "../routes/site-stats.js";
import type { Env } from "../lib/types.js";

const origin = "https://perkcommons.com";
const id = "826bad35-381b-4a8d-a2dc-902c6930d2d3";
function mockEnv() {
  const calls: Array<{ path: string; value?: { visitor: string; listing: string | null } }> = [];
  const env = {
    SUBMISSION_FINGERPRINT_SECRET: "test-secret-not-private",
    TRACKING_RATE_LIMITER: { limit: async () => ({ success: true }) },
    SITE_STATS: { getByName: (_name: string) => ({ fetch: async (url: string, init?: RequestInit) => {
      calls.push({ path: new URL(url).pathname, value: init?.body ? JSON.parse(String(init.body)) : undefined });
      return Response.json({ month: "2026-10", monthlyBrowsers: 5, onlineNow: 2, listingOpens: 7 });
    } }) },
  } as unknown as Env;
  return { env, calls };
}
function event(headers: Record<string,string> = {}, body: unknown = { visitorId: id, open: true }) {
  return new Request(`${origin}/api/site-stats`, {
    method: "POST",
    headers: { origin, referer: `${origin}/opportunities/test-program/`, "user-agent": "Mozilla/5.0", "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("returns public counters without recording an event", async () => {
  const { env, calls } = mockEnv();
  const response = await handleSiteStats(new Request(`${origin}/api/site-stats`), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json() as { monthlyBrowsers: number }).monthlyBrowsers, 5);
  assert.deepEqual(calls.map(x => x.path), ["/read"]);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("records a listing opening using a hashed identifier", async () => {
  const { env, calls } = mockEnv();
  const response = await handleSiteStats(event(), env);
  assert.equal(response.status, 200);
  assert.equal(calls[0]?.path, "/record");
  assert.equal(calls[0]?.value?.listing, "test-program");
  assert.match(calls[0]?.value?.visitor ?? "", /^[a-f0-9]{64}$/);
  assert.ok(!JSON.stringify(calls).includes(id));
});

test("heartbeat doesn't count another listing open", async () => {
  const { env, calls } = mockEnv();
  assert.equal((await handleSiteStats(event({}, { visitorId: id, open: false }), env)).status, 200);
  assert.equal(calls[0]?.value?.listing, null);
});

test("rejects cross-origin traffic, bots, private pages, and invalid IDs", async () => {
  for (const request of [
    event({ origin: "https://evil.example" }),
    event({ "user-agent": "GPTBot/1.0" }),
    event({ referer: `${origin}/moderator-login/` }),
    event({}, { visitorId: "fake", open: true }),
    event({referer: "not a url"}),
  ]) {
    const { env, calls } = mockEnv();
    assert.notEqual((await handleSiteStats(request, env)).status, 200);
    assert.equal(calls.length, 0);
  }
});

test("returns the counter snapshot on methods only GET/POST", async () => {
  const { env, calls } = mockEnv();
  assert.equal((await handleSiteStats(new Request(`${origin}/api/site-stats`, { method: "DELETE" }), env)).status, 405);
  assert.equal(calls.length, 0);
});

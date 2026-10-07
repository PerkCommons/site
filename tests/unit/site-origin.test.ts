import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { resolveSiteOrigin } from "../../scripts/postbuild-site-assets.mjs";

test("production canonical origin defaults to perkcommons.com", async () => {
  const config = await readFile(
    new URL("../../astro.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(config, /https:\/\/perkcommons\.com/);
  assert.equal(resolveSiteOrigin({}), "https://perkcommons.com");
});

test("explicit site origin remains available for local and hosted verification", () => {
  assert.equal(
    resolveSiteOrigin({ PUBLIC_SITE_URL: "https://preview.example" }),
    "https://preview.example",
  );
  assert.equal(
    resolveSiteOrigin({ PUBLIC_SITE_URL: "http://localhost:4321" }),
    "http://localhost:4321",
  );
});

test("non-local public origins must use HTTPS", () => {
  assert.throws(
    () => resolveSiteOrigin({ PUBLIC_SITE_URL: "http://example.com" }),
    /must use HTTPS/i,
  );
});

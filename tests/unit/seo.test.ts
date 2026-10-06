import assert from "node:assert/strict";
import test from "node:test";

const loadSeo = async () => {
  const modulePath = "../../src/lib/seo.ts";
  return import(modulePath).catch(() => null);
};

test("SEO helper exists for environment-safe metadata", async () => {
  const seo = await loadSeo();
  assert.ok(seo, "src/lib/seo.ts must provide the shared SEO boundary");
});

test("canonicalUrl resolves against configured site origin", async () => {
  const seo = await loadSeo();
  assert.ok(seo);
  assert.equal(
    seo.canonicalUrl(new URL("https://next.example/"), "/about/").href,
    "https://next.example/about/",
  );
});

test("safeJsonLd cannot close its script element", async () => {
  const seo = await loadSeo();
  assert.ok(seo);
  const original = "</script><script>alert(1)</script>\u2028";
  const encoded = seo.safeJsonLd({ name: original });
  assert.equal(encoded.includes("</script>"), false);
  assert.equal(JSON.parse(encoded).name, original);
});

test("base structured data uses the configured origin", async () => {
  const seo = await loadSeo();
  assert.ok(seo);
  const json = JSON.stringify(seo.baseStructuredData(new URL("https://next.example/")));
  assert.match(json, /https:\/\/next\.example/);
  assert.doesNotMatch(json, /https:\/\/perkcommons\.com/);
});

test("base structured data links the site, project repositories, and supported contact point", async () => {
  const module = await loadSeo();
  assert.ok(module);
  const json = JSON.stringify(module.baseStructuredData(new URL("https://preview.example/")));
  assert.match(json, /https:\/\/github\.com\/PerkCommons\/site/);
  assert.match(json, /https:\/\/github\.com\/PerkCommons\/data/);
  assert.match(json, /mailto:hello@perkcommons\.com/);
  assert.match(json, /Nataniel Bogacki/);
  assert.doesNotMatch(json, /operated by Cod from Poland/);
  assert.match(json, /publisher/);
  assert.match(json, /#organization/);
});

test("structured data does not invent a local business, review score, or street address", async () => {
  const module = await loadSeo();
  assert.ok(module);
  const json = JSON.stringify(module.baseStructuredData(new URL("https://preview.example/")));
  assert.doesNotMatch(json, /LocalBusiness/);
  assert.doesNotMatch(json, /aggregateRating/);
  assert.doesNotMatch(json, /streetAddress/);
});

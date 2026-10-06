import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const loadPostbuild = async () => {
  const modulePath = "../../scripts/postbuild-site-assets.mjs";
  return import(modulePath).catch(() => null);
};

const loadAudit = async () => {
  const modulePath = "../../scripts/audit-site-quality.mjs";
  return import(modulePath).catch(() => null);
};

const pngHeader = (width = 1200, height = 630) => {
  const buffer = Buffer.alloc(24);
  Buffer.from("89504e470d0a1a0a", "hex").copy(buffer, 0);
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

const healthyHtml = `<!doctype html>
<html lang="en">
  <head>
    <title>PerkCommons</title>
    <meta name="description" content="Open opportunities" />
    <link rel="canonical" href="https://next.example/" />
    <link rel="icon" href="/favicon.svg" />
    <meta property="og:image" content="https://next.example/brand/social-card.png" />
    <script type="application/ld+json">{"@context":"https://schema.org"}</script>
  </head>
  <body><main><h1>PerkCommons</h1><p>Open opportunities.</p></main></body>
</html>`;

const writeHealthyFixture = async (root: string) => {
  await mkdir(join(root, "brand"), { recursive: true });
  await mkdir(join(root, "_astro"), { recursive: true });
  await writeFile(join(root, "index.html"), healthyHtml, "utf8");
  await writeFile(join(root, "robots.txt"), "User-agent: *\nAllow: /\nSitemap: https://next.example/sitemap.xml\n", "utf8");
  await writeFile(join(root, "sitemap.xml"), "<urlset></urlset>", "utf8");
  await writeFile(join(root, "llms.txt"), "PerkCommons open opportunity directory", "utf8");
  await writeFile(join(root, "favicon.svg"), "<svg></svg>", "utf8");
  await writeFile(join(root, "brand", "social-card.png"), pngHeader());
  await writeFile(join(root, "_astro", "app.js"), "console.log('ok')", "utf8");
};

test("postbuild crawler artifacts use the configured deployment origin", async () => {
  const postbuild = await loadPostbuild();
  assert.ok(postbuild, "scripts/postbuild-site-assets.mjs must exist");

  const root = await mkdtemp(join(tmpdir(), "perkcommons-site-assets-"));
  try {
    const sitemap = "<?xml version=\"1.0\"?><sitemapindex></sitemapindex>";
    await writeFile(join(root, "sitemap-index.xml"), sitemap, "utf8");
    await postbuild.postbuildSiteAssets(root, {
      PUBLIC_SITE_URL: "https://preview.example",
    });

    assert.equal(await readFile(join(root, "sitemap.xml"), "utf8"), sitemap);
    assert.equal(
      await readFile(join(root, "robots.txt"), "utf8"),
      "User-agent: *\nAllow: /\nSitemap: https://preview.example/sitemap.xml\n",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("postbuild crawler artifacts reject non-HTTPS public origins", async () => {
  const postbuild = await loadPostbuild();
  assert.ok(postbuild);
  const root = await mkdtemp(join(tmpdir(), "perkcommons-site-assets-"));
  try {
    await writeFile(join(root, "sitemap-index.xml"), "<sitemapindex/>", "utf8");
    await assert.rejects(
      postbuild.postbuildSiteAssets(root, { PUBLIC_SITE_URL: "http://preview.example" }),
      /HTTPS/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("custom 404 page exists and is explicitly noindex", async () => {
  const page = await readFile(resolve("src/pages/404.astro"), "utf8").catch(() => null);
  assert.ok(page, "src/pages/404.astro must exist");
  assert.match(page, /<BaseLayout[\s\S]*noindex/);
  assert.match(page, /<h1\b/);
  assert.match(page, /href="\/opportunities\/"/);
});

test("llms.txt identifies canonical public data and provenance entry points", async () => {
  const llms = await readFile(resolve("public/llms.txt"), "utf8").catch(() => null);
  assert.ok(llms, "public/llms.txt must exist");
  assert.doesNotMatch(llms, /experimental fork/i);
  assert.match(llms, /review state/i);
  assert.match(llms, /\/api\/v1\/opportunities/);
  assert.match(llms, /\/data\/opportunities\.json/);
  assert.match(llms, /PerkCommons\/site/);
  assert.match(llms, /PerkCommons\/data/);
});

test("social preview is a 1200x630 PNG", async () => {
  const image = await readFile(resolve("public/brand/social-card.png")).catch(() => null);
  assert.ok(image, "public/brand/social-card.png must exist");
  assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(image.readUInt32BE(16), 1200);
  assert.equal(image.readUInt32BE(20), 630);
});

test("site-quality audit accepts a healthy static fixture", async () => {
  const audit = await loadAudit();
  assert.ok(audit, "scripts/audit-site-quality.mjs must exist");
  const root = await mkdtemp(join(tmpdir(), "perkcommons-audit-"));
  try {
    await writeHealthyFixture(root);
    const result = await audit.auditDist(root, { maxLargestJsBytes: 150_000 });
    assert.deepEqual(result.errors, []);
    assert.equal(result.metrics.jsBytes > 0, true);
    assert.equal(result.metrics.largestJsBytes > 0, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("site-quality audit reports HTML metadata and heading regressions", async () => {
  const audit = await loadAudit();
  assert.ok(audit, "scripts/audit-site-quality.mjs must exist");
  const root = await mkdtemp(join(tmpdir(), "perkcommons-audit-"));
  try {
    await writeHealthyFixture(root);
    await writeFile(join(root, "index.html"), "<!doctype html><html><head><title></title></head><body><main></main></body></html>", "utf8");
    const { errors } = await audit.auditDist(root, { maxLargestJsBytes: 150_000 });
    assert.ok(errors.some((error: string) => /lang/i.test(error)));
    assert.ok(errors.some((error: string) => /title/i.test(error)));
    assert.ok(errors.some((error: string) => /description/i.test(error)));
    assert.ok(errors.some((error: string) => /canonical/i.test(error)));
    assert.ok(errors.some((error: string) => /favicon/i.test(error)));
    assert.ok(errors.some((error: string) => /og:image/i.test(error)));
    assert.ok(errors.some((error: string) => /JSON-LD/i.test(error)));
    assert.ok(errors.some((error: string) => /H1/i.test(error)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("site-quality audit reports missing crawler assets and invalid social image", async () => {
  const audit = await loadAudit();
  assert.ok(audit, "scripts/audit-site-quality.mjs must exist");
  const root = await mkdtemp(join(tmpdir(), "perkcommons-audit-"));
  try {
    await writeHealthyFixture(root);
    await Promise.all([
      unlink(join(root, "robots.txt")),
      unlink(join(root, "sitemap.xml")),
      unlink(join(root, "llms.txt")),
    ]);
    await writeFile(join(root, "brand", "social-card.png"), pngHeader(600, 315));
    const { errors } = await audit.auditDist(root, { maxLargestJsBytes: 150_000 });
    assert.ok(errors.some((error: string) => /robots\.txt/i.test(error)));
    assert.ok(errors.some((error: string) => /sitemap\.xml/i.test(error)));
    assert.ok(errors.some((error: string) => /llms\.txt/i.test(error)));
    assert.ok(errors.some((error: string) => /1200x630/i.test(error)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("site-quality audit reports source maps and JavaScript budget regressions", async () => {
  const audit = await loadAudit();
  assert.ok(audit, "scripts/audit-site-quality.mjs must exist");
  const root = await mkdtemp(join(tmpdir(), "perkcommons-audit-"));
  try {
    await writeHealthyFixture(root);
    await writeFile(join(root, "_astro", "app.js.map"), "{}", "utf8");
    await writeFile(join(root, "_astro", "large.js"), "x".repeat(150_001), "utf8");
    const { errors } = await audit.auditDist(root, { maxLargestJsBytes: 150_000 });
    assert.ok(errors.some((error: string) => /source map/i.test(error)));
    assert.ok(errors.some((error: string) => /JavaScript budget/i.test(error)));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
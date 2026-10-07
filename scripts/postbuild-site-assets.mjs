import { copyFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const FALLBACK_SITE = "https://perkcommons.com";

export const resolveSiteOrigin = (env = process.env) => {
  const configuredSite = env.PUBLIC_SITE_URL?.trim();
  const candidate = configuredSite ?? FALLBACK_SITE;
  const url = new URL(candidate);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error("Crawler artifact origin must use HTTPS outside localhost.");
  }
  return url.origin;
};

export const postbuildSiteAssets = async (distRoot = resolve("dist"), env = process.env) => {
  const origin = resolveSiteOrigin(env);
  await copyFile(resolve(distRoot, "sitemap-index.xml"), resolve(distRoot, "sitemap.xml"));
  await writeFile(
    resolve(distRoot, "robots.txt"),
    `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`,
    "utf8",
  );
};

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href
  : false;

if (invokedDirectly) {
  await postbuildSiteAssets();
}

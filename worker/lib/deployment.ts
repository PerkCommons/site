import { assertForkOnlyRepository } from "./github-targets.js";
import { RequestError } from "./http.js";
import { dispatchSiteDeployment } from "./publication-github.js";
import type { Env } from "./types.js";

const defaultSiteRepository = "PerkCommons/site";

export const siteDeploymentConfigured = (env: Env): boolean =>
  Boolean(env.VERCEL_DEPLOY_HOOK_URL || env.GITHUB_SITE_DEPLOY_TOKEN);

export async function requestSiteDeployment(env: Env): Promise<void> {
  if (env.VERCEL_DEPLOY_HOOK_URL) {
    const response = await fetch(env.VERCEL_DEPLOY_HOOK_URL, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      throw new RequestError(
        "The Vercel deployment request failed.",
        502,
        "deployment_request_failed",
      );
    }
    return;
  }

  if (env.GITHUB_SITE_DEPLOY_TOKEN) {
    const siteRepository =
      env.GITHUB_SITE_REPOSITORY ?? defaultSiteRepository;
    assertForkOnlyRepository(siteRepository, env.FORK_ONLY_MODE);
    await dispatchSiteDeployment(
      env.GITHUB_SITE_DEPLOY_TOKEN,
      siteRepository,
    );
    return;
  }

  throw new RequestError(
    "Automated site deployment is not configured.",
    503,
    "deployment_not_configured",
  );
}
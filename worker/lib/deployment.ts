import { assertForkOnlyRepository } from "./github-targets.js";
import { RequestError } from "./http.js";
import { dispatchSiteDeployment } from "./publication-github.js";
import type { Env } from "./types.js";

const defaultSiteRepository = "PerkCommons/site";
const exactCommitPattern = /^[0-9a-f]{40}$/i;

export const siteDeploymentConfigured = (env: Env): boolean =>
  Boolean(env.GITHUB_SITE_DEPLOY_TOKEN);

export async function requestSiteDeployment(
  env: Env,
  dataSha: string,
): Promise<void> {
  if (!exactCommitPattern.test(dataSha)) {
    throw new RequestError(
      "The site deployment requires an exact data commit.",
      500,
      "deployment_data_sha_invalid",
    );
  }

  if (env.GITHUB_SITE_DEPLOY_TOKEN) {
    const siteRepository =
      env.GITHUB_SITE_REPOSITORY ?? defaultSiteRepository;
    assertForkOnlyRepository(siteRepository, env.FORK_ONLY_MODE);
    await dispatchSiteDeployment(
      env.GITHUB_SITE_DEPLOY_TOKEN,
      siteRepository,
      dataSha,
    );
    return;
  }

  throw new RequestError(
    "Automated site deployment is not configured.",
    503,
    "deployment_not_configured",
  );
}

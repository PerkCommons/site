const VERCEL_DATA_REPOSITORY =
  "https://github.com/PerkCommons/data.git";
const VERCEL_DEFAULT_REF = "main";

export function isExactCommitRef(ref) {
  return typeof ref === "string" && /^[0-9a-f]{40}$/i.test(ref);
}

/**
 * Resolve the canonical public data source. Release builds may pin an exact
 * commit so the deployed site and dataset are reproducible.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ repository: string, ref: string | undefined }}
 */
export function resolveDataSource(env = process.env) {
  const isVercel = env.VERCEL === "1";
  const configuredRepository = env.PERKCOMMONS_DATA_REPOSITORY?.trim();
  const configuredRef = env.PERKCOMMONS_DATA_REF?.trim();

  const repository =
    configuredRepository || (isVercel ? VERCEL_DATA_REPOSITORY : "");
  const ref = configuredRef || (isVercel ? VERCEL_DEFAULT_REF : undefined);
  const isReleaseCandidate =
    isVercel && env.PERKCOMMONS_RELEASE_CANDIDATE?.trim() === "1";

  if (!repository) {
    throw new Error(
      "Set PERKCOMMONS_DATA_REPOSITORY to the PerkCommons data repository.",
    );
  }
  if (isVercel && repository !== VERCEL_DATA_REPOSITORY) {
    throw new Error(
      "Vercel builds are restricted to the canonical PerkCommons/data repository.",
    );
  }
  if (
    isReleaseCandidate &&
    (!configuredRef || !isExactCommitRef(configuredRef))
  ) {
    throw new Error(
      "PERKCOMMONS_DATA_REF must be an exact 40-character commit SHA for release-candidate Vercel builds.",
    );
  }

  return { repository, ref };
}

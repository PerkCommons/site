const CANONICAL_DATA_REPOSITORY =
  "https://github.com/PerkCommons/data.git";
const DEFAULT_DATA_REF = "main";

export function isExactCommitRef(ref) {
  return typeof ref === "string" && /^[0-9a-f]{40}$/i.test(ref);
}

/**
 * Resolve the canonical public data source. Release builds pin an exact
 * commit so the deployed site and dataset are reproducible.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ repository: string, ref: string | undefined }}
 */
export function resolveDataSource(env = process.env) {
  const configuredRepository = env.PERKCOMMONS_DATA_REPOSITORY?.trim();
  const configuredRef = env.PERKCOMMONS_DATA_REF?.trim();

  const repository = configuredRepository || CANONICAL_DATA_REPOSITORY;
  const ref = configuredRef || DEFAULT_DATA_REF;
  const isReleaseCandidate =
    env.PERKCOMMONS_RELEASE_CANDIDATE?.trim() === "1";

  if (repository !== CANONICAL_DATA_REPOSITORY) {
    throw new Error(
      "Builds are restricted to the canonical PerkCommons/data repository.",
    );
  }
  if (
    isReleaseCandidate &&
    (!configuredRef || !isExactCommitRef(configuredRef))
  ) {
    throw new Error(
      "PERKCOMMONS_DATA_REF must be an exact 40-character commit SHA for release-candidate builds.",
    );
  }

  return { repository, ref };
}

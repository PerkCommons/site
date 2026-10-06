import { RequestError } from "./http.js";
import type { Env } from "./types.js";

export interface GithubTargetConfig {
  dataRepository: string;
  dataBranch: string;
  headOwner: string;
}

export function assertForkOnlyRepository(
  repository: string,
  forkOnlyMode: string | undefined,
): void {
  if (
    forkOnlyMode === "true" &&
    repository.toLowerCase().startsWith("perkcommons/")
  ) {
    throw new RequestError(
      "Fork-only mode refused an original PerkCommons repository.",
      503,
      "fork_only_violation",
    );
  }
}

export function githubTargetConfig(env: Env): GithubTargetConfig {
  const dataRepository = env.GITHUB_DATA_REPOSITORY ?? "PerkCommons/data";
  const dataBranch = env.GITHUB_DATA_BRANCH ?? "main";
  const headOwner =
    env.GITHUB_HEAD_OWNER ?? dataRepository.split("/")[0] ?? "";

  assertForkOnlyRepository(dataRepository, env.FORK_ONLY_MODE);
  if (!headOwner)
    throw new RequestError(
      "GitHub publication head owner is not configured.",
      503,
      "publication_not_configured",
    );

  return { dataRepository, dataBranch, headOwner };
}
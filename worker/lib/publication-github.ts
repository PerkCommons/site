import { RequestError } from "./http.js";
import type { GithubTargetConfig } from "./github-targets.js";
import type { PublishedOpportunity } from "./publication-data.js";

const GITHUB_API_VERSION = "2026-03-10";

export interface GithubPullRequest {
  number: number;
  html_url: string;
  state: "open" | "closed";
  merged: boolean;
  merged_at: string | null;
  merge_commit_sha: string | null;
  head: { sha: string };
}

export interface GithubCheckRun {
  name: string;
  status: string;
  conclusion: string | null;
}

class GithubError extends Error {
  constructor(
    readonly status: number,
    readonly operation: string,
  ) {
    super(`GitHub ${operation} failed (${status})`);
  }
}

const githubRequest = async <T>(
  token: string | undefined,
  path: string,
  init?: RequestInit,
  allowNotFound = false,
): Promise<T | null> => {
  if (!token)
    throw new RequestError(
      "Automated publication is not configured.",
      503,
      "publication_not_configured",
    );
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "user-agent": "PerkCommons-Publication-Worker",
      "x-github-api-version": GITHUB_API_VERSION,
      ...init?.headers,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    console.error(
      JSON.stringify({
        event: "github_publication_request_failed",
        operation: path.split("?")[0],
        status: response.status,
      }),
    );
    throw new GithubError(response.status, path.split("?")[0] ?? "request");
  }
  if (response.status === 204) return null;
  return (await response.json()) as T;
};

export const publicationBranch = (batchId: string) => `publication-${batchId}`;
export const removalBranch = (batchId: string) => `removal-${batchId}`;

export interface RemovalPullRequestResult {
  baseSha: string;
  pullRequest: GithubPullRequest | null;
}

export const createPublicationPullRequest = async (
  token: string | undefined,
  config: GithubTargetConfig,
  batchId: string,
  opportunities: PublishedOpportunity[],
): Promise<GithubPullRequest> => {
  const branch = publicationBranch(batchId);
  const existingPulls = await githubRequest<GithubPullRequest[]>(
    token,
    `/repos/${config.dataRepository}/pulls?state=open&base=${config.dataBranch}&head=${config.headOwner}:${branch}`,
  );
  if (existingPulls?.[0]) return existingPulls[0];

  const baseReference = await githubRequest<{ object: { sha: string } }>(
    token,
    `/repos/${config.dataRepository}/git/ref/heads/${config.dataBranch}`,
  );
  if (!baseReference) throw new GithubError(404, "read data branch");
  const baseCommit = await githubRequest<{ tree: { sha: string } }>(
    token,
    `/repos/${config.dataRepository}/git/commits/${baseReference.object.sha}`,
  );
  if (!baseCommit) throw new GithubError(404, "read data commit");
  const tree = await githubRequest<{ sha: string }>(
    token,
    `/repos/${config.dataRepository}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: opportunities.map((opportunity) => ({
          path: `opportunities/${opportunity.id}.json`,
          mode: "100644",
          type: "blob",
          content: `${JSON.stringify(opportunity, null, 2)}\n`,
        })),
      }),
    },
  );
  if (!tree) throw new GithubError(500, "create data tree");
  const commit = await githubRequest<{ sha: string }>(
    token,
    `/repos/${config.dataRepository}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: `feat(data): publish ${opportunities.length} approved opportunities`,
        tree: tree.sha,
        parents: [baseReference.object.sha],
      }),
    },
  );
  if (!commit) throw new GithubError(500, "create data commit");

  const referencePath = `/repos/${config.dataRepository}/git/refs/heads/${branch}`;
  const existingReference = await githubRequest<{ object: { sha: string } }>(
    token,
    referencePath,
    undefined,
    true,
  );
  await githubRequest(
    token,
    existingReference
      ? referencePath
      : `/repos/${config.dataRepository}/git/refs`,
    {
      method: existingReference ? "PATCH" : "POST",
      body: JSON.stringify(
        existingReference
          ? { sha: commit.sha, force: true }
          : { ref: `refs/heads/${branch}`, sha: commit.sha },
      ),
    },
  );

  const pullRequest = await githubRequest<GithubPullRequest>(
    token,
    `/repos/${config.dataRepository}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: `feat(data): publish ${opportunities.length} approved opportunities`,
        head: branch,
        base: config.dataBranch,
        body: [
          "## Automated publication batch",
          "",
          `Batch: \`${batchId}\``,
          `Opportunities: ${opportunities.length}`,
          "",
          "Each record was normalized and approved in the PerkCommons moderation workspace. This pull request is merged only after the data validation workflow passes.",
        ].join("\n"),
      }),
    },
  );
  if (!pullRequest)
    throw new GithubError(500, "create publication pull request");
  return pullRequest;
};

export const createRemovalPullRequest = async (
  token: string | undefined,
  config: GithubTargetConfig,
  batchId: string,
  listingId: string,
): Promise<RemovalPullRequestResult> => {
  const branch = removalBranch(batchId);
  const existingPulls = await githubRequest<GithubPullRequest[]>(
    token,
    `/repos/${config.dataRepository}/pulls?state=open&base=${config.dataBranch}&head=${config.headOwner}:${branch}`,
  );
  if (existingPulls?.[0])
    return { baseSha: existingPulls[0].head.sha, pullRequest: existingPulls[0] };

  const baseReference = await githubRequest<{ object: { sha: string } }>(
    token,
    `/repos/${config.dataRepository}/git/ref/heads/${config.dataBranch}`,
  );
  if (!baseReference) throw new GithubError(404, "read data branch");

  const opportunityPath = `opportunities/${listingId}.json`;
  const opportunity = await githubRequest<{ sha: string }>(
    token,
    `/repos/${config.dataRepository}/contents/${opportunityPath}?ref=${config.dataBranch}`,
    undefined,
    true,
  );
  if (!opportunity)
    return { baseSha: baseReference.object.sha, pullRequest: null };

  const baseCommit = await githubRequest<{ tree: { sha: string } }>(
    token,
    `/repos/${config.dataRepository}/git/commits/${baseReference.object.sha}`,
  );
  if (!baseCommit) throw new GithubError(404, "read data commit");
  const tree = await githubRequest<{ sha: string }>(
    token,
    `/repos/${config.dataRepository}/git/trees`,
    {
      method: "POST",
      body: JSON.stringify({
        base_tree: baseCommit.tree.sha,
        tree: [
          {
            path: opportunityPath,
            mode: "100644",
            type: "blob",
            sha: null,
          },
        ],
      }),
    },
  );
  if (!tree) throw new GithubError(500, "create removal tree");
  const commit = await githubRequest<{ sha: string }>(
    token,
    `/repos/${config.dataRepository}/git/commits`,
    {
      method: "POST",
      body: JSON.stringify({
        message: `fix(data): remove reported opportunity ${listingId}`,
        tree: tree.sha,
        parents: [baseReference.object.sha],
      }),
    },
  );
  if (!commit) throw new GithubError(500, "create removal commit");

  const referencePath = `/repos/${config.dataRepository}/git/refs/heads/${branch}`;
  const existingReference = await githubRequest<{ object: { sha: string } }>(
    token,
    referencePath,
    undefined,
    true,
  );
  await githubRequest(
    token,
    existingReference
      ? referencePath
      : `/repos/${config.dataRepository}/git/refs`,
    {
      method: existingReference ? "PATCH" : "POST",
      body: JSON.stringify(
        existingReference
          ? { sha: commit.sha, force: true }
          : { ref: `refs/heads/${branch}`, sha: commit.sha },
      ),
    },
  );

  const pullRequest = await githubRequest<GithubPullRequest>(
    token,
    `/repos/${config.dataRepository}/pulls`,
    {
      method: "POST",
      body: JSON.stringify({
        title: `fix(data): remove reported opportunity ${listingId}`,
        head: branch,
        base: config.dataBranch,
        body: [
          "## Automated reported-listing removal",
          "",
          `Removal batch: \`${batchId}\``,
          `Listing: \`${listingId}\``,
          "",
          "A moderator upheld a public report for this listing. The listing remains suppressed while this pull request validates and is removed from the published dataset.",
        ].join("\n"),
      }),
    },
  );
  if (!pullRequest) throw new GithubError(500, "create removal pull request");
  return { baseSha: baseReference.object.sha, pullRequest };
};

export const getPublicationPullRequest = (
  token: string | undefined,
  config: GithubTargetConfig,
  number: number,
) =>
  githubRequest<GithubPullRequest>(
    token,
    `/repos/${config.dataRepository}/pulls/${number}`,
  );

export const getPublicationChecks = async (
  token: string | undefined,
  config: GithubTargetConfig,
  sha: string,
): Promise<GithubCheckRun[]> => {
  const result = await githubRequest<{ check_runs: GithubCheckRun[] }>(
    token,
    `/repos/${config.dataRepository}/commits/${sha}/check-runs?filter=latest`,
  );
  return result?.check_runs ?? [];
};

export const mergePublicationPullRequest = (
  token: string | undefined,
  config: GithubTargetConfig,
  number: number,
  sha: string,
  itemCount: number,
) =>
  githubRequest<{ merged: boolean; sha: string }>(
    token,
    `/repos/${config.dataRepository}/pulls/${number}/merge`,
    {
      method: "PUT",
      body: JSON.stringify({
        sha,
        merge_method: "squash",
        commit_title: `feat(data): publish ${itemCount} approved opportunities`,
      }),
    },
  );

export const mergeRemovalPullRequest = (
  token: string | undefined,
  config: GithubTargetConfig,
  number: number,
  sha: string,
  listingId: string,
) =>
  githubRequest<{ merged: boolean; sha: string }>(
    token,
    `/repos/${config.dataRepository}/pulls/${number}/merge`,
    {
      method: "PUT",
      body: JSON.stringify({
        sha,
        merge_method: "squash",
        commit_title: `fix(data): remove reported opportunity ${listingId}`,
      }),
    },
  );

export const dispatchSiteDeployment = (
  token: string | undefined,
  siteRepository: string,
  dataSha: string,
) =>
  githubRequest(
    token,
    `/repos/${siteRepository}/actions/workflows/deploy.yml/dispatches`,
    {
      method: "POST",
      body: JSON.stringify({
        ref: "main",
        inputs: { data_sha: dataSha },
      }),
    },
  );
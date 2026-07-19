import {
  createRemovalPullRequest,
  dispatchSiteDeployment,
  getPublicationChecks,
  getPublicationPullRequest,
  mergeRemovalPullRequest,
  removalBranch,
} from "./publication-github";
import { callRpc, supabaseRequest } from "./supabase";
import type { Env } from "./types";

export interface ListingRemovalBatch {
  id: string;
  report_id: string;
  listing_id: string;
  status: "preparing" | "validating" | "merging" | "removed" | "failed";
  created_by: string;
  github_branch: string | null;
  github_pr_number: number | null;
  github_pr_url: string | null;
  github_head_sha: string | null;
  github_merge_sha: string | null;
  last_error_code: string | null;
  deployment_requested_at: string | null;
  created_at: string;
  removed_at: string | null;
}

const batchFields =
  "id,report_id,listing_id,status,created_by,github_branch,github_pr_number,github_pr_url,github_head_sha,github_merge_sha,last_error_code,deployment_requested_at,created_at,removed_at";

const updateBatch = async (
  env: Env,
  id: string,
  values: Record<string, unknown>,
): Promise<void> => {
  await supabaseRequest(
    env,
    `/rest/v1/listing_removal_batches?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify(values),
    },
  );
};

const requestSiteDeployment = async (env: Env, batchId: string) => {
  await dispatchSiteDeployment(env.GITHUB_SITE_DEPLOY_TOKEN);
  await updateBatch(env, batchId, {
    deployment_requested_at: new Date().toISOString(),
  });
};

const finalizeBatch = async (
  env: Env,
  batch: ListingRemovalBatch,
  mergeSha: string,
): Promise<void> => {
  await callRpc<string>(env, "finalize_listing_removal_batch", {
    p_batch_id: batch.id,
    p_merge_sha: mergeSha,
  });
  await requestSiteDeployment(env, batch.id);
};

const prepareBatch = async (
  env: Env,
  batch: ListingRemovalBatch,
): Promise<ListingRemovalBatch> => {
  try {
    const result = await createRemovalPullRequest(
      env.GITHUB_DATA_PUBLICATION_TOKEN,
      batch.id,
      batch.listing_id,
    );
    if (!result.pullRequest) {
      await finalizeBatch(env, batch, result.baseSha);
      return { ...batch, status: "removed", github_merge_sha: result.baseSha };
    }
    const values = {
      status: "validating",
      github_branch: removalBranch(batch.id),
      github_pr_number: result.pullRequest.number,
      github_pr_url: result.pullRequest.html_url,
      github_head_sha: result.pullRequest.head.sha,
      last_error_code: null,
    } as const;
    await updateBatch(env, batch.id, values);
    return { ...batch, ...values };
  } catch (error) {
    await updateBatch(env, batch.id, { last_error_code: "github_prepare_failed" });
    throw error;
  }
};

export const prepareListingRemovalForReport = async (
  env: Env,
  reportId: string,
): Promise<ListingRemovalBatch | null> => {
  const { data } = await supabaseRequest<ListingRemovalBatch[]>(
    env,
    `/rest/v1/listing_removal_batches?report_id=eq.${encodeURIComponent(reportId)}&select=${batchFields}&limit=1`,
  );
  const batch = data[0] ?? null;
  if (!batch || batch.status !== "preparing") return batch;
  return prepareBatch(env, batch);
};

const reconcileBatch = async (env: Env, batch: ListingRemovalBatch) => {
  if (!batch.github_pr_number) return;
  const pullRequest = await getPublicationPullRequest(
    env.GITHUB_DATA_PUBLICATION_TOKEN,
    batch.github_pr_number,
  );
  if (!pullRequest) return;
  if (pullRequest.merged) {
    await finalizeBatch(
      env,
      batch,
      pullRequest.merge_commit_sha || pullRequest.head.sha,
    );
    return;
  }
  if (pullRequest.state === "closed") {
    await updateBatch(env, batch.id, {
      status: "failed",
      last_error_code: "removal_pr_closed",
    });
    return;
  }
  if (pullRequest.head.sha !== batch.github_head_sha)
    await updateBatch(env, batch.id, { github_head_sha: pullRequest.head.sha });
  const checks = await getPublicationChecks(
    env.GITHUB_DATA_PUBLICATION_TOKEN,
    pullRequest.head.sha,
  );
  const validation = checks.find((check) => check.name === "validate");
  if (!validation || validation.status !== "completed") return;
  if (validation.conclusion !== "success") {
    await updateBatch(env, batch.id, {
      status: "failed",
      last_error_code: "validation_failed",
    });
    return;
  }
  await updateBatch(env, batch.id, { status: "merging", last_error_code: null });
  const merge = await mergeRemovalPullRequest(
    env.GITHUB_DATA_PUBLICATION_TOKEN,
    batch.github_pr_number,
    pullRequest.head.sha,
    batch.listing_id,
  );
  if (merge?.merged) await finalizeBatch(env, batch, merge.sha);
  else
    await updateBatch(env, batch.id, {
      status: "validating",
      last_error_code: "merge_not_ready",
    });
};

export const reconcileListingRemovals = async (env: Env): Promise<void> => {
  if (!env.GITHUB_DATA_PUBLICATION_TOKEN || !env.GITHUB_SITE_DEPLOY_TOKEN) return;
  const { data: active } = await supabaseRequest<ListingRemovalBatch[]>(
    env,
    `/rest/v1/listing_removal_batches?status=in.(preparing,validating,merging)&select=${batchFields}&order=created_at.asc&limit=10`,
  );
  for (const batch of active) {
    try {
      if (batch.status === "preparing") await prepareBatch(env, batch);
      else await reconcileBatch(env, batch);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "listing_removal_reconciliation_failed",
          batch_id: batch.id,
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
    }
  }

  const { data: awaitingDeployment } = await supabaseRequest<ListingRemovalBatch[]>(
    env,
    `/rest/v1/listing_removal_batches?status=eq.removed&deployment_requested_at=is.null&select=${batchFields}&order=removed_at.asc&limit=10`,
  );
  for (const batch of awaitingDeployment) {
    try {
      await requestSiteDeployment(env, batch.id);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "listing_removal_deployment_dispatch_failed",
          batch_id: batch.id,
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
    }
  }
};

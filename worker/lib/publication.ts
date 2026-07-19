import { RequestError } from "./http";
import {
  publicationListingId,
  toPublishedOpportunity,
  type PublicationPayload,
} from "./publication-data";
import {
  createPublicationPullRequest,
  dispatchSiteDeployment,
  getPublicationChecks,
  getPublicationPullRequest,
  mergePublicationPullRequest,
  publicationBranch,
} from "./publication-github";
import { callRpc, supabaseRequest } from "./supabase";
import type { Env, Moderator } from "./types";

export {
  publicationListingId,
  toPublishedOpportunity,
  type PublicationPayload,
  type PublishedOpportunity,
} from "./publication-data";

interface PublicationBatch {
  id: string;
  status: "preparing" | "validating" | "merging" | "published" | "failed";
  item_count: number;
  github_branch: string | null;
  github_pr_number: number | null;
  github_pr_url: string | null;
  github_head_sha: string | null;
  github_merge_sha: string | null;
  last_error_code: string | null;
  deployment_requested_at: string | null;
  created_at: string;
  published_at: string | null;
}

const batchFields =
  "id,status,item_count,github_branch,github_pr_number,github_pr_url,github_head_sha,github_merge_sha,last_error_code,deployment_requested_at,created_at,published_at";

const updateBatch = async (
  env: Env,
  id: string,
  values: Record<string, unknown>,
): Promise<void> => {
  await supabaseRequest(
    env,
    `/rest/v1/publication_batches?id=eq.${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "content-type": "application/json", prefer: "return=minimal" },
      body: JSON.stringify(values),
    },
  );
};

const publicationBatch = async (
  env: Env,
  id: string,
): Promise<PublicationBatch | null> => {
  const { data } = await supabaseRequest<PublicationBatch[]>(
    env,
    `/rest/v1/publication_batches?id=eq.${encodeURIComponent(id)}&select=${batchFields}&limit=1`,
  );
  return data[0] ?? null;
};

const saveListingIds = async (
  env: Env,
  batchId: string,
  payloads: PublicationPayload[],
): Promise<void> => {
  await supabaseRequest(
    env,
    "/rest/v1/publication_batch_items?on_conflict=batch_id,submission_id",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(
        payloads.map((payload) => ({
          batch_id: batchId,
          submission_id: payload.submission_id,
          listing_id: publicationListingId(payload),
        })),
      ),
    },
  );
};

export const startPublicationBatch = async (
  env: Env,
  moderator: Moderator,
): Promise<PublicationBatch | null> => {
  if (!env.GITHUB_DATA_PUBLICATION_TOKEN || !env.GITHUB_SITE_DEPLOY_TOKEN)
    throw new RequestError(
      "Automated publication is not configured.",
      503,
      "publication_not_configured",
    );
  const batchId = await callRpc<string | null>(env, "begin_publication_batch", {
    p_moderator_id: moderator.userId,
  });
  if (!batchId) return null;
  const existingBatch = await publicationBatch(env, batchId);
  if (existingBatch && existingBatch.status !== "preparing") return existingBatch;

  const payloads = await callRpc<PublicationPayload[]>(
    env,
    "publication_batch_payload",
    { p_batch_id: batchId },
  );
  const reviewDate = new Date().toISOString().slice(0, 10);
  const opportunities = payloads.map((payload) =>
    toPublishedOpportunity(payload, reviewDate),
  );
  await saveListingIds(env, batchId, payloads);
  try {
    const pullRequest = await createPublicationPullRequest(
      env.GITHUB_DATA_PUBLICATION_TOKEN,
      batchId,
      opportunities,
    );
    await updateBatch(env, batchId, {
      status: "validating",
      github_branch: publicationBranch(batchId),
      github_pr_number: pullRequest.number,
      github_pr_url: pullRequest.html_url,
      github_head_sha: pullRequest.head.sha,
      last_error_code: null,
    });
  } catch (error) {
    await updateBatch(env, batchId, { last_error_code: "github_prepare_failed" });
    if (error instanceof RequestError) throw error;
    throw new RequestError(
      "The publication pull request could not be prepared. Retry this batch.",
      502,
      "publication_failed",
    );
  }
  return publicationBatch(env, batchId);
};

export const publicationBatchStatus = async (
  env: Env,
): Promise<{ batch: PublicationBatch | null; approved_count: number }> => {
  const [batchResult, approvedResult] = await Promise.all([
    supabaseRequest<PublicationBatch[]>(
      env,
      `/rest/v1/publication_batches?select=${batchFields}&order=created_at.desc&limit=1`,
    ),
    supabaseRequest<Array<{ id: string }>>(
      env,
      "/rest/v1/opportunity_submissions?status=eq.approved&select=id&limit=1",
      { headers: { prefer: "count=exact" } },
    ),
  ]);
  const contentRange = approvedResult.response.headers.get("content-range");
  const approvedCount = Number(contentRange?.split("/")[1] ?? approvedResult.data.length);
  return {
    batch: batchResult.data[0] ?? null,
    approved_count: Number.isFinite(approvedCount) ? approvedCount : 0,
  };
};

const requestSiteDeployment = async (env: Env, batchId: string) => {
  await dispatchSiteDeployment(env.GITHUB_SITE_DEPLOY_TOKEN);
  await updateBatch(env, batchId, {
    deployment_requested_at: new Date().toISOString(),
  });
};

const finalizeBatch = async (
  env: Env,
  batch: PublicationBatch,
  mergeSha: string,
): Promise<void> => {
  await callRpc<number>(env, "finalize_publication_batch", {
    p_batch_id: batch.id,
    p_merge_sha: mergeSha,
  });
  await requestSiteDeployment(env, batch.id);
};

const reconcileBatch = async (env: Env, batch: PublicationBatch) => {
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
      last_error_code: "publication_pr_closed",
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
    await updateBatch(env, batch.id, { last_error_code: "validation_failed" });
    return;
  }
  await updateBatch(env, batch.id, {
    status: "merging",
    last_error_code: null,
  });
  const merge = await mergePublicationPullRequest(
    env.GITHUB_DATA_PUBLICATION_TOKEN,
    batch.github_pr_number,
    pullRequest.head.sha,
    batch.item_count,
  );
  if (merge?.merged) await finalizeBatch(env, batch, merge.sha);
  else
    await updateBatch(env, batch.id, {
      status: "validating",
      last_error_code: "merge_not_ready",
    });
};

export const reconcilePublicationBatches = async (env: Env): Promise<void> => {
  if (!env.GITHUB_DATA_PUBLICATION_TOKEN) return;
  const { data: active } = await supabaseRequest<PublicationBatch[]>(
    env,
    `/rest/v1/publication_batches?status=in.(validating,merging)&select=${batchFields}&order=created_at.asc&limit=10`,
  );
  for (const batch of active) {
    try {
      await reconcileBatch(env, batch);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "publication_reconciliation_failed",
          batch_id: batch.id,
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
    }
  }
  const { data: awaitingDeployment } = await supabaseRequest<PublicationBatch[]>(
    env,
    `/rest/v1/publication_batches?status=eq.published&deployment_requested_at=is.null&select=${batchFields}&order=published_at.asc&limit=10`,
  );
  for (const batch of awaitingDeployment) {
    try {
      await requestSiteDeployment(env, batch.id);
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "publication_deployment_dispatch_failed",
          batch_id: batch.id,
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
    }
  }
};

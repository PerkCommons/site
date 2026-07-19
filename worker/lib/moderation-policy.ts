import type { ModeratorRole, SubmissionStatus } from "./types";

export interface BanSignal {
  active: boolean;
  expires_at: string | null;
  mode: "block" | "flag" | "warn";
}

export const isBanActive = (ban: BanSignal, now = new Date()): boolean =>
  ban.active &&
  (!ban.expires_at || new Date(ban.expires_at).getTime() > now.getTime());

export function strongestBanMode(
  bans: BanSignal[],
  now = new Date(),
): "block" | "flag" | "warn" | null {
  const active = bans.filter((ban) => isBanActive(ban, now));
  if (active.some((ban) => ban.mode === "block")) return "block";
  if (active.some((ban) => ban.mode === "flag")) return "flag";
  return active.some((ban) => ban.mode === "warn") ? "warn" : null;
}

export const roleAllows = (
  role: ModeratorRole,
  operation: "review" | "ban" | "manage_moderators",
): boolean => operation === "review" || role === "admin";

export function nextStatusForAction(
  previous: SubmissionStatus,
  action: string,
): SubmissionStatus {
  const statuses: Record<string, SubmissionStatus> = {
    approve: "approved",
    decline: "rejected",
    flag: "flagged",
    unflag: "pending",
    publish: "published",
    withdraw: "withdrawn",
  };
  return statuses[action] ?? previous;
}

export function actionAllowedForStatus(
  status: SubmissionStatus,
  action: string,
): boolean {
  if (status === "pending")
    return ["approve", "decline", "flag", "notes"].includes(action);
  if (status === "flagged")
    return ["approve", "decline", "unflag", "notes"].includes(action);
  return false;
}

export interface AuditAction {
  action: string;
  previous_status: SubmissionStatus;
  new_status: SubmissionStatus;
  reason: string | null;
}
export const buildAuditAction = (
  previous: SubmissionStatus,
  action: string,
  reason: string | null,
): AuditAction => ({
  action,
  previous_status: previous,
  new_status: nextStatusForAction(previous, action),
  reason,
});

export const canUndoAction = (
  createdAt: string,
  now = new Date(),
  windowMinutes = 10,
): boolean =>
  now.getTime() - new Date(createdAt).getTime() <= windowMinutes * 60_000 &&
  now.getTime() >= new Date(createdAt).getTime();

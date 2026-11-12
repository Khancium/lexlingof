import type { contributionStatus } from "../db/schema.js";

type Status = (typeof contributionStatus.enumValues)[number];

/**
 * The column values that go with moving a contribution to `status` by hand
 * (the admin status-change routes).
 *
 * Those routes used to set ONLY `status`. The peer-review path also records
 * who/when (`verified_at`/`verified_by`, `rejected_at`/`rejected_by`), and the
 * admin dashboard's "verified today" counts `verified_at` -- so everything an
 * admin verified was invisible to it, and a verified-then-rejected item kept its
 * stale `verified_at` and the previous `rejection_reason`.
 *
 * Every verified/rejected field is reset first, then the ones that apply to the
 * new status are set, so a contribution never carries metadata from a status it
 * no longer has. (A retake does the same when it resets to pending.)
 */
export function contributionStatusFields(status: Status, reason: string | null, actorId: string, now: Date = new Date()): Record<string, unknown> {
  const cleared = { verifiedAt: null, verifiedBy: null, rejectedAt: null, rejectedBy: null, rejectionReason: null };
  if (status === "verified") return { ...cleared, status, verifiedAt: now, verifiedBy: actorId };
  if (status === "rejected") return { ...cleared, status, rejectedAt: now, rejectedBy: actorId, rejectionReason: reason };
  return { ...cleared, status };
}

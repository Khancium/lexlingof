import { db } from "../db/index.js";
import { auditLogs, userRole } from "../db/schema.js";

/**
 * A single, crude activity log used for the admin Logs page -- every
 * write() call here is one row shown there with a timestamp. Originally
 * admin-only (suspend/delete/config-change), now also called from
 * auth/registration/submission code so the page reflects real app activity,
 * not just moderation actions.
 */
type AuditLogParams = {
  actorId: string | null;
  actorRole: (typeof userRole.enumValues)[number] | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
};

export async function writeAuditLog(params: AuditLogParams): Promise<void> {
  await db.insert(auditLogs).values(toRow(params));
}

/** Same as writeAuditLog, but for a bulk admin action over N rows -- one insert instead of N. */
export async function writeAuditLogs(entries: AuditLogParams[]): Promise<void> {
  if (entries.length === 0) return;
  await db.insert(auditLogs).values(entries.map(toRow));
}

function toRow(params: AuditLogParams) {
  return {
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId ?? null,
    beforeState: params.beforeState ?? null,
    afterState: params.afterState ?? null,
  };
}

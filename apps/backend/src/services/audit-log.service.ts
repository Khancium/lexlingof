import { db } from "../db/index.js";
import { auditLogs, userRole } from "../db/schema.js";

/**
 * A single, crude activity log used for the admin Logs page -- every
 * write() call here is one row shown there with a timestamp. Originally
 * admin-only (suspend/delete/config-change), now also called from
 * auth/registration/submission code so the page reflects real app activity,
 * not just moderation actions.
 */
export async function writeAuditLog(params: {
  actorId: string | null;
  actorRole: (typeof userRole.enumValues)[number] | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
}): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: params.actorId,
    actorRole: params.actorRole,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId ?? null,
    beforeState: params.beforeState ?? null,
    afterState: params.afterState ?? null,
  });
}

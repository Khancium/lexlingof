// One-off, idempotent patch to add the volunteers.manage permission and its
// role_permissions rows without re-running the full seed (which would
// conflict with existing unrelated seed data). Safe to run more than once.
import "dotenv/config";

import { db } from "../../src/db/index.js";
import { permissions, rolePermissions } from "../../src/db/schema.js";

const NEW_PERMISSIONS: { code: string; description: string }[] = [
  { code: "volunteers.manage", description: "Assign the volunteer role, review their pending changes, and toggle auto-approve" },
];

const ROLE_PERMISSION_CODES: Record<string, string[]> = {
  volunteer: ["concepts.manage", "scenes.manage", "sentences.manage"],
  admin: ["volunteers.manage"],
  super_admin: ["volunteers.manage"],
};

async function main() {
  await db
    .insert(permissions)
    .values(
      NEW_PERMISSIONS.map((p) => {
        const [module, ...rest] = p.code.split(".");
        return { code: p.code, description: p.description, module, action: rest.join(".") || "manage" };
      }),
    )
    .onConflictDoNothing({ target: permissions.code });

  const allPermissions = await db.select({ id: permissions.id, code: permissions.code }).from(permissions);
  const idByCode = new Map(allPermissions.map((p) => [p.code, p.id]));

  const roleRows = Object.entries(ROLE_PERMISSION_CODES).flatMap(([role, codes]) =>
    codes.map((code) => {
      const permissionId = idByCode.get(code);
      if (!permissionId) {
        throw new Error(`Unknown permission code: ${code}`);
      }
      return { role: role as (typeof rolePermissions.$inferInsert)["role"], permissionId };
    }),
  );

  await db.insert(rolePermissions).values(roleRows).onConflictDoNothing({ target: [rolePermissions.role, rolePermissions.permissionId] });

  console.log("[patch-volunteer-permissions] done");
  process.exit(0);
}

main().catch((err) => {
  console.error("[patch-volunteer-permissions] FAILED", err);
  process.exit(1);
});

// One-off, idempotent patch to add the publishing.manage permission and its
// role_permissions rows without re-running the full seed. Safe to run more
// than once. See patch-volunteer-permissions.ts for the original pattern.
import "dotenv/config";

import { db } from "../../src/db/index.js";
import { permissions, rolePermissions } from "../../src/db/schema.js";

const NEW_PERMISSIONS: { code: string; description: string }[] = [
  {
    code: "publishing.manage",
    description: "Curate which word recordings and sentence translations are published to the public dictionary / language-learning feed",
  },
];

const ROLE_PERMISSION_CODES: Record<string, string[]> = {
  admin: ["publishing.manage"],
  super_admin: ["publishing.manage"],
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

  console.log("[patch-publishing-permissions] done");
  process.exit(0);
}

main().catch((err) => {
  console.error("[patch-publishing-permissions] FAILED", err);
  process.exit(1);
});

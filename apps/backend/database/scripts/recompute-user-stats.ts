/**
 * One-off repair for user_stats counters that drifted before the points /
 * review fixes (see ARCHITECTURE.md §2.4 and §2.6):
 *
 *   total_points           = SUM(points_transactions.points) for the user.
 *                            Translation, scene, audio and reviewer awards used
 *                            to reach the ledger but never the running total.
 *   pending_contributions  = live (not deleted) contributions that are
 *                            pending / under_review. A rejection never
 *                            decremented it.
 *   rejected_contributions = live contributions that are rejected. A rejection
 *                            never incremented it.
 *
 * Everything else in user_stats is left alone.
 *
 * DRY RUN BY DEFAULT -- it only prints what would change. Pass --apply to write.
 *
 *   npm run db:recompute-stats --workspace=apps/backend            (dry run)
 *   npm run db:recompute-stats --workspace=apps/backend -- --apply
 *
 * Run it AFTER the fixed backend is deployed. Run before, the still-old code
 * keeps under-counting and the totals drift again immediately. It is
 * idempotent, so running it again later is harmless. Prefer a quiet moment:
 * the UPDATE works from a snapshot, so a submission committing during that one
 * statement could have its increment overwritten.
 */
import "dotenv/config";

import { db, sql } from "../../src/db/index.js";

const apply = process.argv.includes("--apply");

// One CTE shared by the report and the update, so what is previewed is exactly
// what would be written.
const computed = sql`
  computed as (
    select
      us.user_id,
      coalesce((select sum(pt.points) from points_transactions pt where pt.user_id = us.user_id), 0)::int as total_points,
      (select count(*) from contributions c
         where c.user_id = us.user_id and c.deleted_at is null and c.status in ('pending', 'under_review'))::int as pending,
      (select count(*) from contributions c
         where c.user_id = us.user_id and c.deleted_at is null and c.status = 'rejected')::int as rejected
    from user_stats us
  )
`;

type DiffRow = {
  user_id: string;
  total_points_before: number;
  total_points_after: number;
  pending_before: number;
  pending_after: number;
  rejected_before: number;
  rejected_after: number;
};

async function main() {
  const diffs = (await db.execute(sql`
    with ${computed}
    select
      us.user_id,
      us.total_points as total_points_before, c.total_points as total_points_after,
      us.pending_contributions as pending_before, c.pending as pending_after,
      us.rejected_contributions as rejected_before, c.rejected as rejected_after
    from user_stats us
    join computed c on c.user_id = us.user_id
    where us.total_points <> c.total_points
       or us.pending_contributions <> c.pending
       or us.rejected_contributions <> c.rejected
    order by abs(c.total_points - us.total_points) desc
  `)) as unknown as DiffRow[];

  const [{ n: examined }] = (await db.execute(sql`select count(*)::int as n from user_stats`)) as unknown as { n: number }[];

  const pointsChanged = diffs.filter((d) => d.total_points_before !== d.total_points_after);
  const pendingChanged = diffs.filter((d) => d.pending_before !== d.pending_after);
  const rejectedChanged = diffs.filter((d) => d.rejected_before !== d.rejected_after);
  const pointsDelta = pointsChanged.reduce((sum, d) => sum + (d.total_points_after - d.total_points_before), 0);

  console.log(`Users examined:                ${examined}`);
  console.log(`Users needing any change:      ${diffs.length}`);
  console.log(`  total_points would change:   ${pointsChanged.length} (net ${pointsDelta >= 0 ? "+" : ""}${pointsDelta} points)`);
  console.log(`  pending would change:        ${pendingChanged.length}`);
  console.log(`  rejected would change:       ${rejectedChanged.length}`);

  if (diffs.length > 0) {
    console.log("\nLargest total_points changes (user id truncated):");
    for (const d of pointsChanged.slice(0, 5)) {
      console.log(`  ${d.user_id.slice(0, 8)}…  ${d.total_points_before} -> ${d.total_points_after}`);
    }
  }

  if (!apply) {
    console.log("\nDry run -- nothing was written. Re-run with --apply to write these changes.");
    return;
  }

  if (diffs.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  const updated = (await db.execute(sql`
    with ${computed}
    update user_stats us
    set total_points = c.total_points,
        pending_contributions = c.pending,
        rejected_contributions = c.rejected,
        updated_at = now()
    from computed c
    where c.user_id = us.user_id
      and (us.total_points <> c.total_points
        or us.pending_contributions <> c.pending
        or us.rejected_contributions <> c.rejected)
    returning us.user_id
  `)) as unknown as unknown[];

  console.log(`\nApplied: updated ${updated.length} user_stats row(s).`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });

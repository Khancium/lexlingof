/**
 * Removes EVERY sentence from the app, together with everything that was built on them: contributors'
 * recorded translations, the contributions/reviews behind them, the queued submissions, and the audio
 * files (database rows AND the objects in R2). It exists so the sentence corpus can be re-imported in the
 * new model (one row = one sentence in English + Urdu + Persian, grouped in categories).
 *
 * What is deliberately KEPT:
 *   - the points contributors earned (points_transactions rows stay, only their link to the deleted
 *     contribution is cleared, so user_stats.total_points and the ledger still agree)
 *   - badges they earned (the link to the triggering contribution is cleared)
 *   - audit_logs (history of who added/changed sentences)
 *   - forum posts that cited a sentence (the citation is cleared by the foreign key)
 * Contributors' contribution counters and levels are adjusted for the contributions that disappear.
 *
 * DRY RUN BY DEFAULT. A dry run reports what exists and then runs the real delete sequence inside a
 * transaction that it ROLLS BACK -- so it proves the foreign-key order works against the actual data
 * without changing anything.
 *
 *   npm run db:purge-sentences --workspace=apps/backend                       (dry run)
 *   npm run db:purge-sentences --workspace=apps/backend -- --execute \
 *        --backup-dir <folder> --confirm <number of sentences the dry run showed>
 *
 * --execute needs BOTH --backup-dir (a backup of every affected row, plus every audio object, is written
 * and verified BEFORE anything is deleted) and --confirm (the sentence count you saw; if it changed since,
 * the run stops). Optional: --skip-audio-backup (rows only, no audio bytes), --skip-r2 (rehearsals on a
 * local database only: don't touch the real bucket).
 *
 * The database part is one transaction (all or nothing) that holds a write lock on the affected tables for
 * its few seconds. The R2 objects are removed AFTER it commits, best-effort; any that could not be removed
 * are listed in r2-failures.json in the backup folder.
 */
import "dotenv/config";

import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { sql } from "drizzle-orm";

import { db } from "../../src/db/index.js";
import { recomputeAllUserLevels } from "../../src/services/level.service.js";
import { storageService } from "../../src/services/storage.service.js";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

const execute = flag("execute");
const backupDir = opt("backup-dir");
const confirm = opt("confirm");
const skipAudioBackup = flag("skip-audio-backup");
const skipR2 = flag("skip-r2");

type Row = Record<string, any>;
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as Row[];

class DryRunRollback extends Error {}

function dbHost(): string {
  try {
    return new URL(process.env.DATABASE_URL ?? "").host;
  } catch {
    return "(unparseable DATABASE_URL)";
  }
}

async function inventory(): Promise<Row> {
  const [r] = await rows(sql`select
    (select count(*)::int from sentences) as sentences,
    (select count(*)::int from sentences where deleted_at is null) as sentences_live,
    (select count(*)::int from translations) as translations,
    (select count(distinct user_id)::int from translations) as translators,
    (select count(*)::int from contributions where module_type = 'TRANSLATION') as translation_contributions,
    (select count(*)::int from contributions where module_type = 'TRANSLATION' and status = 'verified') as verified,
    (select count(*)::int from reviews r join contributions c on c.id = r.contribution_id where c.module_type = 'TRANSLATION') as reviews,
    (select count(*)::int from published_translations) as published,
    (select count(*)::int from points_transactions pt join contributions c on c.id = pt.contribution_id where c.module_type = 'TRANSLATION') as ledger_rows_kept,
    (select coalesce(sum(pt.points), 0)::int from points_transactions pt join contributions c on c.id = pt.contribution_id where c.module_type = 'TRANSLATION') as ledger_points_kept,
    (select count(*)::int from user_badges ub join contributions c on c.id = ub.trigger_contribution_id where c.module_type = 'TRANSLATION') as badges_unlinked,
    (select count(*)::int from pending_submissions where module_type = 'TRANSLATION') as queued_submissions,
    (select count(*)::int from pending_submissions where module_type = 'TRANSLATION' and audio_buffer is not null) as queued_with_audio_bytes,
    (select count(*)::int from forum_posts where sentence_id is not null) as forum_posts_detached,
    (select count(*)::int from audit_logs where resource_type = 'sentence') as audit_rows_kept`);

  const audio = await audioToDelete();
  return { ...r, audio_files: audio.length, audio_bytes: audio.reduce((n, a) => n + Number(a.file_size_bytes ?? 0), 0) };
}

/** Every audio file that only exists for a sentence translation. */
async function audioToDelete(): Promise<Row[]> {
  return rows(sql`select id, storage_key, normalized_storage_key, waveform_storage_key, file_size_bytes, module_type
    from audio_files a
    where a.module_type = 'TRANSLATION'
       or a.id in (select audio_file_id from translations where audio_file_id is not null)
       or a.id in (select resolved_audio_file_id from pending_submissions where module_type = 'TRANSLATION' and resolved_audio_file_id is not null)`);
}

/** Audio files in that set which something we are NOT deleting still uses -- must be zero, or we stop. */
async function sharedAudio(): Promise<number> {
  const [r] = await rows(sql`select count(*)::int as n from audio_files a
    where (a.module_type = 'TRANSLATION'
       or a.id in (select audio_file_id from translations where audio_file_id is not null)
       or a.id in (select resolved_audio_file_id from pending_submissions where module_type = 'TRANSLATION' and resolved_audio_file_id is not null))
      and (exists (select 1 from word_recordings w where w.audio_file_id = a.id)
        or exists (select 1 from scene_contributions s where s.audio_file_id = a.id)
        or exists (select 1 from audio_uploads u where u.audio_file_id = a.id)
        or exists (select 1 from pending_submissions p where p.resolved_audio_file_id = a.id and p.module_type <> 'TRANSLATION'))`);
  return r!.n;
}

/* -------------------------------------------------------------------------- */
/*                                   Backup                                   */
/* -------------------------------------------------------------------------- */

async function writeBackup(dir: string, audio: Row[]): Promise<{ tables: Record<string, number>; audioFiles: number; audioBytes: number; missingAudio: string[] }> {
  mkdirSync(dir, { recursive: true });
  if (readdirSync(dir).length > 0) throw new Error(`backup folder ${dir} is not empty -- use a new folder`);

  const dump = async (name: string, q: ReturnType<typeof sql>) => {
    const data = await rows(q);
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data, null, 1));
    return data.length;
  };

  const tables: Record<string, number> = {};
  tables.sentences = await dump("sentences", sql`select * from sentences order by created_at`);
  tables.translations = await dump("translations", sql`select * from translations order by created_at`);
  tables.contributions = await dump("contributions", sql`select * from contributions where module_type = 'TRANSLATION' order by submitted_at`);
  tables.points_transactions = await dump(
    "points_transactions",
    sql`select pt.* from points_transactions pt join contributions c on c.id = pt.contribution_id where c.module_type = 'TRANSLATION'`,
  );
  tables.reviews = await dump("reviews", sql`select r.* from reviews r join contributions c on c.id = r.contribution_id where c.module_type = 'TRANSLATION'`);
  tables.user_badges = await dump(
    "user_badges",
    sql`select ub.* from user_badges ub join contributions c on c.id = ub.trigger_contribution_id where c.module_type = 'TRANSLATION'`,
  );
  tables.published_translations = await dump("published_translations", sql`select * from published_translations`);
  const audioIds = audio.map((a) => sql`${a.id}::uuid`);
  tables.audio_files = await dump(
    "audio_files",
    audioIds.length > 0 ? sql`select * from audio_files where id in (${sql.join(audioIds, sql`, `)})` : sql`select * from audio_files where false`,
  );
  tables.forum_posts_with_sentence = await dump("forum_posts_with_sentence", sql`select id, sentence_id from forum_posts where sentence_id is not null`);
  // The queued submissions, WITHOUT the raw audio column (written separately below).
  tables.pending_submissions = await dump(
    "pending_submissions",
    sql`select id, user_id, module_type, payload, audio_mime_type, audio_filename, audio_duration_ms, resolved_audio_file_id, status, attempts, error_message, contribution_id, points_awarded, created_at, updated_at
        from pending_submissions where module_type = 'TRANSLATION'`,
  );

  // Raw audio still queued inside the database (the only copy of those recordings).
  const queued = await rows(sql`select id, audio_buffer from pending_submissions where module_type = 'TRANSLATION' and audio_buffer is not null`);
  if (queued.length > 0) {
    mkdirSync(path.join(dir, "queued-audio"), { recursive: true });
    for (const q of queued) writeFileSync(path.join(dir, "queued-audio", `${q.id}.bin`), q.audio_buffer as Buffer);
  }

  // The audio objects themselves.
  const missingAudio: string[] = [];
  let audioFiles = 0;
  let audioBytes = 0;
  if (!skipAudioBackup) {
    for (const a of audio) {
      for (const key of [a.storage_key, a.normalized_storage_key, a.waveform_storage_key].filter(Boolean) as string[]) {
        const target = path.join(dir, "audio", ...key.split("/"));
        mkdirSync(path.dirname(target), { recursive: true });
        try {
          await pipeline(await storageService.getAudioObjectStream(key), createWriteStream(target));
          audioFiles++;
          audioBytes += statSync(target).size;
        } catch (err) {
          // A row whose object is already gone (e.g. a superseded retake) can't be backed up -- record it.
          missingAudio.push(`${key}: ${(err as Error).name ?? "error"}`);
        }
      }
    }
  }

  writeFileSync(
    path.join(dir, "MANIFEST.json"),
    JSON.stringify({ createdAt: new Date().toISOString(), database: dbHost(), tables, queuedAudioBuffers: queued.length, audioObjectsBackedUp: audioFiles, audioBytes, skipAudioBackup, objectsNotBackedUp: missingAudio }, null, 2),
  );
  return { tables, audioFiles, audioBytes, missingAudio };
}

/* -------------------------------------------------------------------------- */
/*                               The delete itself                             */
/* -------------------------------------------------------------------------- */

async function purge(commit: boolean, expect?: { sentences: number; translations: number; contributions: number }): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const step = (name: string, res: unknown) => {
    counts[name] = Number((res as { count?: number }).count ?? 0);
  };

  try {
    await db.transaction(async (tx) => {
      // Fail fast rather than queue behind a long-running writer, and keep new submissions out for these few seconds.
      await tx.execute(sql`set local lock_timeout = '15s'`);
      await tx.execute(
        sql`lock table sentences, translations, contributions, pending_submissions, audio_files, points_transactions, reviews, user_badges, published_translations in share row exclusive mode`,
      );

      // With the tables locked, make sure nothing slipped in since the backup was taken.
      if (expect) {
        const [now] = (await tx.execute(sql`select (select count(*)::int from sentences) as s, (select count(*)::int from translations) as t,
          (select count(*)::int from contributions where module_type = 'TRANSLATION') as c`)) as unknown as { s: number; t: number; c: number }[];
        if (now!.s !== expect.sentences || now!.t !== expect.translations || now!.c !== expect.contributions) {
          throw new Error(`the data changed since the backup was taken (sentences ${expect.sentences}->${now!.s}, translations ${expect.translations}->${now!.t}, contributions ${expect.contributions}->${now!.c}) -- nothing was deleted; run it again`);
        }
      }

      await tx.execute(sql`create temp table _purge_contribs on commit drop as
        select id, user_id, status, deleted_at from contributions where module_type = 'TRANSLATION'`);
      await tx.execute(sql`create temp table _purge_audio on commit drop as
        select a.id from audio_files a
        where a.module_type = 'TRANSLATION'
           or a.id in (select audio_file_id from translations where audio_file_id is not null)
           or a.id in (select resolved_audio_file_id from pending_submissions where module_type = 'TRANSLATION' and resolved_audio_file_id is not null)`);

      // Contribution counters: take back what the contributions that disappear had added (floored at 0). Soft-deleted
      // contributions were already reversed when they were deleted, so only live ones count.
      step(
        "user_stats adjusted",
        await tx.execute(sql`with d as (
            select user_id,
                   count(*)::int as n,
                   count(*) filter (where status = 'verified')::int as nv,
                   count(*) filter (where status in ('pending', 'under_review'))::int as np,
                   count(*) filter (where status = 'rejected')::int as nr
            from _purge_contribs where deleted_at is null group by user_id)
          update user_stats us set
            total_contributions = greatest(us.total_contributions - d.n, 0),
            translation_contributions = greatest(us.translation_contributions - d.n, 0),
            verified_contributions = greatest(us.verified_contributions - d.nv, 0),
            verified_translations = greatest(us.verified_translations - d.nv, 0),
            pending_contributions = greatest(us.pending_contributions - d.np, 0),
            rejected_contributions = greatest(us.rejected_contributions - d.nr, 0),
            updated_at = now()
          from d where us.user_id = d.user_id`),
      );

      // Keep the points and badges; only cut their link to the contribution that is about to go.
      step("user_badges unlinked", await tx.execute(sql`update user_badges set trigger_contribution_id = null where trigger_contribution_id in (select id from _purge_contribs)`));
      step("points_transactions unlinked (rows KEPT)", await tx.execute(sql`update points_transactions set contribution_id = null where contribution_id in (select id from _purge_contribs)`));

      step("reviews deleted", await tx.execute(sql`delete from reviews where contribution_id in (select id from _purge_contribs)`));

      // contributions <-> translations and contributions <-> pending_submissions reference each other: cut one side first.
      await tx.execute(sql`update translations set contribution_id = null where contribution_id is not null`);
      await tx.execute(sql`update contributions set source_buffer_id = null where id in (select id from _purge_contribs) and source_buffer_id is not null`);
      step("queued submissions deleted", await tx.execute(sql`delete from pending_submissions where module_type = 'TRANSLATION'`));

      step("contributions deleted", await tx.execute(sql`delete from contributions where id in (select id from _purge_contribs)`));
      step("published translations deleted", await tx.execute(sql`delete from published_translations`));
      step("translations deleted", await tx.execute(sql`delete from translations`));
      step("audio_files rows deleted", await tx.execute(sql`delete from audio_files where id in (select id from _purge_audio)`));
      step("sentences deleted", await tx.execute(sql`delete from sentences`));

      await tx.execute(
        sql`insert into audit_logs (actor_id, actor_role, action, resource_type, after_state)
            values (null, null, 'admin_sentence_purge', 'sentence', ${JSON.stringify(counts)}::jsonb)`,
      );

      if (!commit) throw new DryRunRollback();
    });
  } catch (err) {
    if (!(err instanceof DryRunRollback)) throw err;
  }
  return counts;
}

/* -------------------------------------------------------------------------- */
/*                                    Main                                    */
/* -------------------------------------------------------------------------- */

function print(title: string, obj: Record<string, unknown>) {
  console.log(`\n${title}`);
  for (const [k, v] of Object.entries(obj)) console.log(`  ${k.padEnd(42)} ${v}`);
}

async function main() {
  console.log(`Database: ${dbHost()}`);
  console.log(execute ? "MODE: EXECUTE (will delete)" : "MODE: dry run (nothing will be changed)");

  const inv = await inventory();
  print("What exists now", inv);

  const shared = await sharedAudio();
  if (shared > 0) throw new Error(`${shared} audio file(s) that would be deleted are still used by something that is not being deleted -- stopping`);

  if (execute) {
    if (!backupDir) throw new Error("--execute needs --backup-dir <folder> (a new, empty folder)");
    if (confirm === undefined || Number(confirm) !== inv.sentences) {
      throw new Error(`--confirm must be the number of sentences that exist (${inv.sentences}); got ${confirm ?? "nothing"} -- stopping`);
    }
    if (existsSync(backupDir) && readdirSync(backupDir).length > 0) throw new Error(`backup folder ${backupDir} is not empty`);

    console.log(`\nWriting backup to ${backupDir} ...`);
    const audio = await audioToDelete();
    const backup = await writeBackup(backupDir, audio);
    print("Backup written", { ...backup.tables, "audio objects saved": backup.audioFiles, "audio bytes saved": backup.audioBytes, "objects NOT saved (missing in R2)": backup.missingAudio.length });
    if (backup.tables.sentences !== inv.sentences || backup.tables.translations !== inv.translations) {
      throw new Error("backup row counts do not match the inventory -- stopping before anything is deleted");
    }
  }

  // Captured before the delete: which R2 objects to remove afterwards.
  const audio = await audioToDelete();
  const r2Keys = audio.flatMap((a) => [a.storage_key, a.normalized_storage_key, a.waveform_storage_key]).filter(Boolean) as string[];

  console.log(`\n${execute ? "Deleting" : "Rehearsing the delete (will be rolled back)"} ...`);
  const counts = await purge(execute, execute ? { sentences: inv.sentences, translations: inv.translations, contributions: inv.translation_contributions } : undefined);
  print(execute ? "Deleted" : "Would delete (rolled back)", counts);

  if (!execute) {
    console.log(`\n${r2Keys.length} R2 object(s) would be removed after the commit.`);
    console.log(`\nTo do it for real:\n  npm run db:purge-sentences --workspace=apps/backend -- --execute --backup-dir <new folder> --confirm ${inv.sentences}`);
    return;
  }

  const levels = await recomputeAllUserLevels();
  console.log(`\nLevels recomputed for contributors whose count dropped: ${levels} changed.`);

  if (skipR2) {
    console.log(`\n--skip-r2: ${r2Keys.length} R2 object(s) left in place.`);
  } else {
    const failures: { key: string; error: string }[] = [];
    for (const key of r2Keys) {
      try {
        await storageService.deleteAudioFile(key);
      } catch (err) {
        failures.push({ key, error: (err as Error).message });
      }
    }
    console.log(`\nR2: ${r2Keys.length - failures.length} object(s) removed, ${failures.length} failed.`);
    if (failures.length > 0) {
      writeFileSync(path.join(backupDir!, "r2-failures.json"), JSON.stringify(failures, null, 2));
      console.log(`  The failed keys are listed in ${path.join(backupDir!, "r2-failures.json")}`);
    }
  }
  console.log("\nDone. Next: apply the contract migration (npm run db:migrate), then import the new sentences.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nSTOPPED:", err instanceof Error ? err.message : err);
    process.exit(1);
  });

import "dotenv/config";
import postgres from "postgres";
import { submitWordRecording } from "./src/modules/contributions/word/word.service.js";

const sql = postgres(process.env.DATABASE_DIRECT_URL!, { max: 1 });
const userId = "b1b91a66-541e-4167-8c7a-8ac894388929";

// Get a real audioFile and a fresh concept (cat, from earlier) to submit against
const [audioFile] = await sql`
  select id from audio_files where uploaded_by = ${userId} limit 1
`;
const [concept] = await sql`select id from concepts where slug = 'animals-cat'`;
const [lang] = await sql`select id from languages where code = 'ps'`;

const beforeWR = await sql`select count(*) from word_recordings where audio_file_id = ${audioFile.id}`;
const beforeContrib = await sql`select count(*) from contributions where user_id = ${userId}`;
console.log("before: word_recordings for this audioFile =", beforeWR[0].count, " contributions for user =", beforeContrib[0].count);

// Deactivate the config row to force CONFIG_MISSING mid-transaction (after
// word_recordings and contributions inserts already happened inside the tx)
await sql`update gamification_config set is_active = false where config_key = 'points.word.base'`;

try {
  await submitWordRecording(userId, {
    audioFileId: audioFile.id,
    conceptId: concept.id,
    languageId: lang.id,
    nativeWord: "rollback-test",
    synonymIndex: 1,
    takeIndex: 1,
    durationMs: 1000,
  });
  console.log("FAIL: should have thrown CONFIG_MISSING");
} catch (e: any) {
  console.log("Forced failure:", e.code, e.statusCode);
}

// Restore config
await sql`update gamification_config set is_active = true where config_key = 'points.word.base'`;

const afterWR = await sql`select count(*) from word_recordings where audio_file_id = ${audioFile.id}`;
const afterContrib = await sql`select count(*) from contributions where user_id = ${userId}`;
console.log("after:  word_recordings for this audioFile =", afterWR[0].count, " contributions for user =", afterContrib[0].count);
console.log(afterWR[0].count === beforeWR[0].count && afterContrib[0].count === beforeContrib[0].count ? "ROLLBACK OK: no orphan rows" : "ROLLBACK FAILED: orphan rows left behind");

await sql.end({ timeout: 1 });

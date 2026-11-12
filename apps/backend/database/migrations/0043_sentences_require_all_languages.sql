-- Contract step of the sentence redesign (see 0042 for the expand step).
--
-- A sentence is one meaning in English, Urdu AND Persian, in a category. This makes the database itself
-- enforce that: no sentence can exist without its two equivalents or without a category.
--
-- IT CAN ONLY RUN ON AN EMPTY `sentences` TABLE. The old sentences (one language per row, no category link)
-- cannot satisfy these constraints, so they must be purged first:
--
--   npm run db:purge-sentences --workspace=apps/backend            (dry run -- shows exactly what goes)
--   npm run db:purge-sentences --workspace=apps/backend -- --execute --backup-dir <new folder> --confirm <count>
--
-- The guard below stops with a clear message instead of a bare "column contains null values" error.
--
-- The old columns (`source_language`, `category_id`) are intentionally NOT dropped here: the backend that is
-- currently deployed still reads them. Drop them in a later migration once the new backend is live.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "sentences") THEN
    RAISE EXCEPTION 'sentences is not empty: run the sentence purge first (npm run db:purge-sentences -- --execute ...), then apply this migration';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "sentences" ALTER COLUMN "urdu_text" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sentences" ALTER COLUMN "persian_text" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sentences" ALTER COLUMN "sentence_category_id" SET NOT NULL;

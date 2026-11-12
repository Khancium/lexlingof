# Lexlingo — Architecture Log

A crowd-sourced language documentation platform: contributors record words, sentence
translations, freeform audio, and scene descriptions in their own language; peers review
each other's submissions; points/levels/badges drive engagement; admins moderate and curate
the corpus. This document describes the system **as currently implemented**, plus the
non-obvious decisions and bugs behind it, so future work doesn't have to rediscover them.

Last updated: 2026-11-11.

> **How this refresh was done.** Sections 3.16-3.22 and 8 are new, and §§1, 2, 4-7 were
> corrected against the code as of commit `cc126bb`. The 2026-11-11 pass was a **read-only
> code audit** (nothing was run or live-tested). Findings from it are listed in §7.2 and
> labelled *code-read*; items elsewhere in this doc that say "verified live" come from earlier
> sessions that did exercise the real backend.

---

## 1. Stack & Monorepo Layout

- **Monorepo**: npm workspaces + Turborepo (`apps/*`, `packages/*`).
- **Backend** (`apps/backend`): Fastify (Node, TypeScript, ESM) + Drizzle ORM + PostgreSQL
  (Supabase-hosted). Deployed to **Railway** (`railway.json`: Railpack build, starts
  `node apps/backend/dist/index.js`).
- **Web** (`apps/web`): Next.js 15 (App Router), React 19, Tailwind 4, Zustand for client
  state, `react-hook-form` + `zod` for forms, `axios` for API calls.
- **Mobile** (`apps/mobile`): Expo (SDK 57, dev-client only) / React Native 0.86, React
  Navigation, Zustand, WatermelonDB, Firebase push. A real, working-looking app that the
  backend has since **drifted away from** — Module 1 is broken against the current API and
  it gets none of the newer web features. See §8.
- **Public API**: a read-only, unauthenticated `/public/*` feed of admin-published words and
  sentences, consumed by the separate Pashtowal WordPress site (§3.17).
- **File storage**: audio → **Cloudflare R2** (S3-compatible, via `@aws-sdk/client-s3` +
  presigned URLs); images (concept/scene/avatar) → **Supabase Storage**.
- **Push notifications**: Firebase Cloud Messaging (`firebase-admin`), gated by both a
  server-config check (`FIREBASE_PROJECT_ID` set) and a per-user preference.
- **Migrations**: Drizzle Kit, hand-reviewed SQL files in `database/migrations/` (42 as of
  this writing, `0000`-`0041`), applied via `npm run db:migrate` — **no separate dev database**; all work
  happens against the same Supabase Postgres instance with careful test-data cleanup.

---

## 2. Backend Architecture

### 2.1 Module map

Each module under `apps/backend/src/modules/*` owns its own `*.routes.ts` (Fastify plugin)
and, where there's real logic, a `*.service.ts`. All routes mount under `/api/v1` (see
`src/index.ts`); a handful of modules keep their own sub-prefix baked into route paths
(word, audio-upload, translation buffer, scenes, reviews, notifications) because their
internal paths already self-namespace.

| Module | Responsibility |
|---|---|
| `auth` | Register (requires accepting the current terms version) / login / refresh / logout, change + forgot/reset password, bcrypt, JWT issuance, httpOnly refresh cookie (§2.2) |
| `users` | Own-profile CRUD, avatar upload, own contributions list, suggestion box, self-service account deletion, minimal public profile (`GET /users/:id`) |
| `users` (demographics, geo) | Onboarding form (`/users/me/demographics`), tribe / sub-tribe / village / quarter lookups, `/geo/countries` + `/geo/cities` (served from the backend so the web bundle doesn't ship the whole `country-state-city` dataset) |
| `categories` | Concept-category + concept listing (browse, search). **Auth required** except `GET /categories/:id`, which is public |
| `languages` | Public active-languages + dialects list (60-min in-memory cache, no invalidation hook) |
| `contributions/word` | Module 1: record a word for a concept (up to 3 synonyms/slots per concept) |
| `contributions/audio` | Module 2: freeform audio upload + transcription + segments |
| `contributions/translation` | Module 3: translate an English sentence, incl. the sentence-grouping/tile feature |
| `contributions/scene` | Module 4: describe a scene image aloud |
| `contributions/buffer` | The DB-buffered submission pipeline shared by all four modules (§2.3) |
| `reviews` | Peer review queue + decision submission (§2.4) |
| `gamification` | Leaderboard, badges, corpus-wide stats, level thresholds |
| `notifications` | In-app notification list/read, device token register/unregister, push sending |
| `audio` | Legacy presigned-upload flow (`POST /audio/upload-url` → PUT to R2 → `POST /audio/:id/confirm`) plus `GET /audio/:id/play-url`. The web app only uses `play-url`; **mobile still uses the whole upload flow** (§8) |
| `forum` | Open discussion forum: posts, threaded comments, reactions, polls (§3.18) |
| `terms` | `GET /terms` — current Terms & Conditions text + version (§3.19) |
| `health` | `GET /api/v1/health` — DB-backed readiness check (503 when the pool can't answer); the bare `GET /health` liveness route lives in `index.ts` (§2.7) |
| `public-content` | Unauthenticated `/public/dictionary` and `/public/language-learning` feeds (§3.17) |
| `admin` | All admin/moderation endpoints — by far the largest module (107 routes in `admin.routes.ts`, §2.5) |
| `admin/publishing` | Curation of which recordings/translations go to the public API (11 routes, `publishing.manage`, §3.17) |

### 2.2 Auth & permissions (`middleware/auth.ts`)

- `verifyToken`: decodes the JWT, then loads the user row through a **30-second in-memory
  cache** (`getUserForToken`) — this is on nearly every request and the DB round trip is a
  real latency cost (see §2.7), so a short cache trades a little staleness for a lot of
  speed. A cool-off ban (`suspendedUntil` in the past) auto-lifts here.
- `requirePermission(code)`: role → permission-code lookup via `role_permissions` /
  `permissions`, also cached (5 min). `super_admin` bypasses every check.
- `hasPermission(role, code)`: same check, callable inline from a handler — used by the
  generic undo endpoint (§2.6), which doesn't know which permission it needs until it's
  looked at the audit-log row it's reverting.
- `requireReviewerEligibility()`: contributor role must be **SILVER or above** to hit the
  review-queue endpoints; admins/super_admins are exempt (they're moderators, not peers).
- `blockIfRestricted`: lighter than a full suspension — blocks new submissions only, login
  and browsing still work. It is applied to the four `POST /contributions/buffer/*` routes
  **and, since 2026-11-12, to the four legacy direct-submit routes** (`POST
  /contributions/word`, `/contributions/audio`, `/sentences/:id/translation`,
  `/scenes/:id/contributions` — what mobile uses; they also now verify the audio file belongs
  to the submitter, §7.2). ⚠️ It is still **not** applied to the forum, so a restricted user
  can still post and comment.

**Session & token model** (`modules/auth`):

- Access token: 15-minute JWT (`sub`, `email`, `role`), kept **in memory only** on the
  client. Refresh token: 32 random bytes, 30-day lifetime, stored hashed (sha256) in
  `refresh_tokens`, rotated on every use.
- **Web** receives the refresh token only as an **httpOnly cookie** `lexlingo_refresh_token`
  (path `/api/v1/auth`; `Secure; SameSite=None` in production, `Lax` in dev), so an XSS can't
  exfiltrate it. CORS is therefore an explicit `ALLOWED_ORIGINS` allowlist with
  `credentials: true`. The cookie is cross-site in production (web and API are on different
  domains), so it is exposed to Safari ITP / third-party-cookie blocking.
- **Mobile** sends `X-Client-Platform: mobile`; the API then *also* returns `refreshToken` in
  the response body, and `/refresh` + `/logout` accept it in the body (cookie wins if both
  are present). The header is a delivery-channel switch, not an authorization boundary.
- `POST /auth/refresh` validates and revokes in a **single** `UPDATE ... WHERE valid
  RETURNING`, so concurrent replays can't both succeed. Changing or resetting a password
  revokes every active refresh token for the user.
- Password reset: `forgot-password` always returns the same response (no account
  enumeration, SMTP failure swallowed); the emailed link carries a one-hour single-use token
  (`password_reset_tokens`, hashed, consumed atomically).
- Rate limits: 300 req/min/IP globally, and 10 per 10 minutes on
  login/register/forgot-password/reset-password. `trustProxy: true` is **required** on
  Railway — without it every request shared the proxy's IP and the limiter collapsed the
  whole user base into one bucket (this 429'd unrelated users' submissions).

**Roles** (`user_role` enum): `contributor` → `volunteer` → `admin` → `super_admin`.
`volunteer` is a restricted content-curation role whose create/delete actions are routed
through an approval queue (§3.16). `isReviewerEligible()` returns `true` for **every
non-contributor role**, so a volunteer can use the peer-review queue without reaching SILVER
(this was only documented for admins before).

### 2.3 The submission buffer (`services/submission-buffer.service.ts`)

Every contribute-page submission (word/translation/audio-upload/scene) goes through one
choke point instead of writing directly to its module's tables:

1. `POST .../contributions/buffer/{word,translation,audio-upload,scene}` buffers the raw
   audio bytes **directly in the `pending_submissions` row** (`bytea`, not local disk — an
   earlier local-disk staging design was abandoned because Railway wipes container disk on
   every redeploy, which broke in-flight submissions) and returns `202` immediately.
2. A background poll loop (3s interval, batches of 5) picks up `pending` rows, resolves the
   audio into a real R2 object (`storeAudioBuffer`, idempotent — a retry after a crash
   reuses `resolved_audio_file_id` instead of re-uploading), then calls the target module's
   real `submit*` service function.
3. On success the row becomes `done` (contributor's real contribution now exists and shows
   up in My Contributions). On failure it retries up to `MAX_ATTEMPTS = 3`, then becomes
   `failed` and fires an in-app `SUBMISSION_FAILED` notification.
4. **Resubmission cleanup**: `enqueueSubmission` deletes any existing `failed` row for the
   same user + module + target (conceptId+synonymIndex / sentenceId / sceneId) *before*
   inserting the new attempt, so "Submit Again" doesn't leave a stale failure sitting next
   to the new one. `TRANSCRIPTION` is exempt — each audio upload is independent, with no
   pre-existing object to match against.
5. `GET /contributions/buffer/mine` returns every non-`done` row for the current user
   (cap raised to 1000 — see §4 changelog), resolving each failed row's target into a
   human label + deep-link id by looking up the referenced concept/sentence/scene.

`sourceBufferId` on the eventual `contributions` row anchors idempotency: a worker retry
that finds a `contributions` row already pointing at this buffer id just finalizes instead
of resubmitting (which would double-award points).

Additional behaviour worth knowing (added 2026-11-11, *code-read*):

- The route reads the whole multipart body into memory (limit 110 MB, set in `index.ts`) and
  stores it as `bytea`. MIME type and size are validated **in the worker, after the row
  exists**, and there is no per-user queue cap.
- **Silence trimming** (`services/audio-trim.service.ts`) applies to WORD and TRANSLATION
  audio only: ffmpeg `silenceremove` at -55 dB / 0.5 s minimum run, then 0.6 s of padding
  put back on each end; the result is kept only if it is shorter than the original and at
  least 1.4 s, otherwise the original stands. On the buffered path it runs synchronously in
  `storeAudioBuffer` and the stored `durationMs` is the measured post-trim value (commit
  `7b9e2c0` fixed WORD submissions failing on a `NaN` duration from browser-recorded webm).
  If ffprobe fails the duration falls back to 0. TRANSCRIPTION (Module 2) audio is never
  trimmed.
- For TRANSCRIPTION, the transcription + segments are applied **after** the submit
  transaction commits (so not atomic with it). **Fixed 2026-11-12:** if that second step
  fails, the retry used to find the contribution through `sourceBufferId` and mark the buffer
  row `done`, silently losing everything the contributor typed. The retry now runs
  `completeTranscriptionExtras()`, which idempotently adds only what is missing (the
  transcription if none exists — `addTranscription` creates a new version and re-awards points
  per call, so it is never called blindly — and any segment indexes not yet stored). The first
  attempt also uses `allSettled`, so a retry never races writes still in flight.
- **A legacy direct-submit path still exists** next to the buffer: `POST
  /contributions/word`, `/contributions/audio`, `/sentences/:id/translation`,
  `/scenes/:id/contributions`, fed by the presigned `/audio/*` flow. Mobile uses it. It skips
  `blockIfRestricted` and does not check that the supplied `audioFileId` belongs to the caller.
- Idempotency of the points ledger comes from `idempotency_key` values of the form
  `${contributionId}:REASON` inserted with `onConflictDoNothing`.

### 2.4 Peer review (`modules/reviews`)

- **Eligibility**: SILVER level or above (contributors), or admin/super_admin.
- **Queue scoping — tribe + city + language, all three.** `getQueue`/`submitReview` compare
  the reviewer's `contributor_demographics` (tribe, city) *and* their
  `contributor_profiles.primary_language_id` against the contribution's own `language_id`.
  ⚠️ An earlier version only scoped by tribe + city, which let contributions in an unrelated
  language leak into a reviewer's queue when a same-tribe/city peer happened to be
  documenting a different language — fixed by adding the language condition to both the
  queue filter and the authoritative submit-time guard.
  ⚠️⚠️ A *second* version of the same bug survived that fix: both guards were wrapped in
  `if (reviewerRole === "contributor")`, so admin and super_admin skipped scoping entirely
  and saw the whole corpus in their peer-review queue. That exemption was wrong by design —
  admins moderate through `/admin/contributions`, which is the deliberately unrestricted
  surface; `/review` is peer review and is scoped for **every** role. The role check is gone
  from both `getQueue` and `submitReview`; a reviewer with no demographics row now gets an
  empty queue rather than an unscoped one.
- **Self-review guard**: a contributor can never review their own contribution (also
  enforced at submit time, not just hidden from the queue — the queue is a hint, not a
  security boundary).
- **Decisions**: `valid` (verifies + awards a contributor bonus), `invalid` (rejects),
  `needs_correction` (status change only, no longer reachable from the UI — the 3-button
  redesign replaced it with `cannot_decide`), `cannot_decide` (reviewer abstains; the
  contribution stays `pending` and is excluded from *that same reviewer's* queue going
  forward so it rotates to someone else instead of stalling or reappearing for them).
- **Per-audio-file tallies**: `audio_files.review_count` / `correct_review_count` /
  `incorrect_review_count` / `cannot_decide_review_count` — crude denormalized counters
  bumped in the same transaction as the review insert, not a substitute for querying
  `reviews` directly.
- Reviewer earns points per completed review (idempotent per contribution+reviewer);
  contributor earns a module-specific verified bonus only on `valid`.
- **A single review decides** — there is no quorum or second opinion. `valid` → `verified`,
  `invalid` → `rejected`, `cannot_decide` leaves the contribution `pending`.
  `needs_correction` is still accepted by the route schema (`reviews.routes.ts`).
- The queue returns at most **20** items, oldest first, so every eligible reviewer in the
  same tribe/city/language sees the same 20. A reviewer's own earlier reviews are excluded.
- A reviewer earns the review award (default 5) for **every** decision, `cannot_decide`
  included.
- Scoping compares `city` with exact string equality (city is free text with only
  `.trim()`), so spelling/case variants fall out of each other's scope. A user with no
  `contributor_demographics` row (e.g. one who only ever used mobile, whose onboarding never
  writes that table) gets an **empty** queue; a deleted submitter's pending contributions can
  no longer be reviewed at all (their demographics are scrubbed).
- **Concurrency (fixed 2026-11-12).** The `pending` check used to run outside the transaction
  and the status `UPDATE` wasn't conditional on it, so two simultaneous decisions both applied
  and double-incremented the contributor's counters. `submitReview` now re-checks inside the
  transaction with `SELECT ... WHERE status = 'pending' FOR UPDATE`: a second reviewer blocks on
  the row lock, then re-evaluates against the already-decided row and gets the usual `409
  CONTRIBUTION_NOT_PENDING`. (Tested through the Supavisor pooler: the second transaction waited
  ~2.7 s behind the first.) `reviews` still has no unique index on (contribution, reviewer).
- **Counters per decision (fixed 2026-11-12).** `valid` bumps verified/per-module counters and
  decrements `pendingContributions` (floored at 0) **only on the first verification** — a retaken
  contribution being re-verified no longer counts twice or re-awards points. `invalid` now moves
  the contributor's `pending` → `rejected` (floored). Both used to be missing, so `pending`
  drifted upward on every rejection and `rejected` stayed 0. Edge: a retake doesn't re-add to
  `pending`, so a retaken-then-rejected contribution can still skew `pending` by one (the floor
  keeps it from going negative); `db:recompute-stats` (§7.3) re-derives both from `contributions`.

### 2.5 Admin module (`modules/admin/admin.routes.ts`)

The largest single file in the backend. Covers, per content type: list (with rich
filtering — status/module/language/dialect/tribe/sub-tribe/geo/gender/education/profession,
each filter **multi-selectable** via comma-separated query params), single-item CRUD, bulk
status-change/delete/edit, CSV/JSON bulk-create, image-by-URL (single + bulk), and a
zip-bundling bulk-download for audio.

Key sub-features:
- **CSV/JSON bulk import** (concepts, scenes, sentences): validated rows are inserted in
  **chunks of 500** with a per-row fallback only if a chunk insert fails (e.g. a duplicate
  slug) — not one `INSERT` per row, which was measured taking 20-40s+ for a few thousand
  rows before this change (see §2.7 on network latency).
- **Bulk image-by-URL**: fetches a third-party image server-side, re-encodes to WebP, and
  re-hosts it in Supabase Storage rather than hotlinking. `pixabay.com` (both its `/photos/`
  page and its `/images/download/...` link, as opposed to the actual `cdn.pixabay.com`
  asset host) is explicitly rejected up front with a specific message — it sits behind
  Cloudflare bot protection + a session/CSRF check that no request header combination gets
  past server-side.
- **"Undo last change"** (`POST /admin/undo/:resourceType/:identifier`): finds the most
  recent `audit_logs` row for that resource and re-applies its `before_state`. Deliberately
  single-step, not a history browser — clicking it twice acts as undo-then-redo, since the
  undo itself is logged and becomes the new "latest" entry. Covers contributions, concepts,
  scenes, sentences, users, `gamification_config`, and `feature_flags`; the latter two are
  keyed by a text key rather than a uuid `resourceId` (that column can't hold a text key),
  so those two look the row up by scanning recent entries for a matching key inside
  `before_state`/`after_state` instead.
- **Admin Logs** (`/admin/logs` UI, `GET /superadmin/audit-logs`): every `writeAuditLog()`
  call anywhere in the backend (registration, login, every contribution submission,
  permanent buffer failures, every moderation action) surfaces here — a deliberately crude,
  unfiltered activity feed, not a curated audit trail.
- **User moderation**: `restrict` (blocks new submissions, login still works) vs `cooloff`
  (blocks login entirely for N days, auto-lifts via `verifyToken`/login once
  `suspendedUntil` passes) are distinct backend actions, merged into one "Restrict /
  Cool-off" picker on the frontend. "Ban" = soft-delete via `deleteUserAccount` (PII
  scrubbed, corpus contributions untouched, email permanently blocked from re-registering).
- **User details** (`GET /admin/users/:id`): full `contributor_demographics` (the signup
  form) + `user_stats` (activity summary) in one call, for the admin "Details" modal.
- **Soft vs. permanent delete** (concepts / scenes / sentences): the normal Delete only
  sets `is_active`/`deleted_at` — the row and any uploaded image stay in the database and
  in Supabase Storage indefinitely (`storageService.deleteImage` existed but had no callers
  at all). A second **Delete Permanently** action (`DELETE /admin/{kind}/:id/permanent`,
  plus `POST /admin/{kind}/bulk-delete-permanent`) erases the DB row and removes its
  images from storage for real. It **refuses** when contributor recordings reference the
  item — and that guard is the **foreign-key violation itself**, caught and translated into
  a 409, *not* a pre-flight count: counting first and deleting second is a
  time-of-check/time-of-use race, and with this app's cross-region DB there are seconds
  between the two statements for the submission-buffer worker to land a recording in
  (which is exactly how it was caught — a 500 on the FK instead of a clean refusal). The
  count query survives only on the refusal path, to word the message. The multi-step
  concept delete (its `scene_concepts` annotations, then the row) runs in a transaction so
  a refusal can't leave annotations half-deleted, and storage objects are removed only
  after the DB delete commits, with storage failures logged rather than thrown. The audit
  entry deliberately records no `beforeState`, so the Undo button correctly refuses it with
  `NOT_REVERTIBLE`.
- **Category creation** (`POST /admin/categories`): categories used to only ever come from
  the seed script — no route existed to create one standalone. Now creatable with zero
  concepts assigned.
- **Suggestions inbox** (`/admin/suggestions`): lists user-submitted feedback
  (`POST /users/me/suggestions`), reuses the `audit.read` permission rather than minting a
  new permission code.
- **Bulk user actions** (`POST /admin/users/bulk-restrict`, `/bulk-unrestrict`,
  `/bulk-delete` (ban), `/bulk-volunteer`; cap 500 ids each) mirror the single-user actions;
  the Users page's bulk bar drives them, and a selection persists across pages. Bulk ban and
  the leaderboard cache: banning clears the cache, but **undoing** a ban does not.
- **Credentials** (`POST /admin/users/:id/credentials`): change a user's email, password or
  display name. Guards: never a `super_admin` target; an `admin` target only by a
  `super_admin`. A password change revokes the target's sessions. (The moderation actions —
  restrict, suspend, cool-off, ban — have **no** such target-role guard.)
- **Volunteers & approval queue** — §3.16. **Publishing** — §3.17.
- **Permissions actually enforced** by some route: `contributions.manage`, `users.manage`,
  `concepts.manage`, `scenes.manage`, `sentences.manage`, `volunteers.manage`,
  `publishing.manage`, `analytics.read`, `audit.read`, `system.manage`. The other seeded codes
  (`categories.manage`, `languages.manage`, `gamification.manage`, `users.suspend`,
  `users.delete`, `contributions.verify/reject/review`, `admins.manage`, `exports.*`, the
  `*.own` codes) are **never checked**. In practice only `super_admin` passes
  `system.manage`, so `/superadmin/gamification`, `/superadmin/feature-flags` and
  `POST /superadmin/admins` are super-admin-only. Forum moderation reuses `users.manage`.
  `user_additional_permissions` is never read, so per-user grants do nothing. There are **no
  admin routes for languages/dialects** despite the seeded `languages.manage`.
- **Undo coverage.** Undoable (has `beforeState`): contribution status/delete, concept and
  scene update/delete, sentence delete/bulk-edit, gamification config, feature flags, user
  restrict/suspend/ban. Logged but **not** revertible: permanent deletes, category create,
  credentials, grant admin/volunteer, pending-change approve/reject. **Not logged at all:**
  concept/scene/sentence *create* (single and bulk), image add/delete/crop, contribution
  remarks/keywords, scene keywords/coverage, suggestions-reviewed, and every publishing action.
- **Transactions.** Only the concept permanent delete runs in one. Everything else is a
  sequence of separate statements (mutation, stats adjustment, audit write), so an audit
  failure after the mutation returns 500 with the change already applied.
- **Concurrency/chunking.** `insertBulkInChunks` inserts 500 rows per statement and falls back
  to per-row inserts if a chunk fails. Bounded concurrency of 5 is used for permanent delete,
  stats reversal and Openverse/Wikimedia autofill. `bulk-url` image fetches (up to 200 ids, 10 MB
  each) have no concurrency cap and several bulk-id arrays have no `.max()`.

### 2.6 Gamification (`modules/gamification`)

- **Levels** (`BRONZE → SILVER → GOLD → …`): thresholds live in `gamification_config`
  (admin-editable), not hardcoded — served publicly via `GET /levels/thresholds` (5-min
  cache) and consumed on the frontend through a Zustand store/hook
  (`useLevelThresholds()`), so an admin's threshold edit actually reaches every progress bar
  without a redeploy. Level is recalculated from **total contribution count**, not verified
  count — verifying a contribution doesn't move the contributor's level on its own.
- **Points**: base points at submission time + bonuses (romanization, IPA, module-specific)
  + a verified bonus on review. All individually recorded in `points_transactions`
  (idempotency-keyed per contribution+reason so a buffer-worker retry can't double-award).
  ⚠️ `contributions.total_points` is a **generated column** (`base_points + bonus_points`)
  that nothing ever populates — the real total for a contribution is the sum of its
  `points_transactions` rows (see the My Contributions bug in §4).
- **`user_stats.totalPoints` now tracks the ledger (fixed 2026-11-12).** It used to be
  incremented in only two places (a WORD submission and the verified bonus), while translation,
  scene and audio submissions, transcription/segment bonuses and reviewer awards reached
  `points_transactions` only — yet `totalPoints` is what the leaderboard, dashboard and admin
  sorting read. A live dry run found **10 of 44 users under-counted, net 2,270 points** (the
  largest gap: one user stored at 620 against a ledger total of 1,835). Now every award keeps the two in step via
  `services/points.service.ts`: `awardPointsOnce()` inserts the idempotency-keyed ledger row and
  adds to `total_points` **only if the row was new** (used by transcription, segment, reviewer
  and verified-bonus awards, which can be replayed); submit-time awards, whose contribution id
  is brand new and so can't conflict, add to `total_points` inline in their existing
  `user_stats` UPDATE. Existing drift is repaired by the one-off `db:recompute-stats` script
  (§7.3). Admin deletes still don't claw points back (a product decision, not a bug).
- **Point amounts** come from `gamification_config` (seeded defaults: word 10 + verified 10;
  translation 10 + audio 10 + romanization 5 + IPA 10, verified 10, max 35 on submit; scene
  20 + long-description 10 + daily 5 + expert 20, verified 10; audio upload 10, native text
  10, romanization 5, IPA 10, English translation 10, segment 5; review award 5). Hardcoded
  rather than configurable: the 3-synonym cap, the 10 s word-recording limit (also a DB
  `CHECK`), the 500 KB word file cap, the 100 MB default upload cap, the 50-sentence group
  size, and the 60 s "long description" threshold. Seeded-but-unused keys:
  `points.word.synonym_bonus`, `levels.bronze.min`, and the three `modules.*` keys
  (`modules.word.max_duration_ms = 3000` contradicts the real 10000).
- **Streaks** (`services/streak.service.ts`): `updateStreakOnContribution` bumps
  `streaks.currentStreak` inside the same transaction as a qualifying contribution — but it
  only ever *runs* on a contribution, so a broken streak stayed showing its last known value
  on every read (dashboard, profile, leaderboard) until the user's next submission finally
  recalculated it. A user who built a 10-day streak and then went quiet for a week still saw
  "10" the whole time. Fixed with a separate, side-effect-free `computeStreakDisplay()`
  called from every read path (`GET /users/me`, `/users/me/stats`, `/leaderboard`, and the
  word-retake response) that derives the true-as-of-now number from `lastActivityDate`
  without writing anything: 0 days stale → `active`; 1 day stale → `grace` (today isn't over
  yet, the streak survives only if they contribute again today — this is the first thing to
  ever use the `streak_status` enum's `grace` value, which existed in the schema from the
  start but nothing previously set); ≥2 days stale → `broken`, displayed as 0. The stored row
  itself is left untouched by reads; only the write path (`updateStreakOnContribution`)
  still corrects it, on next contribution.
- **Badges**, **leaderboard snapshots**: supporting tables exist (`badges`, `user_badges`,
  `leaderboard_snapshots`) — leaderboard is fed from `user_stats`. **Badges are now
  awarded (fixed 2026-11-12).** `evaluateAndAwardBadges()` in `gamification.service.ts` was fully
  implemented (including the push notification) but had **zero callers**, so no badge had
  ever been awarded (22 are active; `user_badges` was empty). It is now triggered, via the
  fire-and-forget `awardBadgesInBackground()` (never awaited, only logs on failure — a badge
  problem can't slow or fail a submission), after each of the four submit paths and after a
  review (the reviewer, for review-count badges; the contributor too on a `valid` decision).
  It is idempotent (earned badges are skipped; inserts are `ON CONFLICT DO NOTHING`). ⚠️
  **Expect a one-time burst:** each user's *first* trigger awards everything they already
  qualify for — the top contributor alone would get 9 badges. The in-app notification rows are
  one per badge, but when more than three are earned at once a **single summary push** is sent.
  Tested for real in a rolled-back transaction (pushes off): 9 badges awarded, one notification
  row each, a second evaluation a no-op, nothing left behind.
- **Leaderboard** (`GET /leaderboard`, **public**, exposes `userId` + `displayName`): ranks
  from `user_stats`, default page cached 2 minutes per period (cleared on ban / bulk ban, not
  on undo). Ranks use `row_number`, so ties get arbitrary distinct ranks. **All-time** ranks
  by `user_stats.total_points`. **Weekly / monthly** (fixed 2026-11-12) rank by the points a
  user earned in the **last 7 / 30 days (rolling)**, summed from `points_transactions` through
  `pointsInLastDays()` in `points.service.ts` — they used to read
  `user_stats.points_this_week/month`, which nothing ever wrote (and nothing resets on a
  schedule), so those boards were all zeros. The same helper now feeds `pointsThisWeek` /
  `pointsThisMonth` on `GET /users/me`, `GET /users/me/stats` and the admin user
  report/details. The two stored columns and `leaderboard_snapshots` remain unused.
- ⚠️ **Deleting a contribution never adjusted `user_stats`.** `DELETE /admin/contributions/:id`
  (and its bulk form) soft-deleted the `contributions` row but left
  `totalContributions`/the per-module counter/`verifiedContributions` untouched — found live
  via a mobile-responsiveness screenshot audit: the seeded demo account
  (farrukh@lexlingo.app) showed "4 contributions" on its dashboard while the `contributions`
  table had zero live rows for that user, because all 4 had been admin-deleted at some point
  in earlier testing and nothing had ever decremented the counters. Fixed with
  `adjustContributionStats(userId, moduleType, status, delta)` (`admin.routes.ts`), called
  with `-1` from both delete routes and `+1` from the generic Undo path when the reverted
  action is `admin_contribution_delete` (restoring a deleted contribution without
  re-incrementing its counters would be the same bug in reverse). Verified live: delete then
  undo round-trips a real contribution's `user_stats` row back to its exact original values.
  It originally excluded `rejectedContributions` because the `invalid` review decision never
  touched the contributor's `user_stats`, leaving that column at 0 for everyone. **That was
  fixed 2026-11-12** (§2.4: `invalid` now moves `pending` → `rejected`), so
  `adjustContributionStats` now also reverses the `rejected` counter when a rejected
  contribution is deleted or its delete is undone. Rejections from before the fix were never
  counted, so deleting one floors at 0 and undoing that delete adds a +1 the original never had
  — a one-off drift that `db:recompute-stats` (§7.3) repairs. Also
  deliberately excludes `points_transactions`/`totalPoints` — whether a moderation delete
  should claw back already-earned points is a separate product decision, not a bug fix.
  **Not retroactively repaired**: the fix stops future drift; farrukh@lexlingo.app's stats
  still read 4/10 points with 0 live contributions as of this writing, since correcting
  already-stored counters is a data change outside the app's normal code path.
- **Corpus Analytics** (public `/corpus` page): aggregate stats (audio hours, contributor
  count, languages covered) plus a per-language contribution breakdown. Only `/corpus/stats` is cached (1 hour);
  `/corpus/categories` and `/corpus/languages` are not.

### 2.7 Cross-cutting infrastructure notes

- **DB connection & Supavisor**: the backend connects to Supabase's **port-6543 pooler**
  (Supavisor, transaction-pooling mode) with `postgres.js`. ⚠️ **`prepare: false` is
  required** in the connection config (`src/db/index.ts`) — transaction-mode pooling can
  route different statements of one multi-statement transaction to different physical
  backend connections, and with prepared statements *on* (the postgres.js default) this
  caused multi-statement transactions to silently drop a write while still reporting
  success. This was found by live-testing the review-counter feature (a transaction with
  several sequential round trips) and reproduced consistently once isolated.
- **Cross-region latency**: the backend and its database are in different regions, so every
  round trip has real, non-trivial cost (a bare `SELECT count(*)` measured ~2-3s cold), and
  **transferring many rows is disproportionately expensive** — fetching ~6,400 rows once
  measured 20-40s+, while a bounded ~100-1000 row page consistently lands under ~2s. The
  practical rule this produced: never pull a large row set into Node to post-process; do
  aggregation/bucketing in one SQL statement and only return the small, already-summarized
  result. (This is exactly the fix applied to the sentence-grouping feature, §3.)
- **Row Level Security**: enabled on **every table in the live database (58 of 58, checked
  directly 2026-11-12)**, with **no policies defined**. The backend connects as `postgres`, which
  bypasses RLS, so this is currently inert protection against a future misconfigured
  low-privilege role (or Supabase's Data API / anon key), not an active access-control layer.
  ⚠️ **The migration files only cover 46 of those 58 tables.** `0015` enabled RLS on the 45 tables
  that existed then (plus `contribution_keywords` in `0017`); the 12 created since — the 6 forum
  tables (posts, comments, the two reaction tables, poll options, poll votes), plus
  `password_reset_tokens`, `terms_acceptances`, `pending_changes`, `suggestions`,
  `published_word_recordings` and `published_translations` — were never covered by a migration.
  Production has RLS on them anyway: it was turned on outside the migration history (most likely
  from the Supabase dashboard — the database has no auto-enable event trigger). **Correction:** an
  earlier revision of this doc reported those 12 as a live exposure, inferred from the migration
  files alone; the live check showed that was wrong. `0041_enable_rls_remaining_tables.sql`
  closes the gap in the *history* so a database built from migrations (e.g. a future staging
  database) matches production; against production it is a no-op.
- **Pool health, `/api/v1/health` and the watchdog** (added 2026-11-12, after the Railway API's
  connection pool wedged — the process stayed up and `/health` stayed green while every
  database-backed endpoint hung until clients gave up at 30 s). Three layers:
  1. `db/index.ts` now sets `connect_timeout: 10`, `idle_timeout: 60`, `max_lifetime: 1200`
     (seconds). The postgres.js defaults (idle connections kept forever, 30 s connect wait —
     the same 30 s as the clients' axios timeout) meant a pool of silently-dead connections
     never recovered and callers saw only `timeout of 30000ms exceeded`. `idle_timeout` is
     deliberately not small: this deployment is cross-region, so every reconnect costs ~1-2 s.
  2. `GET /api/v1/health` is now a **readiness** check (`modules/health/health.routes.ts`): it
     runs `select 1` through the pool with a 5 s timeout and returns `503 {status:
     "degraded"}` (no error detail — it's unauthenticated) on failure. The bare `GET /health`
     stays a cheap liveness probe. **Point uptime monitors at `/api/v1/health`.** A healthy
     response also carries `uptimeSeconds` (resets on every restart) and `version` (the
     deployed commit, from Railway's `RAILWAY_GIT_COMMIT_SHA`, or `null`) so a rollout can be
     confirmed from outside — Railway doesn't report deployments to GitHub (only Vercel does).
  3. `services/db-watchdog.service.ts` probes the pool every 30 s. After 3 consecutive
     failures it opens one brand-new connection: if that **works** the database is fine and the
     pool is wedged, so the process exits and Railway restarts it with a fresh pool; if that
     **also fails** the database itself is down, so it does *not* exit (a restart can't fix it,
     and repeated exits would exhaust Railway's restart retries and leave the service crashed
     after the database returns). Restarting is safe for in-flight submissions: the
     submission-buffer worker resets rows stuck in `processing` to `pending` on startup.
- **In-process caches** (all per Node process, so multiple replicas would drift): user row
  30 s and role permissions 5 min (`middleware/auth.ts`), categories-with-counts 30 min
  (invalidated by every concept mutation but **not** by category creation), languages 60 min
  (no invalidation), level thresholds 5 min, leaderboard 2 min, corpus stats 1 h, public
  dictionary/learning *filter options* 5 min (never invalidated on publish/unpublish).
- **Security headers / CSP**: `next.config.ts` sets a CSP with `media-src` limited to `self`,
  `blob:` and `*.r2.cloudflarestorage.com`, and `connect-src` limited to self plus the API
  origin (from `NEXT_PUBLIC_API_URL`). A past bug: the CSP blocked local `blob:` preview
  playback until `blob:` was added.
- **Feature flags are inert.** `feature_flags` is seeded (10 flags) and editable at
  `/admin/feature-flags`, but nothing in the backend or web app *reads* a flag to gate
  behaviour — only the admin routes touch them. Toggling one has no effect today.
- **Audit logging** (`services/audit-log.service.ts`): `writeAuditLog()` (single) and
  `writeAuditLogs()` (batch — one multi-row `INSERT` instead of N single-row ones for bulk
  admin actions) are called from auth, every contribution-submission service, permanent
  buffer failures, and every admin moderation/content action. This is also the data source
  for both the Admin Logs page and the generic Undo feature.
- **Image processing** (`services/storage.service.ts`): every uploaded/fetched image
  (concept, scene, avatar) is resized (max 1600px concept/scene, 512px avatar) and
  re-encoded to **WebP** (not JPEG) before storage — WebP is 25-35% smaller than JPEG at
  equivalent visual quality. `next.config.ts` additionally runs everything through
  next/image's own per-viewer format negotiation and resizing on top of this; the WebP
  source is what that optimizer starts from, and what anything bypassing it gets directly.
- **Audio recording** (`components/audio-recorder.tsx` + `lib/upload.ts`): `MediaRecorder`
  requests an explicit low bitrate tuned for speech — 24kbps Opus (webm/ogg) or 40kbps AAC
  (Safari's mp4 container) — instead of the browser's music-oriented default (commonly
  128kbps), plus a `sampleRate: 16000` hint on the mic constraint. These are single-speaker
  voice recordings, not music, so this is a large size cut with no perceptible quality loss.

---

## 3. Notable Feature Deep-Dives

### 3.1 Sentence grouping (translate module)

Sentences are bucketed into fixed groups of **at most 50**, shown as tiles on the main
translate page, each with a progress bar (translated / total for the current user).
Group membership is a **deterministic pseudo-random order** — sorted by `md5(id)`, not
creation order or alphabetically — computed on the fly rather than stored, so it needs no
migration/backfill and automatically covers sentences added later (at the cost of group
boundaries potentially shifting slightly if sentences are added/removed between requests;
acceptable for a progress-bar UI, not a strict invariant).

"Translate Randomly" exists at both levels: the top-level button is a true random pick
across every sentence (backend `ORDER BY random()`); the inside-a-group version picks
client-side from that group's already-fetched ≤50 items (preferring an untranslated one)
rather than another round trip. Opening a group shows its sentences in a **per-user
shuffled order** (`seededShuffle`, same utility used for concept-category and scene
ordering elsewhere), so browsing order is stable per user but differs between users.

Both `GET /sentence-groups` (paginated tile list) and `GET /sentence-groups/:groupIndex`
(one group's detail) do their bucketing **entirely in one SQL statement** each — see the
§2.7 note on why a naive "fetch every sentence id into Node" version of this had to be
rewritten.

### 3.2 Admin "reverse changes" (undo)

Scoped, by explicit product decision, to **undoing just the single most recent change per
item** — not a full version history browser, and not a whole-bulk-operation undo. This
required retrofitting `beforeState` capture onto several admin mutations that didn't
previously log it at all (concept/scene single edits), and converting concept/scene/
sentence bulk-edit/bulk-delete from one shared audit row per batch to one row **per
affected item** (mirroring the pattern already used for contribution bulk actions), since
per-item undo needs each item's own prior state, not a batch-level summary.

### 3.3 Mobile-responsive notification popup

The mobile-header notification bell used to sit as the *middle* child of a 3-way
`justify-between` row (logo / bell / hamburger), landing it near the horizontal center of
the screen instead of the right edge — its dropdown's `right: 0` anchor then opened mostly
off the left side of the viewport. Fixed by grouping the bell with the hamburger into one
flex child (so the pair sits flush right) and making the panel itself a near-full-width
sheet on narrow viewports (reverting to the original right-anchored dropdown at the `sm`
breakpoint and up, where it was already fine).

### 3.4 "Fill once, lock forever" demographics

The onboarding form (`contributor_demographics`) captures the required fields once; a
separate `PUT /users/me/demographics/optional` endpoint fills in whichever *optional*
fields (sub-tribe, quarter, dialect, education level, profession) were skipped at signup —
but any field that already has a value is silently left untouched rather than overwritten,
since these are meant to be provided once, not edited later.

### 3.5 Admin user filtering & report generation

The admin Users table uses the same comma-separated multi-select convention as admin
Contributions (`?gender=male,female`), decoded by the shared `csvOf()` / `csvOfUuid()` zod
preprocessors. Filters span both halves of a user record:

- **Signup form** (`contributor_demographics`): gender, education level, tribe, sub-tribe,
  village, quarter, country, city, mother tongue, profession, age range. Tribe→sub-tribe and
  country+city→village→quarter cascade, exactly as on the contributions page.
- **Account & activity** (`users` + `user_stats`): role, status, level, contribution counts,
  verified counts, points, peer reviews completed, has-ever-contributed, join-date range,
  plus a sort selector.

⚠️ `user_stats` is LEFT JOINed, so a user who has never contributed has **NULL** counters,
not `0`. Every numeric filter wraps the column in `coalesce(..., 0)` — without it, `min_points=0`
or `max_contributions=5` would silently drop every never-contributed user from the result.

**Reports** (`modules/admin/user-report.service.ts`):

- `GET /admin/users/:id/report?format=csv|pdf` — one user.
- `POST /admin/users/report` `{ ids, format }` — one *combined* file for a bulk selection,
  capped at 1000 ids (the list endpoint's own page ceiling). Rows are re-ordered to match the
  order the ids were selected in, not whatever order Postgres returned them.
- Both share `userReportQuery()` with `GET /admin/users/:id`, so the Details modal and the
  downloaded report can never disagree about a field.
- **CSV** is the lossless format: UTF-8 with a BOM (Excel otherwise renders Pashto/Urdu names
  as mojibake) and a leading-`'` guard on cells starting with `=`, `+`, `-` or `@` so a crafted
  display name can't execute as a formula on open.
- **PDF** uses `pdfkit` with the built-in Helvetica, which is WinAnsi-encoded. Characters
  outside it (Arabic script) are replaced with `?` rather than throwing — the CSV is the
  answer for non-Latin data. ⚠️ The page-number footer is drawn below the bottom margin, and
  pdfkit auto-appends a page for any text crossing a margin, so `doc.page.margins.bottom` is
  zeroed inside the footer loop; without that every report gained a trailing blank page.
- A consolidated report leads with an aggregate Summary section, then one page per user.

### 3.6 Peer review stats in admin contribution details

`GET /admin/contributions/:id/reviews` returns every review on a contribution plus a decision
tally. The admin contributions row-expander fetches it alongside keywords with
`Promise.allSettled`, so a failure in one does not blank the other.

### 3.7 Minimum signup age

Enforced in two places that must be kept in sync: `apps/web/app/onboarding/page.tsx`'s zod
schema (client-side, live as the date is picked — the form uses `mode: "onChange"`
specifically so this doesn't wait for a Submit click) and
`apps/backend/src/modules/users/demographics.routes.ts`'s `submitDemographicsSchema`
(server-side, authoritative). Both currently hardcode `14` as `MINIMUM_SIGNUP_AGE`.

### 3.8 Auth boot cost & the contribute-page header truncation

Two findings from live-testing (Playwright, mobile viewports, against a real Fastify
instance + Supabase) rather than code review alone:

- **Session restore cost three sequential cross-region round trips.** The access token is
  memory-only, so after any page reload there isn't one — `loadUser()` called
  `GET /users/me` bare, let it 401, and relied on the axios interceptor's refresh-and-retry.
  That's `GET /users/me` (401) → `POST /auth/refresh` → `GET /users/me` again, each a full
  round trip at the ~2-3s cross-region cost noted in §2.7 — the majority of the time spent
  behind `<AuthProvider>`'s blocking spinner, and the source of the `users/me:1 401` that
  showed in the console on every sign-in. Fixed with `ensureAccessToken()` (`lib/api.ts`),
  which mints the token up front and shares its in-flight promise with the interceptor's
  retry path, cutting boot to two round trips. Also found and fixed while here: the
  refresh-token rotation itself (`authService.refreshTokens`) validated with a SELECT and
  revoked with a separate UPDATE — two concurrent requests carrying the same refresh token
  could both pass validation before either revoked it, both walking away with valid new
  token pairs. Now one `UPDATE ... WHERE valid RETURNING`, so the validity check and the
  rotation are the same atomic statement. Verified live: replay of a used token is rejected,
  and of two concurrent uses of one still-valid token, exactly one succeeds.
- **Every `contribute/*` page's header could clip its own title.** `flex items-center gap-3`
  paired a fixed-width "← Back to Contribute" button with `<h1 className="min-w-0 flex-1
  truncate">` — at a 320-375px phone width the button (uppercase, `.btn-duo`, never
  shrinking below its content) left too little room for the title, so "Translate a
  Sentence" rendered as "Translate a Se…" and "Record a Word" as "Rec…". Not a layout
  *break* (`truncate` did its job — no horizontal overflow anywhere; a full Playwright sweep
  of every authenticated page at 320px and 375px found zero instances of content actually
  exceeding the viewport), just a title reading as unintentionally cut off. Fixed in all
  four contribute pages (`concept`, `scene`, `translate`, `audio`) two ways together: the
  back button's label shortens to "← Back" below the `sm` breakpoint (full text at `sm:`
  and up), and the header row switches from a single `flex-row` to `flex-col` on mobile
  (back button above, title gets the full line to itself), reverting to the original
  side-by-side row at `sm:` and up where there was always enough room.

### 3.9 Openverse image sourcing (`services/openverse.service.ts`)

Concept and scene images can now be sourced from [Openverse](https://openverse.org)'s
aggregated catalog of openly-licensed images (Flickr, Wikimedia Commons, museum
collections, etc.) instead of only manual upload / "From URL":

- **Search** (`GET /admin/openverse/search`, gated on `concepts.manage` OR `scenes.manage`
  via a new `requireAnyPermission()` helper since it's shared by both admin pages and
  touches neither table itself) is filtered to `license_type=commercial,modification` —
  every stored image gets resized and re-encoded to WebP (`storage.service.ts`), which is a
  "modification", so a license forbidding that isn't actually usable here even if it
  surfaced in an unfiltered search.
- **Attribution is Openverse's own field, used verbatim**, not reconstructed — it already
  reads e.g. `"Birch Trees" by saaby is licensed under CC BY-SA 2.0. To view a copy of this
  license, visit https://...`, including the license URL, which is more complete than
  anything worth rebuilding from the individual title/creator/license fields. Stored in two
  new nullable columns on `concept_media`/`scene_media` (migration `0027`):
  `source_provider` ("openverse" or null for a plain upload/URL fetch), `source_url` (the
  `foreign_landing_url`, i.e. a link back to the original), and `attribution` (the credit
  line itself). A picked image is re-hosted through the exact same
  `fetchImageFromUrl` → `insertConceptMedia`/`insertSceneMedia` pipeline as "From URL" — it
  ends up on our own Supabase Storage CDN either way, just with license metadata attached.
- **Manual picker** (`AdminOpenversePicker`, shared component): search box defaulting to
  the concept's label / scene's title, a thumbnail grid with license badges, pagination.
  Selecting one calls `POST /admin/{concepts,scenes}/:id/media/openverse`.
- **Bulk auto-fill** (`AdminOpenverseAutofill`, shared component): one button that searches
  Openverse by each item's own name and attaches the top result to every concept/scene that
  currently has *no* image at all — either the full corpus or an explicit id list. Runs in
  batches of 5 concurrent lookups (same bounded-concurrency pattern as the permanent-delete
  and contribution-stats-reversal batching elsewhere in `admin.routes.ts`), and one bad
  search miss doesn't block the rest of the batch. Verified live: filled 3 real concepts
  (Black/Roof/Orange) and 2 real scenes (River Journey/School Day) that had no image,
  correctly re-hosted and attributed.
- **Optional higher rate limit**: unauthenticated Openverse search works out of the box
  (~100 requests/day); setting `OPENVERSE_CLIENT_ID`/`OPENVERSE_CLIENT_SECRET` (free
  self-serve registration at Openverse) raises it to ~10,000/day via their
  `client_credentials` OAuth2 flow, with the token cached in memory and refreshed on
  expiry. Same "missing config degrades gracefully instead of failing" pattern as Firebase
  push (§2.6/§6) — unset, search just runs anonymously.
- Client-submitted attribution is trusted rather than re-verified server-side against a
  fresh Openverse lookup — this is admin-only (`concepts.manage`/`scenes.manage`), so a
  mismatched credit line would be a data-quality issue, not a security one, the same trust
  level already extended to an admin's own "From URL" input.

#### Wikimedia Commons, alongside Openverse (`services/wikimedia.service.ts`)

A second, independent image source: searches [Wikimedia Commons](https://commons.wikimedia.org)'
own media library directly via its `action=query&generator=search` API, rather than through
Openverse's aggregated (and comparatively smaller) slice of it — useful when Openverse hasn't
indexed an image yet, or an admin specifically wants Commons' much larger catalog. Mirrors the
Openverse integration's shape exactly, as a parallel, not a replacement:

- **Search** (`GET /admin/wikimedia/search`, same `requireAnyPermission()` gate) queries the
  `File:` namespace and reads each result's `imageinfo.extmetadata.License` slug (e.g.
  `cc-by-sa-4.0`, `cc0`, `pd`) — Commons has no built-in `license_type` filter like Openverse, so
  this is checked client-side in the service: anything tagged non-commercial (`nc`) or
  no-derivatives (`nd`) is dropped, same commercial-use-and-modification policy as Openverse.
  Total hit count comes from a `list=search&srinfo=totalhits` sub-query folded into the same
  request, used to compute a `pageCount` matching `OpenverseSearchResponse`'s shape.
  Unauthenticated (Commons' search API needs no key), but requires a descriptive `User-Agent`
  per Wikimedia's API etiquette (their anti-abuse tooling is aggressive toward anonymous-looking
  traffic) — a static `Lexlingo/1.0 (...)` string, same idea as the browser-like `User-Agent`
  `storage.service.ts` sends when fetching an admin-submitted "From URL" image.
- **Attribution is reconstructed**, not verbatim — unlike Openverse, Commons' `imageinfo` has no
  single ready-to-use credit-line field; `buildAttribution()` assembles one from the title,
  the `Artist` field (HTML-stripped), and the parsed license slug.
- **Same storage columns, a different `source_provider`**: `"wikimedia"` instead of
  `"openverse"`, same `source_url` (the Commons file description page) / `attribution` pair on
  `concept_media`/`scene_media` — no schema change needed, `source_provider` was always a plain
  string.
- **Manual picker and bulk auto-fill** (`AdminWikimediaPicker`, `AdminOpenverseAutofill` reused
  with a `providerLabel="Wikimedia Commons"` prop rather than a second duplicate component) sit
  right next to their Openverse counterparts on both admin pages — `POST
  /admin/{concepts,scenes}/:id/media/wikimedia` for a manually-picked image, `POST
  /admin/{concepts,scenes}/media/wikimedia-autofill` for the bulk sweep.

### 3.10 Paste-a-list bulk create (categories, concepts, scenes)

A lighter-weight sibling of the CSV/JSON bulk upload for the common case of just wanting to
add a handful of names quickly, without preparing a file:

- `POST /admin/categories/bulk-text` — one name per line, slug auto-generated the same way
  the single-category form does.
- `POST /admin/concepts/bulk-text` — `"label, category"` per line. Shares its category
  resolution and row-building logic (`buildConceptInserts()`) with the CSV/JSON route, so a
  category typo behaves identically either way: that row errors, the rest of the batch
  still commits.
- `POST /admin/scenes/bulk-text` — one title per line, **no slug required** (unlike the CSV
  route, which still asks for one) — generated from the title via the existing `slugify()`
  helper, with a numeric suffix on collision against both already-existing active scenes
  and earlier lines in the same paste, since two people independently pasting "Market Day"
  shouldn't fight over one slug.
- All three reuse `insertBulkInChunks()` and return the same `{ created, errors: [{row,
  message}] }` shape as the file-based bulk routes. None of them write an audit log
  (matching `/admin/concepts/bulk` and `/admin/scenes/bulk`, which don't either) —
  `audit_logs.resourceId` is a uuid column, and a chunked multi-row `INSERT` doesn't return
  per-row ids to key one against.
- Verified live: duplicate category names (both within one paste and against an existing
  category) each surface as their own row error rather than failing the batch; an unknown
  concept category does the same; two identical scene titles in one paste correctly get
  `slug` and `slug-2`.

### 3.11 Silent, case-insensitive duplicate handling on every add path

Adding a concept, scene, or sentence — through any of the seven routes that can create one
(single-item POST, CSV/JSON bulk, and bulk-text where it exists) — now silently no-ops
against a pre-existing case-insensitive duplicate instead of erroring or creating a second
copy: `"River"` and `"river"` are the same thing.

- **Concepts**: the duplicate key is the slug itself (`${category.slug}-${slugify(label)}`)
  — `slugify()` already lowercases, so this was actually the pre-existing behavior at the
  *database* level (the `uq_concepts_slug_active` unique index already rejected it), just
  surfaced as a raw unhandled 500 rather than something graceful. The single-create route
  now pre-checks and hands back the existing concept (`200`, not `201`) instead of hitting
  that constraint; the bulk routes (shared via `buildConceptInserts()`) check the same way,
  scoped to just the categories the batch actually touches (not the whole `concepts`
  table), and also dedupe *within* the batch itself so two "River" rows in one paste don't
  both attempt to insert.
- **Scenes and sentences** have no slug to lean on (a scene's slug is caller-supplied, not
  derived from the title; sentences have no slug at all), so these compare
  `lower(title)` / `lower(englishText)` directly against two new plain (non-unique)
  functional indexes, `ix_scenes_title_lower` and `ix_sentences_english_text_lower`
  (migration `0028`) — plain rather than unique, since the corpus may already contain
  incidental duplicates from before this check existed, and a unique index would fail to
  create over those. Bulk routes fetch only the existing rows matching the batch's own
  candidate texts (`lower(col) in (...)`, drizzle's array-interpolation syntax for this —
  `= any(...)` with an interpolated JS array does **not** work, it expands to a tuple
  `($1, $2)` rather than a Postgres array literal, confirmed by a live 500 while testing
  this) rather than pulling the whole table, which for `sentences` (6000+ rows) would be
  exactly the "never pull a large row set into Node" mistake documented in §2.7.
- **Silent** means what it says: a skipped duplicate is not added to a bulk result's
  `errors` array and does not count toward `created` — the admin sees a clean result with
  no noise, not a phantom "row N already exists" for something they'd consider a non-event.
- **Deliberately forward-only.** This governs what happens the next time something is
  *added* — it does not retroactively scan for and merge/delete duplicates that already
  exist in the corpus. Doing that safely would mean deciding which of two duplicates to
  keep (recordings/reviews/points may already be attached to either one) and is a
  meaningfully more invasive, harder-to-reverse operation than declining to create a new
  one going forward.
- Verified live: a same-slug concept (any case) returns the pre-existing row from all three
  concept-add paths; a mixed-case duplicate scene title is silently skipped from both the
  CSV and bulk-text routes; a mixed-case duplicate sentence is silently skipped from both
  the single-create and CSV bulk routes.

### 3.12 Category tiles: staleness and empty categories

Two related bugs on the same page (`/contribute/concept`'s category grid), both found via
the same user report:

- **Stale counters.** `GET /categories` (`categories.routes.ts`) caches its
  category-list-with-concept-counts for 30 minutes (`LIST_CACHE_TTL_MS`), and until now had
  no invalidation trigger at all — adding, editing, deleting, undoing, or bulk-editing a
  concept's category never touched it, so a category tile's "X / Y objects" counter and
  progress bar could read up to 30 minutes stale after any of those. Fixed with an exported
  `invalidateCategoriesCache()`, called from every concept-mutating route in
  `admin.routes.ts` (both single-item and bulk forms, plus the generic Undo path's
  `"concept"` case). Verified live: a freshly bulk-created concept's category shows its
  incremented count on the very next `GET /categories`, no wait.
- **Empty categories stayed visible.** A category with zero live concepts (all deleted, or
  never populated) still rendered as a tile reading "0 / 0 objects" — a dead end with
  nothing to record. Categories still need to exist and be visible for admin management
  (creating new concepts into them, including ones deliberately created empty — see §2.5's
  category-creation note), so this is filtered client-side, only on the contributor-facing
  page: `apps/web/app/(app)/contribute/concept/page.tsx` drops any category with
  `conceptCount === 0` before rendering the grid. Verified live against 7 categories in the
  actual corpus that already had zero concepts (Animals, Food, Transport, Actions, Health,
  Objects, People) — all seven correctly disappear from the contributor page's category
  grid while the admin's own category list (which needs to manage them) is untouched.

### 3.13 Per-image deletion (concepts and scenes)

Every image on a concept or scene, regardless of how it got there (multipart upload,
"From URL", or Openverse — all three funnel through the same `insertConceptMedia`/
`insertSceneMedia`), can now be individually removed. There was previously no way to
remove one image without deleting the entire concept/scene (which cascades its media as a
side effect of a much bigger, unrelated action).

- `GET`/`DELETE /admin/concepts/:id/media/:mediaId` and the identical pair for scenes.
  Deleting the DB row and the Supabase Storage object are two separate steps — the DB
  delete happens first, and a storage failure is logged rather than thrown, same "the
  delete already succeeded, an orphaned file is a much smaller problem" reasoning as the
  permanent-delete path (§2.5).
- **Primary reassignment**: if the deleted image was the primary one and others remain,
  the oldest survivor is promoted to primary — otherwise the concept/scene would keep
  other images on file while having none marked as its cover image.
- `scene_image_keywords` cascades on the DB side (`onDelete: "cascade"` on its FK to
  `scene_media`), so removing a scene image auto-removes its keywords with no extra query.
  Nothing references `concept_media` by FK, so no equivalent cleanup is needed there.
- **Frontend**: a new shared `AdminMediaManager` component (thumbnail grid, a "Remove"
  button per image, a "Primary" badge, the source provider if it came from Openverse) is
  wired into both admin pages behind an "Images" toggle — the same expand/collapse
  convention already used for the scenes page's "Keywords" panel. Concepts previously
  showed no thumbnail of an assigned image at all (only "Upload / From URL / Openverse"
  buttons); this is also the first time an admin can actually *see* a concept's image
  without leaving the page.
- Verified live: deleting a concept's primary image while a second remains correctly
  promotes the second to primary and confirms the deleted file is actually gone via the
  Supabase Storage `list` API (not just the public URL, which can be stale from CDN
  caching — see the permanent-delete note in §2.5 on why that check specifically isn't
  trustworthy); deleting a scene's only remaining image correctly leaves it with none.

### 3.14 Date-added filters (concepts, scenes, sentences)

`createdFrom`/`createdTo` (ISO datetime, end-inclusive of the whole day) are now accepted
by the public `GET /concepts` and `GET /scenes` list endpoints and the admin-only
`GET /admin/sentences` — added to the existing endpoints rather than duplicating a
separate admin-only list route, consistent with this module's existing "admin pages reuse
the public list endpoints" design (§2.5's module-map note). The contributor-facing browse
UI has no date picker and never sends these params; only the admin pages' new "Added
[date] to [date]" filter bar does. Sort order is untouched by this filter (scenes still
order by difficulty for contributor browsing) — the filter narrows the `WHERE` clause
only, it doesn't introduce a new default ordering that would affect contributor browsing.
Verified live against real corpus data for all three: total vs. "created today or later"
vs. "created before 2020" (0, as expected) counts all matched.

### 3.15 Has-image badge, category/image-status filters, and image cropping

> **Superseded in part (2026-11-11).** Concept images are no longer 1:1. Both concept and
> scene uploads now auto-crop to **16:9 at 1600×900** (`CONCEPT_IMAGE_SIZE` /
> `SCENE_IMAGE_SIZE` in `storage.service.ts`, still `fit: "cover"` + `position: "attention"`).
> The concept manual cropper is now **free-form** (`aspectRatio={null}`: any rectangle, any
> ratio) and is stored via `uploadFreeformCroppedImage` — longest edge capped at 1600,
> `fit: "inside"`, never upscaled, admin's ratio kept — while scene crops stay fixed 16:9
> (`fit: "fill"`). The "1:1", "1200×1200" and per-ratio statements below describe the
> original implementation and are kept for the reasoning, not the numbers. Avatars are still
> 1:1 / 512 px.

- **Has-image badge**: a small "✓ IMAGE" / "NO IMAGE" tag on every concept/scene row —
  purely a frontend read of the `imageUrl` field the list endpoints already returned; no
  backend change needed for the badge itself.
- **Filters**: `hasImage=yes|no` added to both `GET /concepts` and `GET /scenes`, via an
  `exists`/`not exists` subquery against `concept_media`/`scene_media` — written with
  literal, table-qualified SQL text (`concept_media.concept_id = concepts.id`, not
  `${concepts.id}` interpolated) for the same reason as the sentence/scene duplicate
  checks in §3.11: the inner table has its own `id` column, and an unqualified reference
  can silently bind to the wrong one. **Scenes have no direct category column** — a
  `categoryId` filter here matches scenes with at least one `scene_concepts` coverage
  annotation in that category (`scene_concepts` already carries its own `category_id` for
  exactly this). `getScenes()` was refactored from positional parameters to a `filters`
  options object once it grew past four. Verified live: `hasImage=yes` went from 0 → 1
  immediately after attaching a test image; a `categoryId` filter correctly matched only
  after inserting a real `scene_concepts` row pointing a scene at that category (the table
  was empty in this corpus, so a temporary row was inserted and removed to prove the join).
- **Auto-crop, every source, every path**: `storageService.uploadConceptImage()` (1:1) and
  `uploadSceneImage()` (16:9) now both use `fit: "cover"` with `position: "attention"`
  (sharp's saliency-based smart crop) instead of the previous `fit: "inside"`, which only
  capped the longest edge and left whatever aspect ratio the source happened to have —
  meaning concept/scene images were never actually the ratio the frontend's fixed-ratio
  image boxes assumed. Both functions share one private `uploadImageWithTargetRatio()`
  helper; since `insertConceptMedia`/`insertSceneMedia` are the single choke point every
  source (upload, "From URL", Openverse) already funnels through, this one change covers
  all three uniformly. Verified live: a freshly-attached Openverse image came back at
  exactly 1200×1200.
- **Manual crop**: a from-scratch canvas cropper (`components/image-cropper.tsx`) — no
  third-party crop library; React 19 compatibility risk for one wasn't worth it against a
  fairly small amount of drag/resize math. A fixed-aspect-ratio box can be dragged (move)
  and resized (bottom-right handle, ratio-locked), starting centered at the largest box of
  the target ratio that fits (the on-screen equivalent of the server's own auto-crop, so
  "Reset to auto-crop" and the initial state are the same thing). On Apply it draws the
  selected region onto an offscreen canvas at the caller's target resolution and hands back
  a Blob.
  - **Where it's wired in**: the "Upload" file picker on both admin pages now opens the
    cropper before the file ever reaches `uploadConceptMedia`/`uploadSceneMedia` (1:1 /
    16:9 respectively); the profile page's avatar picker opens it too (1:1, 512×512,
    matching `AVATAR_MAX_DIMENSION`). A new "Crop" button in `AdminMediaManager` (next to
    "Remove") lets an admin re-crop *any already-stored* image regardless of how it got
    there — including "From URL" and Openverse sources, which never pass through the
    browser as a raw file. This works because the cropper loads the image from its own
    Supabase Storage `publicUrl`, and Supabase Storage's public objects are already served
    with permissive CORS headers, so `crossOrigin="anonymous"` never taints the canvas —
    no proxy or preview-before-commit step needed.
  - **Backend**: `PUT /admin/{concepts,scenes}/:id/media/:mediaId/crop` (multipart) accepts
    the already-cropped image and re-encodes it with `fit: "fill"`
    (`uploadPrecroppedImage`/its two wrappers) rather than `"cover"` — re-cropping an
    image the admin already manually framed would silently override their choice, which is
    exactly the bug this route exists to avoid. The row's `id`/`isPrimary`/attribution are
    untouched; only `storageKey`/`publicUrl`/`mimeType` change, and the old storage object
    is deleted after the new one is confirmed (logged, not thrown, on delete failure — same
    convention as every other storage cleanup in this file).
  - Verified live end-to-end through the actual browser UI (not just curl): picked a
    concept's stored image, opened the crop modal, dragged the resize handle, clicked
    Apply, confirmed the `PUT .../crop` request returned 200, and confirmed the resulting
    stored file was exactly 1200×1200. Also verified directly against a scene image
    (simulating a browser-cropped 16:9 buffer) that the same-row id and `isPrimary` survive
    the swap and the previous storage object is actually gone (`storage.list`, not just the
    public URL, which can be stale from CDN caching per the permanent-delete note in §2.5).

### 3.16 Volunteers and the pending-changes approval queue

A fourth role, `volunteer`, lets trusted non-admins help curate content without being able to
change the corpus unsupervised. Seeded permissions for the role: `concepts.manage`,
`scenes.manage`, `sentences.manage` (nothing else). The web admin layout admits volunteers,
and `AdminNav` shows them only Concepts, Scenes and Sentences.

- **Gate** (`services/pending-changes.service.ts`, `gateVolunteerAction`): wraps the
  single-item *create* and *delete* routes for categories, concepts, scenes and sentences, and
  the four image-add routes (upload / URL / Openverse / Wikimedia) for concepts and scenes.
  Outcome: admin or super_admin → applied immediately; volunteer with
  `users.auto_approve_volunteer` → applied immediately; any other volunteer → a
  `pending_changes` row (`target_type`, `action` = create | delete, jsonb `payload`) and a
  **202** `{ pending: ... }` response (the web client's `PendingResult` type, narrowed with
  `"pending" in result`). Uploaded image bytes are stored **base64 inside the jsonb**.
- A volunteer may delete only rows they created (`createdBy`), checked in the route and
  again in `applyDelete*`. `concepts`/`scenes`/`sentences` gained a `created_by` column
  (`0029`), set only for volunteer-created rows.
- **Approval** (`volunteers.manage`, held by admin/super_admin): `/admin/volunteers` lists
  volunteers with pending counts and an auto-approve toggle; the per-volunteer view reviews
  each pending row (approve/reject, group approve/reject all, history, audit log). Status
  moves `pending` → `approved` | `rejected` once; `applyPendingChange` replays the payload
  through the same `apply*` functions the live routes use, re-running domain checks at
  approval time. If apply throws, the row stays `pending`. Bulk approve/reject cap: 200.
- **Partly fixed 2026-11-12.** The gate wraps **only** those routes, and volunteers hold the
  full `*.manage` codes, so they could call the *ungated* routes directly. The destructive ones
  are now **admin-only** (`forbidVolunteers` in `middleware/auth.ts`): `bulk-delete`,
  `bulk-delete-permanent` and single `/permanent` for concepts, scenes and sentences (a volunteer
  could previously erase any item with no recordings, and its images, regardless of
  `createdBy`). ⚠️ **Still open — needs a product decision on what volunteers may do
  unreviewed:** PUT edits, bulk-edit, bulk and bulk-text creates (which also leave `createdBy`
  null), image delete/crop/bulk-url/autofill, and Undo. The comment in `seed.ts` overstates
  the coverage. **Approval is now atomic (fixed 2026-11-12):** it used to be check → apply →
  `markApproved` with no `WHERE status = 'pending'`, so a double-click or two admins could both
  apply the same change (image adds would duplicate). `claimPendingChange()` now takes the row
  with one `UPDATE … WHERE status = 'pending' RETURNING`, exactly one caller wins (tested: two
  simultaneous approvals → one success, one 409 `ALREADY_REVIEWED`), a failed apply calls
  `releasePendingChange()` so the row goes back to `pending`, and `markRejected` is conditional
  too. A duplicate-key failure at approval time is now a clean 409 `DUPLICATE` (it was a raw
  500 with the driver message), and `listPendingChanges` no longer ships the base64 file
  payloads — any value over 2000 characters is replaced by a marker in SQL (the full payload is
  still read by id when approving). Remaining edge: a crash in the instant between claiming and
  applying would leave a change `approved` but never applied.
- Web gaps: volunteers have no nav link into `/admin` (they must type `/admin/concepts`),
  and Undo buttons render for them even though that isn't their intended scope.

### 3.17 Publishing and the public API (Pashtowal)

Contributions are not public by default. An admin with `publishing.manage` curates exactly
which recordings and translations are exposed, and an unauthenticated read-only API serves
only those.

- **Tables** (`0036`): `published_word_recordings(concept_id, word_recording_id UNIQUE,
  sort_order, published_by)` and `published_translations(sentence_id, translation_id
  UNIQUE, ...)`. Publishing a row is an `INSERT ... ON CONFLICT DO NOTHING`; unpublishing
  deletes it. There is no approval step. `sort_order` is read but no route sets it.
- **Admin UI** (`/admin/publishing`, backend `modules/admin/publishing.*`): Words and
  Sentences tabs with the same demographic filters as the contributions page; per-concept /
  per-sentence lists of current (`isCurrent`) recordings with a presigned audio URL;
  publish/unpublish one, or withdraw a whole word (`DELETE /concepts/:id/recordings`);
  bulk-tag grammar (`PUT /concepts/:id/recordings/grammar`: gender, part of speech, number).
  Commit `7b519ad` deliberately dropped the earlier "verified only" requirement — recordings
  of **any** review status can be published.
- **Public endpoints** (`modules/public-content`): `GET /public/dictionary`,
  `/public/dictionary/filters`, `/public/language-learning`, `/public/language-learning/filters`.
  The dictionary is organised by concept (recordings, primary image, up to 6 related words
  from the same category); language-learning by sentence. Each recording carries native text,
  romanization, IPA, language, dialect and (words only) grammar tags. Audio is a **10-minute
  presigned R2 URL**.
- **Access control**: a `PUBLIC_API_KEY` env var checked against the `x-public-api-key`
  header in constant time. **In production an unset key now fails closed** (503
  `PUBLIC_API_NOT_CONFIGURED`, fixed 2026-11-12); in development an unset key leaves it open
  for local use. (Production already has the key set, so nothing changed for the WordPress
  site.) The separate Pashtowal WordPress theme is the intended consumer.
- **Privacy**: a contributor's city, tribe, village and gender are included — and the location
  filters honour them — only when `contributor_profiles.show_location` is true
  (`privacyFields()` in `public-content.service.ts`).
- **Stale rows — fixed 2026-11-12.** Every public query (lists, the filter dropdowns, related
  words) now counts a published row only while its source recording is live: not soft-deleted,
  and still the contributor's `is_current` take (`LIVE_WORD_RECORDING` / `LIVE_TRANSLATION` in
  `public-content.service.ts`). Before, a recording that was later deleted or superseded stayed
  public until an admin unpublished it. (Production had 10 published recordings, none stale,
  so the fix changed nothing visible today.) ⚠️ Still open: neither publishing nor the feed
  checks the contribution's *review status* (deliberate — commit `7b519ad`); a **retake of a
  published recording** swaps the audio in place (`word_recordings.audio_file_id`), so the new,
  unreviewed audio goes live while the contribution is back to `pending` (a product decision:
  auto-unpublish on retake?). Publishing actions are also not audit-logged (so not undoable).
  (`ilike` search used to treat the user's `%` and `_` as wildcards — **fixed 2026-11-12** at all
  14 search sites via `containsPattern()` in `utils/sql-like.ts`, §7.2.)

### 3.18 Discussion forum

An open forum, all routes authenticated (`modules/forum`, mounted at `/api/v1/forum`):
posts (≤4000 chars, optional image ≤10 MB re-encoded to WebP and stored in the shared
Supabase image bucket, optional share-link to a concept or sentence via
`?conceptId=` / `?sentenceId=`, optional single-choice poll of 2-6 options — a post is a poll
when it has `forum_poll_options` rows), threaded comments (`parent_comment_id`, ≤500 per post,
no pagination; the web UI caps visual indent at depth 4), 7 reaction types
(`like/dislike/laugh/love/wow/sad/angry`, one per user per target by unique index) and poll
votes (changeable, no close/expiry). Comments, replies and first-time reactions create in-app
notifications plus best-effort push.

- **Moderation** is delete-only: the author or any holder of `users.manage` can soft-delete a
  post or comment. There is no report, hide, lock, edit, forum-ban or admin listing, and no
  forum-specific rate limit beyond the global 300/min/IP.
- **Fixed 2026-11-12:** `blockIfRestricted` now guards creating posts and comments (a
  restricted user can still read, react and delete their own); deleting a post removes its image
  from storage (best-effort) and clears `image_url`/`image_storage_key` — the key was stored but
  never used, so deleted posts' pictures stayed publicly reachable; `votePoll` refuses a deleted
  post. ⚠️ Still open: posts by banned users stay visible as "Deleted User"; toggling a reaction
  off and on re-notifies the author each time.
  A GIF attachment existed briefly (`0034`) and was dropped (`0035`).

### 3.19 Terms & Conditions

`src/content/terms.ts` holds `CURRENT_TERMS_VERSION` (currently `"2026-10-20"`) and
`TERMS_CONTENT` (a 13-section markdown string), served by `GET /terms` and rendered by the web
`/terms` page and the register form (mobile shows it in a modal).

- **Enforcement**: `POST /auth/register` requires `termsVersion`; the server rejects anything
  but the current version with `409 TERMS_VERSION_MISMATCH` and inserts a `terms_acceptances`
  row (append-only, unique on user+version) in the same transaction as the account. Web and
  mobile register forms fetch the version immediately before submitting.
- **No re-acceptance**: existing users are never re-prompted when the version changes.
- ⚠️ The text is marked as an **unreviewed draft, not legal advice**, still contains
  unfilled placeholders (`[Jurisdiction]`, `[contact email]`), grants a perpetual commercial /
  AI licence with no compensation, and says 18+ while signup enforces
  `MINIMUM_SIGNUP_AGE = 14` (§3.7). The unused `consents` table's defaults (CC-BY-4.0,
  `commercial = false`) contradict it.

### 3.20 Password recovery

`/forgot-password` → `POST /auth/forgot-password` (identical response whether or not the
email exists; SMTP failure swallowed) → emailed link `${FRONTEND_URL}/reset-password?token=…`
→ `POST /auth/reset-password` (token consumed atomically; all sessions revoked). Mail goes
through `mailer.service.ts` (nodemailer, SMTP env vars, §6). In production an unset
`SMTP_HOST` throws, and the caller swallows it, so a misconfigured mailer fails silently.
Account emails were **case-sensitive** (`uq_users_email_active` is on raw `email`, so
`Foo@x.com` and `foo@x.com` were different accounts, and a banned address could re-register by
changing its capitalisation). **Fixed 2026-11-12:** register, login, forgot-password and the
admin credentials route now trim and lower-case the address (`z.string().trim().toLowerCase()`).
Every existing address was already lower-case with no collisions (checked live), so no data
change or new index was needed.

### 3.21 Word recordings: synonyms, retakes, grammar metadata

- A contributor records a concept in up to **3 synonym slots** (`synonym_index` 1-3, unique per
  user+concept+slot while not deleted); the 3-slot cap is hardcoded in the route.
  `GET /contributions/word/:conceptId/limits` returns `{1: bool, 2: bool, 3: bool}` (which
  slots are taken). An earlier "takes" model was removed (commit `4d4e087`) — mobile still
  speaks the old shape (§8).
- Recording length is capped at **10 s** (zod, a re-check against the post-trim duration, and
  the DB `CHECK ck_word_recording_max_duration`; raised from 5 s in `0039`). Several stale
  comments still say "3-second"/"5-second".
- **Retake**: re-submitting the same user+concept+slot replaces the audio in place, resets
  the contribution to `pending`, clears verified/rejected fields, bumps `version` and
  `submittedAt`, quarantines the old `audio_files` row and deletes the old R2 object. It
  awards **no** points and doesn't touch `user_stats`. An override that gets the same
  `audioFileId` short-circuits.
- **Grammar metadata is per recording** (`grammatical_gender`, `part_of_speech`,
  `grammatical_number` on `word_recordings`; added to `concepts` in `0037`, moved in `0038`
  because different speakers/dialects can differ). Shown in My Contributions and in the
  public API; admins bulk-tag it from the publishing page.
- Uniqueness for words and translations is **language-agnostic**, so a second-language
  submission silently overrides the first, and `language_id` isn't updated on override.

### 3.22 Sentence source language and paste-text sentence upload

- `sentences.source_language` (`sentence_source_language` enum: `english | urdu | persian`,
  default `english`, `0031`) lets the corpus hold Urdu and Persian prompts. The translate page
  has a source-language filter and renders such sentences with `dir="rtl"`. ⚠️ The column that
  stores the prompt is still named `english_text` (and its FTS index uses the `'english'`
  config), so the name is now misleading.
- `POST /admin/sentences/bulk` (file) takes `?sourceLanguage=`; `POST
  /admin/sentences/bulk-text` (paste, one sentence per line — commit `57a2793`) takes the
  same. The admin Sentences page has one shared "bulk upload language" selector for both.
  Both reuse the silent case-insensitive de-dupe from §3.11. There is no PUT to edit a
  sentence's text.

---

## 4. Frontend Architecture

- **Routing**: Next.js App Router with three route groups — `(auth)` (login/register, no
  nav), `(app)` (the contributor-facing app, wrapped in `<Nav>`), `(admin)` (wrapped in
  `<AdminNav>`, gated by role). `app/onboarding/page.tsx` sits outside all three groups.
- **State**: a single Zustand store (`lib/store.ts`) holds the current user
  (`UserProfile`) and loading/error state; `loadUser()` is called once on app mount via
  `<AuthProvider>` and **skips the network call entirely** if the `lexlingo_has_session`
  localStorage flag isn't set — the refresh token is now an httpOnly cookie JS can't read, so
  the flag is the only hint; it used to check for a stored refresh
  token (added specifically to stop a real 401 from showing in the browser console for
  every anonymous visitor landing on `/login` — harmless, but looked like a bug).
- **API client** (`lib/api.ts`): one `axios` instance, bearer token attached via
  interceptor, automatic refresh-and-retry on a 401 (concurrent 401s share one refresh
  call). `getErrorMessage()` normalizes a caught error into a user-facing string, preferring
  the backend's Zod-issue message over axios's generic "Request failed with status code
  N" — several bug reports this session turned out to be this helper not being used
  somewhere, hiding the real backend error behind a useless generic one.
- **Shared components** worth knowing about:
  - `components/admin-pagination.tsx` — the one `<Pagination>` used everywhere paginated
    admin/contributor lists exist; supports a "per page" selector (10/20/50/100/1000) and
    an optional numbered-page-buttons mode (`showPageNumbers`).
  - `components/audio-recorder.tsx` — the one recording widget used by every contribute
    page; mic access is requested synchronously inside the record button's `onClick`
    (mobile browsers throw `NotAllowedError` if `getUserMedia` isn't inside a user gesture).
  - `components/admin-undo-button.tsx` — thin wrapper around the undo endpoint (§2.5).
  - `components/notification-bell.tsx` — polls every 30s; a `SUBMISSION_FAILED`
    notification's "View" button deep-links into `/contributions?failed=<id>`, which
    auto-opens the Failed Submissions view and highlights that specific entry.
- **Shared audio-playback pattern**: every list of playable items (My Contributions, the
  admin contributions table, the peer review queue) uses **one hidden, always-mounted
  `<audio>` element per page**, driven by direct `.play()`/`.pause()`/`.currentTime =`
  calls and a `playingId`/`loadedId`/`loadUrlCache` trio of state, rather than mounting a
  fresh `<audio>` per row. This is a **deliberate, repeated fix**: a per-row/conditionally-
  mounted `<audio>` element reliably needs two clicks to start playback, because the first
  click's `.play()` call races the element's just-created ref not yet being attached — this
  exact bug was found and fixed independently on the review page after already being
  established correctly on My Contributions; any new playable list should copy the
  established pattern from the start rather than rediscovering this.
- **Deep-linking into a contribute page**: `contribute/concept`, `contribute/scene`, and
  `contribute/translate` each accept a query param (`?conceptId=`, `?sceneId=`,
  `?sentenceId=`, plus `?synonymIndex=` for words) that jumps straight into recording that
  exact object, bypassing the normal browse flow — used by "Submit Again" on a failed
  submission. Each of these three pages is wrapped in a `<Suspense>` boundary because
  `useSearchParams()` requires one for static prerendering.

### 4.1 Route map (added 2026-11-11)

There is **no `middleware.ts`**: every guard is client-side, and `AuthProvider` renders only a
spinner until `loadUser()` resolves, so the server HTML of every page — including `/` and
`/terms`, which fetch data on the server — is effectively a spinner.

| Area | Routes |
|---|---|
| Public | `/` (marketing + corpus stats, `force-dynamic`), `/terms` (server-rendered, hand-rolled markdown subset) |
| Auth (`(auth)`, no layout) | `/login`, `/register` (fetches `GET /terms`, sends `termsVersion`, then → `/onboarding`), `/forgot-password`, `/reset-password?token=` |
| Onboarding | `/onboarding` — demographics form (zod `mode: "onChange"`, `MINIMUM_SIGNUP_AGE = 14`, free-text tribe/village/quarter via datalist `Combobox`, arbitrary-depth sub-tribe chain, country sent as a *name*) |
| Contributor (`(app)`, `<Nav>`) | `/dashboard`, `/contribute` (hub) → `/contribute/concept`, `/contribute/translate`, `/contribute/scene`, `/contribute/audio`; `/contributions` (history + failed submissions), `/review` (SILVER+), `/leaderboard`, `/corpus`, `/forum`, `/forum/[id]`, `/profile`, `/settings` |
| Admin (`(admin)/admin`, `<AdminNav>`) | `dashboard`, `users`, `contributions`, `concepts`, `scenes`, `sentences`, `volunteers`, `publishing`, `suggestions`, and super-admin-only `gamification`, `feature-flags`, `logs` |

- **Guards**: `(app)/layout.tsx` redirects to `/login` when there's no user. The admin layout
  admits `admin`, `super_admin` **and `volunteer`**; `AdminNav` filters links by role, and the
  gamification / feature-flags pages self-check for `super_admin`. Other admin pages (users,
  logs, …) have no page-level role check — a volunteer who types the URL sees the shell and
  gets 403s from the API.
- **Gates**: terms are only enforced at registration (§3.19). Onboarding is only reached via
  `register → /onboarding`; login always goes to `/dashboard`, so a user who skipped it sees
  "Set your language in your profile before contributing" on every contribute page, but the
  profile page has no language editor and nothing links back to `/onboarding`.
- **Contribute pages**: `concept` (3-step: categories → concepts → record; image carousel;
  3 synonym slots; "Suggest a better image"; "Share to Forum"), `translate` (groups of ≤50 →
  group → record, 60 s max, per-user shuffle, source-language filter), `scene`, `audio`
  (100 MB file, optional transcription + time segments). All four submit through the buffer
  (§2.3). Categories and scenes are ordered with `seededShuffle(userId)`.
- **Admin pages** share one set of components (`Pagination`, `AdminMultiSelect`,
  `AdminBulkBar`, `AdminBulkUpload`/`-TextCreate`/`-ImageUrlUpload`, `AdminMediaManager`,
  Openverse/Wikimedia pickers + autofill, `AdminUndoButton`, `AdminPermanentDeleteButton`,
  `ImageCropper`, the three user modals) — the Openverse and Wikimedia pickers are
  near-identical copies. Scenes has no title/description edit UI.
- **API client**: `lib/api.ts` (~1900 lines) is the whole surface — `auth`, `terms`, `users`,
  `notifications`, `languages`, `geo`, `demographics`, `categories`, `concepts`, `audio`,
  `buffer`, `contributions`, `scenes`, `reviews`, `leaderboard`, `levels`, `corpus`, `badges`,
  `forum`, `admin` (~100 wrappers), `publishing`, `superadmin`. Volunteer-gated calls return
  `PendingResult`. Many wrappers are unused (the legacy non-buffer submit paths,
  `admin.getPendingChanges`, `suspendUser`, `scenes.getDaily`, …).
- **Design system**: Tailwind 4 `@theme` tokens in `globals.css` (`brand` green, `secondary`,
  `accent`, `gold`, `danger`, `surface*`, `border`, `ink*`; Nunito via `next/font`) and a
  Duolingo-style kit — `.btn-duo` (+ `-secondary`/`-blue`/`-danger`), `.card-duo`,
  `.progress-duo-*`. **No i18n**: `<html lang="en">` with no `dir`; the only RTL support is
  `dir="rtl"` on Urdu/Persian source sentences in translate.

---

## 5. Database Schema — Domain Grouping

(Full detail lives in `apps/backend/src/db/schema.ts`; this is an index, not a
restatement of every column.)

| Domain | Tables |
|---|---|
| Identity & access | `users`, `refresh_tokens`, `password_reset_tokens`, `terms_acceptances`, `device_tokens`, `permissions`, `role_permissions`, `user_additional_permissions` (never read) |
| Demographics & geography | `contributor_demographics`, `contributor_profiles`, `tribes`, `sub_tribes`, `villages`, `quarters` |
| Content taxonomy | `languages`, `dialects`, `categories`, `concepts`, `concept_media`, `sentences`, `scenes`, `scene_media`, `scene_image_keywords`, `scene_concepts` |
| Contributions (per module) | `word_recordings` (Module 1), `audio_uploads` + `transcriptions` + `transcription_segments` (Module 2), `translations` (Module 3), `scene_contributions` (Module 4), plus the umbrella `contributions` table every module row is linked from |
| Submission pipeline | `pending_submissions` |
| Media | `audio_files` (shared by every module; carries the crude review-tally counters, §2.4) |
| Review & moderation | `reviews`, `contribution_keywords`, `audit_logs`, `suggestions` |
| Gamification | `user_stats`, `streaks`, `gamification_config`, `points_transactions`, `badges`, `user_badges`, `perks`, `leaderboard_snapshots` |
| Comms & compliance | `notifications`, `consents`, `data_exports` |
| Ops | `feature_flags` (inert, §2.7) |
| Forum (§3.18) | `forum_posts`, `forum_comments`, `forum_post_reactions`, `forum_comment_reactions`, `forum_poll_options`, `forum_poll_votes` |
| Publishing (§3.17) | `published_word_recordings`, `published_translations` |
| Volunteer workflow (§3.16) | `pending_changes` (+ `users.auto_approve_volunteer`, `created_by` on `concepts`/`scenes`/`sentences`) |

`contributions` is the single row every review/point/status action operates on regardless
of module — it holds exactly one of `word_recording_id` / `audio_upload_id` /
`translation_id` / `scene_contribution_id` (enforced by a `CHECK` constraint,
`ck_contribution_single_reference`), plus `status`, `language_id`, `dialect_id`, and the
(effectively dead — see §2.6) `base_points`/`bonus_points`/`total_points` generated column.

As of 2026-11-11 there are **58 tables and 27 enums**. Other things worth knowing:

- **Never referenced outside `schema.ts`**: `consents`, `data_exports`, `perks`,
  `leaderboard_snapshots`, `user_additional_permissions`. `audio_files`' virus-scan/processing
  columns are largely unused. `bullmq` and `ioredis` are in `apps/backend/package.json` but
  never imported.
- `contributions` and `pending_submissions` reference each other (circular FKs), which forces
  nullable-then-backfill insert order. `pending_changes.result_resource_id` has no FK and its
  `payload` is untyped jsonb. Drizzle `relations()` exist only for the older tables; forum,
  publishing, `pending_changes`, `suggestions`, `terms_acceptances` and
  `password_reset_tokens` use manual joins.
- `contributor_profiles` (language, location, tribe as free text) overlaps with
  `contributor_demographics` (the real onboarding form); mobile onboarding writes only the
  former, the web form writes both.
- `audit_logs.resource_id` is a `uuid`, so resources keyed by text (`gamification_config`,
  `feature_flags`) can't be stored there (see §2.5's undo note).
- `pending_submissions` history: `audio_data` bytea (`0008`) → dropped (`0011`) → local-disk
  `audio_file_path` (`0010`) → back to `audio_buffer` bytea (`0018`). Some `schema.ts`
  comments (the `pending_submissions` docblock, the "3-second limit") are stale.
- Migrations `0018`–`0020` are hand-written with commented SQL, and `0018` has no
  `meta/*_snapshot.json`. `0007`, `0012`, `0019` and `0022` include data backfills.
- The unique email index compares the raw string; the app lower-cases emails on input (§3.20).
  `contributor_demographics.age` is
  server-computed from `date_of_birth`.

---

## 6. Environment & Deployment

- **Backend**: Railway. Build: `npm run build --workspace=apps/backend` (tsc). Start:
  `node apps/backend/dist/index.js`.
- **Web**: (Vercel-style Next.js hosting, standard `next build`/`next start`.)
- **Database**: Supabase Postgres, accessed through its **transaction-mode pooler**
  (port 6543) — see the `prepare: false` requirement in §2.7.
- **Object storage**: Cloudflare R2 (audio, via S3-compatible API + presigned URLs),
  Supabase Storage (images, public URLs).
- **Push**: Firebase Cloud Messaging, optional (`FIREBASE_PROJECT_ID` unset/`"placeholder"`
  → push sending is a no-op logged to console, not an error).
- **Openverse image search** (§3.9): no config required — `OPENVERSE_CLIENT_ID` /
  `OPENVERSE_CLIENT_SECRET` are optional, raising the anonymous rate limit if set.
- Every environment variable is loaded via `dotenv/config` at the top of `src/index.ts`;
  there is **no separate staging/dev database** — all development and testing happens
  against the same production Supabase instance, with disciplined creation/cleanup of
  throwaway test accounts and careful FK-order deletion.

### 6.1 Environment variables (as read by the code, 2026-11-11)

**Backend** (`apps/backend`):

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string — the Supabase **pooler** (6543); `prepare: false` is required (§2.7) |
| `DATABASE_DIRECT_URL` | Used only by `drizzle.config.ts` (`db:migrate`); falls back to `DATABASE_URL`, but a pooled URL can't run DDL reliably |
| `JWT_SECRET` | Signs/verifies access tokens |
| `ALLOWED_ORIGINS` | Comma-separated CORS allowlist (default `http://localhost:3000`); no wildcard, because cookies need `credentials: true` |
| `PORT` / `HOST` | Default `3001` / `0.0.0.0` |
| `NODE_ENV` | `production` → `Secure; SameSite=None` refresh cookie and no stack traces in error bodies |
| `FRONTEND_URL` | Base of the password-reset link (default `http://localhost:3000`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Mailer; in production an unset `SMTP_HOST` throws (caller swallows it) |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_AUDIO_BUCKET`, `R2_EXPORTS_BUCKET` | Cloudflare R2 (audio) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_STORAGE_BUCKET` | Supabase Storage (images) |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | FCM push; unset / `"placeholder"` → push is a logged no-op |
| `OPENVERSE_CLIENT_ID`, `OPENVERSE_CLIENT_SECRET` | Optional; raises Openverse's anonymous rate limit |
| `PUBLIC_API_KEY` | Optional; if unset the `/public/*` API is **fully open** (§3.17) |

**Web**: `NEXT_PUBLIC_API_URL` (API base and CSP `connect-src`). `NEXT_PUBLIC_SUPABASE_URL` /
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are read only by `utils/supabase/server.ts`, which
nothing imports (dead, along with the `@supabase/ssr` / `@supabase/supabase-js` deps).
**Mobile**: `EXPO_PUBLIC_API_URL` (fallback `http://10.0.2.2:3001`).

**Seeding**: `npm run db:seed` (a plain `tsx` script). Its first three sections (feature flags,
gamification config, permissions + role grants) are now insert-or-skip, so they work on a
database that has already been migrated (fixed 2026-11-12); the later sections (demo users,
categories, concepts, …) are **not** idempotent, so don't re-run the whole seed against a
populated database. The `patch-*.ts` seed scripts have no npm script — run them with `tsx`. One-off data repair: `npm run db:recompute-stats` (dry run; add
`-- --apply` to write) — see §7.3.

---

## 7. Known Gaps / Not Yet Implemented

### 7.1 Carried over from earlier sessions

- Mobile app (`apps/mobile`) has drifted from the backend and gets none of the newer web
  features — see §8. It is no longer accurate to call it merely "not part of this log".
- No automated test suite — correctness is established via manual live-testing against the
  real backend/database per change (register throwaway accounts, exercise the real HTTP
  endpoints, verify via direct queries, clean up).
- RLS policies are not actually defined (§2.7) — currently relies entirely on
  application-layer permission checks.
- `needs_correction` review decision still exists in the schema/backend but has no
  reachable UI button (superseded by the 3-button valid/invalid/cannot_decide redesign).
- `contributions.base_points`/`bonus_points`/`total_points` (generated column) are
  effectively dead weight — nothing populates the first two, and the one place that used to
  read the third has been switched to summing `points_transactions` instead. Not removed,
  since a generated column can't easily be dropped without checking for any remaining
  reader, but worth knowing this generated value is **not** the real per-contribution point
  total.
- **Badges were never awarded** — fixed 2026-11-12: `evaluateAndAwardBadges()` is now called
  after each submit path and each review (§2.6). The frontend already lists a user's badges
  (`badges.getForUser`); there is no special "you just earned one" UI beyond the notification.
- `user_stats.rejectedContributions` is permanently stuck at 0 for every user — nothing in
  `reviews.service.ts`'s `invalid` decision path increments it (§2.6). Shown in the admin
  "Details" modal, so it currently always reads "0 rejected" regardless of reality.
- Some already-seeded accounts' `user_stats` counters predate the delete-reversal fix
  (§2.6) and were never retroactively corrected — e.g. the demo account
  farrukh@lexlingo.app still reads 4 total contributions / 10 points against 0 live
  `contributions` rows. The fix stops the drift going forward; it doesn't repair history,
  since that's a direct data change outside the app's normal code path rather than a code
  fix.

### 7.2 Found by the 2026-11-11 code audit (*code-read*, not live-verified)

Pointers to §2-§3 where an item is already described in detail. Everything here was found by
reading the code. These were additionally re-checked directly against the source before being
written down: the `totalPoints` writers, the never-written weekly/monthly counters, the
uncalled `evaluateAndAwardBadges()`, the review `invalid` path and its race, the volunteer
gate's route coverage, the scope of `blockIfRestricted`, feature-flag usage, the
seed/migration `0007` conflict, and the 16:9 image sizes. (RLS was checked against the *migration
files* only and turned out wrong for the live database — see §2.7.) The rest rests on the audit
agents' reading and should be reproduced — ideally against the live system, not just the code —
before being fixed.

**Data integrity & correctness**
- **Fixed and shipped 2026-11-12 (batch 1 — see §7.3):** the
  `totalPoints` under-count (§2.6), the always-zero weekly/monthly leaderboards (§2.6), the
  review concurrency race and the `invalid`-decision counters (§2.4).
  **Still open:** `evaluateAndAwardBadges()` has no callers (§2.6).
- **Admin status changes — fixed 2026-11-12** (`services/contribution-status.service.ts`).
  `PUT /admin/contributions/:id/status` and `bulk-status` set only `status`, so admin-verified
  items had no `verifiedAt` (and were missing from the dashboard's "verified today") and a
  verified-then-rejected item kept its stale `verified*` fields and previous `rejectionReason`.
  They now set `verifiedAt/By` or `rejectedAt/By` + reason for the new status and reset every
  field that belongs to a status it no longer has; both routes also skip/404 deleted
  contributions, and the saved undo state excludes `deletedAt` (so undoing a status change can't
  un-delete a contribution). ⚠️ Still open: they don't adjust `user_stats` counters or award
  the verified bonus (a product call — should an admin override pay out like a peer review?);
  `db:recompute-stats` re-derives the pending/rejected counters.
- **Double deletes — fixed 2026-11-12.** `DELETE /admin/contributions/:id` didn't check
  `deletedAt`, so a second delete reversed the owner's stats again; it now 409s
  `ALREADY_DELETED`, and the `UPDATE` itself is conditional on "not deleted yet" so two
  simultaneous deletes can't both reverse the stats. The concept / scene / sentence
  `bulk-delete` routes now skip already-deleted rows instead of overwriting their original
  `deleted_at` and logging a misleading before-state.
- **Undo fragility — fixed 2026-11-12** (`utils/audit-state.ts` + the undo handler).
  `beforeState` comes back from jsonb with timestamps as ISO *strings*, and `...before` was
  passed straight to Drizzle's `.set()`, whose timestamp mapper calls `.toISOString()` — so
  undoing any change with a non-null timestamp (e.g. `verifiedAt`) threw a 500. Saved state now
  goes through `reviveAuditState()` (ISO string → `Date`; keys that aren't columns of the table
  are dropped). Lifting a restriction/suspension by undo now also clears its reason/until
  fields; re-applying a contribution delete (`undo:admin_contribution_delete`) now re-decrements
  stats; and **a ban can no longer be undone** (`NOT_REVERTIBLE` — banning scrubs the account's
  data for good, so the old undo resurrected an empty, unusable "zombie" account).
- Points farming: scenes have no per-user uniqueness; every `POST /:id/transcription` creates a
  new version and a new idempotency key (re-awarding points); segment arrays are unbounded.
- Word/translation uniqueness ignores language (§3.21); retaking a published recording
  publishes unreviewed audio (§3.17). (Buffered TRANSCRIPTION losing its transcription/segments
  on a retry is **fixed 2026-11-12**, §2.3.)
- Account deletion (`deleteUserAccount`, five parallel un-transacted writes) scrubs `users`,
  demographics, profile, refresh tokens and device tokens only. Forum posts, suggestions,
  notifications, `terms_acceptances` and reset tokens remain, and the schema's `ON DELETE
  CASCADE`s never fire because users are only soft-deleted.

**Security**
- **Fixed 2026-11-12 (batch 2, §7.4):** the volunteer permanent/bulk-delete bypass (partly —
  §3.16); the missing moderation target rules; the undo → admin re-grant escalation; the
  legacy-route restriction and audio-ownership gaps; SSRF by redirect; the public API's
  fail-open key and stale rows (§3.17); raw 5xx errors reaching clients; case-sensitive emails.
  Details:
  - **Moderation target rules** (`services/moderation-guards.service.ts`). Nobody can restrict /
    cool off / suspend / ban / lift any of those on their **own** account; only a super_admin can
    moderate an admin or a super_admin (single and bulk — a bulk selection containing a protected
    account is refused as a whole, not partly applied). `POST /superadmin/admins` refuses a
    super_admin or deleted target instead of silently demoting them. Undoing a user action goes
    through the same check. (Before, an admin with `users.manage` could lock out a super_admin.)
  - **Undo → privilege re-escalation.** Undo matched `log.action === "superadmin_grant_admin"`
    exactly; after a super_admin undid a grant the newest row was `undo:superadmin_grant_admin`,
    so any `users.manage` admin could undo *that* and restore `role: "admin"`. Permissions are
    now judged on the **original** action (all `undo:` prefixes stripped), and any log row that
    changes a user's `role` needs `system.manage` however it was logged.
  - **Legacy direct-submit routes** now run `blockIfRestricted` and `assertOwnsAudioFile()`
    (`services/audio-file.service.ts`: the audio row's `uploaded_by` must be the submitter —
    both upload flows already recorded it). This closes the path where a reviewer, who can see
    every queued contribution's `audioFileId`, attached a victim's audio as their own recording
    and retook it, which quarantines the old row and deletes the victim's R2 object.
  - **SSRF by redirect:** `fetchImageFromUrl` follows redirects by hand (`redirect: "manual"`, up
    to 5 hops) and re-runs the private-address check on **every** hop, so a public URL can no
    longer 302 to `169.254.169.254` or an internal service.
  - **Error handler** (`utils/error-handler.ts`): in production an unexpected 5xx returns a
    generic `{code: "INTERNAL_ERROR", message: "Something went wrong"}`; SQL text, hostnames and
    driver messages stay in the server log only.
- **Still open:** the presigned flow trusts the client (`/audio/:id/confirm` compares two
  client-supplied checksums and never checks R2; the presigned `PutObject` has no content-length
  limit; `durationMs` is client-reported for SCENE and TRANSCRIPTION in every flow, so the scene
  "long description" bonus can be claimed by lying); the Openverse/Wikimedia routes accept any
  public `image.url` host (the redirect/private-address guard now protects them, but an arbitrary
  public host can still be fetched); the public leaderboard exposes `userId`/`displayName`;
  terms say 18+ but signup allows 14. (RLS on 12 tables is missing from the migration history
  but **already on in production** — not a live exposure, §2.7.)
- **Fixed 2026-11-12 (batch 4, §7.6):** `DELETE /devices/unregister` is now scoped to the
  caller's own tokens (it matched on the token alone, so anyone holding another device's token
  could switch that user's notifications off); the bulk image-by-URL routes run 5 downloads at a
  time instead of up to 200 at once (and no longer echo raw error messages); the buffered-submit
  endpoints refuse a user who already has 25 submissions `pending`/`processing`
  (`429 TOO_MANY_PENDING`) — each queued row holds up to 110 MB of audio in the database.

**Seed & ops**
- **Seed — fixed 2026-11-12.** `npm run db:seed` failed on a freshly migrated database:
  migration `0007` already inserts `points.audio.translation` and `seed.ts` inserted it again
  with no `ON CONFLICT`, violating `uq_gamification_config_key_active` and aborting the
  gamification-config section after the feature flags had already committed. Those sections
  (and permissions / role grants) are now insert-or-skip, and `publishing.manage` is in the
  seed itself (it used to need `patch-publishing-permissions.ts`). ⚠️ Still open: the seed
  creates no `super_admin` (promotion is manual) and gives demo contributors no demographics
  (so reviewer scoping returns an empty queue); seeded level descriptions say "Minimum points"
  but levels are driven by contribution *count*.
- **Admin tuning — fixed 2026-11-12** (`services/gamification-config.service.ts`):
  `PUT /superadmin/gamification/:key` accepted any number. Points, level and module-limit values
  must now be whole, non-negative numbers (a fractional or negative point value would have made
  the next submission fail on the integer `points` column), and the level thresholds must stay
  strictly increasing (silver < gold < platinum, silver > 0). Changing — or undoing a change to —
  a `levels.*` threshold now **re-derives every user's stored level** in one statement
  (`recomputeAllUserLevels()`); before, levels only moved when each user next submitted, and could
  then change unpredictably. A new category now invalidates the 30-minute categories cache.
  `/admin/analytics` no longer counts soft-deleted contributions or banned users.
  ⚠️ Still open: `/admin/training-data/images` and `/categories` / `GET /concepts/next` pull whole
  tables into Node (against §2.7's own rule).
- **Input handling — fixed 2026-11-12:** the `z.coerce.boolean()` bug (the string `"false"` became
  `true`) via `queryBoolean()` in `utils/query-params.ts`; a CSV saved from Excel as "UTF-8" now
  parses (`bom: true` — the BOM used to be glued onto the first header so every row was rejected)
  and a UTF-8 BOM no longer breaks JSON; a `null`/non-object element in a JSON array is a clear 400
  instead of a 500; failed bulk-insert rows report a short reason ("Already exists (duplicate)")
  instead of the whole failed SQL statement and its parameters; permanent delete detaches
  `suggestions` that reference the concept/scene (it was reporting that FK as `HAS_CONTRIBUTIONS`
  with a count of 0); every bulk-id array is capped at 1000 (an audit insert past ~9,300 rows
  exceeded Postgres's parameter limit *after* the mutation had applied); the concepts list has a
  stable `ORDER BY` (creation order). ⚠️ Still open: `GET /sentences/random` writes `usage_count`
  on a GET.
- Notifications: `GET /notifications` mutates `sent → delivered`; there is no unread count or
  mark-all-read; push honours only the global `pushNotificationsEnabled` preference.
  Streaks are computed in UTC, and parallel buffer rows for one user can race on the streak
  read-modify-write.

**Web frontend**
- **Fixed 2026-11-12 (PR "Web: surface real error messages…", §7.5):**
  - A failed session restore (refresh rejected with **401**) now clears the
    `lexlingo_has_session` hint (`clearSessionHint()`), so later boots stop re-firing a refresh
    that can only 401. Network errors / timeouts / 5xx deliberately don't clear it.
  - `NotificationBell` is mounted once (it polled twice); volunteers get an "Admin" link to
    `/admin/concepts`; the "set your language" dead end now links to `/onboarding` (still no
    forced redirect).
  - ~40 `err instanceof Error ? err.message` sites use `getErrorMessage()` (left alone on
    purpose: microphone permission, canvas crop, and the helper itself); pages that hung on
    "Loading…" or swallowed failures (dashboard, profile, `/corpus`, `/leaderboard`, forum
    reactions/poll, feature flags, admin bulk and row actions) now show an error.
  - Smaller: the invalid nested `<button>` and the undefined `text-ink-faint` token on the
    publishing page; a profile bio can be cleared; the audio-upload form shows a success
    message; the concepts page reloads after an image is added; "Lift ban" → "Lift
    suspension".
- **Still open:** the admin *scenes* page has the same stale "Image" badge after an image add;
  admin contributions' `load()` and the concepts mount-time fetch have no catch; `next lint`
  can't run (no ESLint config in `apps/web`); someone who finished onboarding but whose mother
  tongue didn't map to a language row still sees "Complete your profile", which may not help
  (demographics are fill-once — a product call). Also: `store.error` is still never read; the
  scene coverage picker loads only the first 200 concepts and is add-only; admin contributions'
  `togglePlay` doesn't use the `loadedId` pattern §4 calls established; the forum post detail
  counts only top-level comments; `confirm`/`alert`/`prompt` are used at ~60 sites.

**Dead code & config**
- Never read: `feature_flags` (§2.7), `consents`, `data_exports`, `perks`,
  `leaderboard_snapshots`, `user_additional_permissions`; ~10 seeded permission codes (§2.5);
  `points.word.synonym_bonus`, `levels.bronze.min`, the `modules.*` config keys;
  `PermanentFailure` in `submission-buffer.service.ts`; `bullmq` / `ioredis`;
  `apps/web/utils/supabase/server.ts` and its deps; ~15 unused `lib/api.ts` wrappers;
  `lib/demographics-constants.ts` is a hand-synced copy of the backend list; `.turbo/turbo-build.log`
  is stale.
- Stale comments: `schema.ts` (`pending_submissions` still described as local-disk, "3-second
  limit", a duplicated JSDoc block), several "3-second" word-limit comments in the services,
  `storage.service.ts` image comments (JPEG / 1:1), `store.ts` ("sessionStorage"), and
  `ConfirmDialog`'s "first custom modal".

### 7.3 Batch 1 — shipped 2026-11-12

**Status: shipped.** Merged to `main` as PR #2 (rebase merge), deployed by Railway, migration
`0041` applied, and the `user_stats` repair applied. Details of what was run and checked are
below.

What changed: `services/points.service.ts` (`awardPointsOnce`, `pointsInLastDays`) wired into
every award path; the review lock + per-decision counters in `reviews.service.ts`; the
`rejected` branch in `adjustContributionStats`; ledger-backed weekly/monthly figures in the
leaderboard, `/users/me`, `/users/me/stats` and the admin report; DB pool timeouts, the
`/api/v1/health` readiness route and the watchdog (§2.7); migration `0041` (brings the
migration history in line with production's RLS — a no-op there); and the
`database/scripts/recompute-user-stats.ts` repair script.

**What was run, in order** (the order mattered — the repair only after the fixed code was live):
1. **PR #2 merged → Railway deploy.** Confirmed live when `GET /api/v1/health` began returning
   `db: "ok"`, about 11 minutes after the merge.
2. **`npm run db:migrate`** — applied only `0041` (migrations table: 42 recorded, nothing
   pending; RLS still 58 of 58). Effectively a no-op, since production already had RLS.
3. **`npm run db:recompute-stats`**: dry run, then `-- --apply` — updated **10** `user_stats` rows
   (net +2,270 points; 4 `pending` and 2 `rejected` counters). The before-values were saved
   first, in the git-ignored `apps/backend/data/backups/`
   (`user_stats_before_recompute_2026-11-12.json` and `revert_user_stats_2026-11-12.sql`;
   reverting overwrites any activity those users had since). A second dry run found 0 users to
   change.
4. **Not done: point an uptime monitor at `GET /api/v1/health`** (not `/health`) — that needs an
   external monitoring account.

**Effect on the leaderboard:** the all-time top entries changed from 770 / 620 / 30 to
1,835 / 1,570 / 80, and the first two users swapped places — the user previously second had
never had their translation / scene / audio points counted.

**Verified after shipping, against the live system:** the deployed `/api/v1/health` reports
`db: "ok"`; the deployed all-time, weekly and monthly leaderboards return 200 with every row
equal to the points ledger; 0 of 44 users have a stored `total_points` that differs from the
ledger; and `/users/me` and `/users/me/stats` (the same route code, run against the repaired
database) report `totalPoints` equal to the ledger with non-negative pending/rejected counts.
The authenticated endpoints on the *deployed* service were not hit (no credentials to do so).

**How it was verified** (throwaway harness, since deleted; run against the real database with
nothing left behind): watchdog decision logic with fakes (wedged → exit once; database-down →
never exits; a success resets the count); health route 200 on the real pool and 503 with no error
detail on a failing probe; `awardPointsOnce` adds exactly the points once and is a no-op on
replay, inside a rolled-back transaction; leaderboard (weekly/monthly) rows equal the ledger's
7/30-day sums; `/users/me`, `/users/me/stats` and the admin report match the ledger; and `FOR
UPDATE` through the Supavisor pooler really blocks a second reviewer (waited ~2.7 s).

**Still not tested (no staging database; the repo's convention is throwaway accounts):** the review `valid`/`invalid` counter changes end to end (the
lock and the helper were tested in isolation, not a full review by a second user); the
watchdog's real `process.exit` path (only its decision logic was tested); and a weekly
leaderboard with non-zero data (there was no activity in the last 7 days; the monthly board had
real non-zero values and matched).

### 7.4 Batch 2 — security hardening (2026-11-12)

Shipped as one PR; the individual fixes are described where they live (§2.2, §3.16, §3.17,
§3.20, §7.2 "Security" and "Data integrity"). New files: `services/moderation-guards.service.ts`,
`utils/audit-state.ts`, `utils/error-handler.ts` (the handler moved out of `index.ts` so it can be
tested), `utils/query-params.ts`, plus `forbidVolunteers` in `middleware/auth.ts` and
`assertOwnsAudioFile()` in `services/audio-file.service.ts`. No migration, no data change.

**Verified** with a throwaway harness against the real database and the real route code (roles
taken from the live accounts — one super_admin, one admin, one volunteer, contributors), 50
checks: the who-may-moderate-whom matrix; admin → restrict / suspend / ban / bulk-restrict /
bulk-ban a super_admin and → restrict themselves all 403; volunteer → permanent and bulk delete
403 while an admin's identical call isn't blocked; the undo escalation (`undo:…grant_admin`,
nested `undo:undo:…`, any role-changing row → 403; a ban undo → `NOT_REVERTIBLE`; a normal undo
still reaches the target check; a super_admin isn't blocked); timestamp revival builds a valid
`UPDATE` where the old code threw; `"false"` → false; production 500s carry no SQL/host/stack;
the public API key fails closed in production and the dictionary returns exactly the live
published recordings (10 of 10); another user's audio file via the legacy route → 403; and, with
`fetch` stubbed (no network), a public URL redirecting to `169.254.169.254` or loopback is
rejected without the internal address ever being requested, a 6-hop chain stops, and a normal
public → public redirect still works. Probes only ever targeted nonexistent ids or checked that
nothing changed; the live super_admin / admin / volunteer accounts were verified unchanged
afterwards and the few audit rows the harness inserted were deleted.

**Deliberately NOT changed — each needs a decision that isn't mine to make:**
- What volunteers may do *unreviewed* beyond destructive deletes (edits, bulk creates, image
  delete/crop/bulk-url/autofill, Undo) — tightening these changes how volunteers work (§3.16).
- Retaking a published recording puts the new, unreviewed audio live — auto-unpublish, or
  re-review first? (§3.17)
- Points-farming rules (scenes per-user uniqueness; whether re-transcribing re-awards).
- The Terms of Service text (age, placeholders, licence) — needs legal review; re-acceptance flow.
- Account-deletion scope (forum posts, suggestions, notifications), and what to do about
  feature flags (wire them up, or delete them).
- Whether to revive or park the mobile app (§8); a staging database; an uptime monitor.

### 7.5 Batches 3 and the web fixes (2026-11-12)

**Web (`apps/web`)** — shipped as its own PR, verified by `tsc --noEmit` (run by the author and
independently re-run) and Vercel's production `next build`; **not browser-tested**. Details in
§7.2 "Web frontend".

**Data integrity (backend)** — admin status changes now record who/when and reset stale
fields; double deletes are rejected (and concurrent ones can't both reverse stats); the
concept / scene / sentence bulk-delete routes skip already-deleted rows; badges are finally
awarded (§2.6); a buffered TRANSCRIPTION retry no longer loses its transcription/segments
(§2.3); the seed works on an already-migrated database (§6.1). No migration, no data change.
Verified against the live database: the status-field helper; already-deleted contributions
and sentences through the real routes (409 / 404 / `updated: 0` / `deleted: 0`, rows and the
owner's `user_stats` untouched); the badge function for real in a rolled-back transaction with
pushes off; and the seed's `ON CONFLICT` behaviour against the real unique index.

⚠️ **Not covered by a live test:** `completeTranscriptionExtras()` (the buffered-transcription
retry) — exercising it needs a real in-flight buffered upload, so it is verified by review and
typecheck only; and the admin status-change *routes* end to end (they'd have to change real
contributions), so only their field logic and their deleted-row guards were exercised.

**Still deliberately left** (needs a decision — see §7.4): volunteer permissions beyond
destructive deletes; retake of a published recording; points-farming rules; Terms text;
account-deletion scope; feature flags (wire up or remove); mobile; whether admin status
overrides should also pay the verified bonus / adjust counters; a staging database; an uptime
monitor.

### 7.6 Batch 4 — hardening and bug fixes (2026-11-12)

Fixes listed where they live (§3.16 pending changes, §3.17, §3.18 forum, §7.2 "Security", "Admin
tuning", "Input handling"). New files: `services/gamification-config.service.ts`,
`utils/sql-like.ts`; `claimPendingChange`/`releasePendingChange`/`finishApproval`/
`isUniqueViolation` in `services/pending-changes.service.ts`; `recomputeAllUserLevels()` in
`services/level.service.ts`. No migration, no data change.

**Verified against the live database** (40 checks, throwaway harness, one throwaway
`pending_changes` row that was deleted): two **simultaneous** approvals → exactly one wins and
the loser gets 409; a later approval and a reject-after-approve are refused; release restores
`pending`; the list view omits a 6000-character file payload while the by-id read still returns
all of it; real Postgres unique vs foreign-key errors are told apart; the config validator's
accept/reject matrix and the three real `PUT /superadmin/gamification` rejections (nothing
written); `recomputeAllUserLevels()` is a no-op on consistent data; LIKE escaping against real
Postgres (`%`, `_`, backslash, normal terms); a UTF-8-BOM CSV parses; 1001-id bulk requests are
refused and 1000 still accepted; `/admin/analytics` matches the live non-deleted pending count;
a poll vote on a missing post is a 404.

⚠️ **Not covered by a live test:** device-unregister ownership (no active device tokens exist to
test with — verified by review/typecheck), the per-user buffer cap, the forum restricted-user
guard and image cleanup (no restricted user / deletable post to probe without changing real
data), the permanent-delete suggestion detach, and the JSON-array-element check inside the real
upload route.

---

## 8. Mobile App (`apps/mobile`)

*Added 2026-11-11 from a read-only audit; nothing here was built or run on a device.*

**Verdict**: a real app, not a stub — but the backend has moved on and Module 1 does not work
against it. The only commit to touch it after late September was the narrow auth fix `16c810d`
(plus two audio-limit constants).

**Stack**: Expo SDK 57 as a **dev-client build** (`expo start --dev-client`; Expo Go can't run
it), React Native 0.86 / React 19.2, new architecture + Hermes, TypeScript strict, React
Navigation 7 (native-stack + bottom tabs), Zustand (`auth.store`, `app.store`), axios,
WatermelonDB 0.28 (one table `offline_contributions`), `react-native-audio-recorder-player` v4
(AAC `.m4a`, mono, 44.1 kHz), `react-native-blob-util`, `expo-secure-store` (refresh token),
AsyncStorage (FCM token, 24 h languages/categories cache), `@react-native-firebase/{app,messaging}`
v26. `@tanstack/react-query` is installed and `QueryClientProvider` wraps the app, but no
`useQuery`/`useMutation` exists. Android package `com.lexlingo.app`; the iOS Xcode project still
says `org.name.mobile` and `app.json` has no `ios.bundleIdentifier`, which mismatches the
committed `GoogleService-Info.plist`. API base: `EXPO_PUBLIC_API_URL`.

**Boot**: `index.js` → `App.tsx` (waits for Nunito fonts) → `AppInitializer` calls `loadUser()`,
starts the NetInfo sync listener and requests the FCM token (registered via `POST
/devices/register` once authenticated; no `onTokenRefresh`, no background handler, no
tap-handling — a foreground message just raises an `Alert`). `RootNavigator` shows a splash,
then `OnboardingScreen` if `isAuthenticated && justRegistered`, else the tab navigator, else
`AuthStack`.

**Auth**: sends `X-Client-Platform: mobile` on every call, so the backend returns the refresh
token in the response body (§2.2); the access token lives in memory, the refresh token in
SecureStore. A 401 interceptor skips `/auth/*`, shares one in-flight refresh, retries once and
logs out on failure. Logout is best-effort (`/auth/logout` needs a valid access token).

**Tabs**: Home (stats, daily scene, last 5 contributions), Contribute (hub → Modules 1-4),
Review (SILVER+, gated client-side), Ranks (leaderboard), Profile (stats, badges, settings).

**Upload path**: mobile uses the **legacy presigned flow** — `POST /audio/upload-url` → PUT to
R2 → `POST /audio/:id/confirm` → the module's direct-submit JSON — not the durable buffer the
web uses (§2.3), so it is also the only client that skips `blockIfRestricted`.

**What is real vs placeholder**
- Real: login, register (with terms), a reduced onboarding, all four contribute modules,
  review list/detail, leaderboard, badges, profile/stats, settings, push registration.
- Placeholder/missing: `ContributionHistoryScreen` is a `PlaceholderScreen` nothing navigates
  to; Settings "Terms of Service: Coming soon" and a "contact support" alert instead of calling
  `DELETE /users/me`; the Home "pending upload — tap to sync" banner has no `onPress`;
  ProfileMain never loads the existing biography. Absent versus web: forum, corpus page,
  contributions/failed-submissions UI, full demographics onboarding, forgot/change password,
  avatar upload, notification inbox, suggestion box, account deletion, sentence-group browse,
  and all volunteer/admin tooling.
- **Offline queue is built but dead**: `syncService.queueContribution()` is never called, no
  screen writes to WatermelonDB, every module uploads inline and just shows an error on
  failure. Even if wired, it sends `mimeType: 'audio/m4a'` (not in the backend's allowed list →
  400), never retries rows stuck in `uploading`, and never surfaces `dead` ones.

**Known drift from the backend**
1. **Module 1 is broken.** `GET /contributions/word/:conceptId/limits` now returns
   `{1: bool, 2: bool, 3: bool}` (commit `4d4e087` removed "takes"), but `Module1Screen.tsx`
   expects `canAddTake`/`nextSynonymIndex`/`takesPerSynonym` and reads
   `limits?.takesPerSynonym[...]` — a `TypeError` as soon as a concept opens. It also has no
   synonym selector.
2. **Module 3 audio is not optional** in the backend (`audioFileId` is required) but the UI
   says it is and allows a text-only submit → 400.
3. **Empty review queue** for mobile-only users: scoping needs `contributor_demographics`,
   which mobile onboarding never writes (it writes `contributor_profiles` with a free-text
   tribe).
4. Wrong copy: review "unlocks at GOLD" (gate is SILVER); "3-second word clips" (cap is 10 s).
   Level thresholds are hardcoded in `utils/level.ts` although they're admin-configurable via
   `GET /levels/thresholds`. The Daily Challenge opens a *random* scene, so the daily bonus
   isn't reliably earned.
5. Server error messages are mostly lost (only `auth.store.ts` extracts `response.data.message`),
   so e.g. `ACCOUNT_RESTRICTED` shows axios's generic text. Login doesn't trim the email and
   has no forgot-password link; Register's submit stays disabled forever if `/terms` fails.
6. Module 2 hashes the whole file as base64 in JS (OOM risk near the 100 MB cap) and segments
   with `endMs <= startMs` fail backend validation after the audio is already submitted.

# Lexlingo — Architecture Log

A crowd-sourced language documentation platform: contributors record words, sentence
translations, freeform audio, and scene descriptions in their own language; peers review
each other's submissions; points/levels/badges drive engagement; admins moderate and curate
the corpus. This document describes the system **as currently implemented**, plus the
non-obvious decisions and bugs behind it, so future work doesn't have to rediscover them.

Last updated: 2026-09-15.

---

## 1. Stack & Monorepo Layout

- **Monorepo**: npm workspaces + Turborepo (`apps/*`, `packages/*`).
- **Backend** (`apps/backend`): Fastify (Node, TypeScript, ESM) + Drizzle ORM + PostgreSQL
  (Supabase-hosted). Deployed to **Railway** (`railway.json`: Railpack build, starts
  `node apps/backend/dist/index.js`).
- **Web** (`apps/web`): Next.js 15 (App Router), React 19, Tailwind, Zustand for client
  state, `react-hook-form` + `zod` for forms, `axios` for API calls.
- **Mobile** (`apps/mobile`): React Native / Expo. Present in the repo but **out of scope**
  for this log — untracked/not actively developed in the sessions this doc summarizes.
- **File storage**: audio → **Cloudflare R2** (S3-compatible, via `@aws-sdk/client-s3` +
  presigned URLs); images (concept/scene/avatar) → **Supabase Storage**.
- **Push notifications**: Firebase Cloud Messaging (`firebase-admin`), gated by both a
  server-config check (`FIREBASE_PROJECT_ID` set) and a per-user preference.
- **Migrations**: Drizzle Kit, hand-reviewed SQL files in `database/migrations/` (26 as of
  this writing), applied via `npm run db:migrate` — **no separate dev database**; all work
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
| `auth` | Register/login/refresh/logout, password hashing (bcrypt), JWT issuance |
| `users` | Own-profile CRUD, avatar upload, own contributions list, mother-tongue demographics form |
| `categories` | Public concept-category + concept listing (browse, search) |
| `languages` | Public active-languages + dialects list (60-min in-memory cache) |
| `contributions/word` | Module 1: record a word for a concept (up to 3 synonyms/slots per concept) |
| `contributions/audio` | Module 2: freeform audio upload + transcription + segments |
| `contributions/translation` | Module 3: translate an English sentence, incl. the sentence-grouping/tile feature |
| `contributions/scene` | Module 4: describe a scene image aloud |
| `contributions/buffer` | The DB-buffered submission pipeline shared by all four modules (§2.3) |
| `reviews` | Peer review queue + decision submission (§2.4) |
| `gamification` | Leaderboard, badges, corpus-wide stats, level thresholds |
| `notifications` | In-app notification list/read, device token register/unregister, push sending |
| `admin` | All admin/moderation endpoints — by far the largest module (§2.5) |

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
  and browsing still work.

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
  `leaderboard_snapshots`) — leaderboard is fed from `user_stats`. ⚠️ **Badges are never
  actually awarded**: `evaluateAndAwardBadges()` in `gamification.service.ts` is fully
  implemented (including the push notification) but has **zero callers** anywhere in the
  backend — found while investigating the streak bug above, not yet fixed. Every seeded
  badge (including the `streak_days` trigger type, which reads `currentStreak` the same way
  this section describes) is permanently unreachable until something calls it after a
  contribution/review completes.
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
  Deliberately excludes `rejectedContributions` — `reviews.service.ts`'s `invalid` decision
  only ever decrements `pendingContributions`, it never increments `rejectedContributions`,
  so that column already sits at 0 for every user regardless of actual rejections (a separate
  pre-existing bug); adjusting an always-zero counter isn't symmetric once the delete side's
  `greatest(x-1, 0)` floor kicks in, so it's left alone rather than making it worse. Also
  deliberately excludes `points_transactions`/`totalPoints` — whether a moderation delete
  should claw back already-earned points is a separate product decision, not a bug fix.
  **Not retroactively repaired**: the fix stops future drift; farrukh@lexlingo.app's stats
  still read 4/10 points with 0 live contributions as of this writing, since correcting
  already-stored counters is a data change outside the app's normal code path.
- **Corpus Analytics** (public `/corpus` page): aggregate stats (audio hours, contributor
  count, languages covered) plus a per-language contribution breakdown, both cached.

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
- **Row Level Security**: enabled on every table (`0015_enable_rls_all_tables.sql`) but with
  **no policies defined** — the backend's DB role owns the tables / bypasses RLS, so this is
  currently inert protection against a future misconfigured low-privilege role, not an
  active access-control layer.
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

---

## 4. Frontend Architecture

- **Routing**: Next.js App Router with three route groups — `(auth)` (login/register, no
  nav), `(app)` (the contributor-facing app, wrapped in `<Nav>`), `(admin)` (wrapped in
  `<AdminNav>`, gated by role). `app/onboarding/page.tsx` sits outside all three groups.
- **State**: a single Zustand store (`lib/store.ts`) holds the current user
  (`UserProfile`) and loading/error state; `loadUser()` is called once on app mount via
  `<AuthProvider>` and **skips the network call entirely** if there's no stored refresh
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

---

## 5. Database Schema — Domain Grouping

(Full detail lives in `apps/backend/src/db/schema.ts`; this is an index, not a
restatement of every column.)

| Domain | Tables |
|---|---|
| Identity & access | `users`, `refresh_tokens`, `device_tokens`, `permissions`, `role_permissions`, `user_additional_permissions` |
| Demographics & geography | `contributor_demographics`, `contributor_profiles`, `tribes`, `sub_tribes`, `villages`, `quarters` |
| Content taxonomy | `languages`, `dialects`, `categories`, `concepts`, `concept_media`, `sentences`, `scenes`, `scene_media`, `scene_image_keywords`, `scene_concepts` |
| Contributions (per module) | `word_recordings` (Module 1), `audio_uploads` + `transcriptions` + `transcription_segments` (Module 2), `translations` (Module 3), `scene_contributions` (Module 4), plus the umbrella `contributions` table every module row is linked from |
| Submission pipeline | `pending_submissions` |
| Media | `audio_files` (shared by every module; carries the crude review-tally counters, §2.4) |
| Review & moderation | `reviews`, `contribution_keywords`, `audit_logs`, `suggestions` |
| Gamification | `user_stats`, `streaks`, `gamification_config`, `points_transactions`, `badges`, `user_badges`, `perks`, `leaderboard_snapshots` |
| Comms & compliance | `notifications`, `consents`, `data_exports` |
| Ops | `feature_flags` |

`contributions` is the single row every review/point/status action operates on regardless
of module — it holds exactly one of `word_recording_id` / `audio_upload_id` /
`translation_id` / `scene_contribution_id` (enforced by a `CHECK` constraint,
`ck_contribution_single_reference`), plus `status`, `language_id`, `dialect_id`, and the
(effectively dead — see §2.6) `base_points`/`bonus_points`/`total_points` generated column.

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

---

## 7. Known Gaps / Not Yet Implemented

- Mobile app (`apps/mobile`) is present but not part of the work this log describes.
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
- **`evaluateAndAwardBadges()` is fully implemented but never called** (§2.6) — no badge
  has ever been auto-awarded in this app's lifetime. Wiring it in means deciding where to
  call it (after each of the four submit paths, and/or after a review decision) and what the
  frontend does with a newly-awarded badge, which is more than a one-line fix; noted here
  rather than done as a drive-by.
- `user_stats.rejectedContributions` is permanently stuck at 0 for every user — nothing in
  `reviews.service.ts`'s `invalid` decision path increments it (§2.6). Shown in the admin
  "Details" modal, so it currently always reads "0 rejected" regardless of reality.
- Some already-seeded accounts' `user_stats` counters predate the delete-reversal fix
  (§2.6) and were never retroactively corrected — e.g. the demo account
  farrukh@lexlingo.app still reads 4 total contributions / 10 points against 0 live
  `contributions` rows. The fix stops the drift going forward; it doesn't repair history,
  since that's a direct data change outside the app's normal code path rather than a code
  fix.

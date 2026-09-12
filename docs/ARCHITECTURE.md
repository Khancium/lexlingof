# Lexlingo — Architecture Log

A crowd-sourced language documentation platform: contributors record words, sentence
translations, freeform audio, and scene descriptions in their own language; peers review
each other's submissions; points/levels/badges drive engagement; admins moderate and curate
the corpus. This document describes the system **as currently implemented**, plus the
non-obvious decisions and bugs behind it, so future work doesn't have to rediscover them.

Last updated: 2026-09-12.

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
- **Streaks**, **badges**, **leaderboard snapshots**: supporting tables exist
  (`streaks`, `badges`, `user_badges`, `leaderboard_snapshots`) — badges/leaderboard are
  fed from `user_stats`.
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

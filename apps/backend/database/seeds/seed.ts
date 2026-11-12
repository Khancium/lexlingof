import "dotenv/config";

import bcrypt from "bcrypt";

import { db } from "../../src/db/index.js";
import {
  badgeTriggerType,
  badges,
  categories,
  contributorProfiles,
  dialects,
  featureFlags,
  gamificationConfig,
  languages,
  permissions,
  rolePermissions,
  scenes,
  sentenceCategories,
  concepts,
  streaks,
  userStats,
  users,
} from "../../src/db/schema.js";

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

function slugify(word: string): string {
  return word
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function titleCase(word: string): string {
  return word
    .split(/[-\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/** Wraps a section in its own transaction; logs and re-throws on failure so a
 * partial run leaves no half-written section behind. */
async function runSection<T>(name: string, fn: Parameters<typeof db.transaction<T>>[0]): Promise<T> {
  try {
    const result = await db.transaction(fn);
    console.log(`[seed] ${name}: done`);
    return result;
  } catch (err) {
    console.error(`[seed] ${name}: FAILED`, err);
    throw err;
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Seed data                                 */
/* -------------------------------------------------------------------------- */

const FEATURE_FLAGS: { flagKey: string; isEnabled: boolean; description: string }[] = [
  { flagKey: "module_1_enabled", isEnabled: true, description: "Module 1: word recordings" },
  { flagKey: "module_2_enabled", isEnabled: true, description: "Module 2: audio uploads and transcription" },
  { flagKey: "module_3_enabled", isEnabled: true, description: "Module 3: sentence translations" },
  { flagKey: "module_4_enabled", isEnabled: true, description: "Module 4: scene descriptions" },
  { flagKey: "community_review_enabled", isEnabled: true, description: "Community peer review of contributions" },
  { flagKey: "public_profiles_enabled", isEnabled: true, description: "Public contributor profile pages" },
  { flagKey: "offline_mode_enabled", isEnabled: true, description: "Offline recording queue in the mobile app" },
  { flagKey: "data_exports_enabled", isEnabled: false, description: "Researcher-facing data export requests" },
  { flagKey: "leaderboard_enabled", isEnabled: true, description: "Public leaderboard and rankings" },
  { flagKey: "push_notifications_enabled", isEnabled: false, description: "Push notifications via device tokens" },
];

const GAMIFICATION_CONFIG: { configKey: string; value: number; description: string }[] = [
  { configKey: "points.word.base", value: 10, description: "Base points for a word recording" },
  { configKey: "points.word.verified_bonus", value: 10, description: "Bonus points when a word recording is verified" },
  { configKey: "points.word.synonym_bonus", value: 5, description: "Bonus points for recording a synonym" },
  { configKey: "points.audio.upload", value: 10, description: "Base points for an audio upload" },
  { configKey: "points.audio.native_text", value: 10, description: "Bonus points for adding native-script text" },
  { configKey: "points.audio.romanization", value: 5, description: "Bonus points for adding romanization" },
  { configKey: "points.audio.ipa", value: 10, description: "Bonus points for adding IPA transcription" },
  { configKey: "points.audio.translation", value: 10, description: "Bonus points for adding an English translation" },
  { configKey: "points.audio.segment", value: 5, description: "Bonus points per transcribed segment" },
  { configKey: "points.audio.verified_bonus", value: 10, description: "Bonus points when an audio upload is verified" },
  { configKey: "points.translation.base", value: 10, description: "Base points for a sentence translation" },
  { configKey: "points.translation.audio", value: 10, description: "Bonus points for attaching audio to a translation" },
  { configKey: "points.translation.roman", value: 5, description: "Bonus points for adding romanization" },
  { configKey: "points.translation.ipa", value: 10, description: "Bonus points for adding IPA transcription" },
  { configKey: "points.translation.verified", value: 10, description: "Bonus points when a translation is verified" },
  { configKey: "points.scene.base", value: 20, description: "Base points for a scene description" },
  { configKey: "points.scene.long_bonus", value: 10, description: "Bonus points for an extended description" },
  { configKey: "points.scene.daily_bonus", value: 5, description: "Bonus points for completing the daily scene" },
  { configKey: "points.scene.expert_bonus", value: 20, description: "Bonus points for an expert-difficulty scene" },
  { configKey: "points.scene.verified_bonus", value: 10, description: "Bonus points when a scene contribution is verified" },
  { configKey: "points.review.award", value: 5, description: "Points awarded to a reviewer per completed review" },
  { configKey: "levels.bronze.min", value: 0, description: "Minimum points for Bronze level" },
  { configKey: "levels.silver.min", value: 100, description: "Minimum points for Silver level" },
  { configKey: "levels.gold.min", value: 500, description: "Minimum points for Gold level" },
  { configKey: "levels.platinum.min", value: 1000, description: "Minimum points for Platinum level" },
  { configKey: "modules.word.max_duration_ms", value: 3000, description: "Maximum duration for a Module 1 word recording, in milliseconds" },
  { configKey: "modules.audio.max_file_bytes", value: 104857600, description: "Maximum upload size for a Module 2 audio file, in bytes" },
  { configKey: "modules.scene.max_duration_ms", value: 300000, description: "Maximum duration for a Module 4 scene description, in milliseconds" },
];

const PERMISSIONS: { code: string; description: string }[] = [
  { code: "contributions.create", description: "Submit new contributions" },
  { code: "contributions.read", description: "View contributions" },
  { code: "contributions.update.own", description: "Edit one's own contributions" },
  { code: "contributions.delete.own", description: "Delete one's own contributions" },
  { code: "contributions.review", description: "Review contributions submitted by others" },
  { code: "contributions.verify", description: "Mark a contribution as verified" },
  { code: "contributions.reject", description: "Reject a contribution" },
  { code: "contributions.manage", description: "Full administrative control over contributions" },
  { code: "users.read", description: "View user accounts" },
  { code: "users.update.own", description: "Edit one's own account" },
  { code: "users.suspend", description: "Suspend a user account" },
  { code: "users.delete", description: "Delete a user account" },
  { code: "users.manage", description: "Full administrative control over user accounts" },
  { code: "categories.manage", description: "Create, edit and reorder categories" },
  { code: "concepts.manage", description: "Create, edit and reorder concepts" },
  { code: "scenes.manage", description: "Create, edit and publish scenes" },
  { code: "sentences.manage", description: "Create and edit sentences" },
  { code: "languages.manage", description: "Configure languages and dialects" },
  { code: "gamification.manage", description: "Configure points, levels and badges" },
  { code: "admins.manage", description: "Grant or revoke admin and super-admin roles" },
  { code: "system.manage", description: "Configure system-wide settings and feature flags" },
  { code: "volunteers.manage", description: "Assign the volunteer role, review their pending changes, and toggle auto-approve" },
  {
    code: "publishing.manage",
    description: "Curate which word recordings and sentence translations are published to the public dictionary / language-learning feed",
  },
  { code: "exports.create", description: "Request a data export" },
  { code: "exports.manage", description: "Manage and fulfil data export requests" },
  { code: "analytics.read", description: "View analytics and reporting dashboards" },
  { code: "audit.read", description: "View the audit log" },
];

const CONTRIBUTOR_PERMISSION_CODES = [
  "contributions.create",
  "contributions.read",
  "contributions.update.own",
  "contributions.delete.own",
  "users.read",
  "users.update.own",
];

/**
 * Deliberately the exact same three codes admin holds for the concepts/
 * scenes/sentences pages -- a volunteer gets full route-level access to
 * those admin pages for free through the existing requirePermission()
 * checks. What's different isn't which routes a volunteer can call, it's
 * what those routes *do* for them: pending-changes.service.ts intercepts
 * every create/delete on those three routes (plus categories and concept/
 * scene image-add, which are gated on these same codes) and queues them for
 * admin approval instead of applying immediately, unless
 * users.autoApproveVolunteer is on. See §1 of the volunteer feature notes
 * in ARCHITECTURE.md.
 */
const VOLUNTEER_PERMISSION_CODES = ["concepts.manage", "scenes.manage", "sentences.manage"];

const ADMIN_PERMISSION_CODES = [
  "contributions.create",
  "contributions.read",
  "contributions.update.own",
  "contributions.delete.own",
  "contributions.review",
  "contributions.verify",
  "contributions.reject",
  "contributions.manage",
  "users.read",
  "users.update.own",
  "users.suspend",
  "users.delete",
  "users.manage",
  "categories.manage",
  "concepts.manage",
  "scenes.manage",
  "sentences.manage",
  "languages.manage",
  "gamification.manage",
  "exports.create",
  "exports.manage",
  "analytics.read",
  "audit.read",
  "volunteers.manage",
  "publishing.manage",
];

/**
 * super_admin bypasses requirePermission() entirely in the auth middleware,
 * but is seeded with every permission anyway so role_permissions stays a
 * complete source of truth for any code path that queries it directly.
 */
const SUPER_ADMIN_PERMISSION_CODES = [...new Set([...ADMIN_PERMISSION_CODES, "admins.manage", "system.manage"])];

const ROLE_PERMISSION_CODES: Record<"contributor" | "volunteer" | "admin" | "super_admin", string[]> = {
  contributor: CONTRIBUTOR_PERMISSION_CODES,
  volunteer: VOLUNTEER_PERMISSION_CODES,
  admin: ADMIN_PERMISSION_CODES,
  super_admin: SUPER_ADMIN_PERMISSION_CODES,
};

const DIALECTS: { code: string; nameEnglish: string }[] = [
  { code: "ps-yousafzai", nameEnglish: "Yousafzai" },
  { code: "ps-kandahar", nameEnglish: "Kandahari" },
  { code: "ps-waziri", nameEnglish: "Waziri" },
  { code: "ps-peshawar", nameEnglish: "Peshawari" },
];

const CATEGORIES: { slug: string; nameEnglish: string; icon: string; sortOrder: number }[] = [
  { slug: "animals", nameEnglish: "Animals", icon: "🐾", sortOrder: 1 },
  { slug: "food", nameEnglish: "Food", icon: "🍎", sortOrder: 2 },
  { slug: "nature", nameEnglish: "Nature", icon: "🌿", sortOrder: 3 },
  { slug: "household", nameEnglish: "Household", icon: "🏠", sortOrder: 4 },
  { slug: "clothing", nameEnglish: "Clothing", icon: "👗", sortOrder: 5 },
  { slug: "tools", nameEnglish: "Tools", icon: "🔧", sortOrder: 6 },
  { slug: "places", nameEnglish: "Places", icon: "📍", sortOrder: 7 },
  { slug: "transport", nameEnglish: "Transport", icon: "🚗", sortOrder: 8 },
  { slug: "actions", nameEnglish: "Actions", icon: "⚡", sortOrder: 9 },
  { slug: "emotions", nameEnglish: "Emotions", icon: "😊", sortOrder: 10 },
  { slug: "body", nameEnglish: "Body", icon: "🫀", sortOrder: 11 },
  { slug: "weather", nameEnglish: "Weather", icon: "🌤", sortOrder: 12 },
  { slug: "agriculture", nameEnglish: "Agriculture", icon: "🌾", sortOrder: 13 },
  { slug: "colors", nameEnglish: "Colors", icon: "🎨", sortOrder: 14 },
  { slug: "culture", nameEnglish: "Culture", icon: "🎭", sortOrder: 15 },
  { slug: "education", nameEnglish: "Education", icon: "📚", sortOrder: 16 },
  { slug: "health", nameEnglish: "Health", icon: "🏥", sortOrder: 17 },
  { slug: "objects", nameEnglish: "Objects", icon: "📦", sortOrder: 18 },
  { slug: "professions", nameEnglish: "Professions", icon: "👨‍💼", sortOrder: 19 },
  { slug: "people", nameEnglish: "People", icon: "👥", sortOrder: 20 },
];

/** 10 words per category slug, matching CATEGORIES above. */
const CONCEPTS_BY_CATEGORY: Record<string, string[]> = {
  animals: ["dog", "cat", "bird", "fish", "cow", "horse", "sheep", "goat", "chicken", "donkey"],
  food: ["bread", "rice", "water", "milk", "meat", "egg", "apple", "orange", "salt", "sugar"],
  nature: ["mountain", "river", "tree", "stone", "sun", "moon", "rain", "cloud", "forest", "valley"],
  household: ["door", "window", "chair", "table", "bed", "kitchen", "roof", "wall", "floor", "lamp"],
  clothing: ["shirt", "trousers", "shoes", "hat", "coat", "dress", "scarf", "belt", "gloves", "sandals"],
  tools: ["knife", "axe", "shovel", "rope", "basket", "pot", "needle", "thread", "hammer", "saw"],
  places: ["house", "mosque", "school", "market", "road", "bridge", "field", "village", "city", "hospital"],
  transport: ["car", "bus", "bicycle", "donkey-cart", "boat", "truck", "motorbike", "horse", "wagon", "foot"],
  actions: ["walk", "run", "eat", "drink", "sleep", "work", "speak", "listen", "read", "write"],
  emotions: ["happy", "sad", "angry", "afraid", "surprised", "tired", "hungry", "thirsty", "proud", "shy"],
  body: ["head", "hand", "eye", "ear", "nose", "mouth", "foot", "heart", "back", "arm"],
  weather: ["rain", "snow", "wind", "hot", "cold", "sunny", "cloudy", "storm", "fog", "flood"],
  agriculture: ["wheat", "corn", "seed", "harvest", "irrigation", "plow", "soil", "crop", "field", "farmer"],
  colors: ["red", "blue", "green", "white", "black", "yellow", "brown", "orange", "purple", "pink"],
  culture: ["wedding", "festival", "prayer", "tradition", "music", "dance", "story", "elder", "tribe", "custom"],
  education: ["book", "pen", "teacher", "student", "school", "lesson", "exam", "writing", "number", "letter"],
  health: ["medicine", "doctor", "pain", "fever", "hospital", "rest", "water", "food", "wound", "birth"],
  objects: ["stone", "wood", "metal", "cloth", "paper", "glass", "plastic", "leather", "wool", "clay"],
  professions: ["farmer", "teacher", "doctor", "trader", "soldier", "carpenter", "tailor", "cook", "driver", "shepherd"],
  people: ["man", "woman", "child", "elder", "mother", "father", "brother", "sister", "husband", "wife"],
};

const SCENES: {
  slug: string;
  title: string;
  difficulty: "easy" | "medium" | "hard" | "expert";
  estimatedDurationSeconds: number;
  isDaily: boolean;
}[] = [
  { slug: "village-market", title: "Village Market", difficulty: "medium", estimatedDurationSeconds: 120, isDaily: true },
  { slug: "family-home", title: "Family Home", difficulty: "easy", estimatedDurationSeconds: 90, isDaily: false },
  { slug: "mountain-farm", title: "Mountain Farm", difficulty: "medium", estimatedDurationSeconds: 150, isDaily: false },
  { slug: "wedding-preparation", title: "Preparing for a Wedding", difficulty: "hard", estimatedDurationSeconds: 180, isDaily: false },
  { slug: "river-journey", title: "River Journey", difficulty: "medium", estimatedDurationSeconds: 120, isDaily: false },
  { slug: "school-day", title: "School Day", difficulty: "easy", estimatedDurationSeconds: 90, isDaily: false },
  { slug: "traditional-gathering", title: "Traditional Gathering", difficulty: "hard", estimatedDurationSeconds: 180, isDaily: false },
  { slug: "rainy-day-home", title: "Rainy Day at Home", difficulty: "easy", estimatedDurationSeconds: 90, isDaily: false },
  { slug: "morning-village", title: "Morning in the Village", difficulty: "easy", estimatedDurationSeconds: 90, isDaily: false },
  { slug: "river-harvest", title: "River Harvest", difficulty: "expert", estimatedDurationSeconds: 240, isDaily: false },
];

/**
 * Categories for sentences (separate from the concept categories above). Contributors translate a
 * category's sentences in order. NO demo sentences are seeded: a sentence needs its English, Urdu and
 * Persian text, and the real corpus is imported through the admin Sentences page (CSV / paste).
 */
const SENTENCE_CATEGORIES: { slug: string; name: string }[] = [
  { slug: "greetings", name: "Greetings" },
  { slug: "salutations", name: "Salutations" },
  { slug: "introduction", name: "Introduction" },
  { slug: "work", name: "Work" },
  { slug: "agriculture", name: "Agriculture" },
  { slug: "husbandry", name: "Husbandry" },
  { slug: "household", name: "Household" },
];

type BadgeSeed = {
  slug: string;
  name: string;
  icon: string;
  triggerType: (typeof badgeTriggerType.enumValues)[number];
  triggerValue: number | null;
  triggerModule: "WORD" | "TRANSCRIPTION" | "TRANSLATION" | "SCENE" | null;
  description: string;
};

const BADGES: BadgeSeed[] = [
  { slug: "first-contribution", name: "First Contribution", icon: "🌱", triggerType: "contribution_count", triggerValue: 1, triggerModule: null, description: "Submit your first contribution" },
  { slug: "ten-contributions", name: "10 Contributions", icon: "⭐", triggerType: "contribution_count", triggerValue: 10, triggerModule: null, description: "Submit 10 contributions" },
  { slug: "hundred-contributions", name: "100 Contributions", icon: "🌟", triggerType: "contribution_count", triggerValue: 100, triggerModule: null, description: "Submit 100 contributions" },
  { slug: "five-hundred", name: "500 Contributions", icon: "💫", triggerType: "contribution_count", triggerValue: 500, triggerModule: null, description: "Submit 500 contributions" },
  { slug: "thousand", name: "1000 Contributions", icon: "🏆", triggerType: "contribution_count", triggerValue: 1000, triggerModule: null, description: "Submit 1000 contributions" },
  { slug: "first-verified", name: "First Verified", icon: "✅", triggerType: "verified_count", triggerValue: 1, triggerModule: null, description: "Have your first contribution verified" },
  { slug: "hundred-verified", name: "100 Verified", icon: "🎯", triggerType: "verified_count", triggerValue: 100, triggerModule: null, description: "Have 100 contributions verified" },
  { slug: "seven-streak", name: "7 Day Streak", icon: "🔥", triggerType: "streak_days", triggerValue: 7, triggerModule: null, description: "Contribute 7 days in a row" },
  { slug: "thirty-streak", name: "30 Day Streak", icon: "💎", triggerType: "streak_days", triggerValue: 30, triggerModule: null, description: "Contribute 30 days in a row" },
  { slug: "word-collector", name: "Word Collector", icon: "📝", triggerType: "contribution_count", triggerValue: 100, triggerModule: "WORD", description: "Submit 100 word recordings" },
  { slug: "audio-archivist", name: "Audio Archivist", icon: "🎙️", triggerType: "contribution_count", triggerValue: 10, triggerModule: "TRANSCRIPTION", description: "Submit 10 audio uploads" },
  { slug: "sentence-translator", name: "Sentence Translator", icon: "🌐", triggerType: "contribution_count", triggerValue: 50, triggerModule: "TRANSLATION", description: "Submit 50 sentence translations" },
  { slug: "scene-explorer", name: "Scene Explorer", icon: "🏔️", triggerType: "contribution_count", triggerValue: 10, triggerModule: "SCENE", description: "Submit 10 scene descriptions" },
  { slug: "master-storyteller", name: "Master Storyteller", icon: "📖", triggerType: "contribution_count", triggerValue: 100, triggerModule: "SCENE", description: "Submit 100 scene descriptions" },
  { slug: "multi-module", name: "Multi-Module", icon: "🔀", triggerType: "module_completion", triggerValue: 2, triggerModule: null, description: "Contribute to 2 different modules" },
  { slug: "data-explorer", name: "Data Explorer", icon: "🔬", triggerType: "module_completion", triggerValue: 3, triggerModule: null, description: "Contribute to 3 different modules" },
  { slug: "complete-contributor", name: "Complete Contributor", icon: "🌍", triggerType: "module_completion", triggerValue: 4, triggerModule: null, description: "Contribute to all 4 modules" },
  { slug: "community-reviewer", name: "Community Reviewer", icon: "👥", triggerType: "review_count", triggerValue: 10, triggerModule: null, description: "Complete 10 community reviews" },
  // level_reached badges: the schema has no dedicated contributor_level column
  // on `badges`, so the target level is encoded as an ordinal in triggerValue
  // (1=BRONZE, 2=SILVER, 3=GOLD, 4=PLATINUM) for application logic to map.
  { slug: "bronze-badge", name: "Bronze Contributor", icon: "🥉", triggerType: "level_reached", triggerValue: 1, triggerModule: null, description: "Reach Bronze level" },
  { slug: "silver-badge", name: "Silver Contributor", icon: "🥈", triggerType: "level_reached", triggerValue: 2, triggerModule: null, description: "Reach Silver level" },
  { slug: "gold-badge", name: "Gold Contributor", icon: "🥇", triggerType: "level_reached", triggerValue: 3, triggerModule: null, description: "Reach Gold level" },
  { slug: "platinum-badge", name: "Platinum Contributor", icon: "💜", triggerType: "level_reached", triggerValue: 4, triggerModule: null, description: "Reach Platinum level" },
];

const DEMO_USERS: { displayName: string; email: string; role: "contributor" | "admin" }[] = [
  { displayName: "Ahmad Nawaz", email: "ahmad@lexlingo.app", role: "contributor" },
  { displayName: "Farrukh Khan", email: "farrukh@lexlingo.app", role: "contributor" },
  { displayName: "Admin User", email: "admin@lexlingo.app", role: "admin" },
];

/* -------------------------------------------------------------------------- */
/*                                    Main                                    */
/* -------------------------------------------------------------------------- */

async function main() {
  // The three sections below are insert-or-skip so the seed can be re-run, and so it
  // works on a database that has already been through the migrations: migration 0007
  // inserts the `points.audio.translation` config row itself, and the plain INSERT
  // here used to violate uq_gamification_config_key_active on a freshly migrated
  // database -- aborting this section after the feature flags had already committed.
  await runSection("feature flags", async (tx) => {
    await tx.insert(featureFlags).values(FEATURE_FLAGS).onConflictDoNothing();
  });

  await runSection("gamification config", async (tx) => {
    await tx
      .insert(gamificationConfig)
      .values(
        GAMIFICATION_CONFIG.map((c) => ({
          configKey: c.configKey,
          configValue: { value: c.value },
          description: c.description,
        })),
      )
      .onConflictDoNothing();
  });

  await runSection("permissions", async (tx) => {
    await tx
      .insert(permissions)
      .values(
        PERMISSIONS.map((p) => {
          const [module, ...rest] = p.code.split(".");
          return {
            code: p.code,
            description: p.description,
            module,
            action: rest.join(".") || "manage",
          };
        }),
      )
      .onConflictDoNothing({ target: permissions.code });

    const allPermissions = await tx.select({ id: permissions.id, code: permissions.code }).from(permissions);
    const idByCode = new Map(allPermissions.map((p) => [p.code, p.id]));

    const roleRows = (Object.entries(ROLE_PERMISSION_CODES) as [keyof typeof ROLE_PERMISSION_CODES, string[]][]).flatMap(
      ([role, codes]) =>
        codes.map((code) => {
          const permissionId = idByCode.get(code);
          if (!permissionId) {
            throw new Error(`Unknown permission code in ROLE_PERMISSION_CODES: ${code}`);
          }
          return { role, permissionId };
        }),
    );

    await tx.insert(rolePermissions).values(roleRows).onConflictDoNothing();
  });

  const { pashtoId } = await runSection("languages", async (tx) => {
    const [pashto] = await tx
      .insert(languages)
      .values({
        code: "ps",
        iso6393: "pus",
        nameEnglish: "Pashto",
        nameNative: "پښتو",
        scriptCode: "Arab",
        textDirection: "rtl",
      })
      .returning({ id: languages.id });

    return { pashtoId: pashto.id };
  });

  await runSection("dialects", async (tx) => {
    await tx.insert(dialects).values(
      DIALECTS.map((d) => ({
        languageId: pashtoId,
        code: d.code,
        nameEnglish: d.nameEnglish,
      })),
    );
  });

  const categoryIdBySlug = await runSection("categories", async (tx) => {
    const rows = await tx
      .insert(categories)
      .values(
        CATEGORIES.map((c) => ({
          slug: c.slug,
          nameEnglish: c.nameEnglish,
          icon: c.icon,
          sortOrder: c.sortOrder,
        })),
      )
      .returning({ id: categories.id, slug: categories.slug });

    return new Map(rows.map((r) => [r.slug, r.id]));
  });

  await runSection("concepts", async (tx) => {
    const rows = Object.entries(CONCEPTS_BY_CATEGORY).flatMap(([categorySlug, words]) => {
      const categoryId = categoryIdBySlug.get(categorySlug);
      if (!categoryId) {
        throw new Error(`No category found for slug "${categorySlug}"`);
      }
      return words.map((word) => ({
        categoryId,
        slug: `${categorySlug}-${slugify(word)}`,
        labelEnglish: titleCase(word),
      }));
    });
    await tx.insert(concepts).values(rows);
  });

  await runSection("scenes", async (tx) => {
    await tx.insert(scenes).values(
      SCENES.map((s) => ({
        slug: s.slug,
        title: s.title,
        difficulty: s.difficulty,
        estimatedDurationSeconds: s.estimatedDurationSeconds,
        isDaily: s.isDaily,
      })),
    );
  });

  await runSection("sentence categories", async (tx) => {
    await tx
      .insert(sentenceCategories)
      .values(SENTENCE_CATEGORIES.map((c, i) => ({ slug: c.slug, nameEnglish: c.name, sortOrder: i })))
      .onConflictDoNothing();
  });

  await runSection("badges", async (tx) => {
    await tx.insert(badges).values(
      BADGES.map((b) => ({
        slug: b.slug,
        name: b.name,
        description: b.description,
        icon: b.icon,
        category: b.triggerModule ? b.triggerModule.toLowerCase() : "general",
        triggerType: b.triggerType,
        triggerValue: b.triggerValue,
        triggerModule: b.triggerModule,
      })),
    );
  });

  await runSection("demo users", async (tx) => {
    const passwordHash = await bcrypt.hash("demo123", 12);

    for (const demoUser of DEMO_USERS) {
      const [user] = await tx
        .insert(users)
        .values({
          email: demoUser.email,
          displayName: demoUser.displayName,
          passwordHash,
          role: demoUser.role,
          emailVerified: true,
        })
        .returning({ id: users.id });

      if (demoUser.role === "contributor") {
        await tx.insert(contributorProfiles).values({
          userId: user.id,
          primaryLanguageId: pashtoId,
        });
        await tx.insert(userStats).values({ userId: user.id });
        await tx.insert(streaks).values({ userId: user.id, currentStreak: 0 });
      }
    }
  });

  console.log("Lexlingo seed complete");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[seed] Fatal error, seed aborted:", err);
    process.exit(1);
  });

import axios, { type AxiosError, type InternalAxiosRequestConfig } from "axios";

// Note: the refresh token lives in sessionStorage (per the explicit
// auth.login instruction, "for now"), not a cookie -- the 401-retry flow
// below reads from the same place login()/register() write to, since a
// cookie-based read would never see a token that was actually stored in
// sessionStorage.
const REFRESH_TOKEN_KEY = "lexlingo_refresh_token";

// In-memory only -- never persisted, so it's gone on a full page reload
// (the refresh token in sessionStorage is what re-establishes a session).
let accessToken: string | null = null;

export function getErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string } | undefined)?.message;
    if (message) return message;
  }
  return err instanceof Error ? err.message : fallback;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

function getStoredRefreshToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(REFRESH_TOKEN_KEY);
}

function setStoredRefreshToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    window.sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
  } else {
    window.sessionStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}

// Only redirects when a session actually existed and its refresh failed
// (e.g. an expired/revoked refresh token) -- NOT when there was simply never
// a refresh token to begin with. Callers like loadUser() call api.users.getMe()
// unconditionally on every app boot, including for anonymous visitors on public
// pages; without this distinction, every such visitor would be force-redirected
// to /login the instant that call 401s, since there'd be nothing to refresh.
function clearSessionAndRedirectToLogin(hadRefreshToken: boolean): void {
  setAccessToken(null);
  setStoredRefreshToken(null);
  if (hadRefreshToken && typeof window !== "undefined") {
    window.location.href = "/login";
  }
}

export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
  timeout: 30000,
});

apiClient.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

// Concurrent 401s share one refresh call instead of each firing their own.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const storedRefreshToken = getStoredRefreshToken();
  if (!storedRefreshToken) {
    return null;
  }

  const response = await axios.post<TokenPair>(
    `${apiClient.defaults.baseURL}/api/v1/auth/refresh`,
    { refreshToken: storedRefreshToken },
  );
  const { accessToken: newAccessToken, refreshToken: newRefreshToken } = response.data;

  setAccessToken(newAccessToken);
  setStoredRefreshToken(newRefreshToken);

  return newAccessToken;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableConfig | undefined;
    const isAuthEndpoint = originalRequest?.url?.includes("/api/v1/auth/");

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      isAuthEndpoint
    ) {
      return Promise.reject(error);
    }
    originalRequest._retry = true;
    const hadRefreshToken = !!getStoredRefreshToken();

    try {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      const newAccessToken = await refreshPromise;

      if (!newAccessToken) {
        throw new Error("No refresh token available");
      }

      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      return apiClient(originalRequest);
    } catch (refreshError) {
      clearSessionAndRedirectToLogin(hadRefreshToken);
      return Promise.reject(refreshError);
    }
  },
);

/* -------------------------------------------------------------------------- */
/*                                    Types                                   */
/* -------------------------------------------------------------------------- */

export type ContributorLevel = "BRONZE" | "SILVER" | "GOLD" | "PLATINUM";
export type ModuleType = "WORD" | "TRANSCRIPTION" | "TRANSLATION" | "SCENE";
export type SceneDifficulty = "easy" | "medium" | "hard" | "expert";
export type ReviewDecision = "valid" | "needs_correction" | "invalid";

type TokenPair = { accessToken: string; refreshToken: string };

export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
};

export type AuthResponse = TokenPair & { user: AuthUser };

export type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  avatarUrl: string | null;
  level: ContributorLevel;
  totalPoints: number;
  verifiedContributions: number;
  totalContributions: number;
  currentStreak: number;
  longestStreak: number;
  language: { id: string; code: string; nameEnglish: string; nameNative: string } | null;
  dialect: { id: string; code: string; nameEnglish: string } | null;
  location: { country: string | null; city: string | null; village: string | null; showLocation: boolean } | null;
  biography: string | null;
  pointsThisWeek: number;
  lastContributionAt: string | null;
};

export type UpdateMeInput = Partial<{
  displayName: string;
  biography: string;
  timezone: string;
  locale: string;
  primaryLanguageId: string;
  primaryDialectId: string;
  locationCountry: string;
  locationCity: string;
  locationVillage: string;
  tribe: string;
  showLocation: boolean;
}>;

export type NamedOption = { id: string; name: string };

export type GenderOption = "male" | "female" | "other" | "prefer_not_to_say";

export type ContributorDemographics = {
  fullName: string;
  age: number;
  gender: GenderOption;
  motherTongue: string;
  country: string;
  city: string;
  dialect: string | null;
  tribeName: string | null;
  subTribeName: string | null;
  villageName: string | null;
  quarterName: string | null;
};

export type SubmitDemographicsInput = {
  fullName: string;
  age: number;
  gender: GenderOption;
  motherTongue: string;
  tribe: string;
  subTribe?: string;
  country: string;
  city: string;
  village: string;
  quarter?: string;
  dialect?: string;
};

export type UserStatsResponse = {
  stats: {
    totalContributions: number;
    verifiedContributions: number;
    totalPoints: number;
    wordContributions: number;
    audioContributions: number;
    translationContributions: number;
    sceneContributionsCount: number;
    level: ContributorLevel;
  } | null;
  streak: { currentStreak: number; longestStreak: number } | null;
};

export type ContributionsQuery = { limit?: number; offset?: number; moduleType?: ModuleType };
export type ContributionListItem = {
  id: string;
  moduleType: ModuleType;
  status: string;
  totalPoints: number | null;
  submittedAt: string;
  verifiedAt: string | null;
  detail: Record<string, unknown> | null;
};
export type ContributionsResponse = { items: ContributionListItem[]; limit: number; offset: number; total: number };

export type Dialect = { id: string; code: string; nameEnglish: string; nameNative: string | null };
export type Language = {
  id: string;
  code: string;
  nameEnglish: string;
  nameNative: string;
  dialects: Dialect[];
};

export type Category = { id: string; slug: string; nameEnglish: string; icon: string | null; conceptCount: number };

export type ConceptsQuery = { categoryId?: string; search?: string; limit?: number; offset?: number };
export type ConceptListItem = {
  id: string;
  categoryId: string;
  categoryName: string;
  slug: string;
  labelEnglish: string;
  description: string | null;
  difficulty: string;
};
export type ConceptsResponse = { items: ConceptListItem[]; limit: number; offset: number };
export type ConceptDetail = {
  id: string;
  slug: string;
  labelEnglish: string;
  description: string | null;
  difficulty: string;
  category: { id: string; name: string; slug: string };
  media: { id: string; publicUrl: string; isPrimary: boolean }[];
};

export type NextConceptResponse = {
  concept: { id: string; slug: string; labelEnglish: string; description: string | null; difficulty: string };
  category: { id: string; name: string; slug: string };
  publicUrl: string | null;
  limits: WordLimits;
};

export type GetUploadUrlInput = {
  module: ModuleType;
  filename: string;
  mimeType: string;
  checksumSha256: string;
  fileSizeBytes: number;
};
export type GetUploadUrlResponse = { audioFileId: string; uploadUrl: string; storageKey: string; expiresAt: string };
export type ConfirmUploadInput = { durationMs: number; checksumSha256: string };
export type ConfirmUploadResponse = { audioFileId: string; storageKey: string; durationMs: number; processingStatus: string };
export type PlayUrlResponse = { url: string; expiresAt: string };

export type SubmitWordInput = {
  audioFileId: string;
  conceptId: string;
  languageId: string;
  dialectId?: string;
  nativeWord?: string;
  romanization?: string;
  ipa?: string;
  synonymIndex: 1 | 2 | 3;
  takeIndex: 1 | 2 | 3;
  durationMs: number;
  deviceId?: string;
  appVersion?: string;
  clientType?: string;
};
export type SubmitWordResponse = {
  contributionId: string;
  wordRecordingId: string;
  pointsAwarded: number;
  userLevel: ContributorLevel | null;
  currentStreak: number;
};

export type WordLimits = {
  synonymCount: number;
  takesPerSynonym: Record<"1" | "2" | "3", number>;
  canAddSynonym: boolean;
  canAddTake: boolean;
  nextSynonymIndex: 1 | 2 | 3 | null;
  nextTakeIndex: 1 | 2 | 3 | null;
};

export type SubmitAudioInput = {
  audioFileId: string;
  languageId: string;
  dialectId?: string;
  title: string;
  description?: string;
  recordingType: string;
  location?: string;
  recordedAt?: string;
  speakerDescription?: string;
  culturalContext?: string;
  source?: string;
  thirdPartyConsent?: boolean;
  deviceId?: string;
  appVersion?: string;
  clientType?: string;
};
export type SubmitAudioResponse = { contributionId: string; audioUploadId: string; pointsAwarded: number };

export type AddTranscriptionInput = { nativeText?: string; romanization?: string; ipa?: string };
export type AddTranscriptionResponse = { transcriptionId: string; version: number; pointsAwarded: number };

export type AddSegmentInput = {
  segmentIndex: number;
  startMs: number;
  endMs: number;
  nativeText?: string;
  romanization?: string;
  ipa?: string;
  speakerLabel?: string;
};
export type AddSegmentResponse = { segmentId: string; pointsAwarded: number };

export type RandomSentence = {
  id: string;
  englishText: string;
  category: { id: string; name: string; slug: string } | null;
  difficulty: string;
};

export type SubmitTranslationInput = {
  nativeText: string;
  romanization?: string;
  ipa?: string;
  audioFileId?: string;
  languageId: string;
  dialectId?: string;
  deviceId?: string;
  appVersion?: string;
  clientType?: string;
};
export type SubmitTranslationResponse = { contributionId: string; translationId: string; pointsAwarded: number };

export type Scene = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  difficulty: SceneDifficulty;
  estimatedDurationSeconds: number | null;
  isDaily: boolean;
  imageUrl: string | null;
};

export type SubmitSceneInput = {
  audioFileId: string;
  durationMs: number;
  languageId: string;
  dialectId?: string;
  deviceId?: string;
  appVersion?: string;
  clientType?: string;
};
export type SubmitSceneResponse = {
  contributionId: string;
  sceneContributionId: string;
  pointsAwarded: number;
  bonusBreakdown: { base: number; longBonus: number; dailyBonus: number; expertBonus: number };
};

export type ReviewQueueItem = {
  contributionId: string;
  moduleType: ModuleType;
  status: string;
  submittedAt: string;
  contributor: { id: string; displayName: string };
  language: { id: string; code: string; nameEnglish: string } | null;
  detail: {
    // WORD
    nativeWord?: string | null;
    romanization?: string | null;
    ipa?: string | null;
    durationMs?: number | null;
    // TRANSCRIPTION (Audio Upload) / SCENE share "title"
    title?: string | null;
    recordingType?: string | null;
    nativeText?: string | null;
    // TRANSLATION
    englishText?: string | null;
    // SCENE
    difficulty?: string | null;
    // Present (possibly null) for every module -- WORD/SCENE/TRANSCRIPTION
    // always have one, TRANSLATION's is optional since its audio is optional.
    audioFileId?: string | null;
    // WORD (concept image) and SCENE (scene image).
    imageUrl?: string | null;
  };
};

export type SubmitReviewInput = { contributionId: string; decision: ReviewDecision; reason?: string; notes?: string };
export type SubmitReviewResponse = {
  reviewId: string;
  decision: ReviewDecision;
  contributorPointsAwarded: number;
  newStatus: string;
  levelChange: { oldLevel: ContributorLevel; newLevel: ContributorLevel } | null;
};

export type LeaderboardQuery = { limit?: number; offset?: number; period?: "all_time" | "weekly" | "monthly" };
export type LeaderboardRow = {
  rank: number;
  userId: string;
  displayName: string;
  level: ContributorLevel;
  totalPoints: number;
  verifiedContributions: number;
  currentStreak: number;
  language: { id: string; code: string; nameEnglish: string } | null;
};

export type CorpusStats = {
  totalActiveContributors: number;
  totalContributions: number;
  verifiedContributions: number;
  audioHours: number;
  countByModuleType: Record<string, number>;
  activeLanguages: number;
  activeDialects: number;
};

export type CorpusCategoryCoverage = {
  id: string;
  slug: string;
  name: string;
  totalConcepts: number;
  // Module 1 (word recording) coverage ONLY -- scene_concepts (the image
  // coverage map) is admin-only and must never appear in this response.
  conceptsWithRecordings: number;
  wordRecordingCoveragePct: number;
};

export type CorpusLanguageBreakdown = {
  id: string;
  code: string;
  nameEnglish: string;
  contributionCount: number;
};

export type Badge = {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  category: string;
};
export type UserBadgesResponse = {
  earned: (Badge & { earnedAt: string })[];
  available: Badge[];
};

/* -------------------------------------------------------------------------- */
/*                                    Admin                                   */
/* -------------------------------------------------------------------------- */

export type ContributionStatusValue = "draft" | "pending" | "under_review" | "verified" | "needs_correction" | "rejected";

export type AdminContributionListItem = {
  contributionId: string;
  moduleType: ModuleType;
  status: ContributionStatusValue;
  submittedAt: string;
  contributor: { id: string; displayName: string };
  detail: Record<string, unknown>;
};

export type AdminContributionsQuery = {
  status?: ContributionStatusValue;
  module_type?: ModuleType;
  language_id?: string;
  limit?: number;
  offset?: number;
};

export type UpdateContributionStatusInput = { status: ContributionStatusValue; reason?: string };

export type AdminAnalytics = {
  contributionsPerDay: { day: string; count: number }[];
  topContributors: { userId: string; displayName: string; verifiedContributions: number; totalPoints: number }[];
  reviewQueueDepth: number;
  audioStorage: { totalBytes: number; totalDurationMs: number; fileCount: number };
  totalUsers: number;
  contributionsToday: number;
  verifiedToday: number;
};

export type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
  isSuspended: boolean;
  suspendedReason: string | null;
  createdAt: string;
  lastSeenAt: string | null;
};

export type AdminConceptInput = { categoryId: string; labelEnglish: string; description?: string; difficulty?: number };
export type AdminConceptUpdateInput = Partial<{
  categoryId: string;
  labelEnglish: string;
  description: string;
  difficulty: number;
  isActive: boolean;
  sortOrder: number;
}>;

export type AdminSceneInput = {
  slug: string;
  title: string;
  description?: string;
  difficulty?: SceneDifficulty;
  estimatedDurationSeconds?: number;
};
export type AdminSceneUpdateInput = Partial<{
  slug: string;
  title: string;
  description: string;
  difficulty: SceneDifficulty;
  estimatedDurationSeconds: number;
  isActive: boolean;
  isDaily: boolean;
}>;

export type AdminSceneConceptInput = { sceneId: string; conceptId: string; categoryId: string; importance?: number };

export type AdminSentenceInput = { englishText: string; categoryId?: string; difficulty?: number };
export type BulkUploadResult = { created: number; errors: { row: number; message: string }[] };
export type AdminSentence = {
  id: string;
  englishText: string;
  categoryId: string | null;
  difficulty: number;
  isActive: boolean;
  usageCount: number;
  createdAt: string;
};

export type GamificationConfigRow = {
  id: string;
  configKey: string;
  configValue: { value: number } | Record<string, unknown>;
  description: string;
  module: string | null;
  isActive: boolean;
  updatedBy: string | null;
  updatedAt: string;
};

export type FeatureFlag = {
  id: string;
  flagKey: string;
  isEnabled: boolean;
  description: string;
  rolloutPercent: number;
  updatedBy: string | null;
  updatedAt: string;
};

/* -------------------------------------------------------------------------- */
/*                                     API                                    */
/* -------------------------------------------------------------------------- */

export const api = {
  auth: {
    // Also establishes the session (like login()) -- a freshly registered
    // user is logged in immediately, and without this, an immediate
    // api.users.getMe() call would have neither an in-memory access token
    // nor a stored refresh token to fall back on.
    register: async (email: string, password: string) => {
      const data = await apiClient
        .post<AuthResponse>("/api/v1/auth/register", { email, password })
        .then((r) => r.data);
      setAccessToken(data.accessToken);
      setStoredRefreshToken(data.refreshToken);
      return data;
    },

    // Stores the access token in memory and the refresh token in
    // sessionStorage (for now -- see the module-level note above).
    login: async (email: string, password: string) => {
      const data = await apiClient.post<AuthResponse>("/api/v1/auth/login", { email, password }).then((r) => r.data);
      setAccessToken(data.accessToken);
      setStoredRefreshToken(data.refreshToken);
      return data;
    },

    logout: async () => {
      const refreshToken = getStoredRefreshToken();
      if (refreshToken) {
        await apiClient.post("/api/v1/auth/logout", { refreshToken }).catch(() => {
          // Best-effort -- local session is cleared below regardless.
        });
      }
      setAccessToken(null);
      setStoredRefreshToken(null);
    },

    refresh: async () => {
      const refreshToken = getStoredRefreshToken();
      if (!refreshToken) {
        throw new Error("No refresh token available");
      }
      const data = await apiClient.post<TokenPair>("/api/v1/auth/refresh", { refreshToken }).then((r) => r.data);
      setAccessToken(data.accessToken);
      setStoredRefreshToken(data.refreshToken);
      return data;
    },

    changePassword: (currentPassword: string, newPassword: string) =>
      apiClient.post<{ success: boolean }>("/api/v1/auth/change-password", { currentPassword, newPassword }).then((r) => r.data),
  },

  users: {
    getMe: () => apiClient.get<UserProfile>("/api/v1/users/me").then((r) => r.data),
    updateMe: (data: UpdateMeInput) => apiClient.put<UserProfile>("/api/v1/users/me", data).then((r) => r.data),
    getStats: () => apiClient.get<UserStatsResponse>("/api/v1/users/me/stats").then((r) => r.data),
    getContributions: (params?: ContributionsQuery) =>
      apiClient.get<ContributionsResponse>("/api/v1/users/me/contributions", { params }).then((r) => r.data),
    uploadAvatar: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiClient.post<UserProfile>("/api/v1/users/me/avatar", form).then((r) => r.data);
    },
  },

  languages: {
    getAll: () => apiClient.get<Language[]>("/api/v1/languages").then((r) => r.data),
  },

  geo: {
    getCountries: () =>
      apiClient.get<{ items: { code: string; name: string }[] }>("/api/v1/geo/countries").then((r) => r.data.items),
    getCities: (country: string) =>
      apiClient.get<{ items: string[] }>("/api/v1/geo/cities", { params: { country } }).then((r) => r.data.items),
  },

  demographics: {
    getMotherTongues: () =>
      apiClient.get<{ items: string[] }>("/api/v1/users/mother-tongues").then((r) => r.data.items),
    getTribes: () =>
      apiClient.get<{ items: NamedOption[] }>("/api/v1/users/tribes").then((r) => r.data.items),
    getSubTribes: (tribeId: string) =>
      apiClient
        .get<{ items: NamedOption[] }>(`/api/v1/users/tribes/${tribeId}/sub-tribes`)
        .then((r) => r.data.items),
    getVillages: (country: string, city: string) =>
      apiClient
        .get<{ items: NamedOption[] }>("/api/v1/users/villages", { params: { country, city } })
        .then((r) => r.data.items),
    getQuarters: (villageId: string) =>
      apiClient
        .get<{ items: NamedOption[] }>(`/api/v1/users/villages/${villageId}/quarters`)
        .then((r) => r.data.items),
    getMe: () =>
      apiClient.get<ContributorDemographics | null>("/api/v1/users/me/demographics").then((r) => r.data),
    submit: (data: SubmitDemographicsInput) =>
      apiClient.post<ContributorDemographics>("/api/v1/users/me/demographics", data).then((r) => r.data),
  },

  categories: {
    getAll: () => apiClient.get<Category[]>("/api/v1/categories").then((r) => r.data),
    getById: (id: string) => apiClient.get<Category>(`/api/v1/categories/${id}`).then((r) => r.data),
  },

  concepts: {
    getAll: (params?: ConceptsQuery) => apiClient.get<ConceptsResponse>("/api/v1/concepts", { params }).then((r) => r.data),
    getById: (id: string) => apiClient.get<ConceptDetail>(`/api/v1/concepts/${id}`).then((r) => r.data),
    // Not in the original spec list for this file, but required for Module 1
    // ("shows current concept") -- there's no other way to pick a concept to
    // show. Backed by word.routes.ts's GET /concepts/next.
    getNext: (categoryId?: string) =>
      apiClient
        .get<NextConceptResponse>("/api/v1/concepts/next", { params: categoryId ? { categoryId } : undefined })
        .then((r) => r.data),
  },

  audio: {
    getUploadUrl: (data: GetUploadUrlInput) =>
      apiClient.post<GetUploadUrlResponse>("/api/v1/audio/upload-url", data).then((r) => r.data),
    confirmUpload: (id: string, data: ConfirmUploadInput) =>
      apiClient.post<ConfirmUploadResponse>(`/api/v1/audio/${id}/confirm`, data).then((r) => r.data),
    getPlayUrl: (id: string) => apiClient.get<PlayUrlResponse>(`/api/v1/audio/${id}/play-url`).then((r) => r.data),
  },

  contributions: {
    submitWord: (data: SubmitWordInput) =>
      apiClient.post<SubmitWordResponse>("/api/v1/contributions/word", data).then((r) => r.data),
    getWordLimits: (conceptId: string) =>
      apiClient.get<WordLimits>(`/api/v1/contributions/word/${conceptId}/limits`).then((r) => r.data),
    submitAudio: (data: SubmitAudioInput) =>
      apiClient.post<SubmitAudioResponse>("/api/v1/contributions/audio", data).then((r) => r.data),
    addTranscription: (id: string, data: AddTranscriptionInput) =>
      apiClient.post<AddTranscriptionResponse>(`/api/v1/contributions/audio/${id}/transcription`, data).then((r) => r.data),
    addSegment: (id: string, data: AddSegmentInput) =>
      apiClient.post<AddSegmentResponse>(`/api/v1/contributions/audio/${id}/segments`, data).then((r) => r.data),
    getRandomSentence: (languageId: string) =>
      apiClient.get<RandomSentence>("/api/v1/sentences/random", { params: { languageId } }).then((r) => r.data),
    submitTranslation: (sentenceId: string, data: SubmitTranslationInput) =>
      apiClient.post<SubmitTranslationResponse>(`/api/v1/sentences/${sentenceId}/translation`, data).then((r) => r.data),
  },

  scenes: {
    getAll: () => apiClient.get<Scene[]>("/api/v1/scenes").then((r) => r.data),
    getDaily: () => apiClient.get<Scene>("/api/v1/scenes/daily").then((r) => r.data),
    getRandom: (excludeId?: string) =>
      apiClient.get<Scene>("/api/v1/scenes/random", { params: excludeId ? { exclude: excludeId } : undefined }).then((r) => r.data),
    getById: (id: string) => apiClient.get<Scene>(`/api/v1/scenes/${id}`).then((r) => r.data),
    submitContribution: (sceneId: string, data: SubmitSceneInput) =>
      apiClient.post<SubmitSceneResponse>(`/api/v1/scenes/${sceneId}/contributions`, data).then((r) => r.data),
  },

  reviews: {
    getQueue: (moduleType?: ModuleType) =>
      apiClient
        .get<ReviewQueueItem[]>("/api/v1/reviews/queue", { params: moduleType ? { moduleType } : undefined })
        .then((r) => r.data),
    submitReview: (data: SubmitReviewInput) =>
      apiClient.post<SubmitReviewResponse>("/api/v1/reviews", data).then((r) => r.data),
  },

  leaderboard: {
    getGlobal: (params?: LeaderboardQuery) =>
      apiClient.get<LeaderboardRow[]>("/api/v1/leaderboard", { params }).then((r) => r.data),
  },

  corpus: {
    getStats: () => apiClient.get<CorpusStats>("/api/v1/corpus/stats").then((r) => r.data),
    getCategories: () => apiClient.get<CorpusCategoryCoverage[]>("/api/v1/corpus/categories").then((r) => r.data),
    getLanguages: () => apiClient.get<CorpusLanguageBreakdown[]>("/api/v1/corpus/languages").then((r) => r.data),
  },

  badges: {
    getAll: () => apiClient.get<Badge[]>("/api/v1/badges").then((r) => r.data),
    getForUser: (userId: string) => apiClient.get<UserBadgesResponse>(`/api/v1/badges/user/${userId}`).then((r) => r.data),
  },

  admin: {
    getContributions: (params?: AdminContributionsQuery) =>
      apiClient.get<AdminContributionListItem[]>("/api/v1/admin/contributions", { params }).then((r) => r.data),
    updateContributionStatus: (id: string, data: UpdateContributionStatusInput) =>
      apiClient.put<{ id: string; status: ContributionStatusValue }>(`/api/v1/admin/contributions/${id}/status`, data).then((r) => r.data),

    getAnalytics: () => apiClient.get<AdminAnalytics>("/api/v1/admin/analytics").then((r) => r.data),

    getUsers: (params?: { role?: string; search?: string; limit?: number; offset?: number }) =>
      apiClient.get<AdminUser[]>("/api/v1/admin/users", { params }).then((r) => r.data),
    suspendUser: (id: string, reason: string) =>
      apiClient.post<{ id: string; isSuspended: boolean }>(`/api/v1/admin/users/${id}/suspend`, { reason }).then((r) => r.data),

    // No admin-specific list endpoints exist for concepts/scenes -- the
    // public GET /concepts and GET /scenes routes have no auth requirement
    // and return everything needed, so admin pages reuse api.concepts.getAll
    // / api.scenes.getAll directly instead of duplicating them here.
    createConcept: (data: AdminConceptInput) => apiClient.post<ConceptDetail>("/api/v1/admin/concepts", data).then((r) => r.data),
    updateConcept: (id: string, data: AdminConceptUpdateInput) =>
      apiClient.put<ConceptDetail>(`/api/v1/admin/concepts/${id}`, data).then((r) => r.data),
    deleteConcept: (id: string) => apiClient.delete(`/api/v1/admin/concepts/${id}`).then((r) => r.data),
    uploadConceptMedia: (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiClient
        .post<{ id: string; publicUrl: string }>(`/api/v1/admin/concepts/${id}/media`, form)
        .then((r) => r.data);
    },
    bulkUploadConcepts: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiClient.post<BulkUploadResult>("/api/v1/admin/concepts/bulk", form).then((r) => r.data);
    },

    createScene: (data: AdminSceneInput) => apiClient.post<Scene>("/api/v1/admin/scenes", data).then((r) => r.data),
    updateScene: (id: string, data: AdminSceneUpdateInput) =>
      apiClient.put<Scene>(`/api/v1/admin/scenes/${id}`, data).then((r) => r.data),
    deleteScene: (id: string) => apiClient.delete(`/api/v1/admin/scenes/${id}`).then((r) => r.data),
    uploadSceneMedia: (id: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiClient
        .post<{ id: string; publicUrl: string }>(`/api/v1/admin/scenes/${id}/media`, form)
        .then((r) => r.data);
    },
    bulkUploadScenes: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiClient.post<BulkUploadResult>("/api/v1/admin/scenes/bulk", form).then((r) => r.data);
    },
    createSceneConcept: (data: AdminSceneConceptInput) =>
      apiClient.post<{ id: string }>("/api/v1/admin/scene-concepts", data).then((r) => r.data),

    getSentences: (params?: { limit?: number; offset?: number }) =>
      apiClient.get<AdminSentence[]>("/api/v1/admin/sentences", { params }).then((r) => r.data),
    createSentence: (data: AdminSentenceInput) => apiClient.post<AdminSentence>("/api/v1/admin/sentences", data).then((r) => r.data),
    deleteSentence: (id: string) => apiClient.delete(`/api/v1/admin/sentences/${id}`).then((r) => r.data),
    bulkUploadSentences: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return apiClient.post<BulkUploadResult>("/api/v1/admin/sentences/bulk", form).then((r) => r.data);
    },
  },

  superadmin: {
    getGamificationConfig: () => apiClient.get<GamificationConfigRow[]>("/api/v1/superadmin/gamification").then((r) => r.data),
    updateGamificationConfig: (key: string, value: number) =>
      apiClient.put<GamificationConfigRow>(`/api/v1/superadmin/gamification/${key}`, { value }).then((r) => r.data),

    getFeatureFlags: () => apiClient.get<FeatureFlag[]>("/api/v1/superadmin/feature-flags").then((r) => r.data),
    updateFeatureFlag: (key: string, isEnabled: boolean) =>
      apiClient.put<FeatureFlag>(`/api/v1/superadmin/feature-flags/${key}`, { isEnabled }).then((r) => r.data),
  },
};

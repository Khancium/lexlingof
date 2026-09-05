import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

const REFRESH_TOKEN_KEY = 'lexlingo_refresh_token';

// Never persisted -- lost on app restart/kill, which is the point: only the
// refresh token (opaque, revocable server-side) survives to disk.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// Hermes has no global atob/Buffer, so base64url is decoded by hand.
function decodeBase64Url(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  let output = '';
  let buffer = 0;
  let bits = 0;

  for (const char of base64) {
    const value = BASE64_CHARS.indexOf(char);
    if (value === -1) {
      continue;
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }

  return output;
}

// Decodes the `sub` claim out of the in-memory access token without
// verifying its signature -- fine here since we only ever act on a token
// this same client just received from the server over TLS.
export function getCurrentUserId(): string | null {
  if (!accessToken) {
    return null;
  }
  try {
    const payload = accessToken.split('.')[1];
    const json = decodeURIComponent(
      decodeBase64Url(payload)
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    return JSON.parse(json).sub ?? null;
  } catch {
    return null;
  }
}

export const apiClient = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3001',
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
  const storedRefreshToken = await AsyncStorage.getItem(REFRESH_TOKEN_KEY);
  if (!storedRefreshToken) {
    return null;
  }

  const response = await axios.post(
    `${apiClient.defaults.baseURL}/api/v1/auth/refresh`,
    { refreshToken: storedRefreshToken },
  );
  const { accessToken: newAccessToken, refreshToken: newRefreshToken } = response.data;

  setAccessToken(newAccessToken);
  await AsyncStorage.setItem(REFRESH_TOKEN_KEY, newRefreshToken);

  return newAccessToken;
}

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetryableConfig | undefined;
    const isAuthEndpoint = originalRequest?.url?.includes('/api/v1/auth/');

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      isAuthEndpoint
    ) {
      return Promise.reject(error);
    }
    originalRequest._retry = true;

    try {
      if (!refreshPromise) {
        refreshPromise = refreshAccessToken().finally(() => {
          refreshPromise = null;
        });
      }
      const newAccessToken = await refreshPromise;

      if (!newAccessToken) {
        throw new Error('No refresh token available');
      }

      originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
      return apiClient(originalRequest);
    } catch (refreshError) {
      const { useAuthStore } = await import('../store/auth.store');
      await useAuthStore.getState().logout();
      return Promise.reject(refreshError);
    }
  },
);

export const api = {
  auth: {
    register: (email: string, password: string, displayName: string) =>
      apiClient.post('/api/v1/auth/register', { email, password, displayName }).then((r) => r.data),
    login: (email: string, password: string) =>
      apiClient.post('/api/v1/auth/login', { email, password }).then((r) => r.data),
    refreshToken: (refreshToken: string) =>
      apiClient.post('/api/v1/auth/refresh', { refreshToken }).then((r) => r.data),
    logout: (refreshToken: string) =>
      apiClient.post('/api/v1/auth/logout', { refreshToken }).then((r) => r.data),
  },

  devices: {
    register: (token: string, platform: 'ios' | 'android') =>
      apiClient.post('/api/v1/devices/register', { token, platform }).then((r) => r.data),
    unregister: (token: string) =>
      apiClient.delete('/api/v1/devices/unregister', { data: { token } }).then((r) => r.data),
  },

  users: {
    getMe: () => apiClient.get('/api/v1/users/me').then((r) => r.data),
    updateMe: (data: Record<string, unknown>) => apiClient.put('/api/v1/users/me', data).then((r) => r.data),
    getStats: () => apiClient.get('/api/v1/users/me/stats').then((r) => r.data),
    getContributions: (params?: { limit?: number; offset?: number; moduleType?: string }) =>
      apiClient.get('/api/v1/users/me/contributions', { params }).then((r) => r.data),
  },

  languages: {
    getAll: () => apiClient.get('/api/v1/languages').then((r) => r.data),
  },

  categories: {
    getAll: () => apiClient.get('/api/v1/categories').then((r) => r.data),
  },

  concepts: {
    getAll: (params?: { categoryId?: string; search?: string; limit?: number; offset?: number }) =>
      apiClient.get('/api/v1/concepts', { params }).then((r) => r.data),
    getById: (id: string) => apiClient.get(`/api/v1/concepts/${id}`).then((r) => r.data),
    getNext: (categoryId?: string) =>
      apiClient.get('/api/v1/concepts/next', { params: categoryId ? { categoryId } : undefined }).then((r) => r.data),
    getLimits: (conceptId: string) =>
      apiClient.get(`/api/v1/contributions/word/${conceptId}/limits`).then((r) => r.data),
  },

  audio: {
    getUploadUrl: (data: {
      module: string;
      filename: string;
      mimeType: string;
      checksumSha256: string;
      fileSizeBytes: number;
    }) => apiClient.post('/api/v1/audio/upload-url', data).then((r) => r.data),
    confirmUpload: (id: string, data: { durationMs: number; checksumSha256: string }) =>
      apiClient.post(`/api/v1/audio/${id}/confirm`, data).then((r) => r.data),
    getPlayUrl: (id: string) => apiClient.get(`/api/v1/audio/${id}/play-url`).then((r) => r.data),
  },

  contributions: {
    submitWord: (data: Record<string, unknown>) =>
      apiClient.post('/api/v1/contributions/word', data).then((r) => r.data),
    submitAudio: (data: Record<string, unknown>) =>
      apiClient.post('/api/v1/contributions/audio', data).then((r) => r.data),
    addTranscription: (audioUploadId: string, data: Record<string, unknown>) =>
      apiClient.post(`/api/v1/contributions/audio/${audioUploadId}/transcription`, data).then((r) => r.data),
    addSegment: (audioUploadId: string, data: Record<string, unknown>) =>
      apiClient.post(`/api/v1/contributions/audio/${audioUploadId}/segments`, data).then((r) => r.data),
    getRandomSentence: (languageId: string) =>
      apiClient.get('/api/v1/sentences/random', { params: { languageId } }).then((r) => r.data),
    submitTranslation: (sentenceId: string, data: Record<string, unknown>) =>
      apiClient.post(`/api/v1/sentences/${sentenceId}/translation`, data).then((r) => r.data),
  },

  scenes: {
    getAll: () => apiClient.get('/api/v1/scenes').then((r) => r.data),
    getDaily: () => apiClient.get('/api/v1/scenes/daily').then((r) => r.data),
    getRandom: (excludeId?: string) =>
      apiClient.get('/api/v1/scenes/random', { params: excludeId ? { exclude: excludeId } : undefined }).then((r) => r.data),
    getById: (id: string) => apiClient.get(`/api/v1/scenes/${id}`).then((r) => r.data),
    submitContribution: (sceneId: string, data: Record<string, unknown>) =>
      apiClient.post(`/api/v1/scenes/${sceneId}/contributions`, data).then((r) => r.data),
  },

  reviews: {
    getQueue: (moduleType?: string) =>
      apiClient.get('/api/v1/reviews/queue', { params: moduleType ? { moduleType } : undefined }).then((r) => r.data),
    submitReview: (data: { contributionId: string; decision: 'valid' | 'needs_correction' | 'invalid'; reason?: string; notes?: string }) =>
      apiClient.post('/api/v1/reviews', data).then((r) => r.data),
  },

  leaderboard: {
    getGlobal: (params?: { limit?: number; offset?: number; period?: string }) =>
      apiClient.get('/api/v1/leaderboard', { params }).then((r) => r.data),
  },

  corpus: {
    getStats: () => apiClient.get('/api/v1/corpus/stats').then((r) => r.data),
    getCategories: () => apiClient.get('/api/v1/corpus/categories').then((r) => r.data),
  },

  badges: {
    getAll: () => apiClient.get('/api/v1/badges').then((r) => r.data),
    getForUser: () => {
      const userId = getCurrentUserId();
      if (!userId) {
        return Promise.reject(new Error('No authenticated user'));
      }
      return apiClient.get(`/api/v1/badges/user/${userId}`).then((r) => r.data);
    },
  },

  notifications: {
    getAll: (params?: { limit?: number; offset?: number }) =>
      apiClient.get('/api/v1/notifications', { params }).then((r) => r.data),
    markRead: (id: string) => apiClient.post(`/api/v1/notifications/${id}/read`).then((r) => r.data),
  },
};

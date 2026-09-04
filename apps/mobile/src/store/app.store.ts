import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../services/api.service';

const LANGUAGES_CACHE_KEY = 'lexlingo_languages_cache';
const CATEGORIES_CACHE_KEY = 'lexlingo_categories_cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type Dialect = { id: string; code: string; nameEnglish: string; nameNative?: string | null };
export type Language = {
  id: string;
  code: string;
  nameEnglish: string;
  nameNative: string;
  dialects: Dialect[];
};
export type Category = { id: string; slug: string; nameEnglish: string; icon?: string | null };

type CacheEnvelope<T> = { data: T; cachedAt: number };

type AppState = {
  languages: Language[];
  categories: Category[];
  isOffline: boolean;
  pendingUploadCount: number;
  loadLanguages: () => Promise<void>;
  loadCategories: () => Promise<void>;
  setOffline: (isOffline: boolean) => void;
  setPendingCount: (count: number) => void;
};

async function readCache<T>(key: string): Promise<T | null> {
  const raw = await AsyncStorage.getItem(key);
  if (!raw) {
    return null;
  }
  const envelope: CacheEnvelope<T> = JSON.parse(raw);
  if (Date.now() - envelope.cachedAt > CACHE_TTL_MS) {
    return null;
  }
  return envelope.data;
}

async function writeCache<T>(key: string, data: T): Promise<void> {
  const envelope: CacheEnvelope<T> = { data, cachedAt: Date.now() };
  await AsyncStorage.setItem(key, JSON.stringify(envelope));
}

export const useAppStore = create<AppState>((set) => ({
  languages: [],
  categories: [],
  isOffline: false,
  pendingUploadCount: 0,

  loadLanguages: async () => {
    const cached = await readCache<Language[]>(LANGUAGES_CACHE_KEY);
    if (cached) {
      set({ languages: cached });
      return;
    }

    const languages = await api.languages.getAll();
    await writeCache(LANGUAGES_CACHE_KEY, languages);
    set({ languages });
  },

  loadCategories: async () => {
    const cached = await readCache<Category[]>(CATEGORIES_CACHE_KEY);
    if (cached) {
      set({ categories: cached });
      return;
    }

    const categories = await api.categories.getAll();
    await writeCache(CATEGORIES_CACHE_KEY, categories);
    set({ categories });
  },

  setOffline: (isOffline) => set({ isOffline }),
  setPendingCount: (count) => set({ pendingUploadCount: count }),
}));

import { create } from 'zustand';
import { storage } from './taskStore';

// 用户配置（Tab 4 我的）：持久化到 MMKV
export interface Settings {
  deepseekKey: string;
  weatherKey: string;
  weatherCity: string;
  targetUniversity: string;
}

const SETTINGS_KEY = 'settings';

function loadSettings(): Settings {
  const raw = storage.getString(SETTINGS_KEY);
  if (!raw) return { deepseekKey: '', weatherKey: '', weatherCity: '', targetUniversity: '' };
  try {
    return { deepseekKey: '', weatherKey: '', weatherCity: '', targetUniversity: '', ...JSON.parse(raw) };
  } catch {
    return { deepseekKey: '', weatherKey: '', weatherCity: '', targetUniversity: '' };
  }
}

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...loadSettings(),
  update: (patch) => {
    set(patch);
    const { deepseekKey, weatherKey, weatherCity, targetUniversity } = get();
    storage.set(SETTINGS_KEY, JSON.stringify({ deepseekKey, weatherKey, weatherCity, targetUniversity }));
  },
}));

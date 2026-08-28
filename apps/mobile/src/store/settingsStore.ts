import { create } from 'zustand';
import { storage } from './taskStore';

// 用户配置（Tab 4 我的）：持久化到 MMKV
export interface Settings {
  weatherKey: string;
  weatherCity: string;
  targetUniversity: string;
  githubRepo: string; // Obsidian 仓库，格式 owner/repo（知识库用）
  githubBranch: string;
  llmProvider: string; // deepseek | openai | moonshot | glm | custom
  llmBaseUrl: string;
  llmModel: string;
  llmApiKey: string;
  supabaseUrl: string; // 云端读取（每日备课内容）
  supabaseAnonKey: string;
  accessKey: string; // 与 profiles.access_key 一致的设备访问密钥
  tavilyKey: string; // 联网搜索（AI searchWeb 工具用）
  webApiUrl: string; // 管理台地址（错题云同步走 /api/mistakes 代理）
  sttBaseUrl: string; // 语音转写（留空回退 LLM baseUrl；DeepSeek 无 ASR 需单独配）
  sttApiKey: string;
  sttModel: string; // whisper-1 / whisper-large-v3（Groq）/ SenseVoice 等
}

const SETTINGS_KEY = 'settings';

const DEFAULTS: Settings = {
  weatherKey: '',
  weatherCity: '',
  targetUniversity: '',
  githubRepo: '',
  githubBranch: 'main',
  llmProvider: 'deepseek',
  llmBaseUrl: 'https://api.deepseek.com',
  llmModel: 'deepseek-chat',
  llmApiKey: '',
  supabaseUrl: '',
  supabaseAnonKey: '',
  accessKey: '',
  tavilyKey: '',
  webApiUrl: '',
  sttBaseUrl: '',
  sttApiKey: '',
  sttModel: 'whisper-1',
};

function loadSettings(): Settings {
  const raw = storage.getString(SETTINGS_KEY);
  if (!raw) return { ...DEFAULTS };
  try {
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

interface SettingsState extends Settings {
  update: (patch: Partial<Settings>) => void;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...loadSettings(),
  update: (patch) => {
    set(patch);
    const { update: _fn, ...rest } = get() as SettingsState & { update: unknown };
    storage.set(SETTINGS_KEY, JSON.stringify(rest));
  },
}));

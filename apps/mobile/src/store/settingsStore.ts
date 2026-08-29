import { create } from 'zustand';
import { storage } from './storage';
import type { ThemeMode } from '@/theme';

// 用户配置（Tab 4 我的）：持久化到 MMKV
export interface Settings {
  weatherKey: string;
  weatherCity: string;
  targetUniversity: string;
  targetScore: number | null; // 本人目标总分（横向对标数值化：与检索到的分数线计算差距）
  githubRepo: string; // Obsidian 仓库，格式 owner/repo（知识库用）
  githubBranch: string;
  themeMode: ThemeMode; // 深色模式：system 跟随系统 / light / dark 手动固定
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
  visionBaseUrl: string; // 视觉模型（错题图片识别）：默认智谱，OpenAI 兼容
  visionApiKey: string;
  visionModel: string; // GLM-4.6V-Flash（免费额度）
}

const SETTINGS_KEY = 'settings';

const DEFAULTS: Settings = {
  weatherKey: '',
  weatherCity: '',
  targetUniversity: '',
  targetScore: null,
  githubRepo: '',
  githubBranch: 'main',
  themeMode: 'system', // 默认跟随系统深色模式
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
  visionBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
  visionApiKey: '',
  visionModel: 'glm-4.6v-flash',
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

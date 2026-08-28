import { create } from 'zustand';
import { storage } from './taskStore';

// 知识库：按需下载的 Markdown 内容缓存（MMKV 持久化，离线可读）
const KEY = 'knowledge-cache';

function load(): Record<string, string> {
  const raw = storage.getString(KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

interface KnowledgeState {
  cache: Record<string, string>;
  save: (path: string, content: string) => void;
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  cache: load(),
  save: (path, content) => {
    const cache = { ...get().cache, [path]: content };
    // 限制缓存体积：最多保留 100 篇（超出丢弃最早的写入，按对象键序近似）
    const keys = Object.keys(cache);
    if (keys.length > 100) delete cache[keys[0]];
    storage.set(KEY, JSON.stringify(cache));
    set({ cache });
  },
}));

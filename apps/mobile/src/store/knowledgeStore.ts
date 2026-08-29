import { create } from 'zustand';
import { storage } from './storage';

// 知识库：按需下载的 Markdown 内容缓存（MMKV 持久化，离线可读）
const KEY = 'knowledge-cache';

// 读盘整体 try/catch：MMKV 取值也可能抛（数据损坏/跨版本结构变化），不能让模块加载直接崩
function load(): Record<string, string> {
  try {
    const raw = storage.getString(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    // 排除数组与 null（typeof null === 'object'），否则后续 Object.keys/cache[path] 行为异常
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Record<string, string>;
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
    try {
      storage.set(KEY, JSON.stringify(cache));
    } catch {
      // 写盘失败（容量/序列化）只影响离线缓存，内存态本次仍可用
    }
    set({ cache });
  },
}));

import { create } from 'zustand';
import { storage } from './taskStore';

// 代码沙盒片段（MMKV 持久化；Phase 3 同步云端）
export interface Snippet {
  id: string;
  name: string;
  code: string;
}

const KEY = 'sandbox-snippets';

function load(): Snippet[] {
  const raw = storage.getString(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface SandboxState {
  snippets: Snippet[];
  save: (name: string, code: string) => void;
  remove: (id: string) => void;
}

export const useSandboxStore = create<SandboxState>((set, get) => ({
  snippets: load(),
  save: (name, code) => {
    const next = [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: name.trim() || '未命名片段', code },
      ...get().snippets,
    ].slice(0, 50);
    storage.set(KEY, JSON.stringify(next));
    set({ snippets: next });
  },
  remove: (id) => {
    const next = get().snippets.filter((s) => s.id !== id);
    storage.set(KEY, JSON.stringify(next));
    set({ snippets: next });
  },
}));

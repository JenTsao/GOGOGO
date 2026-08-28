import { create } from 'zustand';
import { storage } from './taskStore';
import * as FileSystem from 'expo-file-system';

// 错题本：本地优先（MMKV 快照，离线可用），云端经管理台 /api/mistakes 异步同步
export interface Mistake {
  id: string;
  subject: string;
  tags: string[];
  imageUri?: string; // 本地持久化路径（file://）
  imageUrl?: string; // 云端 URL（同步成功后回填）
  voiceUri?: string;
  voiceUrl?: string;
  createdAt: string; // ISO
  synced: boolean;
  cloudId?: string; // 云端 mistakes.id（同步成功后回填，供重做结果 PATCH）
  correct?: 'right' | 'wrong'; // 重做结果：喂画像「学科掌握」维度
  transcript?: string; // 语音反思转写文本：AI 讲解上下文 + 画像情绪词来源
}

interface MistakeState {
  mistakes: Mistake[];
  addMistake: (m: Omit<Mistake, 'id' | 'synced'>) => string;
  removeMistake: (id: string) => void;
  markSynced: (id: string, imageUrl: string, voiceUrl?: string, cloudId?: string) => void;
  // 重做结果：本地即时更新；已同步的条目同时 PATCH 云端（失败静默，下次同步重试）
  markCorrect: (id: string, correct: 'right' | 'wrong', webApiUrl: string, accessKey: string) => void;
  // 语音转写结果落库（本地）
  setTranscript: (id: string, text: string) => void;
  // 全量同步：未同步的逐条上传（图片 base64），成功回填 URL
  syncAll: (webApiUrl: string, accessKey: string) => Promise<{ ok: number; fail: number }>;
}

const KEY = 'mistakes';

function load(): Mistake[] {
  const raw = storage.getString(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as Mistake[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(list: Mistake[]) {
  // 上限 200 条：防 MMKV 无限增长
  storage.set(KEY, JSON.stringify(list.slice(0, 200)));
}

// 本地文件 → base64（上传用）
async function fileToBase64(uri: string): Promise<string | null> {
  try {
    const res = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
    return res;
  } catch {
    return null;
  }
}

export const useMistakeStore = create<MistakeState>((set, get) => ({
  mistakes: load(),
  addMistake: (m) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const mistake: Mistake = { ...m, id, synced: false };
    const next = [mistake, ...get().mistakes];
    persist(next);
    set({ mistakes: next });
    return id;
  },
  removeMistake: (id) => {
    const next = get().mistakes.filter((m) => m.id !== id);
    persist(next);
    set({ mistakes: next });
  },
  markSynced: (id, imageUrl, voiceUrl, cloudId) => {
    const next = get().mistakes.map((m) =>
      m.id === id ? { ...m, synced: true, imageUrl, voiceUrl, cloudId: cloudId ?? m.cloudId } : m
    );
    persist(next);
    set({ mistakes: next });
  },
  markCorrect: (id, correct, webApiUrl, accessKey) => {
    const next = get().mistakes.map((m) => (m.id === id ? { ...m, correct } : m));
    persist(next);
    set({ mistakes: next });
    const m = next.find((x) => x.id === id);
    if (!m?.cloudId) return; // 未同步的先记本地，syncAll 成功后可再补报
    fetch(`${webApiUrl.replace(/\/+$/, '')}/api/mistakes`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-access-key': accessKey },
      body: JSON.stringify({ id: m.cloudId, isMastered: correct === 'right' }),
    }).catch(() => {}); // 云端回写失败不影响本地画像
  },
  setTranscript: (id, text) => {
    const next = get().mistakes.map((m) => (m.id === id ? { ...m, transcript: text } : m));
    persist(next);
    set({ mistakes: next });
  },
  syncAll: async (webApiUrl, accessKey) => {
    if (!webApiUrl || !accessKey) throw new Error('请在「我的」配置管理台地址与访问密钥');
    let ok = 0;
    let fail = 0;
    for (const m of get().mistakes.filter((x) => !x.synced)) {
      if (!m.imageUri) {
        fail++;
        continue;
      }
      try {
        const imageBase64 = await fileToBase64(m.imageUri);
        if (!imageBase64) throw new Error('图片读取失败');
        const voiceBase64 = m.voiceUri ? await fileToBase64(m.voiceUri) : null;
        const res = await fetch(`${webApiUrl.replace(/\/+$/, '')}/api/mistakes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-access-key': accessKey },
          body: JSON.stringify({
            subject: m.subject,
            tags: m.tags,
            imageBase64,
            imageMime: 'image/jpeg',
            voiceBase64: voiceBase64 ?? undefined,
            voiceMime: 'audio/mp4',
            createdAt: m.createdAt,
            isMastered: m.correct ? m.correct === 'right' : undefined,
          }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as { id?: string; imageUrl: string; voiceUrl?: string };
        get().markSynced(m.id, data.imageUrl, data.voiceUrl, data.id);
        ok++;
      } catch {
        fail++; // 单条失败不阻断其余条目
      }
    }
    return { ok, fail };
  },
}));

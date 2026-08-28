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
  summary?: string; // 视觉模型识别的题面摘要：AI 讲解上下文
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
  // 双向同步：推（未同步条目上传，携带 transcript/summary）→ 拉（云端条目差集下载到本地）→ 回填（本地有而云端无的转写/摘要 PATCH 上去）
  syncAll: (webApiUrl: string, accessKey: string) => Promise<{ ok: number; fail: number; pulled: number }>;
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

// 云端文件落地：下载到文档目录，保证拉取的条目离线可看可播（失败返回 undefined 走在线 URL 兜底）
async function downloadToDoc(url: string, ext: string): Promise<string | undefined> {
  try {
    const dir = `${FileSystem.documentDirectory}mistakes`;
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
    const dest = `${dir}${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const { uri } = await FileSystem.downloadAsync(url, dest);
    return uri;
  } catch {
    return undefined;
  }
}

interface CloudMistake {
  id: string;
  subject: string;
  tags: string[] | null;
  image_urls: string[] | null;
  voice_note_url: string | null;
  is_mastered: boolean | null;
  transcript: string | null;
  summary: string | null;
  created_at: string;
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
          transcript: m.transcript,
          summary: m.summary,
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

  // ---------- 拉：云端条目差集合入本地（他端新增） ----------
  let pulled = 0;
  try {
    const res = await fetch(`${webApiUrl.replace(/\/+$/, '')}/api/mistakes`, {
      headers: { 'x-access-key': accessKey },
    });
    if (res.ok) {
      const data = (await res.json()) as { mistakes?: CloudMistake[] };
      const local = get().mistakes;
      const knownCloudIds = new Set(local.map((m) => m.cloudId).filter(Boolean));
      const remote = data.mistakes ?? [];
      const additions: Mistake[] = [];
      for (const c of remote) {
        if (knownCloudIds.has(c.id)) continue;
        const imgUrl = c.image_urls?.[0];
        if (!imgUrl) continue;
        // 图片下载到本地（离线可看）；失败则直接用云端 URL
        const imageUri = (await downloadToDoc(imgUrl, 'jpg')) ?? imgUrl;
        const voiceUri = c.voice_note_url ? await downloadToDoc(c.voice_note_url, 'm4a') : undefined;
        additions.push({
          id: `c-${c.id}`,
          subject: c.subject,
          tags: c.tags ?? [],
          imageUri,
          imageUrl: imgUrl,
          voiceUri,
          voiceUrl: c.voice_note_url ?? undefined,
          createdAt: c.created_at,
          synced: true,
          cloudId: c.id,
          correct: c.is_mastered === null || c.is_mastered === undefined ? undefined : c.is_mastered ? 'right' : 'wrong',
          transcript: c.transcript ?? undefined,
          summary: c.summary ?? undefined,
        });
        pulled++;
      }
      if (additions.length > 0) {
        const merged = [...additions, ...local].slice(0, 200);
        persist(merged);
        set({ mistakes: merged });
      }
    }
  } catch {
    // 拉取失败不影响推送结果
  }

  // ---------- 回填：已同步条目中本地有而云端缺的转写/摘要/重做结果 ----------
  try {
    const res = await fetch(`${webApiUrl.replace(/\/+$/, '')}/api/mistakes`, {
      headers: { 'x-access-key': accessKey },
    });
    if (res.ok) {
      const data = (await res.json()) as { mistakes?: CloudMistake[] };
      const cloudById = new Map((data.mistakes ?? []).map((c) => [c.id, c]));
      for (const m of get().mistakes) {
        if (!m.cloudId || !m.synced) continue;
        const c = cloudById.get(m.cloudId);
        const patch: Record<string, unknown> = {};
        if (m.transcript && !c?.transcript) patch.transcript = m.transcript;
        if (m.summary && !c?.summary) patch.summary = m.summary;
        if (m.correct && c?.is_mastered !== (m.correct === 'right')) patch.isMastered = m.correct === 'right';
        if (Object.keys(patch).length === 0) continue;
        await fetch(`${webApiUrl.replace(/\/+$/, '')}/api/mistakes`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-access-key': accessKey },
          body: JSON.stringify({ id: m.cloudId, ...patch }),
        }).catch(() => {}); // 单条回填失败静默，下次同步重试
      }
    }
  } catch {
    // 回填失败静默
  }

  return { ok, fail, pulled };
  },
}));

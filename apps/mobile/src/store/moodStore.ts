// 情绪打卡（蓝皮书 mood_checkins 表）：本地优先（MMKV）+ 云同步
// 数据源用途：画像情绪信号（打卡 emoji 趋势 + 语音转写消极词加权）
import { create } from 'zustand';
import * as FileSystem from 'expo-file-system';
import { MMKV } from 'react-native-mmkv';
import { useSettingsStore } from './settingsStore';
import { localDateStr } from './reminderStore';

const storage = new MMKV({ id: 'gaokao-mood' });
const KEY = 'mood_checkins_v1';
const MAX = 200; // 上限：一年足够，防无限膨胀

export interface MoodCheckin {
  id: string;
  date: string; // YYYY-MM-DD（一人一天一条，重打覆盖）
  emojiCode: string; // 😊😃😐😟😫
  summary?: string; // 一句话备注
  voiceUri?: string; // 本地录音文件
  transcript?: string; // 语音转写（画像情绪词来源）
  cloudUrl?: string; // 云端语音 URL
  synced: boolean;
  cloudId?: string;
}

interface MoodState {
  checkins: MoodCheckin[];
  load: () => void;
  checkIn: (emojiCode: string, summary?: string, voiceUri?: string) => void;
  setTranscript: (id: string, text: string) => void;
  syncAll: () => Promise<void>;
}

// 反序列化必须校验结构：旧版本/写盘中断可能留下非数组内容，
// 直接 set 会让后续 .filter / .map 直接崩溃
function parseList(raw: string | undefined): MoodCheckin[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as MoodCheckin[]) : [];
  } catch {
    return [];
  }
}

function persist(list: MoodCheckin[]): void {
  try {
    storage.set(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // 序列化失败静默：内存态仍可用
  }
}

export const useMoodStore = create<MoodState>((set, get) => ({
  checkins: [],
  load: () => {
    try {
      set({ checkins: parseList(storage.getString(KEY)) });
    } catch {
      // 读取失败按空处理
      set({ checkins: [] });
    }
  },
  // 打卡/重打：同日覆盖（保留云端 id 与旧转写直到重新录音转写）
  checkIn: (emojiCode, summary, voiceUri) => {
    const date = localDateStr(new Date());
    const prev = get().checkins.find((c) => c.date === date);
    const entry: MoodCheckin = {
      id: prev?.id ?? `${Date.now()}`,
      date,
      emojiCode,
      summary: summary?.trim() || undefined,
      voiceUri: voiceUri ?? prev?.voiceUri,
      transcript: prev?.transcript,
      // 重新录音 → 旧云端语音已失效，清空等下次同步重传；未重新录音 → 继承原地址，否则他端拉取后无法播放
      cloudUrl: voiceUri ? undefined : prev?.cloudUrl,
      synced: false,
      cloudId: prev?.cloudId,
    };
    const list = [entry, ...get().checkins.filter((c) => c.date !== date)].slice(0, MAX);
    persist(list);
    set({ checkins: list });
  },
  setTranscript: (id, text) => {
    const list = get().checkins.map((c) => (c.id === id ? { ...c, transcript: text || undefined } : c));
    persist(list);
    set({ checkins: list });
  },
  // 云同步：经管理台 /api/mood 代理（与错题同一鉴权模型），失败留待下次
  syncAll: async () => {
    const { webApiUrl, accessKey } = useSettingsStore.getState();
    if (!webApiUrl || !accessKey) return;
    const pending = get().checkins.filter((c) => !c.synced);
    if (pending.length === 0) return;
    for (const c of pending) {
      try {
        // 语音转 base64 随打卡上传（≤1 分钟 m4a，体积可接受）
        let voiceBase64: string | undefined;
        if (c.voiceUri) {
          voiceBase64 = await FileSystem.readAsStringAsync(c.voiceUri, { encoding: FileSystem.EncodingType.Base64 });
        }
        const res = await fetch(`${webApiUrl.replace(/\/+$/, '')}/api/mood`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-access-key': accessKey },
          body: JSON.stringify({ date: c.date, emojiCode: c.emojiCode, summary: c.summary, voiceBase64 }),
        });
        if (!res.ok) continue; // 单条失败不阻断其余
        const data = (await res.json()) as { id?: string; voiceUrl?: string };
        const list = get().checkins.map((x) =>
          x.id === c.id ? { ...x, synced: true, cloudId: data.id ?? x.cloudId, cloudUrl: data.voiceUrl ?? x.cloudUrl } : x
        );
        persist(list);
        set({ checkins: list });
      } catch {
        // 网络失败静默，下次再试
      }
    }
  },
}));

// 模块加载即恢复本地打卡：不能等驾驶舱挂载才 load，其他入口（AI 画像、后台任务）先读 store 会拿到空数据
useMoodStore.getState().load();

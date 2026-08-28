// 语音转文字：OpenAI 兼容 /audio/transcriptions（OpenAI whisper-1 / Groq whisper-large-v3 / SiliconFlow SenseVoice 等）
// 注意：DeepSeek 无 ASR 服务，需在「我的」单独配置支持转写的 baseUrl + Key
import * as FileSystem from 'expo-file-system';

export interface SttConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

// 录音文件（m4a）→ 文本。RN fetch + FormData 直接上传本地文件
export async function transcribeAudio(uri: string, cfg: SttConfig): Promise<string> {
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error('未配置语音转写服务（需 OpenAI/Groq 等支持 ASR 的供应商）');
  const formData = new FormData();
  formData.append('file', {
    uri,
    name: 'audio.m4a',
    type: 'audio/mp4',
  } as unknown as FormData.Value);
  formData.append('model', cfg.model || 'whisper-1');
  formData.append('language', 'zh'); // 高考场景锁定中文，减少误识别

  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: formData,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`转写失败 HTTP ${res.status}${detail ? `：${detail.slice(0, 120)}` : ''}`);
  }
  const data = (await res.json()) as { text?: string };
  if (!data.text) throw new Error('转写结果为空');
  return data.text.trim();
}

// 画像情绪词：语音反思中的消极信号即时加权（蓝皮书「激进模式画像」数据源）
export const NEGATIVE_WORDS = ['搞不懂', '不会', '不理解', '崩溃', '烦', '太难', '卡住', '又错', '还是错', '记不住', '看不懂'] as const;

export function countNegativeWords(texts: string[]): Map<string, number> {
  const count = new Map<string, number>();
  for (const text of texts) {
    for (const word of NEGATIVE_WORDS) {
      const n = text.split(word).length - 1;
      if (n > 0) count.set(word, (count.get(word) ?? 0) + n);
    }
  }
  return count;
}

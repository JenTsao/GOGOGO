// 语音合成：OpenAI 兼容 /audio/speech（OpenAI tts-1 / gpt-4o-mini-tts / SiliconFlow FishAudio 等）
// 返回 mp3 二进制 → 落缓存文件 → expo-av 播放。DeepSeek/智谱无 TTS，需单独配置。
import * as FileSystem from 'expo-file-system';

export interface TtsConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
}

export function ttsConfigured(cfg: Pick<TtsConfig, 'baseUrl' | 'apiKey'>): boolean {
  return !!cfg.baseUrl && !!cfg.apiKey;
}

// ArrayBuffer → base64：RN 没有 Blob→base64 直转路径，分块 String.fromCharCode + btoa（Hermes 内置）
// 0x8000 分块避开一次性展开的调用栈上限；一段 30 秒 mp3 约 500KB，转换耗时可忽略
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// 合成语音并落盘，返回文件 URI（调用方播完负责删除，避免缓存目录堆积）
export async function synthesizeSpeech(text: string, cfg: TtsConfig): Promise<string> {
  if (!ttsConfigured(cfg)) throw new Error('未配置语音合成（TTS）服务');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  let res: Response;
  try {
    res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model || 'tts-1',
        input: text,
        voice: cfg.voice || 'alloy',
        response_format: 'mp3',
      }),
      signal: controller.signal,
    });
  } catch (e) {
    throw (e as Error).name === 'AbortError' ? new Error('语音合成超时（30 秒），请检查网络或合成服务地址') : (e as Error);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`语音合成失败 HTTP ${res.status}${detail ? `：${detail.slice(0, 120)}` : ''}`);
  }
  const buf = await res.arrayBuffer();
  if (!buf || buf.byteLength === 0) throw new Error('语音合成返回为空');
  const uri = `${FileSystem.cacheDirectory}tts-${Date.now()}.mp3`;
  await FileSystem.writeAsStringAsync(uri, bytesToBase64(new Uint8Array(buf)), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return uri;
}

// Markdown → 可朗读纯文本：代码块/表格/链接/标记符号会破坏语音可懂度，全部清洗；
// 朗读上限 600 字：长回复听不完还烧 TTS 额度，截断比念一半更符合直觉
export function speakableText(md: string): string {
  const t = md
    .replace(/```[\s\S]*?```/g, '（代码略）')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\$\$?([^$]+)\$\$?/g, '$1')
    .replace(/[#>*_~|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > 600 ? `${t.slice(0, 600)}……` : t;
}

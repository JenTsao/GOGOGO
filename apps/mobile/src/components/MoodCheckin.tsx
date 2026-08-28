// 情绪打卡条（仪表盘顶部）：emoji + 一句话备注 + 语音备忘
// 本地优先落 MMKV → 后台同步云端 mood_checkins；语音可转写喂画像情绪信号
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { useMoodStore } from '@/store/moodStore';
import { useSettingsStore } from '@/store/settingsStore';
import { transcribeAudio } from '@/lib/stt';

const EMOJIS = [
  { code: '😊', label: '不错' },
  { code: '😃', label: '充实' },
  { code: '😐', label: '一般' },
  { code: '😟', label: '焦虑' },
  { code: '😫', label: '疲惫' },
];

async function persistAudio(tempUri: string): Promise<string> {
  // 录音默认落在缓存目录（系统可能清理），拷贝到文档目录保持久
  const dir = `${FileSystem.documentDirectory}mood`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const dest = `${dir}${Date.now()}.m4a`;
  await FileSystem.copyAsync({ from: tempUri, to: dest });
  return dest;
}

export default function MoodCheckin() {
  const checkins = useMoodStore((s) => s.checkins);
  const checkIn = useMoodStore((s) => s.checkIn);
  const syncAll = useMoodStore((s) => s.syncAll);
  const setTranscript = useMoodStore((s) => s.setTranscript);
  const { llmBaseUrl, llmApiKey, sttBaseUrl, sttApiKey, sttModel } = useSettingsStore();

  const todayStr = new Date().toISOString().slice(0, 10);
  const today = checkins.find((c) => c.date === todayStr);

  const [selected, setSelected] = useState<string | null>(today?.emojiCode ?? null);
  const [summary, setSummary] = useState(today?.summary ?? '');
  const [voiceUri, setVoiceUri] = useState<string | null>(today?.voiceUri ?? null);
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [saving, setSaving] = useState(false);

  // 录音/播放句柄用 ref 持有：60 秒兜底定时器触发时 state 闭包已过期（调度时 recording 还是 null），必须走 ref
  const soundRef = useRef<Audio.Sound | null>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 卸载时统一释放：清定时器、停录音、释放声音实例
  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
      recordingRef.current?.stopAndUnloadAsync().catch(() => {});
      soundRef.current?.unloadAsync().catch(() => {});
    };
  }, []);

  // 打卡记录加载后回填今日状态
  useEffect(() => {
    if (today) {
      setSelected((v) => v ?? today.emojiCode);
      setSummary((v) => v || today.summary || '');
      setVoiceUri((v) => v ?? today.voiceUri ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkins.length]);

  const stopRecording = async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    if (recordTimerRef.current) {
      clearTimeout(recordTimerRef.current);
      recordTimerRef.current = null;
    }
    try {
      await rec.stopAndUnloadAsync();
      const uri = rec.getURI();
      setRecording(null);
      if (uri) setVoiceUri(await persistAudio(uri));
    } catch {
      setRecording(null);
    }
  };

  const toggleRecord = async () => {
    // 停止判定走 ref：定时器兜底触发时闭包里的 state 不可靠
    if (recordingRef.current) {
      await stopRecording();
      return;
    }
    try {
      const perm = await Audio.requestPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('需要麦克风权限', '语音备忘用于记录当天状态与情绪信号');
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = rec;
      setRecording(rec);
      // 60 秒兜底自动停（防忘记停止）
      recordTimerRef.current = setTimeout(() => {
        recordTimerRef.current = null;
        void stopRecording();
      }, 61000);
    } catch (e) {
      // 防御性重置：当前赋值在 await 成功之后理论上不会污染 ref，此处兜底防未来代码重排
      recordingRef.current = null;
      setRecording(null);
      Alert.alert('录音失败', (e as Error).message);
    }
  };

  const play = async () => {
    if (!voiceUri) return;
    try {
      await sound?.unloadAsync();
      const { sound: s } = await Audio.Sound.createAsync({ uri: voiceUri });
      soundRef.current = s;
      setSound(s);
      await s.playAsync();
    } catch {
      // 播放失败静默
    }
  };

  // 语音转文字：喂画像情绪信号（与错题语音同一 STT 配置）
  const transcribe = async () => {
    if (!voiceUri) return;
    const apiKey = sttApiKey || llmApiKey;
    if (!apiKey) {
      Alert.alert('未配置转写', '请到「我的」填写 STT（如 Groq whisper-large-v3）或 LLM Key');
      return;
    }
    if (!today) {
      Alert.alert('请先打卡', '选一个 emoji 保存后再转写语音');
      return;
    }
    setTranscribing(true);
    try {
      const text = await transcribeAudio(voiceUri, {
        baseUrl: sttBaseUrl || llmBaseUrl,
        apiKey,
        model: sttModel,
      });
      setTranscript(today.id, text);
    } catch (e) {
      Alert.alert('转写失败', (e as Error).message);
    } finally {
      setTranscribing(false);
    }
  };

  const save = async () => {
    if (!selected) {
      Alert.alert('选一个状态', '点击上方 emoji 选择今天的心情');
      return;
    }
    setSaving(true);
    try {
      checkIn(selected, summary, voiceUri ?? undefined);
      await syncAll(); // 失败静默，本地已落
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>🫀 今日情绪打卡{today?.synced ? ' · 已同步 ☁️' : today ? ' · 未同步 ⏳' : ''}</Text>
      <View style={styles.emojiRow}>
        {EMOJIS.map((e) => (
          <TouchableOpacity
            key={e.code}
            style={[styles.emojiBtn, selected === e.code && styles.emojiActive]}
            onPress={() => setSelected(e.code)}
          >
            <Text style={styles.emoji}>{e.code}</Text>
            <Text style={[styles.emojiLabel, selected === e.code && styles.emojiLabelActive]}>{e.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.input}
        placeholder="一句话备注（可选）：今天卡在导数第二问…"
        placeholderTextColor="#999"
        value={summary}
        onChangeText={setSummary}
        maxLength={100}
      />
      <View style={styles.actionRow}>
        <TouchableOpacity style={[styles.miniBtn, recording && styles.recBtn]} onPress={toggleRecord}>
          <Text style={styles.miniBtnText}>{recording ? '⏹ 停止' : voiceUri ? '🎤 重录' : '🎤 语音'}</Text>
        </TouchableOpacity>
        {!!voiceUri && (
          <>
            <TouchableOpacity style={styles.miniBtn} onPress={play}>
              <Text style={styles.miniBtnText}>▶️</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.miniBtn} onPress={transcribe} disabled={transcribing}>
              {transcribing ? <ActivityIndicator size="small" color="#1a4d8f" /> : <Text style={styles.miniBtnText}>📝 转写</Text>}
            </TouchableOpacity>
          </>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity style={[styles.saveBtn, saving && { opacity: 0.6 }]} onPress={save} disabled={saving}>
          <Text style={styles.saveText}>{saving ? '保存中…' : today ? '更新打卡' : '打卡'}</Text>
        </TouchableOpacity>
      </View>
      {today?.transcript ? <Text style={styles.transcript}>🗣 {today.transcript}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 14,
    marginHorizontal: 16,
    marginTop: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  title: { fontSize: 14, fontWeight: '700', color: '#1a1a1a', marginBottom: 10 },
  emojiRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  emojiBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, backgroundColor: '#f5f6f8' },
  emojiActive: { backgroundColor: '#eef2ff', borderWidth: 1.5, borderColor: '#1a4d8f' },
  emoji: { fontSize: 22 },
  emojiLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  emojiLabelActive: { color: '#1a4d8f', fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: '#e3e6eb',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    color: '#1a1a1a',
    marginBottom: 10,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  miniBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#f5f6f8' },
  recBtn: { backgroundColor: '#ffe4e4' },
  miniBtnText: { fontSize: 13, color: '#1a1a1a' },
  saveBtn: { backgroundColor: '#1a4d8f', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8 },
  saveText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  transcript: { marginTop: 8, fontSize: 12, color: '#666', fontStyle: 'italic' },
});

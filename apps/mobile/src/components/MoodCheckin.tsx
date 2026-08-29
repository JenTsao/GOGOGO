// 情绪打卡条（仪表盘顶部）：emoji + 一句话备注 + 语音备忘
// 本地优先落 MMKV → 后台同步云端 mood_checkins；语音可转写喂画像情绪信号
import { View, Text, TextInput, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';
import { useMoodStore } from '@/store/moodStore';
import { useSettingsStore } from '@/store/settingsStore';
import { transcribeAudio } from '@/lib/stt';
import { R, cardShadow, themedStyles, usePalette, useScheme } from '@/theme';

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
  const C = usePalette();
  const styles = STYLES[useScheme()];
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
      <View style={styles.titleRow}>
        <Ionicons name="heart" size={15} color={C.primary} />
        <Text style={styles.title}>今日情绪打卡</Text>
        {today?.synced ? (
          <View style={styles.syncChip}>
            <Ionicons name="cloud-done" size={12} color={C.green} />
            <Text style={[styles.syncText, { color: C.green }]}>已同步</Text>
          </View>
        ) : today ? (
          <View style={styles.syncChip}>
            <Ionicons name="cloud-offline" size={12} color={C.text3} />
            <Text style={styles.syncText}>未同步</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.emojiRow}>
        {EMOJIS.map((e) => (
          <TouchableOpacity
            key={e.code}
            style={[styles.emojiBtn, selected === e.code && styles.emojiActive]}
            onPress={() => setSelected(e.code)}
            activeOpacity={0.85}
            accessibilityLabel={`情绪：${e.label}`}
          >
            <Text style={styles.emoji}>{e.code}</Text>
            <Text style={[styles.emojiLabel, selected === e.code && styles.emojiLabelActive]}>{e.label}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <TextInput
        style={styles.input}
        placeholder="一句话备注（可选）：今天卡在导数第二问…"
        placeholderTextColor={C.text3}
        value={summary}
        onChangeText={setSummary}
        maxLength={100}
      />
      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.miniBtn, recording && styles.recBtn]}
          onPress={toggleRecord}
          activeOpacity={0.85}
          accessibilityLabel={recording ? '停止录音' : voiceUri ? '重新录音' : '语音备忘'}
        >
          <Ionicons name={recording ? 'stop' : 'mic'} size={14} color={recording ? C.red : C.text2} />
          <Text style={[styles.miniBtnText, recording && { color: C.red, fontWeight: '600' }]}>
            {recording ? '停止' : voiceUri ? '重录' : '语音'}
          </Text>
        </TouchableOpacity>
        {!!voiceUri && (
          <>
            <TouchableOpacity style={styles.miniBtn} onPress={play} activeOpacity={0.85} accessibilityLabel="播放语音备忘">
              <Ionicons name="play" size={14} color={C.text2} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.miniBtn}
              onPress={transcribe}
              disabled={transcribing}
              activeOpacity={0.85}
              accessibilityLabel="语音转文字"
            >
              {transcribing ? (
                <ActivityIndicator size="small" color={C.primary} />
              ) : (
                <>
                  <Ionicons name="document-text" size={14} color={C.text2} />
                  <Text style={styles.miniBtnText}>转写</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
        <View style={{ flex: 1 }} />
        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.6 }]}
          onPress={save}
          disabled={saving}
          activeOpacity={0.85}
        >
          <Text style={styles.saveText}>{saving ? '保存中…' : today ? '更新打卡' : '打卡'}</Text>
        </TouchableOpacity>
      </View>
      {today?.transcript ? (
        <View style={styles.transcriptRow}>
          <Ionicons name="chatbox-ellipses" size={12} color={C.text3} />
          <Text style={styles.transcript}>{today.transcript}</Text>
        </View>
      ) : null}
    </View>
  );
}

// 双套样式表：light/dark 模块级各建一份，主题切换零重建
const STYLES = themedStyles((C) => ({
  wrap: {
    backgroundColor: C.card,
    borderRadius: R.lg,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 12,
    ...cardShadow,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  title: { fontSize: 15, fontWeight: '700', color: C.text, flex: 1 },
  syncChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  syncText: { fontSize: 11, color: C.text3, fontWeight: '500' },
  emojiRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  emojiBtn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: R.sm, backgroundColor: C.bg },
  emojiActive: { backgroundColor: C.primarySoft, borderWidth: 1.5, borderColor: C.primary },
  emoji: { fontSize: 22 },
  emojiLabel: { fontSize: 11, color: C.text3, marginTop: 2 },
  emojiLabelActive: { color: C.primary, fontWeight: '700' },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: C.text,
    backgroundColor: C.card,
    marginBottom: 12,
  },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  miniBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: R.sm,
    backgroundColor: C.bg,
    minHeight: 36,
  },
  recBtn: { backgroundColor: C.redSoft },
  miniBtnText: { fontSize: 13, color: C.text2 },
  saveBtn: { backgroundColor: C.primary, paddingHorizontal: 18, paddingVertical: 9, borderRadius: R.sm },
  saveText: { color: C.onPrimary, fontSize: 13, fontWeight: '700' },
  transcriptRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, marginTop: 10 },
  transcript: { flex: 1, fontSize: 12, color: C.text2, fontStyle: 'italic', lineHeight: 17 },
}));

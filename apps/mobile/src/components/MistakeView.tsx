import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import { Audio } from 'expo-av';
import { useMistakeStore, Mistake } from '@/store/mistakeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useAiStore } from '@/store/aiStore';
import { transcribeAudio } from '@/lib/stt';

// 错题本：拍照/相册 → 压缩 → 学科/标签/语音反思 → 本地入库 + 云端同步
const SUBJECTS = ['数学', '语文', '英语', '物理', '化学', '生物', '历史', '地理', '政治'] as const;

// 压缩到 ≤1080px JPEG（约 100-300KB），并拷贝到文档目录持久化（临时目录会被系统清理）
async function persistImage(tempUri: string): Promise<string> {
  const manipulated = await ImageManipulator.manipulateAsync(
    tempUri,
    [{ resize: { width: 1080 } }],
    { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
  );
  const dest = `${FileSystem.documentDirectory}mistakes/${Date.now()}.jpg`;
  await FileSystem.makeDirectoryAsync(FileSystem.documentDirectory + 'mistakes', { intermediates: true }).catch(() => {});
  await FileSystem.copyAsync({ from: manipulated.uri, to: dest });
  return dest;
}

async function persistAudio(tempUri: string): Promise<string> {
  const dest = `${FileSystem.documentDirectory}mistakes/${Date.now()}.m4a`;
  await FileSystem.makeDirectoryAsync(FileSystem.documentDirectory + 'mistakes', { intermediates: true }).catch(() => {});
  await FileSystem.copyAsync({ from: tempUri, to: dest });
  return dest;
}

export function MistakeView() {
  const { mistakes, addMistake, removeMistake, syncAll, markCorrect, setTranscript } = useMistakeStore();
  const { webApiUrl, accessKey, llmBaseUrl, llmApiKey, sttBaseUrl, sttApiKey, sttModel } = useSettingsStore();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [subject, setSubject] = useState<string>('数学');
  const [tagsDraft, setTagsDraft] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [voiceUri, setVoiceUri] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [detail, setDetail] = useState<Mistake | null>(null);
  const [sound, setSound] = useState<Audio.Sound | null>(null);
  const [transcribing, setTranscribing] = useState(false);

  // 语音备忘转文字：结果落 mistakeStore（AI 讲解上下文 + 画像情绪词来源）
  const transcribe = async (m: Mistake) => {
    const uri = m.voiceUri ?? m.voiceUrl;
    if (!uri) return;
    setTranscribing(true);
    try {
      const text = await transcribeAudio(uri, {
        baseUrl: sttBaseUrl || llmBaseUrl, // 未单独配置时回退 LLM 服务（DeepSeek 无 ASR，需另配）
        apiKey: sttApiKey || llmApiKey,
        model: sttModel,
      });
      setTranscript(m.id, text);
      setDetail(useMistakeStore.getState().mistakes.find((x) => x.id === m.id) ?? null);
    } catch (e) {
      Alert.alert('转写失败', (e as Error).message);
    } finally {
      setTranscribing(false);
    }
  };

  // 错题 AI 讲解：学科/卡壳标签/语音反思转写/重做结果 组装上下文，唤起悬浮球对话
  // 局限：当前多模态未接入，AI 看不到错题图片，讲解质量依赖转写与标签
  const askAi = (m: Mistake) => {
    const parts = [`学科：${m.subject}`];
    if (m.tags.length > 0) parts.push(`卡壳点：${m.tags.join('、')}`);
    if (m.transcript) parts.push(`我的语音反思：${m.transcript}`);
    if (m.correct) parts.push(`重做结果：${m.correct === 'right' ? '重做已能做对' : '重做仍然做错'}`);
    const ai = useAiStore.getState();
    ai.open();
    ai.ask(
      `我在一道${m.subject}错题上卡住了，请讲解这类题的解题思路、常见陷阱，并给 2 个针对性练习方向。信息如下：\n${parts.join('\n')}\n（注：你看不到错题图片本身，请基于以上信息与该学科常见题型讲解）`
    );
  };

  const unsynced = mistakes.filter((m) => !m.synced).length;

  const pick = async (useCamera: boolean) => {
    setPickerOpen(false);
    const perm = useCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('需要权限', '请在系统设置中允许访问相机/相册');
      return;
    }
    const result = useCamera
      ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (!result.canceled && result.assets[0]) setImageUri(result.assets[0].uri);
  };

  const toggleRecord = async () => {
    if (recording) {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (uri) setVoiceUri(await persistAudio(uri));
      return;
    }
    const perm = await Audio.requestPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('需要权限', '请在系统设置中允许录音');
      return;
    }
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const { recording: rec } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(rec);
  };

  const playVoice = async (m: Mistake) => {
    if (!m.voiceUri && !m.voiceUrl) return;
    try {
      await sound?.unloadAsync();
      const { sound: s } = await Audio.Sound.createAsync({ uri: m.voiceUri ?? m.voiceUrl! });
      setSound(s);
      await s.playAsync();
    } catch {
      Alert.alert('播放失败', '语音文件不可用');
    }
  };

  const save = async () => {
    if (!imageUri) {
      Alert.alert('缺少图片', '请先拍照或选择错题图片');
      return;
    }
    setSaving(true);
    try {
      const persisted = await persistImage(imageUri);
      const tags = tagsDraft
        .split(/[,\s，]+/)
        .map((t) => t.trim().replace(/^#/, ''))
        .filter(Boolean);
      addMistake({
        subject,
        tags,
        imageUri: persisted,
        voiceUri: voiceUri ?? undefined,
        createdAt: new Date().toISOString(),
      });
      // 重置表单
      setImageUri(null);
      setTagsDraft('');
      setVoiceUri(null);
      setPickerOpen(false);
      setDetail(null);
      Alert.alert('✅ 已入库', `错题已保存到本地（${subject}）。\n云端同步可在下方点击「同步到云端」。`);
    } catch (e) {
      Alert.alert('保存失败', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const { ok, fail } = await syncAll(webApiUrl, accessKey);
      Alert.alert('同步完成', `成功 ${ok} 条${fail ? `，失败 ${fail} 条（将自动重试）` : ''}`);
    } catch (e) {
      Alert.alert('同步失败', (e as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {/* 新增入口 */}
      <TouchableOpacity style={styles.addBtn} onPress={() => setPickerOpen(true)}>
        <Text style={styles.addBtnText}>📷 收录错题</Text>
        <Text style={styles.addHint}>拍照或相册 → 学科标签 → 语音反思</Text>
      </TouchableOpacity>

      {/* 云同步 */}
      <TouchableOpacity style={[styles.syncBtn, unsynced === 0 && styles.syncBtnDone]} onPress={sync} disabled={syncing}>
        {syncing ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.syncBtnText}>
            ☁️ {unsynced > 0 ? `同步到云端（${unsynced} 条待传）` : '已全部同步'}
          </Text>
        )}
      </TouchableOpacity>

      {/* 列表 */}
      {mistakes.length === 0 ? (
        <Text style={styles.empty}>还没有错题。考完一张卷子，第一时间把错题拍进来。</Text>
      ) : (
        mistakes.map((m) => (
          <TouchableOpacity key={m.id} style={styles.card} onPress={() => setDetail(m)}>
            {m.imageUri ? (
              <Image source={{ uri: m.imageUri }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]} />
            )}
            <View style={styles.cardInfo}>
              <Text style={styles.cardSubject}>
                {m.subject}
                <Text style={styles.syncTag}>{m.synced ? '  ✅' : '  ⏳'}</Text>
              </Text>
              <Text style={styles.cardTags} numberOfLines={2}>
                {m.tags.map((t) => `#${t}`).join(' ') || '无标签'}
              </Text>
              <Text style={styles.cardDate}>{m.createdAt.slice(0, 10)}{m.voiceUri || m.voiceUrl ? ' · 🎤' : ''}</Text>
            </View>
          </TouchableOpacity>
        ))
      )}

      {/* 详情弹窗 */}
      <Modal visible={!!detail} animationType="slide" onRequestClose={() => setDetail(null)}>
        <ScrollView style={styles.detail}>
          <TouchableOpacity style={styles.closeBtn} onPress={() => setDetail(null)}>
            <Text style={styles.closeBtnText}>← 返回</Text>
          </TouchableOpacity>
          {detail && (
            <>
              {detail.imageUri && (
                <Image source={{ uri: detail.imageUri }} style={styles.detailImage} resizeMode="contain" />
              )}
              <Text style={styles.detailMeta}>
                {detail.subject} · {detail.createdAt.slice(0, 10)}
                {detail.synced ? ' · 已同步' : ' · 未同步'}
              </Text>
              <View style={styles.tagRow}>
                {detail.tags.map((t) => (
                  <View key={t} style={styles.tag}>
                    <Text style={styles.tagText}>#{t}</Text>
                  </View>
                ))}
              </View>
              {(detail.voiceUri || detail.voiceUrl) && (
                <TouchableOpacity style={styles.playBtn} onPress={() => playVoice(detail)}>
                  <Text style={styles.playBtnText}>▶️ 播放语音反思</Text>
                </TouchableOpacity>
              )}

              {/* 语音备忘转文字 + AI 讲解 */}
              {(detail.voiceUri || detail.voiceUrl || detail.transcript) && (
                <>
                  {(detail.voiceUri || detail.voiceUrl) && (
                    <TouchableOpacity style={styles.playBtn} onPress={() => transcribe(detail)} disabled={transcribing}>
                      {transcribing ? (
                        <ActivityIndicator size="small" color="#111" />
                      ) : (
                        <Text style={styles.playBtnText}>{detail.transcript ? '🔁 重新转写语音' : '📝 语音转文字'}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  {!!detail.transcript && (
                    <View style={styles.transcriptBox}>
                      <Text style={styles.transcriptLabel}>语音反思转写</Text>
                      <Text style={styles.transcriptText}>{detail.transcript}</Text>
                    </View>
                  )}
                </>
              )}
              <TouchableOpacity style={styles.aiBtn} onPress={() => askAi(detail)}>
                <Text style={styles.aiBtnText}>🤖 AI 讲解这道错题</Text>
                <Text style={styles.aiHint}>{detail.transcript ? '基于转写反思 + 卡壳标签' : '建议先语音转文字，讲解更精准'}</Text>
              </TouchableOpacity>

              <Text style={styles.fieldLabel}>重做结果（喂画像「学科掌握」维度）</Text>
              <View style={styles.resultRow}>
                <TouchableOpacity
                  style={[styles.resultBtn, detail.correct === 'right' && styles.resultRight]}
                  onPress={() => markCorrect(detail.id, 'right', webApiUrl, accessKey)}
                >
                  <Text style={[styles.resultText, detail.correct === 'right' && styles.resultTextActive]}>
                    ✅ 重做正确
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.resultBtn, detail.correct === 'wrong' && styles.resultWrong]}
                  onPress={() => markCorrect(detail.id, 'wrong', webApiUrl, accessKey)}
                >
                  <Text style={[styles.resultText, detail.correct === 'wrong' && styles.resultTextActive]}>
                    ❌ 仍然做错
                  </Text>
                </TouchableOpacity>
              </View>
              {!detail.cloudId && <Text style={styles.syncHint}>条目尚未同步到云端，掌握度先记录在本地</Text>}
              <TouchableOpacity style={styles.deleteBtn} onPress={() => {
                removeMistake(detail.id);
                setDetail(null);
              }}>
                <Text style={styles.deleteBtnText}>删除该错题</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </Modal>

      {/* 收录弹窗 */}
      <Modal visible={pickerOpen} animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <ScrollView style={styles.detail}>
          <TouchableOpacity style={styles.closeBtn} onPress={() => setPickerOpen(false)}>
            <Text style={styles.closeBtnText}>← 取消</Text>
          </TouchableOpacity>
          {imageUri ? (
            <Image source={{ uri: imageUri }} style={styles.detailImage} resizeMode="contain" />
          ) : (
            <View style={styles.pickRow}>
              <TouchableOpacity style={styles.pickBtn} onPress={() => pick(true)}>
                <Text style={styles.pickBtnText}>📷 拍照</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.pickBtn} onPress={() => pick(false)}>
                <Text style={styles.pickBtnText}>🖼 相册</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.fieldLabel}>学科</Text>
          <View style={styles.subjectRow}>
            {SUBJECTS.map((s) => (
              <TouchableOpacity key={s} style={[styles.subjectChip, subject === s && styles.subjectChipActive]} onPress={() => setSubject(s)}>
                <Text style={[styles.subjectText, subject === s && styles.subjectTextActive]}>{s}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>卡壳标签（空格分隔，喂给画像词云）</Text>
          <TextInput
            style={styles.input}
            placeholder="如：导数 设辅助函数 计算失误"
            placeholderTextColor="#999"
            value={tagsDraft}
            onChangeText={setTagsDraft}
            multiline
          />

          <Text style={styles.fieldLabel}>语音反思（可选，≤1 分钟）</Text>
          <TouchableOpacity style={[styles.recordBtn, recording && styles.recordBtnActive]} onPress={toggleRecord}>
            <Text style={styles.recordBtnText}>{recording ? '⏹ 停止录音' : voiceUri ? '🎤 已录制 · 点按重录' : '🎤 开始录音'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>✅ 保存错题</Text>}
          </TouchableOpacity>
        </ScrollView>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  addBtn: { backgroundColor: '#111', borderRadius: 14, padding: 16, alignItems: 'center' },
  addBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  addHint: { color: '#bbb', fontSize: 12, marginTop: 4 },
  syncBtn: { backgroundColor: '#2563eb', borderRadius: 12, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  syncBtnDone: { backgroundColor: '#94a3b8' },
  syncBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  empty: { color: '#999', fontSize: 13, lineHeight: 22, marginTop: 20, textAlign: 'center' },
  card: { flexDirection: 'row', backgroundColor: '#fff', borderRadius: 12, padding: 10, marginTop: 10, alignItems: 'center' },
  thumb: { width: 72, height: 72, borderRadius: 8, backgroundColor: '#f0f1f3' },
  thumbPlaceholder: {},
  cardInfo: { flex: 1, marginLeft: 12 },
  cardSubject: { fontSize: 15, fontWeight: '700', color: '#111' },
  syncTag: { fontSize: 11, fontWeight: '400' },
  cardTags: { fontSize: 12, color: '#2563eb', marginTop: 4 },
  cardDate: { fontSize: 11, color: '#aaa', marginTop: 4 },
  detail: { flex: 1, padding: 16, backgroundColor: '#fafafa' },
  closeBtn: { paddingVertical: 10, marginBottom: 8 },
  closeBtnText: { fontSize: 15, color: '#2563eb' },
  detailImage: { width: '100%', height: 320, borderRadius: 12, backgroundColor: '#fff', marginBottom: 12 },
  detailMeta: { fontSize: 14, color: '#555', marginTop: 4 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  tag: { backgroundColor: '#eef2ff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  tagText: { color: '#3730a3', fontSize: 12 },
  playBtn: { backgroundColor: '#fff', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 14, borderWidth: 1, borderColor: '#e5e7eb' },
  playBtnText: { fontSize: 14, color: '#111' },
  // 语音转写结果
  transcriptBox: { backgroundColor: '#f8fafc', borderRadius: 12, padding: 12, marginTop: 10, borderLeftWidth: 3, borderLeftColor: '#2563eb' },
  transcriptLabel: { fontSize: 12, color: '#888', marginBottom: 4 },
  transcriptText: { fontSize: 14, color: '#333', lineHeight: 22 },
  aiBtn: { backgroundColor: '#111', borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 14 },
  aiBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  aiHint: { color: '#999', fontSize: 11, marginTop: 4 },
  deleteBtn: { alignItems: 'center', padding: 14, marginTop: 24 },
  deleteBtnText: { color: '#c0392b', fontSize: 14 },
  // 重做结果
  resultRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  resultBtn: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  resultRight: { backgroundColor: '#f0f9f2', borderColor: '#1c7d2c' },
  resultWrong: { backgroundColor: '#fef2f2', borderColor: '#c0392b' },
  resultText: { fontSize: 14, color: '#555' },
  resultTextActive: { fontWeight: '700', color: '#111' },
  syncHint: { fontSize: 12, color: '#aaa', marginTop: 8 },
  pickRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  pickBtn: { flex: 1, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 12, paddingVertical: 22, alignItems: 'center' },
  pickBtnText: { fontSize: 15, color: '#111' },
  fieldLabel: { fontSize: 14, fontWeight: '700', color: '#333', marginTop: 18, marginBottom: 8 },
  subjectRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  subjectChip: { borderWidth: 1, borderColor: '#ddd', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  subjectChipActive: { backgroundColor: '#111', borderColor: '#111' },
  subjectText: { fontSize: 13, color: '#555' },
  subjectTextActive: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12, fontSize: 14, minHeight: 60, textAlignVertical: 'top', color: '#111' },
  recordBtn: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  recordBtnActive: { backgroundColor: '#fee2e2', borderColor: '#fca5a5' },
  recordBtnText: { fontSize: 14, color: '#111' },
  saveBtn: { backgroundColor: '#111', borderRadius: 12, paddingVertical: 16, alignItems: 'center', marginTop: 24, marginBottom: 40 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});

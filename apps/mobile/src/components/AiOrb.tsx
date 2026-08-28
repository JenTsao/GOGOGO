import {
  View,
  StyleSheet,
  Modal,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system';
import { useAiStore, STATUS_EMOTION } from '@/store/aiStore';
import { useSettingsStore } from '@/store/settingsStore';
import { describeToolCall } from '@/lib/aiTools';
import { C, R, cardShadow } from '@/theme';

// 本地 asset（需 metro.config.js 把 html 列入 assetExts）+ 远程兜底
const BALL_MODULE = require('../../assets/grok-ball/ball.html');
const BALL_REMOTE =
  'https://raw.githubusercontent.com/JenTsao/GOGOGO/main/apps/mobile/assets/grok-ball/ball.html';

// AI 悬浮球：完整 grok-ball（32 表情）+ 多供应商 LLM 对话
export function AiOrb() {
  const { visible, status, open, close, messages, ask, confirmToolCall, cancelToolCall } = useAiStore();
  const { llmModel } = useSettingsStore();
  const webviewRef = useRef<WebView>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [ready, setReady] = useState(false);
  const [orbFailed, setOrbFailed] = useState(false);
  // html 字符串注入最稳；失败再退到 remote uri；再失败才静态占位
  const [ballSource, setBallSource] = useState<
    { html: string } | { uri: string } | null
  >(null);
  const [input, setInput] = useState('');
  const insets = useSafeAreaInsets();
  const busy = status === 'thinking' || status === 'searching' || status === 'generating';

  const post = (obj: Record<string, unknown>) =>
    webviewRef.current?.postMessage(JSON.stringify(obj));

  // 解析 ball：本地 asset → 读成字符串 → source={{ html }}；失败则用 GitHub raw
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const asset = Asset.fromModule(BALL_MODULE);
        await asset.downloadAsync();
        const uri = asset.localUri || asset.uri;
        if (uri) {
          const html = await FileSystem.readAsStringAsync(uri);
          if (html && html.includes('GrokBall') && !cancelled) {
            setBallSource({ html });
            return;
          }
        }
      } catch {
        // fall through to remote
      }
      if (!cancelled) setBallSource({ uri: BALL_REMOTE });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (ready) post({ type: 'emotion', id: STATUS_EMOTION[status] });
  }, [status, ready]);

  const send = () => {
    if (!input.trim() || busy) return;
    ask(input);
    setInput('');
  };

  return (
    <>
      <View style={[styles.orbWrap, cardShadow]} pointerEvents="box-none">
        {orbFailed || !ballSource ? (
          <TouchableOpacity style={styles.orbFallback} onPress={open} activeOpacity={0.85}>
            <Ionicons name="sparkles" size={30} color="#f5f5f5" />
          </TouchableOpacity>
        ) : (
          <WebView
            ref={webviewRef}
            source={
              'html' in ballSource
                ? { html: ballSource.html, baseUrl: '' }
                : { uri: ballSource.uri }
            }
            style={styles.orb}
            containerStyle={styles.orbContainer}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            scrollEnabled={false}
            bounces={false}
            overScrollMode="never"
            setSupportMultipleWindows={false}
            androidLayerType="hardware"
            {...(Platform.OS === 'android' ? { mixedContentMode: 'always' as const } : {})}
            onError={() => {
              // 本地 html 失败时再试远程；远程也失败才占位
              if (ballSource && 'html' in ballSource) {
                setBallSource({ uri: BALL_REMOTE });
                setReady(false);
              } else {
                setOrbFailed(true);
              }
            }}
            onHttpError={() => {
              if (ballSource && 'html' in ballSource) {
                setBallSource({ uri: BALL_REMOTE });
                setReady(false);
              } else {
                setOrbFailed(true);
              }
            }}
            onMessage={(e) => {
              let msg: { type: string };
              try {
                msg = JSON.parse(e.nativeEvent.data);
              } catch {
                return;
              }
              if (msg.type === 'tap') open();
              if (msg.type === 'ready') {
                setReady(true);
                post({ type: 'emotion', id: STATUS_EMOTION.idle });
              }
            }}
          />
        )}
      </View>

      <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
        <KeyboardAvoidingView
          style={styles.sheetWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
            <View style={styles.gripBar}>
              <View style={styles.grip} />
            </View>
            <View style={styles.header}>
              <View style={styles.headerLeft}>
                <View style={styles.headerDot} />
                <View>
                  <Text style={styles.title}>高考副驾驶</Text>
                  <Text style={styles.subtitle} numberOfLines={1}>
                    {busy ? '思考中…' : llmModel || '在线'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={close}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="close" size={22} color={C.text2} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.messages}
              ref={scrollRef}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {messages.length === 0 && (
                <View style={styles.placeholderCard}>
                  <Ionicons name="chatbubbles-outline" size={28} color={C.primary} />
                  <Text style={styles.placeholder}>随点随到。先在「我的」配置 API Key；试试：</Text>
                  <Text style={styles.placeholderExample}>
                    “帮我规划今晚的数学复习”{'\n'}“讲讲导数构造函数”
                  </Text>
                </View>
              )}
              {messages.map((m, i) => (
                <View key={i} style={m.role === 'user' ? styles.rowUser : styles.rowAssistant}>
                  <View
                    style={[styles.bubble, m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}
                  >
                    <Text style={m.role === 'user' ? styles.bubbleUserText : styles.bubbleAssistantText}>
                      {m.content}
                    </Text>
                  </View>
                  {m.toolCall?.state === 'pending' && (
                    <View style={styles.confirmCard}>
                      <View style={styles.confirmHead}>
                        <Ionicons name="settings-outline" size={15} color={C.orange} />
                        <Text style={styles.confirmTitle}>操作确认</Text>
                      </View>
                      <Text style={styles.confirmText}>
                        {describeToolCall(m.toolCall.name, m.toolCall.args)}
                      </Text>
                      <View style={styles.confirmRow}>
                        <TouchableOpacity
                          style={styles.confirmBtnOk}
                          onPress={() => confirmToolCall(m.toolCall!.id)}
                        >
                          <Ionicons name="checkmark" size={15} color="#fff" />
                          <Text style={styles.confirmBtnOkText}>确认执行</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.confirmBtnNo}
                          onPress={() => cancelToolCall(m.toolCall!.id)}
                        >
                          <Text style={styles.confirmBtnNoText}>取消</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
                  {m.toolCall?.state === 'confirmed' && (
                    <View style={styles.toolDone}>
                      <Ionicons name="checkmark-circle" size={13} color={C.green} />
                      <Text style={styles.toolDoneText}>已执行</Text>
                    </View>
                  )}
                  {m.toolCall?.state === 'cancelled' && (
                    <View style={styles.toolDone}>
                      <Ionicons name="close-circle" size={13} color={C.text3} />
                      <Text style={styles.toolDoneText}>已取消</Text>
                    </View>
                  )}
                </View>
              ))}
              {busy && (
                <View style={styles.rowAssistant}>
                  <View style={[styles.bubble, styles.bubbleAssistant, styles.typingBubble]}>
                    <ActivityIndicator size="small" color={C.primary} />
                    <Text style={styles.typingText}>
                      {status === 'searching'
                        ? '检索资料中…'
                        : status === 'generating'
                          ? '生成回复中…'
                          : '思考中…'}
                    </Text>
                  </View>
                </View>
              )}
            </ScrollView>

            <View style={styles.inputRow}>
              <TextInput
                style={styles.input}
                placeholder={busy ? '思考中…' : '问问 AI…'}
                placeholderTextColor={C.text3}
                value={input}
                onChangeText={setInput}
                editable={!busy}
                onSubmitEditing={send}
                returnKeyType="send"
                multiline
              />
              <TouchableOpacity
                style={[styles.sendBtn, (!input.trim() || busy) && styles.sendBtnDisabled]}
                onPress={send}
                disabled={!input.trim() || busy}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Ionicons name="arrow-up" size={20} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  orbWrap: {
    position: 'absolute',
    right: 16,
    bottom: 24,
    width: 75,
    height: 75,
    borderRadius: 37.5,
    zIndex: 100,
    overflow: 'hidden',
  },
  orb: {
    width: 75,
    height: 75,
    backgroundColor: 'transparent',
    borderRadius: 37.5,
  },
  orbContainer: {
    backgroundColor: 'transparent',
  },
  orbFallback: {
    width: 75,
    height: 75,
    borderRadius: 37.5,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(18,14,34,0.45)' },
  sheet: {
    maxHeight: '86%',
    backgroundColor: C.bg,
    borderTopLeftRadius: R.lg,
    borderTopRightRadius: R.lg,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  gripBar: { alignItems: 'center', paddingVertical: 8 },
  grip: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: C.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 17, fontWeight: '700', color: C.text },
  subtitle: { fontSize: 12, color: C.text3, marginTop: 1 },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: C.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messages: { flex: 1, marginTop: 12 },
  placeholderCard: {
    alignItems: 'center',
    backgroundColor: C.primarySoft,
    borderRadius: R.md,
    padding: 24,
    marginTop: 24,
    gap: 10,
  },
  placeholder: { color: C.text2, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  placeholderExample: {
    color: C.primaryDeep,
    fontSize: 14,
    lineHeight: 24,
    fontWeight: '600',
    textAlign: 'center',
  },
  rowUser: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10 },
  rowAssistant: { flexDirection: 'row', justifyContent: 'flex-start', marginBottom: 10 },
  bubble: { borderRadius: R.md, paddingVertical: 10, paddingHorizontal: 14, maxWidth: '86%' },
  bubbleUser: { backgroundColor: C.primary, borderBottomRightRadius: 4 },
  bubbleUserText: { color: '#fff', fontSize: 14, lineHeight: 21 },
  bubbleAssistant: { backgroundColor: C.card, borderBottomLeftRadius: 4, ...cardShadow },
  bubbleAssistantText: { color: C.text, fontSize: 14, lineHeight: 21 },
  typingBubble: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  typingText: { color: C.text2, fontSize: 13 },
  confirmCard: {
    backgroundColor: C.orangeSoft,
    borderLeftWidth: 4,
    borderLeftColor: C.orange,
    borderRadius: R.md,
    padding: 12,
    marginTop: 6,
  },
  confirmHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  confirmTitle: { fontSize: 12, fontWeight: '700', color: C.orange },
  confirmText: { fontSize: 14, color: '#6b5414', lineHeight: 20 },
  confirmRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  confirmBtnOk: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: R.sm,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    backgroundColor: C.primary,
  },
  confirmBtnOkText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  confirmBtnNo: {
    flex: 1,
    borderRadius: R.sm,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.card,
  },
  confirmBtnNoText: { color: C.text2, fontSize: 13, fontWeight: '600' },
  toolDone: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  toolDoneText: { fontSize: 12, color: C.text3 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginTop: 10 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.pill,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    fontSize: 15,
    backgroundColor: C.card,
    color: C.text,
    maxHeight: 100,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { backgroundColor: C.border },
});

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
  PanResponder,
  useWindowDimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import { useAiStore, STATUS_EMOTION } from '@/store/aiStore';
import { useSettingsStore } from '@/store/settingsStore';
import { describeToolCall } from '@/lib/aiTools';
import { C, R, cardShadow } from '@/theme';

const ORB_SIZE = 75;
const EDGE = 8;

// 完整 grok-ball（32 表情）HTML：优先国内 CDN，首次成功后本地缓存
const BALL_URLS = [
  'https://cdn.jsdelivr.net/gh/JenTsao/GOGOGO@main/apps/mobile/assets/grok-ball/ball.html',
  'https://fastly.jsdelivr.net/gh/JenTsao/GOGOGO@main/apps/mobile/assets/grok-ball/ball.html',
  'https://raw.githubusercontent.com/JenTsao/GOGOGO/main/apps/mobile/assets/grok-ball/ball.html',
];
const BALL_CACHE = `${FileSystem.cacheDirectory}grok-ball.html`;

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

export function AiOrb() {
  const { visible, status, open, close, messages, ask, confirmToolCall, cancelToolCall } = useAiStore();
  const { llmModel } = useSettingsStore();
  const webviewRef = useRef<WebView>(null);
  const scrollRef = useRef<ScrollView>(null);
  const [ready, setReady] = useState(false);
  const [orbFailed, setOrbFailed] = useState(false);
  const [ballHtml, setBallHtml] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const insets = useSafeAreaInsets();
  const busy = status === 'thinking' || status === 'searching' || status === 'generating';

  // 响应式视口：分屏/旋屏/折叠屏尺寸变化时拖拽边界与初始位置都随之更新
  const { width: sw, height: sh } = useWindowDimensions();
  // 默认右下角（避开底部 Tab 栏内容高 60 + 手势条安全区；与 _layout 的 TAB_BAR_CONTENT_HEIGHT 保持一致）
  const [pos, setPos] = useState({
    x: sw - EDGE - ORB_SIZE - 8,
    y: sh - insets.bottom - 60 - ORB_SIZE - 8,
  });
  const posRef = useRef(pos);
  posRef.current = pos;
  const dragOrigin = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);

  const post = (obj: Record<string, unknown>) =>
    webviewRef.current?.postMessage(JSON.stringify(obj));

  // 自由拖动：移动超过阈值算拖拽，松手未明显移动则打开对话
  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
        onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 3 || Math.abs(g.dy) > 3,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          movedRef.current = false;
          dragOrigin.current = { ...posRef.current };
        },
        onPanResponderMove: (_, g) => {
          if (Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6) movedRef.current = true;
          const maxX = sw - ORB_SIZE - EDGE;
          const maxY = sh - ORB_SIZE - Math.max(insets.bottom, EDGE);
          const minY = Math.max(insets.top, EDGE);
          setPos({
            x: clamp(dragOrigin.current.x + g.dx, EDGE, maxX),
            y: clamp(dragOrigin.current.y + g.dy, minY, maxY),
          });
        },
        onPanResponderRelease: (_, g) => {
          if (!movedRef.current && Math.abs(g.dx) < 8 && Math.abs(g.dy) < 8) {
            open();
          }
        },
      }),
    [sw, sh, insets.top, insets.bottom, open]
  );

  // 视口尺寸变化后把悬浮球拉回可视范围（避免停在新边界外不可拖回）
  useEffect(() => {
    setPos((p) => ({
      x: clamp(p.x, EDGE, Math.max(EDGE, sw - ORB_SIZE - EDGE)),
      y: clamp(
        p.y,
        Math.max(insets.top, EDGE),
        Math.max(Math.max(insets.top, EDGE), sh - ORB_SIZE - Math.max(insets.bottom, EDGE))
      ),
    }));
  }, [sw, sh, insets.top, insets.bottom]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await FileSystem.getInfoAsync(BALL_CACHE);
        if (info.exists) {
          const cached = await FileSystem.readAsStringAsync(BALL_CACHE);
          if (cached.includes('GrokBall') && !cancelled) {
            setBallHtml(cached);
            return;
          }
        }
      } catch {
        // ignore
      }

      for (const url of BALL_URLS) {
        try {
          const res = await fetch(url);
          if (!res.ok) continue;
          const html = await res.text();
          if (!html.includes('GrokBall')) continue;
          try {
            await FileSystem.writeAsStringAsync(BALL_CACHE, html);
          } catch {
            // optional
          }
          if (!cancelled) setBallHtml(html);
          return;
        } catch {
          // next
        }
      }

      if (!cancelled) setOrbFailed(true);
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
      <View
        style={[styles.orbWrap, cardShadow, { left: pos.x, top: pos.y }]}
        {...panResponder.panHandlers}
      >
        {orbFailed || !ballHtml ? (
          <View style={styles.orbFallback}>
            <View style={styles.orbLoading}>
              {!orbFailed ? (
                <ActivityIndicator size="small" color="#f5f5f5" />
              ) : (
                <Ionicons name="sparkles" size={30} color="#f5f5f5" />
              )}
            </View>
          </View>
        ) : (
          <WebView
            ref={webviewRef}
            source={{ html: ballHtml, baseUrl: 'https://localhost/' }}
            style={styles.orb}
            containerStyle={styles.orbContainer}
            // 触摸由外层 PanResponder 接管，避免 WebView 吞掉拖动手势
            pointerEvents="none"
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
            nestedScrollEnabled={false}
            {...(Platform.OS === 'android' ? { mixedContentMode: 'always' as const } : {})}
            onError={() => setOrbFailed(true)}
            onHttpError={() => setOrbFailed(true)}
            onMessage={(e) => {
              let msg: { type: string };
              try {
                msg = JSON.parse(e.nativeEvent.data);
              } catch {
                return;
              }
              if (msg.type === 'ready') {
                setReady(true);
                post({ type: 'emotion', id: STATUS_EMOTION.idle });
              }
            }}
          />
        )}
      </View>

      <Modal
        visible={visible}
        animationType="slide"
        transparent
        statusBarTranslucent // 半透明遮罩盖到状态栏区，顶部不留未压暗缝隙
        onRequestClose={close}
      >
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
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    zIndex: 100,
    overflow: 'hidden',
  },
  orb: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    backgroundColor: 'transparent',
    borderRadius: ORB_SIZE / 2,
  },
  orbContainer: {
    backgroundColor: 'transparent',
  },
  orbFallback: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbLoading: {
    width: ORB_SIZE,
    height: ORB_SIZE,
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

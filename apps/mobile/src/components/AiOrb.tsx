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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as FileSystem from 'expo-file-system';
import { BlurView } from 'expo-blur';
import { useAiStore, STATUS_EMOTION } from '@/store/aiStore';
import { useSettingsStore } from '@/store/settingsStore';
import { describeToolCall } from '@/lib/aiTools';
import {
  R,
  cardShadow,
  GLASS_BLUR,
  glassShadowFor,
  HIT_SLOP,
  themedStyles,
  usePalette,
  useScheme,
  type Scheme,
} from '@/theme';

const ORB_SIZE = 75;
const SHEET_ORB_SIZE = 44;
const EDGE = 8;

const BALL_URLS = [
  'https://cdn.jsdelivr.net/gh/JenTsao/GOGOGO@main/apps/mobile/assets/grok-ball/ball.html',
  'https://fastly.jsdelivr.net/gh/JenTsao/GOGOGO@main/apps/mobile/assets/grok-ball/ball.html',
  'https://raw.githubusercontent.com/JenTsao/GOGOGO/main/apps/mobile/assets/grok-ball/ball.html',
];
// v2：缓存键 bump，避免旧 HTML 无 theme 桥
const BALL_CACHE = `${FileSystem.cacheDirectory}grok-ball-v2.html`;

type OrbMode = 'black' | 'white';

function clamp(v: number, min: number, max: number) {
  return Math.min(Math.max(v, min), max);
}

function resolveOrbMode(orbStyle: 'auto' | 'black' | 'white', scheme: Scheme): OrbMode {
  if (orbStyle === 'black' || orbStyle === 'white') return orbStyle;
  // auto：浅色页用黑球、深色页用白球，对比更清晰
  return scheme === 'dark' ? 'white' : 'black';
}

/** 注入白/黑球主题与 message 桥；按尺寸改 CSS，聊天头用 44px */
function prepareBallHtml(raw: string, mode: OrbMode, size: number): string {
  const color = mode === 'white' ? '#F3F0EA' : '#1a1a1a';
  const eye = mode === 'white' ? '#1A1A1A' : '#f5f5f5';
  const eyeScale = size <= 48 ? 1.55 : 1.4;
  let html = raw;
  // 尺寸：匹配 ball.html 里 #ball { ... width:75px; height:75px; ... }
  html = html.replace(
    /#ball\s*\{[^}]*width:\s*\d+px;\s*height:\s*\d+px;/i,
    `#ball { position:fixed; right:0; bottom:0; width:${size}px; height:${size}px;`
  );
  // 初始主题：匹配 GrokBall.create(...)
  html = html.replace(
    /GrokBall\.create\s*\(\s*['"]#ball['"]\s*,\s*\{[^}]*\}\s*\)/,
    `GrokBall.create('#ball', { emotion:'02', color:'${color}', eyeColor:'${eye}', eyeScale: ${eyeScale} })`
  );
  // 运行时主题切换：写 engine._theme（与构造时 color 同源）
  if (!html.includes("msg.type === 'theme'")) {
    html = html.replace(
      "if (msg.type === 'emotion' && msg.id) engine.setEmotion(msg.id);",
      "if (msg.type === 'emotion' && msg.id) engine.setEmotion(msg.id);\n" +
        "    else if (msg.type === 'theme') {\n" +
        "      var tm = msg.mode === 'white'\n" +
        "        ? { body: '#F3F0EA', eyes: '#1A1A1A' }\n" +
        "        : { body: '#1a1a1a', eyes: '#f5f5f5' };\n" +
        "      engine._theme = tm;\n" +
        "    }"
    );
  }
  return html;
}

type BallViewProps = {
  html: string;
  size: number;
  emotionId: string;
  mode: OrbMode;
  onReady?: () => void;
  onFail?: () => void;
  webRef?: React.MutableRefObject<WebView | null>;
};

function BallView({ html, size, emotionId, mode, onReady, onFail, webRef }: BallViewProps) {
  const localRef = useRef<WebView>(null);
  const ref = webRef ?? localRef;
  const readyRef = useRef(false);

  const post = useCallback((obj: Record<string, unknown>) => {
    ref.current?.postMessage(JSON.stringify(obj));
  }, [ref]);

  useEffect(() => {
    if (readyRef.current) {
      post({ type: 'emotion', id: emotionId });
    }
  }, [emotionId, post]);

  useEffect(() => {
    if (readyRef.current) {
      post({ type: 'theme', mode });
    }
  }, [mode, post]);

  return (
    <WebView
      ref={ref}
      source={{ html, baseUrl: 'https://localhost/' }}
      style={{ width: size, height: size, backgroundColor: 'transparent' }}
      containerStyle={{ backgroundColor: 'transparent' }}
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
      onError={() => onFail?.()}
      onHttpError={() => onFail?.()}
      onMessage={(e) => {
        let msg: { type: string };
        try {
          msg = JSON.parse(e.nativeEvent.data);
        } catch {
          return;
        }
        if (msg.type === 'ready') {
          readyRef.current = true;
          post({ type: 'theme', mode });
          post({ type: 'emotion', id: emotionId });
          onReady?.();
        }
      }}
    />
  );
}

export function AiOrb() {
  const C = usePalette();
  const scheme = useScheme();
  const styles = STYLES[scheme];
  const { visible, status, open, close, messages, ask, confirmToolCall, cancelToolCall } = useAiStore();
  const { llmModel, orbStyle } = useSettingsStore();
  const scrollRef = useRef<ScrollView>(null);
  const [orbFailed, setOrbFailed] = useState(false);
  const [rawHtml, setRawHtml] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const insets = useSafeAreaInsets();
  const busy = status === 'thinking' || status === 'searching' || status === 'generating';
  const emotionId = STATUS_EMOTION[status];
  const mode = resolveOrbMode(orbStyle, scheme);

  const { width: sw, height: sh } = useWindowDimensions();
  const [pos, setPos] = useState({
    x: sw - EDGE - ORB_SIZE - 8,
    y: sh - insets.bottom - 60 - ORB_SIZE - 8,
  });
  const posRef = useRef(pos);
  posRef.current = pos;
  const dragOrigin = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);

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
            setRawHtml(cached);
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
          if (!cancelled) setRawHtml(html);
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

  const floatHtml = useMemo(
    () => (rawHtml ? prepareBallHtml(rawHtml, mode, ORB_SIZE) : null),
    [rawHtml, mode]
  );
  const sheetHtml = useMemo(
    () => (rawHtml ? prepareBallHtml(rawHtml, mode, SHEET_ORB_SIZE) : null),
    [rawHtml, mode]
  );

  const send = () => {
    if (!input.trim() || busy) return;
    ask(input);
    setInput('');
  };

  const blurIntensity = GLASS_BLUR.sheet[scheme];
  const showBall = !orbFailed && !!floatHtml;

  return (
    <>
      {/* 悬浮球：仅在聊天关闭时显示（Modal 是独立原生窗口，外部球无法叠在聊天上） */}
      {!visible && (
        <View
          style={[styles.orbWrap, cardShadow, { left: pos.x, top: pos.y }]}
          {...panResponder.panHandlers}
        >
          {!showBall ? (
            <View style={styles.orbFallback}>
              {!orbFailed ? (
                <ActivityIndicator size="small" color={C.onPrimary} />
              ) : (
                <Ionicons name="sparkles" size={30} color={C.onPrimary} />
              )}
            </View>
          ) : (
            <BallView
              key={`float-${mode}`}
              html={floatHtml!}
              size={ORB_SIZE}
              emotionId={emotionId}
              mode={mode}
              onFail={() => setOrbFailed(true)}
            />
          )}
        </View>
      )}

      <Modal
        visible={visible}
        animationType="slide"
        transparent
        statusBarTranslucent
        onRequestClose={close}
      >
        <KeyboardAvoidingView
          style={[styles.sheetWrap, { backgroundColor: C.glassDim }]}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View
            style={[
              styles.sheetShell,
              glassShadowFor(scheme),
              { paddingBottom: insets.bottom + 12 },
            ]}
          >
            <BlurView
              intensity={blurIntensity}
              tint={scheme}
              experimentalBlurMethod="dimezisBlurView"
              style={StyleSheet.absoluteFill}
            />
            <View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, { backgroundColor: C.glassSurfaceStrong }]}
            />
            <View
              pointerEvents="none"
              style={[
                styles.sheetHighlight,
                { backgroundColor: scheme === 'dark' ? C.glassHighlightSoft : C.glassHighlight },
              ]}
            />
            <View style={styles.sheetInner}>
              <View style={styles.gripBar}>
                <View style={[styles.grip, { backgroundColor: C.glassBorder }]} />
              </View>
              <View style={styles.header}>
                <View style={styles.headerLeft}>
                  {/* 聊天内 AI 球：嵌在 Modal 里，表情随 status 同步 */}
                  <View
                    style={[
                      styles.sheetOrbFrame,
                      mode === 'white' ? styles.sheetOrbFrameLight : styles.sheetOrbFrameDark,
                    ]}
                  >
                    {sheetHtml ? (
                      <BallView
                        key={`sheet-${mode}`}
                        html={sheetHtml}
                        size={SHEET_ORB_SIZE}
                        emotionId={emotionId}
                        mode={mode}
                      />
                    ) : (
                      <Ionicons name="sparkles" size={20} color={mode === 'white' ? '#1A1A1A' : '#f5f5f5'} />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>高考副驾驶</Text>
                    <Text style={styles.subtitle} numberOfLines={1}>
                      {busy ? '思考中…' : llmModel || '在线'}
                    </Text>
                  </View>
                </View>
                <TouchableOpacity style={styles.closeBtn} onPress={close} hitSlop={HIT_SLOP}>
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
                            <Ionicons name="checkmark" size={15} color={C.onPrimary} />
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
                  <Ionicons name="arrow-up" size={20} color={C.onPrimary} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}

const STYLES = themedStyles((C) => ({
  orbWrap: {
    position: 'absolute',
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    zIndex: 100,
    overflow: 'hidden',
  },
  orbFallback: {
    width: ORB_SIZE,
    height: ORB_SIZE,
    borderRadius: ORB_SIZE / 2,
    backgroundColor: C.ink,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetWrap: { flex: 1, justifyContent: 'flex-end' },
  sheetShell: {
    maxHeight: '86%',
    borderTopLeftRadius: R.xl,
    borderTopRightRadius: R.xl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: 0,
    borderColor: C.glassBorder,
    backgroundColor: 'transparent',
  },
  sheetHighlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth * 2,
    zIndex: 2,
  },
  sheetInner: {
    position: 'relative',
    zIndex: 1,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  gripBar: { alignItems: 'center', paddingVertical: 8 },
  grip: { width: 40, height: 4, borderRadius: 2 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  sheetOrbFrame: {
    width: SHEET_ORB_SIZE,
    height: SHEET_ORB_SIZE,
    borderRadius: SHEET_ORB_SIZE / 2,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetOrbFrameDark: { backgroundColor: '#1a1a1a' },
  sheetOrbFrameLight: { backgroundColor: '#F3F0EA' },
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
  bubbleUserText: { color: C.onPrimary, fontSize: 14, lineHeight: 21 },
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
  confirmText: { fontSize: 14, color: C.warnDeep, lineHeight: 20 },
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
  confirmBtnOkText: { color: C.onPrimary, fontSize: 13, fontWeight: '700' },
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
}));

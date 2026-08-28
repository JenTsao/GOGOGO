import { View, StyleSheet, Modal, Text, TextInput } from 'react-native';
import { WebView } from 'react-native-webview';
import { useRef, useState } from 'react';
import { useAiStore } from '@/store/aiStore';

// grok-ball 资产由 Expo 打包（引擎已内联进 ball.html，零外部依赖）
const BALL_HTML = require('../../assets/grok-ball/ball.html');

// AI 状态 → grok-ball 表情映射（emotionId 见 grok-ball 文档）
function emotionForAssistant(): string {
  return '30'; // 思考中
}
function emotionForIdle(): string {
  return '02'; // 待机放空
}

// AI 悬浮球：用 grok-ball 项目渲染会跟随、可切换 32 种表情的表情球
export function AiOrb() {
  const { visible, open, close, messages, pushMessage } = useAiStore();
  const webviewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const inputRef = { current: '' } as { current: string };

  const post = (obj: Record<string, unknown>) =>
    webviewRef.current?.postMessage(JSON.stringify(obj));

  return (
    <>
      {/* 角标球：Web 端 grok-ball，固定右下角，点击唤起 AI 对话 */}
      <View style={styles.orbWrap} pointerEvents="box-none">
        <WebView
          ref={webviewRef}
          source={BALL_HTML}
          style={styles.orb}
          transparent
          originWhitelist={['*']}
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
              post({ type: 'emotion', id: emotionForIdle() });
            }
          }}
        />
      </View>

      <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>高考副驾驶 · AI</Text>
            <Text style={styles.close} onPress={close}>
              ✕
            </Text>
          </View>

          <View style={styles.messages}>
            {messages.length === 0 && (
              <Text style={styles.placeholder}>
                随点随到。试试：“把每日一题加到明天后备箱”或“查一下今年物理分数线”。
              </Text>
            )}
            {messages.map((m, i) => (
              <Text
                key={i}
                style={[styles.bubble, m.role === 'user' ? styles.user : styles.assistant]}
              >
                {m.content}
              </Text>
            ))}
          </View>

          <TextInput
            style={styles.input}
            placeholder="问问 AI…"
            placeholderTextColor="#888"
            onChangeText={(t) => (inputRef.current = t)}
            onSubmitEditing={({ nativeEvent }) => {
              const text = nativeEvent.text.trim();
              if (!text) return;
              pushMessage({ role: 'user', content: text });
              // TODO: Phase 2 接入 DeepSeek，识别工具意图并执行
              if (ready) post({ type: 'emotion', id: emotionForAssistant() });
              pushMessage({ role: 'assistant', content: '（演示）已收到，AI 引擎将在 Phase 2 接入。' });
              if (ready) post({ type: 'emotion', id: emotionForIdle() });
              inputRef.current = '';
            }}
          />
        </View>
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
    zIndex: 100,
  },
  orb: {
    width: 75,
    height: 75,
    backgroundColor: 'transparent',
  },
  sheet: {
    flex: 1,
    marginTop: 80,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
  },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '700' },
  close: { fontSize: 18, color: '#888' },
  messages: { flex: 1, marginTop: 12 },
  placeholder: { color: '#999', fontSize: 14, lineHeight: 22 },
  bubble: { padding: 10, borderRadius: 12, marginBottom: 8, fontSize: 14 },
  user: { backgroundColor: '#e3f2fd', alignSelf: 'flex-end' },
  assistant: { backgroundColor: '#f3f3f3', alignSelf: 'flex-start' },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 12,
    padding: 12,
    fontSize: 14,
  },
});

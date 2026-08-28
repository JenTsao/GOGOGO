import { View, StyleSheet, Modal, Text, TextInput, ScrollView } from 'react-native';
import { WebView } from 'react-native-webview';
import { useEffect, useRef, useState } from 'react';
import { useAiStore, STATUS_EMOTION } from '@/store/aiStore';
import { useSettingsStore } from '@/store/settingsStore';

// grok-ball 资产由 Expo 打包（引擎已内联进 ball.html，零外部依赖）
const BALL_HTML = require('../../assets/grok-ball/ball.html');

// AI 悬浮球：grok-ball 表情球 + 多供应商 LLM 对话（请求逻辑统一在 aiStore.ask）
export function AiOrb() {
  const { visible, status, open, close, setStatus, messages, ask } = useAiStore();
  const { llmModel } = useSettingsStore();
  const webviewRef = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [input, setInput] = useState('');
  const busy = status === 'thinking';

  const post = (obj: Record<string, unknown>) =>
    webviewRef.current?.postMessage(JSON.stringify(obj));

  // 状态变化 → 切换 grok-ball 表情
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
      {/* 角标球：Web 端 grok-ball，固定右下角，点击唤起 AI 对话 */}
      <View style={styles.orbWrap} pointerEvents="box-none">
        <WebView
          ref={webviewRef}
          source={BALL_HTML}
          style={styles.orb}
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
              post({ type: 'emotion', id: STATUS_EMOTION.idle });
            }
          }}
        />
      </View>

      <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>高考副驾驶 · {llmModel || 'AI'}</Text>
            <Text style={styles.close} onPress={close}>
              ✕
            </Text>
          </View>

          <ScrollView style={styles.messages}>
            {messages.length === 0 && (
              <Text style={styles.placeholder}>
                随点随到。先在「我的」Tab 配置 API Key；试试：“帮我规划今晚的数学复习”或“讲讲导数构造函数”。
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
          </ScrollView>

          <TextInput
            style={styles.input}
            placeholder={busy ? '思考中…' : '问问 AI…'}
            placeholderTextColor="#888"
            value={input}
            onChangeText={setInput}
            editable={!busy}
            onSubmitEditing={send}
            returnKeyType="send"
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

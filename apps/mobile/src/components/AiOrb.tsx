import { View, TouchableOpacity, StyleSheet, Modal, Text, TextInput } from 'react-native';
import { useAiStore } from '@/store/aiStore';

// 磨砂玻璃 AI 悬浮球（直径 56pt），点击弹出 L4 级智能体对话窗口
export function AiOrb() {
  const { visible, open, close, messages, pushMessage } = useAiStore();
  const inputRef = { current: '' } as { current: string };

  return (
    <>
      <View style={styles.orbWrap} pointerEvents="box-none">
        <TouchableOpacity style={styles.orb} onPress={open} activeOpacity={0.8}>
          <Text style={styles.orbText}>🤖</Text>
        </TouchableOpacity>
      </View>

      <Modal visible={visible} animationType="slide" transparent onRequestClose={close}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>高考副驾驶 · AI</Text>
            <TouchableOpacity onPress={close}>
              <Text style={styles.close}>✕</Text>
            </TouchableOpacity>
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
              pushMessage({ role: 'assistant', content: '（演示）已收到，AI 引擎将在 Phase 2 接入。' });
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
    bottom: 28,
    alignSelf: 'center',
    zIndex: 100,
  },
  orb: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.65)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  orbText: { fontSize: 26 },
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

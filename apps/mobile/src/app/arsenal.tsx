import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useState } from 'react';
import { useAiStore } from '@/store/aiStore';
import { CodeSandbox } from '@/components/CodeSandbox';
import { KnowledgeView } from '@/components/KnowledgeView';

// Tab 2：弹药库（工具与知识）
// 顶部切换：[💻 代码沙盒] | [📓 知识库]
// 业务入口：一键生成错题本 / 编译输出（驱动 AI 表情状态）
export default function ArsenalScreen() {
  const [tab, setTab] = useState<'code' | 'knowledge'>('code');
  const runAction = useAiStore((s) => s.runAction);

  return (
    <View style={styles.container}>
      <View style={styles.switch}>
        <TouchableOpacity
          style={[styles.tab, tab === 'code' && styles.tabActive]}
          onPress={() => setTab('code')}
        >
          <Text style={[styles.tabText, tab === 'code' && styles.tabTextActive]}>💻 代码沙盒</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'knowledge' && styles.tabActive]}
          onPress={() => setTab('knowledge')}
        >
          <Text style={[styles.tabText, tab === 'knowledge' && styles.tabTextActive]}>📓 知识库</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {tab === 'code' ? (
          <CodeSandbox />
        ) : (
          <KnowledgeView />
        )}

        {/* 业务入口：生成错题本 / 编译输出 */}
        <Text style={styles.sectionTitle}>⚡ 快捷生成</Text>
        <TouchableOpacity style={styles.actionBtn} onPress={() => runAction('生成错题本')}>
          <Text style={styles.actionBtnText}>📚 生成错题本</Text>
          <Text style={styles.actionHint}>汇总全部错题，AI 精炼成终极复习卡片</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={() => runAction('编译输出')}>
          <Text style={styles.actionBtnText}>📦 编译输出</Text>
          <Text style={styles.actionHint}>一键生成 PDF 复习 / Anki 卡片包 / 纯文本大纲</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 16, backgroundColor: '#fafafa' },
  switch: { flexDirection: 'row', paddingHorizontal: 16, gap: 8 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: '#eee', alignItems: 'center' },
  tabActive: { backgroundColor: '#111' },
  tabText: { color: '#555', fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  body: { flex: 1, padding: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 24, marginBottom: 8 },
  actionBtn: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#eee',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  actionBtnText: { fontSize: 16, fontWeight: '700', color: '#111' },
  actionHint: { marginTop: 4, fontSize: 13, color: '#888' },
});

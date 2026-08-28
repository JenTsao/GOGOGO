import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useState } from 'react';

// Tab 2：弹药库（工具与知识）
// 顶部切换：[💻 代码沙盒] | [📓 知识库]
export default function ArsenalScreen() {
  const [tab, setTab] = useState<'code' | 'knowledge'>('code');

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
          <Text style={styles.placeholder}>
            Monaco 编辑器 + Pyodide 运行 + 强制熔断（5 秒无响应杀进程）。Phase 2 集成。
          </Text>
        ) : (
          <Text style={styles.placeholder}>
            按需从 GitHub 拉取目录树，点击单篇下载 Markdown，渲染支持 LaTeX / 代码高亮 / [[双链]]。Phase 2 集成。
          </Text>
        )}
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
  placeholder: { color: '#999', fontSize: 15, lineHeight: 24 },
});

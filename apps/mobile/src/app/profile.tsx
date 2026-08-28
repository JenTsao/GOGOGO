import { View, Text, StyleSheet, Switch, ScrollView } from 'react-native';
import { useState } from 'react';

// Tab 4：我的（配置与调度）
export default function ProfileScreen() {
  const [synced, setSynced] = useState(false);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionTitle}>⚙️ 配置</Text>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>DeepSeek API Key</Text>
        <Text style={styles.rowValue}>未配置</Text>
      </View>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>目标大学</Text>
        <Text style={styles.rowValue}>未设定</Text>
      </View>

      <Text style={styles.sectionTitle}>📅 自定义日期提醒</Text>
      <Text style={styles.placeholder}>点击日期添加提醒，红点标记。Phase 1 后续。</Text>

      <View style={styles.row}>
        <Text style={styles.rowLabel}>手动同步</Text>
        <Switch value={synced} onValueChange={() => setSynced((v) => !v)} />
      </View>
      <Text style={styles.placeholder}>拉取云端最新画像与 Obsidian 目录。</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fafafa' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 12, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: '#eee' },
  rowLabel: { fontSize: 16, color: '#333' },
  rowValue: { fontSize: 15, color: '#888' },
  placeholder: { color: '#999', fontSize: 14, lineHeight: 22, marginTop: 4 },
});

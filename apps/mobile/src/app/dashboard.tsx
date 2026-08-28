import { View, Text, StyleSheet, ScrollView } from 'react-native';

// Tab 3：仪表盘（数据与洞察）— Recharts 图表区占位
export default function DashboardScreen() {
  return (
    <ScrollView style={styles.container}>
      <Text style={styles.cardTitle}>📊 我的画像</Text>
      <View style={styles.card}>
        <Text style={styles.placeholder}>优势学科 / 危险学科 / 最近卡壳词云。Phase 3 接入激进画像系统。</Text>
      </View>

      <Text style={styles.cardTitle}>学科能力雷达图</Text>
      <View style={styles.card}>
        <Text style={styles.placeholder}>五维，100 分制。Recharts 雷达图。Phase 3。</Text>
      </View>

      <Text style={styles.cardTitle}>心流热力图</Text>
      <View style={styles.card}>
        <Text style={styles.placeholder}>最佳专注时段。Phase 3。</Text>
      </View>

      <Text style={styles.cardTitle}>任务完成率趋势</Text>
      <View style={styles.card}>
        <Text style={styles.placeholder}>折线图。Phase 3。</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fafafa' },
  cardTitle: { fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, minHeight: 80, justifyContent: 'center' },
  placeholder: { color: '#999', fontSize: 14, lineHeight: 22 },
});

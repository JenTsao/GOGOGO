import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useTaskStore } from '@/store/taskStore';
import { useFocusStore } from '@/store/focusStore';

// Tab 1：驾驶舱（时间线与当下）
export default function CockpitScreen() {
  const { top3, addTask, completeTask, swapWithBacklog } = useTaskStore();
  const { seconds, running, start, stop, reset } = useFocusStore();

  const examDate = new Date('2026-06-07');
  const today = new Date();
  const daysLeft = Math.max(0, Math.ceil((examDate.getTime() - today.getTime()) / 86400000));

  return (
    <ScrollView style={styles.container}>
      {/* 顶部状态栏：日期 + 天气占位 */}
      <Text style={styles.date}>{today.toLocaleDateString('zh-CN')} · 26°C 适合刷题</Text>

      {/* 信仰级倒计时 */}
      <Text style={styles.countdown}>距离 2026 高考 · {daysLeft} 天</Text>

      {/* 今日三件事 */}
      <Text style={styles.sectionTitle}>🎯 今日三件事</Text>
      {top3.map((t) => (
        <TouchableOpacity key={t.id} onPress={() => completeTask(t.id)}>
          <Text style={styles.taskItem}>○ {t.content}</Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity style={styles.addBtn} onPress={() => addTask('新任务（点此编辑）')}>
        <Text style={styles.addBtnText}>+ 添加今日任务</Text>
      </TouchableOpacity>

      {/* 专注模型启动器 */}
      <Text style={styles.sectionTitle}>🧠 专注模式</Text>
      <Text style={styles.timer}>{String(Math.floor(seconds / 60)).padStart(2, '0')}:{String(seconds % 60).padStart(2, '0')}</Text>
      <TouchableOpacity
        style={styles.focusBtn}
        onPress={() => {
          if (running) { stop(); reset(); } else { reset(); start(); }
        }}
      >
        <Text style={styles.focusBtnText}>{running ? '结束心流' : '进入心流'}</Text>
      </TouchableOpacity>

      {/* TODO: 每日知识点翻转卡片、每日一题、今日提醒横幅（Phase 1 后续） */}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fafafa' },
  date: { color: '#666', fontSize: 14 },
  countdown: { fontSize: 30, fontWeight: '800', marginVertical: 12, color: '#1a1a1a' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  taskItem: { fontSize: 16, paddingVertical: 8, color: '#333' },
  addBtn: { marginTop: 8, padding: 12, borderWidth: 1, borderColor: '#ccc', borderRadius: 10, alignItems: 'center' },
  addBtnText: { color: '#555' },
  timer: { fontSize: 40, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
  focusBtn: { marginTop: 12, backgroundColor: '#111', borderRadius: 12, padding: 16, alignItems: 'center' },
  focusBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

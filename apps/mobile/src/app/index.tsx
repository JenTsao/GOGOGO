import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal } from 'react-native';
import { useEffect, useState } from 'react';
import { useTaskStore } from '@/store/taskStore';
import { useFocusStore } from '@/store/focusStore';
import { useSettingsStore } from '@/store/settingsStore';

// Tab 1：驾驶舱（时间线与当下）
export default function CockpitScreen() {
  const { top3, backlog, addTask, removeTask, swapWithBacklog, completeTask } = useTaskStore();
  const { seconds, running, sessions, start, stop } = useFocusStore();
  const { weatherKey, weatherCity } = useSettingsStore();

  const [draft, setDraft] = useState('');
  const [weather, setWeather] = useState<{ temp: number; desc: string } | null>(null);
  const [inFlow, setInFlow] = useState(false); // 全屏心流模式

  const examDate = new Date('2026-06-07');
  const today = new Date();
  const daysLeft = Math.max(0, Math.ceil((examDate.getTime() - today.getTime()) / 86400000));

  // 专注计时驱动：running 时每秒 tick 一次
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => useFocusStore.getState().tick(), 1000);
    return () => clearInterval(id);
  }, [running]);

  // 天气：OpenWeatherMap（Key 在「我的」Tab 配置）
  useEffect(() => {
    if (!weatherKey || !weatherCity) return;
    let cancelled = false;
    fetch(
      `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(weatherCity)}&appid=${weatherKey}&units=metric&lang=zh_cn`
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => {
        if (!cancelled) setWeather({ temp: Math.round(data.main.temp), desc: data.weather?.[0]?.description ?? '' });
      })
      .catch(() => {
        if (!cancelled) setWeather(null);
      });
    return () => {
      cancelled = true;
    };
  }, [weatherKey, weatherCity]);

  const weatherTip = (temp: number) =>
    temp >= 30 ? '太热，多喝水' : temp >= 22 ? '适合刷题' : temp >= 12 ? '微凉，穿外套' : '注意保暖';

  const submitTask = (status: 'top3' | 'backlog') => {
    const content = draft.trim();
    if (!content) return;
    addTask(content, status);
    setDraft('');
  };

  const fmt = (s: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  const enterFlow = () => {
    useFocusStore.getState().reset();
    start();
    setInFlow(true);
  };
  const exitFlow = () => {
    stop();
    setInFlow(false);
  };

  return (
    <>
      <ScrollView style={styles.container}>
        {/* 顶部状态栏：日期 + 天气 */}
        <Text style={styles.date}>
          {today.toLocaleDateString('zh-CN')} ·{' '}
          {weather ? `${weather.temp}°C ${weather.desc}，${weatherTip(weather.temp)}` : '配置天气 Key 后显示'}
        </Text>

        {/* 信仰级倒计时 */}
        <Text style={styles.countdown}>距离 2026 高考 · {daysLeft} 天</Text>

        {/* 今日三件事 */}
        <Text style={styles.sectionTitle}>🎯 今日三件事</Text>
        {top3.length === 0 && <Text style={styles.empty}>还没有任务，添加最多 3 件今日要事</Text>}
        {top3.map((t) => (
          <View key={t.id} style={styles.taskRow}>
            <TouchableOpacity style={styles.taskMain} onPress={() => completeTask(t.id)}>
              <Text style={[styles.taskItem, t.status === 'done' && styles.taskDone]}>
                {t.status === 'done' ? '☑' : '○'} {t.content}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.taskBtn} onPress={() => swapWithBacklog(t.id)}>
              <Text style={styles.taskBtnText}>⇄</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.taskBtn} onPress={() => removeTask(t.id)}>
              <Text style={styles.taskBtnText}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

        {/* 添加任务（支持直接进后备箱） */}
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder="添加任务…"
            placeholderTextColor="#999"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={() => submitTask('top3')}
          />
          <TouchableOpacity style={styles.addBtn} onPress={() => submitTask('top3')}>
            <Text style={styles.addBtnText}>今日</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.addBtn, styles.addBtnGhost]} onPress={() => submitTask('backlog')}>
            <Text style={styles.addBtnTextGhost}>后备箱</Text>
          </TouchableOpacity>
        </View>

        {/* 后备箱 */}
        {backlog.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>🧳 后备箱</Text>
            {backlog.map((t) => (
              <View key={t.id} style={styles.taskRow}>
                <TouchableOpacity
                  style={styles.taskMain}
                  onPress={() => {
                    removeTask(t.id);
                    addTask(t.content, 'top3');
                  }}
                >
                  <Text style={styles.taskItemBacklog}>↩ {t.content}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.taskBtn} onPress={() => removeTask(t.id)}>
                  <Text style={styles.taskBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}

        {/* 专注模型启动器 */}
        <Text style={styles.sectionTitle}>🧠 专注模式</Text>
        <TouchableOpacity style={styles.focusBtn} onPress={enterFlow}>
          <Text style={styles.focusBtnText}>进入心流</Text>
        </TouchableOpacity>
        {sessions.length > 0 && (
          <Text style={styles.sessionHint}>
            最近一次专注 {Math.round(sessions[0].duration / 60)} 分钟 · 累计 {sessions.length} 次
          </Text>
        )}

        {/* TODO: 每日知识点翻转卡片、每日一题（Phase 2 凌晨备课流水线） */}
      </ScrollView>

      {/* 全屏心流模式：黑底倒计时，强制屏蔽打扰 */}
      <Modal visible={inFlow} animationType="fade" onRequestClose={exitFlow}>
        <View style={styles.flow}>
          <Text style={styles.flowHint}>心流进行中 · 请勿打扰</Text>
          <Text style={styles.flowTimer}>{fmt(seconds)}</Text>
          <TouchableOpacity style={styles.flowStop} onPress={exitFlow}>
            <Text style={styles.flowStopText}>结束心流</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fafafa' },
  date: { color: '#666', fontSize: 14 },
  countdown: { fontSize: 30, fontWeight: '800', marginVertical: 12, color: '#1a1a1a' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 20, marginBottom: 8 },
  empty: { color: '#999', fontSize: 14 },
  taskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  taskMain: { flex: 1 },
  taskItem: { fontSize: 16, paddingVertical: 6, color: '#333' },
  taskDone: { color: '#aaa', textDecorationLine: 'line-through' },
  taskItemBacklog: { fontSize: 15, paddingVertical: 6, color: '#666' },
  taskBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#eee', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  taskBtnText: { color: '#555', fontSize: 16 },
  inputRow: { flexDirection: 'row', marginTop: 10, gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, backgroundColor: '#fff' },
  addBtn: { backgroundColor: '#111', borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  addBtnGhost: { backgroundColor: '#eee' },
  addBtnTextGhost: { color: '#555', fontSize: 14, fontWeight: '600' },
  focusBtn: { marginTop: 8, backgroundColor: '#111', borderRadius: 12, padding: 16, alignItems: 'center' },
  focusBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sessionHint: { marginTop: 10, color: '#888', fontSize: 13, textAlign: 'center' },
  flow: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  flowHint: { color: '#555', fontSize: 15, letterSpacing: 4 },
  flowTimer: { color: '#fff', fontSize: 72, fontWeight: '200', marginVertical: 32, fontVariant: ['tabular-nums'] },
  flowStop: { borderWidth: 1, borderColor: '#444', borderRadius: 24, paddingHorizontal: 32, paddingVertical: 12 },
  flowStopText: { color: '#888', fontSize: 15 },
});

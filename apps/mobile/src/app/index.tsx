import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import * as Location from 'expo-location';
import { useTaskStore } from '@/store/taskStore';
import { useFocusStore } from '@/store/focusStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReminderStore, localDateStr } from '@/store/reminderStore';

// Tab 1：驾驶舱（时间线与当下）——布局严格按蓝皮书顺序：
// 日期天气 → 信仰级倒计时 → 今日提醒横幅 → 每日知识点 → 每日一题 → 今日三件事 → 专注启动器
export default function CockpitScreen() {
  const { top3, backlog, addTask, removeTask, swapWithBacklog, completeTask } = useTaskStore();
  const { seconds, running, sessions, start, stop } = useFocusStore();
  const { weatherKey, weatherCity } = useSettingsStore();
  const reminders = useReminderStore((s) => s.reminders);

  const [draft, setDraft] = useState('');
  const [weather, setWeather] = useState<{ temp: number; desc: string } | null>(null);
  const [inFlow, setInFlow] = useState(false); // 全屏心流模式
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [countdownMode, setCountdownMode] = useState<'days' | 'precise'>('days'); // 倒计时两种展示

  const today = useMemo(() => new Date(), []);
  const todayStr = localDateStr(today);

  const examDate = useMemo(() => new Date('2026-06-07T09:00:00'), []);
  const msLeft = Math.max(0, examDate.getTime() - today.getTime());
  const daysLeft = Math.ceil(msLeft / 86400000);
  // 精确模式：X天X小时X分（蓝皮书：点击倒计时切换）
  const preciseLeft = {
    days: Math.floor(msLeft / 86400000),
    hours: Math.floor((msLeft % 86400000) / 3600000),
    minutes: Math.floor((msLeft % 3600000) / 60000),
  };

  // 今日提醒横幅：仅当存在当日提醒时出现
  const todayReminders = useMemo(
    () => reminders.filter((r) => r.date === todayStr),
    [reminders, todayStr]
  );

  // 今日累计专注（分钟），来自本地会话记录
  const todayFocusMin = useMemo(() => {
    const base = todayStr;
    return Math.round(
      sessions
        .filter((s) => localDateStr(new Date(s.endedAt)) === base)
        .reduce((sum, s) => sum + s.duration, 0) / 60
    );
  }, [sessions, todayStr]);

  // 专注计时驱动：running 时每秒 tick 一次
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => useFocusStore.getState().tick(), 1000);
    return () => clearInterval(id);
  }, [running]);

  // 自动定位：启动时请求前台权限，取当前坐标（失败静默，回退到配置城市）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        if (!cancelled) setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      } catch {
        // 定位失败不阻塞界面
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 天气：优先按定位坐标查询，无定位时按「我的」里配置的城市查询
  useEffect(() => {
    if (!weatherKey) return;
    const query = coords
      ? `lat=${coords.lat}&lon=${coords.lon}`
      : weatherCity
        ? `q=${encodeURIComponent(weatherCity)}`
        : null;
    if (!query) return;
    let cancelled = false;
    fetch(`https://api.openweathermap.org/data/2.5/weather?${query}&appid=${weatherKey}&units=metric&lang=zh_cn`)
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
  }, [weatherKey, weatherCity, coords]);

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
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* 顶部状态栏：日期 + 天气 */}
        <Text style={styles.date}>
          {today.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
        </Text>
        <Text style={styles.weather}>
          {weather
            ? `${weather.temp}°C ${weather.desc} · ${weatherTip(weather.temp)}`
            : weatherKey
              ? '天气加载中…'
              : '在「我的」配置 OpenWeather Key 显示天气'}
        </Text>

        {/* 信仰级倒计时：点击切换 天 / 天时分 */}
        <TouchableOpacity
          style={[styles.card, styles.heroCard]}
          activeOpacity={0.85}
          onPress={() => setCountdownMode((m) => (m === 'days' ? 'precise' : 'days'))}
        >
          <Text style={styles.heroLabel}>距离 2026 高考</Text>
          {countdownMode === 'days' ? (
            <Text style={styles.heroDays}>
              {daysLeft}
              <Text style={styles.heroUnit}> 天</Text>
            </Text>
          ) : (
            <Text style={styles.heroPrecise}>
              {preciseLeft.days}
              <Text style={styles.heroUnitSm}>天 </Text>
              {preciseLeft.hours}
              <Text style={styles.heroUnitSm}>小时 </Text>
              {preciseLeft.minutes}
              <Text style={styles.heroUnitSm}>分</Text>
            </Text>
          )}
          <Text style={styles.heroHint}>点击切换精确到分</Text>
        </TouchableOpacity>

        {/* 今日提醒横幅：仅当有当日提醒时出现 */}
        {todayReminders.length > 0 && (
          <View style={styles.reminderBanner}>
            {todayReminders.map((r) => (
              <Text key={r.id} style={styles.reminderText}>📌 {r.content}</Text>
            ))}
          </View>
        )}

        {/* 📘 每日知识点（翻转卡片）——数据源：Phase 2 凌晨备课流水线 */}
        <View style={[styles.card, styles.placeholderCard]}>
          <Text style={styles.placeholderTitle}>📘 每日知识点</Text>
          <Text style={styles.placeholderText}>AI 每天凌晨 4:00 基于你的 Obsidian 笔记自动生成</Text>
        </View>

        {/* ✏️ 每日一题——数据源：Phase 2 凌晨备课流水线 */}
        <View style={[styles.card, styles.placeholderCard]}>
          <Text style={styles.placeholderTitle}>✏️ 每日一题</Text>
          <Text style={styles.placeholderText}>中高难度 + 分步解析，与知识点同源生成</Text>
        </View>

        {/* 今日三件事 */}
        <View style={[styles.card, styles.sectionCard]}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>🎯 今日三件事</Text>
            <Text style={styles.sectionMeta}>
              {top3.filter((t) => t.status === 'done').length}/{top3.length} 完成
            </Text>
          </View>
          {top3.length === 0 && <Text style={styles.empty}>添加最多 3 件今日要事</Text>}
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
              <Text style={styles.backlogTitle}>🧳 后备箱</Text>
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
        </View>

        {/* 🎯 专注模型启动器 */}
        <View style={[styles.card, styles.sectionCard]}>
          <View style={styles.sectionHead}>
            <Text style={styles.sectionTitle}>🧠 专注模式</Text>
            {todayFocusMin > 0 && <Text style={styles.sectionMeta}>今日 {todayFocusMin} 分钟</Text>}
          </View>
          <TouchableOpacity style={styles.focusBtn} onPress={enterFlow}>
            <Text style={styles.focusBtnText}>进入心流</Text>
          </TouchableOpacity>
          {sessions.length > 0 && (
            <Text style={styles.sessionHint}>
              最近一次专注 {Math.round(sessions[0].duration / 60)} 分钟 · 累计 {sessions.length} 次
            </Text>
          )}
        </View>
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
  container: { flex: 1, backgroundColor: '#f4f5f7' },
  content: { padding: 16, paddingBottom: 96 }, // 底部留出 Tab 栏与 AI 悬浮球空间
  date: { color: '#666', fontSize: 14, fontWeight: '500' },
  weather: { color: '#999', fontSize: 13, marginTop: 2 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginTop: 12,
    // iOS 阴影 + Android elevation 双兜底
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },

  // 信仰级倒计时
  heroCard: { alignItems: 'center', paddingVertical: 24, backgroundColor: '#111' },
  heroLabel: { color: '#888', fontSize: 14, letterSpacing: 2 },
  heroDays: { color: '#fff', fontSize: 64, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 4 },
  heroUnit: { fontSize: 22, fontWeight: '600', color: '#ccc' },
  heroPrecise: { color: '#fff', fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 12 },
  heroUnitSm: { fontSize: 16, fontWeight: '500', color: '#aaa' },
  heroHint: { color: '#555', fontSize: 11, marginTop: 8 },

  // 今日提醒横幅
  reminderBanner: {
    backgroundColor: '#fff7e6',
    borderLeftWidth: 4,
    borderLeftColor: '#faad14',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 12,
  },
  reminderText: { color: '#8c6b1f', fontSize: 14, lineHeight: 22 },

  // 每日知识点 / 每日一题占位（Phase 2 接入后替换为翻转卡与答题交互）
  placeholderCard: { borderStyle: 'dashed', borderWidth: 1, borderColor: '#d9dce1' },
  placeholderTitle: { fontSize: 16, fontWeight: '700', color: '#333' },
  placeholderText: { fontSize: 13, color: '#999', marginTop: 6, lineHeight: 20 },

  sectionCard: { marginTop: 16 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#1a1a1a' },
  sectionMeta: { fontSize: 13, color: '#888' },
  empty: { color: '#999', fontSize: 14, marginTop: 10 },
  taskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4 },
  taskMain: { flex: 1 },
  taskItem: { fontSize: 16, paddingVertical: 6, color: '#333' },
  taskDone: { color: '#aaa', textDecorationLine: 'line-through' },
  taskItemBacklog: { fontSize: 15, paddingVertical: 6, color: '#666' },
  taskBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#f0f1f3', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  taskBtnText: { color: '#555', fontSize: 16 },
  backlogTitle: { fontSize: 14, fontWeight: '600', color: '#888', marginTop: 12, marginBottom: 2 },
  inputRow: { flexDirection: 'row', marginTop: 10, gap: 8 },
  input: { flex: 1, borderWidth: 1, borderColor: '#e2e4e8', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 15, backgroundColor: '#fafafa' },
  addBtn: { backgroundColor: '#111', borderRadius: 10, paddingHorizontal: 14, justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  addBtnGhost: { backgroundColor: '#eee' },
  addBtnTextGhost: { color: '#555', fontSize: 14, fontWeight: '600' },

  focusBtn: { marginTop: 12, backgroundColor: '#111', borderRadius: 12, padding: 16, alignItems: 'center' },
  focusBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  sessionHint: { marginTop: 10, color: '#888', fontSize: 13, textAlign: 'center' },

  flow: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  flowHint: { color: '#555', fontSize: 15, letterSpacing: 4 },
  flowTimer: { color: '#fff', fontSize: 72, fontWeight: '200', marginVertical: 32, fontVariant: ['tabular-nums'] },
  flowStop: { borderWidth: 1, borderColor: '#444', borderRadius: 24, paddingHorizontal: 32, paddingVertical: 12 },
  flowStopText: { color: '#888', fontSize: 15 },
});

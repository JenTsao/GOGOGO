import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as IntentLauncher from 'expo-intent-launcher';
import { useTaskStore } from '@/store/taskStore';
import { useFocusStore } from '@/store/focusStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useReminderStore, localDateStr } from '@/store/reminderStore';
import { useAiStore } from '@/store/aiStore';
import { useMoodStore } from '@/store/moodStore';
import { useMistakeStore } from '@/store/mistakeStore';
import { useAuthStore } from '@/store/authStore';
import { fetchDaily, DailyLearning } from '@/lib/cloud';
import { readDailyCache } from '@/lib/background';
import { C, R, cardShadow, GLASS, HIT_SLOP } from '@/theme';

// Tab 1：驾驶舱（时间线与当下）——布局严格按蓝皮书顺序：
// 日期天气 → 信仰级倒计时 → 今日提醒横幅 → 每日知识点 → 每日一题 → 今日三件事 → 专注启动器
export default function CockpitScreen() {
  const { top3, backlog, addTask, removeTask, swapWithBacklog, completeTask } = useTaskStore();
  const { seconds, running, sessions, start, stop } = useFocusStore();
  const { weatherKey, weatherCity, supabaseUrl, supabaseAnonKey, accessKey } = useSettingsStore();
  const reminders = useReminderStore((s) => s.reminders);
  // 顶部安全区：iQOO Neo10 等打孔屏在 translucent 状态栏下内容会顶进挖孔，必须避让
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState('');
  const [weather, setWeather] = useState<{ temp: number; desc: string } | null>(null);
  const [inFlow, setInFlow] = useState(false); // 全屏心流模式
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [countdownMode, setCountdownMode] = useState<'days' | 'precise'>('days'); // 倒计时两种展示

  // 每日备课内容（云端 daily_learning）
  const [daily, setDaily] = useState<DailyLearning | null>(null);
  const [dailyState, setDailyState] = useState<'loading' | 'ok' | 'empty' | 'error' | 'unconfigured'>('loading');
  const [knowledgeFlipped, setKnowledgeFlipped] = useState(false); // 知识点翻转卡
  const [showAnswer, setShowAnswer] = useState(false); // 每日一题答案

  // 当前时间：分钟级刷新，避免应用跨天驻留后倒计时/提醒/备课日期全部冻结
  const [today, setToday] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setToday(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  const todayStr = localDateStr(today);

  // 信仰级倒计时：滚动到最近一次未来高考（6 月 7 日 09:00 开考；已过开考时刻自动 +1 年，避免考后永远显示 0）
  const examDate = useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    return now.getTime() >= new Date(y, 5, 7, 9, 0, 0).getTime()
      ? new Date(y + 1, 5, 7, 9, 0, 0)
      : new Date(y, 5, 7, 9, 0, 0);
  }, []);
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

  // 每日备课不可用时的提示文案
  const dailyStateText = useMemo(() => {
    switch (dailyState) {
      case 'unconfigured':
        return '在「我的」配置云端地址与访问密钥后，展示 AI 每日生成的知识点与一题';
      case 'loading':
        return '云端加载中…';
      case 'empty':
        return '今日内容尚未生成（凌晨 04:00 备课流水线）';
      case 'error':
        return '云端读取失败，请检查配置或稍后重试';
      default:
        return '';
    }
  }, [dailyState]);

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

  // 启动静默云同步：任务池（并集+墓碑）、专注会话（并集）、情绪打卡与错题（本地优先上传）
  // 全部失败静默——离线可用的底线是本地功能完整
  useEffect(() => {
    void useAuthStore.getState().init(); // 幂等：恢复会话 + 注册订阅（profile 页也会调）
    useTaskStore.getState().syncTasks();
    useFocusStore.getState().syncSessions();
    useMoodStore.getState().load();
    useMoodStore.getState().syncAll();
    // 错题 syncAll 需显式传管理台地址与密钥（接口签名与 moodStore 不同）；提醒云同步同走管理台代理
    const { webApiUrl, accessKey } = useSettingsStore.getState();
    if (webApiUrl && accessKey) {
      void useMistakeStore.getState().syncAll(webApiUrl, accessKey);
      void useReminderStore.getState().sync(webApiUrl, accessKey);
    }
  }, []);

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

  // 每日备课内容：云端读取（未配置/失败均静默降级为提示卡片）
  useEffect(() => {
    if (!supabaseUrl || !supabaseAnonKey || !accessKey) {
      setDailyState('unconfigured');
      return;
    }
    let cancelled = false;
    setDailyState('loading');
    fetchDaily({ supabaseUrl, supabaseAnonKey, accessKey }, todayStr)
      .then((d) => {
        if (!cancelled) {
          setDaily(d);
          setDailyState(d ? 'ok' : 'empty');
        }
      })
      .catch(() => {
        if (!cancelled) {
          // 云读取失败 → 优先用后台唤醒预取的当日缓存兜底
          const cached = readDailyCache();
          if (cached) {
            setDaily(cached);
            setDailyState('ok');
          } else {
            setDailyState('error');
          }
        }
      });
    return () => {
      cancelled = true;
    };
  }, [supabaseUrl, supabaseAnonKey, accessKey, todayStr]);

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
    // 通知抑制开关：前台横幅/声音由 notification handler 读取此标志屏蔽
    useFocusStore.getState().setSuppressNotifications(true);
    setInFlow(true);
  };
  const exitFlow = () => {
    stop();
    useFocusStore.getState().setSuppressNotifications(false);
    setInFlow(false);
  };

  // 系统级免打扰：跳转 Android 勿扰设置（其他 App 的通知只有系统 DND 能挡，App 层无法代办）
  const openZenMode = async () => {
    if (Platform.OS !== 'android') return;
    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.ZEN_MODE_SETTINGS);
    } catch {
      // 部分rom无此入口时退回应用设置
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_SETTINGS);
    }
  };

  return (
    <>
      {/* 心流期间隐藏状态栏（打孔屏沉浸），退出后由 expo-status-bar 栈自动恢复 */}
      <StatusBar hidden={inFlow} animated />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
      >
        {/* 顶部状态栏：问候 + 日期天气 */}
        <View style={styles.topBar}>
          <View>
            <Text style={styles.greeting}>今天也要稳住节奏</Text>
            <Text style={styles.date}>
              {today.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
              {weather ? ` · ${weather.temp}° ${weather.desc}` : ''}
            </Text>
          </View>
          <View style={styles.weatherChip}>
            <Ionicons
              name={!weather ? 'partly-sunny-outline' : weather.temp >= 30 ? 'sunny' : weather.temp >= 12 ? 'cloudy-outline' : 'snow'}
              size={16}
              color={C.primary}
            />
            <Text style={styles.weatherChipText} numberOfLines={1}>
              {weather ? weatherTip(weather.temp) : weatherKey ? '获取中' : '设天气'}
            </Text>
          </View>
        </View>

        {/* 信仰级倒计时：点击切换 天 / 天时分 */}
        <TouchableOpacity
          style={[styles.card, styles.heroCard]}
          activeOpacity={0.9}
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
              <View key={r.id} style={styles.reminderRow}>
                <Ionicons name="notifications" size={15} color={C.orange} />
                <Text style={styles.reminderText}>{r.content}</Text>
              </View>
            ))}
          </View>
        )}

        {/* 每日知识点（翻转卡片）——数据源：凌晨备课流水线 daily_learning */}
        {dailyState === 'ok' && daily?.knowledge_body ? (
          <TouchableOpacity
            style={styles.card}
            activeOpacity={0.85}
            onPress={() => setKnowledgeFlipped((v) => !v)}
          >
            <View style={styles.cardHead}>
              <View style={[styles.cardBadge, styles.badgeBlue]}>
                <Ionicons name="book" size={14} color={C.blue} />
              </View>
              <Text style={styles.cardTitle}>每日知识点</Text>
              <Ionicons name={knowledgeFlipped ? 'chevron-up' : 'chevron-down'} size={16} color={C.text3} />
            </View>
            <Text style={styles.knowledgeBody} numberOfLines={knowledgeFlipped ? undefined : 3}>
              {daily.knowledge_body}
            </Text>
            <Text style={styles.knowledgeHint}>{knowledgeFlipped ? '点击收起' : '点击展开全文'}</Text>
          </TouchableOpacity>
        ) : (
          <View style={[styles.card, styles.placeholderCard]}>
            <View style={styles.cardHead}>
              <View style={[styles.cardBadge, styles.badgeBlue]}>
                <Ionicons name="book-outline" size={14} color={C.text3} />
              </View>
              <Text style={styles.placeholderTitle}>每日知识点</Text>
            </View>
            <Text style={styles.placeholderText}>{dailyStateText}</Text>
          </View>
        )}

        {/* 每日一题——显示答案 + AI 讲题 */}
        {dailyState === 'ok' && daily?.question_text ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={[styles.cardBadge, styles.badgePurple]}>
                <Ionicons name="pencil" size={14} color={C.primary} />
              </View>
              <Text style={styles.cardTitle}>每日一题</Text>
            </View>
            <Text style={styles.questionText}>{daily.question_text}</Text>
            {showAnswer && !!daily.answer && (
              <View style={styles.answerBox}>
                <Ionicons name="bulb" size={14} color={C.green} />
                <Text style={styles.answerText}>{daily.answer}</Text>
              </View>
            )}
            <View style={styles.questionBtnRow}>
              <TouchableOpacity style={styles.qBtn} onPress={() => setShowAnswer((v) => !v)}>
                <Ionicons name={showAnswer ? 'eye-off-outline' : 'eye-outline'} size={15} color={C.text2} />
                <Text style={styles.qBtnText}>{showAnswer ? '隐藏答案' : '显示答案'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.qBtn, styles.qBtnDark]}
                onPress={() => {
                  const ai = useAiStore.getState();
                  ai.open();
                  ai.ask(
                    `请讲解这道题，分步骤说清思路：\n${daily.question_text}` +
                      (daily.answer ? `\n\n参考解析：${daily.answer}` : '')
                  );
                }}
              >
                <Ionicons name="sparkles" size={15} color={C.onPrimary} />
                <Text style={[styles.qBtnText, styles.qBtnTextDark]}>AI 讲题</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={[styles.card, styles.placeholderCard]}>
            <View style={styles.cardHead}>
              <View style={[styles.cardBadge, styles.badgePurple]}>
                <Ionicons name="pencil-outline" size={14} color={C.text3} />
              </View>
              <Text style={styles.placeholderTitle}>每日一题</Text>
            </View>
            <Text style={styles.placeholderText}>{dailyStateText}</Text>
          </View>
        )}

        {/* 今日三件事 */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={[styles.cardBadge, styles.badgeGreen]}>
              <Ionicons name="flag" size={14} color={C.green} />
            </View>
            <Text style={styles.cardTitle}>今日三件事</Text>
            <Text style={styles.sectionMeta}>
              {top3.filter((t) => t.status === 'done').length}/{top3.length}
            </Text>
          </View>
          {top3.length === 0 && <Text style={styles.empty}>添加最多 3 件今日要事</Text>}
          {top3.map((t) => (
            <View key={t.id} style={styles.taskRow}>
              <TouchableOpacity style={styles.taskCheck} onPress={() => completeTask(t.id)}>
                {t.status === 'done' ? (
                  <Ionicons name="checkmark-circle" size={22} color={C.green} />
                ) : (
                  <Ionicons name="ellipse-outline" size={22} color={C.border} />
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.taskMain} onPress={() => completeTask(t.id)}>
                <Text style={[styles.taskItem, t.status === 'done' && styles.taskDone]} numberOfLines={2}>
                  {t.content}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.taskBtn} onPress={() => swapWithBacklog(t.id)} hitSlop={HIT_SLOP}>
                <Ionicons name="swap-horizontal" size={16} color={C.text3} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.taskBtn} onPress={() => removeTask(t.id)} hitSlop={HIT_SLOP}>
                <Ionicons name="close" size={16} color={C.text3} />
              </TouchableOpacity>
            </View>
          ))}

          {/* 添加任务（支持直接进后备箱） */}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="添加任务…"
              placeholderTextColor={C.text3}
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
            <View style={styles.backlogBox}>
              <Text style={styles.backlogTitle}>后备箱</Text>
              {backlog.map((t) => (
                <View key={t.id} style={styles.taskRow}>
                  <TouchableOpacity
                    style={styles.taskMain}
                    onPress={() => {
                      removeTask(t.id);
                      addTask(t.content, 'top3');
                    }}
                  >
                    <Text style={styles.taskItemBacklog} numberOfLines={1}>↩ {t.content}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.taskBtn} onPress={() => removeTask(t.id)} hitSlop={HIT_SLOP}>
                    <Ionicons name="close" size={16} color={C.text3} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* 专注模式启动器 */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={[styles.cardBadge, styles.badgePurple]}>
              <Ionicons name="headset" size={14} color={C.primary} />
            </View>
            <Text style={styles.cardTitle}>专注模式</Text>
            {todayFocusMin > 0 && (
              <View style={styles.focusMeta}>
                <Ionicons name="time-outline" size={13} color={C.primary} />
                <Text style={styles.focusMetaText}>今日 {todayFocusMin} 分钟</Text>
              </View>
            )}
          </View>
          <TouchableOpacity style={styles.focusBtn} onPress={enterFlow} activeOpacity={0.9}>
            <Ionicons name="play" size={18} color={C.onPrimary} />
            <Text style={styles.focusBtnText}>进入心流</Text>
          </TouchableOpacity>
          {sessions.length > 0 && (
            <Text style={styles.sessionHint}>
              最近一次专注 {Math.round(sessions[0].duration / 60)} 分钟 · 累计 {sessions.length} 次
            </Text>
          )}
        </View>
      </ScrollView>

      {/* 全屏心流模式：黑底倒计时 + 本应用通知静默 + 系统免打扰深链 */}
      <Modal
        visible={inFlow}
        animationType="fade"
        statusBarTranslucent // 黑底延伸进状态栏区，配合 StatusBar hidden 实现打孔屏沉浸
        onRequestClose={exitFlow}
      >
        <View style={[styles.flow, { paddingTop: insets.top }]}>
          <View style={styles.flowBadge}>
            <Ionicons name="moon" size={14} color={C.inkSub} />
            <Text style={styles.flowHint}>心流进行中 · 通知已静默</Text>
          </View>
          <Text style={styles.flowTimer}>{fmt(seconds)}</Text>
          {Platform.OS === 'android' && (
            <TouchableOpacity style={styles.zenBtn} onPress={openZenMode}>
              <Ionicons name="notifications-off-outline" size={16} color={C.inkDim} />
              <Text style={styles.zenBtnText}>开启系统免打扰（拦截其他应用）</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.flowStop} onPress={exitFlow} activeOpacity={0.8}>
            <Text style={styles.flowStopText}>结束心流</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 96 }, // 底部留出 Tab 栏与 AI 悬浮球空间

  // 顶栏
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingVertical: 4 },
  greeting: { color: C.text, fontSize: 18, fontWeight: '700' },
  date: { color: C.text3, fontSize: 13, marginTop: 3 },
  weatherChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.primarySoft,
    borderRadius: R.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 2,
  },
  weatherChipText: { color: C.primaryDeep, fontSize: 12, fontWeight: '600' },

  // 通用卡片
  card: {
    backgroundColor: C.card,
    borderRadius: R.lg,
    padding: 16,
    marginTop: 14,
    ...cardShadow,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardBadge: {
    width: 28,
    height: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgePurple: { backgroundColor: C.primarySoft },
  badgeBlue: { backgroundColor: C.blueSoft },
  badgeGreen: { backgroundColor: C.greenSoft },
  cardTitle: { fontSize: 16, fontWeight: '700', color: C.text, flex: 1 },
  sectionMeta: { fontSize: 13, color: C.text3, fontWeight: '600', fontVariant: ['tabular-nums'] },

  // 信仰级倒计时
  heroCard: { alignItems: 'center', paddingVertical: 26, backgroundColor: C.primary },
  heroLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 13, letterSpacing: 3, fontWeight: '600' },
  heroDays: { color: C.onPrimary, fontSize: 64, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 6 },
  heroUnit: { fontSize: 22, fontWeight: '600', color: 'rgba(255,255,255,0.8)' },
  heroPrecise: { color: C.onPrimary, fontSize: 36, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 12 },
  heroUnitSm: { fontSize: 16, fontWeight: '500', color: 'rgba(255,255,255,0.65)' },
  heroHint: { color: 'rgba(255,255,255,0.55)', fontSize: 11, marginTop: 10 },

  // 今日提醒横幅
  reminderBanner: {
    backgroundColor: C.orangeSoft,
    borderRadius: R.md,
    paddingVertical: 10,
    paddingHorizontal: 14,
    marginTop: 12,
    gap: 4,
  },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reminderText: { color: C.amberDeep, fontSize: 14, lineHeight: 22, flex: 1 },

  // 占位降级卡
  placeholderCard: { borderStyle: 'dashed', borderWidth: 1.5, borderColor: C.border, backgroundColor: 'transparent', elevation: 0, shadowOpacity: 0 },
  placeholderTitle: { fontSize: 15, fontWeight: '700', color: C.text2 },
  placeholderText: { fontSize: 13, color: C.text3, marginTop: 8, lineHeight: 20 },

  // 每日知识点
  knowledgeBody: { fontSize: 15, color: C.text, lineHeight: 24, marginTop: 10 },
  knowledgeHint: { fontSize: 12, color: C.text3, marginTop: 8 },

  // 每日一题
  questionText: { fontSize: 15, color: C.text, lineHeight: 24, marginTop: 10 },
  answerBox: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: C.greenSoft,
    borderRadius: R.sm,
    padding: 10,
    marginTop: 10,
  },
  answerText: { fontSize: 14, color: C.greenDeep, lineHeight: 21, flex: 1 },
  questionBtnRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  qBtn: {
    flex: 1,
    flexDirection: 'row',
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.sm,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: C.card,
  },
  qBtnDark: { backgroundColor: C.primary, borderColor: C.primary },
  qBtnText: { fontSize: 14, fontWeight: '600', color: C.text2 },
  qBtnTextDark: { color: C.onPrimary },

  // 今日三件事
  empty: { color: C.text3, fontSize: 14, marginTop: 10 },
  taskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, marginTop: 6 },
  taskCheck: { marginRight: 8 },
  taskMain: { flex: 1 },
  taskItem: { fontSize: 15, paddingVertical: 4, color: C.text, lineHeight: 22 },
  taskDone: { color: C.text3, textDecorationLine: 'line-through' },
  taskItemBacklog: { fontSize: 14, paddingVertical: 4, color: C.text2 },
  taskBtn: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: C.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  backlogBox: { marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  backlogTitle: { fontSize: 13, fontWeight: '600', color: C.text3, marginBottom: 2 },
  inputRow: { flexDirection: 'row', marginTop: 12, gap: 8 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 15,
    backgroundColor: C.bg,
    color: C.text,
  },
  addBtn: { backgroundColor: C.primary, borderRadius: R.sm, paddingHorizontal: 14, justifyContent: 'center' },
  addBtnText: { color: C.onPrimary, fontSize: 14, fontWeight: '600' },
  addBtnGhost: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  addBtnTextGhost: { color: C.text2, fontSize: 14, fontWeight: '600' },

  // 专注
  focusMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  focusMetaText: { fontSize: 13, color: C.primary, fontWeight: '600', fontVariant: ['tabular-nums'] },
  focusBtn: {
    marginTop: 14,
    backgroundColor: C.primary,
    borderRadius: R.md,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  focusBtnText: { color: C.onPrimary, fontSize: 16, fontWeight: '700' },
  sessionHint: { marginTop: 10, color: C.text3, fontSize: 13, textAlign: 'center' },

  // 心流
  flow: { flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  flowBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: GLASS.darkBorder,
    backgroundColor: GLASS.dark, // 深色场景液态玻璃：微透光 + 受光描边
    borderRadius: R.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  flowHint: { color: C.inkSub, fontSize: 13, letterSpacing: 2 },
  flowTimer: { color: C.onPrimary, fontSize: 72, fontWeight: '200', marginVertical: 36, fontVariant: ['tabular-nums'] },
  flowStop: {
    borderWidth: 1,
    borderColor: GLASS.darkBorder,
    backgroundColor: GLASS.dark,
    borderRadius: 24,
    paddingHorizontal: 32,
    paddingVertical: 12,
  },
  flowStopText: { color: C.inkText, fontSize: 15 },
  zenBtn: {
    marginTop: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: GLASS.darkBorder,
    backgroundColor: GLASS.dark,
    borderRadius: R.sm,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  zenBtnText: { color: C.inkDim, fontSize: 13 },
});

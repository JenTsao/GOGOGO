import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, Modal, Platform, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import * as IntentLauncher from 'expo-intent-launcher';
import { useTaskStore } from '@/store/taskStore';
import { useFocusStore } from '@/store/focusStore';
import { gaokaoExamDate, useSettingsStore } from '@/store/settingsStore';
import { useReminderStore, localDateStr } from '@/store/reminderStore';
import { useAiStore } from '@/store/aiStore';
import { useMoodStore } from '@/store/moodStore';
import { useMistakeStore } from '@/store/mistakeStore';
import { useAuthStore } from '@/store/authStore';
import { fetchDaily, DailyLearning } from '@/lib/cloud';
import { readDailyCache } from '@/lib/background';
import { R, cardShadow, glassRim, HIT_SLOP, themedStyles, usePalette, useScheme } from '@/theme';
import { AmbientGlow } from '@/components/AmbientGlow';
import { EggLine } from '@/components/EggLine';
import { jayEggForToday, jayMilestoneEgg, jayWeeklyEgg, nextJayLine, randomJayTaskDoneLine, randomJayTaskLine } from '@/lib/jayEggs';

const FLOW_BRIGHT = '#F2EFFB';

function greetingByHour(h: number) {
  if (h < 5) return '夜深了，注意休息';
  if (h < 11) return '早上好，稳住节奏';
  if (h < 14) return '中午好，适度放松';
  if (h < 18) return '下午好，继续推进';
  if (h < 22) return '晚上好，收尾今日';
  return '夜深了，注意休息';
}

/** 心流计时器独立订阅 seconds，避免每秒重绘驾驶舱整页 */
function FlowTimerDisplay() {
  const seconds = useFocusStore((s) => s.seconds);
  const fmt = (s: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  return <Text style={STYLES[useScheme()].flowTimer}>{fmt(seconds)}</Text>;
}

export default function CockpitScreen() {
  const C = usePalette();
  const scheme = useScheme();
  const styles = STYLES[scheme];
  // 细粒度订阅：避免 focus.tick 每秒拖动整页重渲染
  const top3 = useTaskStore((s) => s.top3);
  const backlog = useTaskStore((s) => s.backlog);
  const addTask = useTaskStore((s) => s.addTask);
  const removeTask = useTaskStore((s) => s.removeTask);
  const swapWithBacklog = useTaskStore((s) => s.swapWithBacklog);
  const completeTask = useTaskStore((s) => s.completeTask);
  const running = useFocusStore((s) => s.running);
  const sessions = useFocusStore((s) => s.sessions);
  const weatherKey = useSettingsStore((s) => s.weatherKey);
  const weatherCity = useSettingsStore((s) => s.weatherCity);
  const supabaseUrl = useSettingsStore((s) => s.supabaseUrl);
  const supabaseAnonKey = useSettingsStore((s) => s.supabaseAnonKey);
  const accessKey = useSettingsStore((s) => s.accessKey);
  const reminders = useReminderStore((s) => s.reminders);
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [draft, setDraft] = useState('');
  const [weather, setWeather] = useState<{ temp: number; desc: string } | null>(null);
  const [inFlow, setInFlow] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [countdownMode, setCountdownMode] = useState<'days' | 'precise'>('days');
  const [daily, setDaily] = useState<DailyLearning | null>(null);
  const [dailyState, setDailyState] = useState<'loading' | 'ok' | 'empty' | 'error' | 'unconfigured'>('loading');
  const [knowledgeFlipped, setKnowledgeFlipped] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [today, setToday] = useState(() => new Date());
  // 心流氛围句：进入心流时随机抽一句周杰伦「歌名梗」彩蛋
  const [flowLine, setFlowLine] = useState('');
  // 三件事空状态句：挂载时抽一次，避免重渲染闪烁
  const taskEmptyLine = useMemo(() => randomJayTaskLine(), []);
  // 三件事全勤句：达成时刻的确定性彩蛋奖励
  const taskDoneLine = useMemo(() => randomJayTaskDoneLine(), []);

  useEffect(() => {
    const id = setInterval(() => setToday(new Date()), 60000);
    return () => clearInterval(id);
  }, []);
  const todayStr = localDateStr(today);

  // 高考日期：「我的」自定义年份优先，未设置自动推断；以 today（60s 刷新）为基准，跨天/改设置即时生效
  const examYearSetting = useSettingsStore((s) => s.examYear);
  const examDate = useMemo(() => gaokaoExamDate(today), [today, examYearSetting]);
  const examYear = examDate.getFullYear();
  const msLeft = Math.max(0, examDate.getTime() - today.getTime());
  const daysLeft = Math.ceil(msLeft / 86400000);
  const preciseLeft = {
    days: Math.floor(msLeft / 86400000),
    hours: Math.floor((msLeft % 86400000) / 3600000),
    minutes: Math.floor((msLeft % 3600000) / 60000),
  };

  // 问候语优先级：特定日期彩蛋（生日/发行日/高考日）> 倒计时里程碑（100/50/30/10/3/2/1/0 天）> 常规时段问候
  const greeting = useMemo(
    () => jayEggForToday(today) ?? jayMilestoneEgg(daysLeft) ?? greetingByHour(today.getHours()),
    [today, daysLeft]
  );

  const todayReminders = useMemo(
    () => reminders.filter((r) => r.date === todayStr),
    [reminders, todayStr]
  );

  const dailyStateText = useMemo(() => {
    switch (dailyState) {
      case 'unconfigured':
        return '配置云端后，这里会显示 AI 每日生成的知识点与一题';
      case 'loading':
        return '正在拉取今日备课…';
      case 'empty':
        return '今日内容尚未生成（凌晨 04:00 备课流水线）';
      case 'error':
        return '云端读取失败，下拉可重试';
      default:
        return '';
    }
  }, [dailyState]);

  const todayFocusMin = useMemo(() => {
    return Math.round(
      sessions
        .filter((s) => localDateStr(new Date(s.endedAt)) === todayStr)
        .reduce((sum, s) => sum + s.duration, 0) / 60
    );
  }, [sessions, todayStr]);

  const top3Done = top3.filter((t) => t.status === 'done').length;
  const top3Full = top3.length >= 3;
  const top3Progress = top3.length === 0 ? 0 : top3Done / top3.length;

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => useFocusStore.getState().tick(), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    void useAuthStore.getState().init();
    useTaskStore.getState().syncTasks();
    useFocusStore.getState().syncSessions();
    useMoodStore.getState().load();
    useMoodStore.getState().syncAll();
    const { webApiUrl, accessKey: key } = useSettingsStore.getState();
    if (webApiUrl && key) {
      void useMistakeStore.getState().syncAll(webApiUrl, key);
      void useReminderStore.getState().sync(webApiUrl, key);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        if (!cancelled) setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude });
      } catch {}
    })();
    return () => { cancelled = true; };
  }, []);

  const loadWeather = useCallback(() => {
    if (!weatherKey) return;
    const query = coords
      ? `lat=${coords.lat}&lon=${coords.lon}`
      : weatherCity
        ? `q=${encodeURIComponent(weatherCity)}`
        : null;
    if (!query) return;
    fetch(`https://api.openweathermap.org/data/2.5/weather?${query}&appid=${weatherKey}&units=metric&lang=zh_cn`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data) => setWeather({ temp: Math.round(data.main.temp), desc: data.weather?.[0]?.description ?? '' }))
      .catch(() => setWeather(null));
  }, [weatherKey, weatherCity, coords]);

  useEffect(() => { loadWeather(); }, [loadWeather]);

  const loadDaily = useCallback(() => {
    if (!supabaseUrl || !supabaseAnonKey || !accessKey) {
      setDailyState('unconfigured');
      return Promise.resolve();
    }
    setDailyState('loading');
    return fetchDaily({ supabaseUrl, supabaseAnonKey, accessKey }, todayStr)
      .then((d) => {
        setDaily(d);
        setDailyState(d ? 'ok' : 'empty');
      })
      .catch(() => {
        const cached = readDailyCache();
        if (cached) {
          setDaily(cached);
          setDailyState('ok');
        } else {
          setDailyState('error');
        }
      });
  }, [supabaseUrl, supabaseAnonKey, accessKey, todayStr]);

  useEffect(() => { void loadDaily(); }, [loadDaily]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    loadWeather();
    await loadDaily();
    setRefreshing(false);
  }, [loadWeather, loadDaily]);

  const weatherTip = (temp: number) =>
    temp >= 30 ? '太热，多喝水' : temp >= 22 ? '适合刷题' : temp >= 12 ? '微凉，穿外套' : '注意保暖';

  const submitTask = (status: 'top3' | 'backlog') => {
    const content = draft.trim();
    if (!content) return;
    if (status === 'top3' && top3Full) {
      addTask(content, 'backlog');
    } else {
      addTask(content, status);
    }
    setDraft('');
  };

  const enterFlow = () => {
    const f = useFocusStore.getState();
    f.reset();
    f.start();
    f.setSuppressNotifications(true);
    setFlowLine(nextJayLine());
    setInFlow(true);
  };
  const exitFlow = () => {
    const f = useFocusStore.getState();
    f.stop();
    f.setSuppressNotifications(false);
    setInFlow(false);
  };

  const openZenMode = async () => {
    if (Platform.OS !== 'android') return;
    try {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.ZEN_MODE_SETTINGS);
    } catch {
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_SETTINGS);
    }
  };

  return (
    <View style={styles.screen}>
      {/* 环境光斑：半透玻璃卡透出的色彩来源，必须铺在滚动内容之下 */}
      <AmbientGlow />
      {/* 心流隐藏状态栏；非心流时必须显式跟随主题——expo-status-bar 后挂载者优先，
          缺省 style 会覆盖根布局的动态设置，导致手动深色模式下状态栏图标不可见 */}
      <StatusBar hidden={inFlow} animated style={scheme === 'dark' ? 'light' : 'dark'} />
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 10 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.primary} colors={[C.primary]} />
        }
      >
        <View style={styles.topBar}>
          <View style={styles.topBarLeft}>
            <Text style={styles.greeting}>{greeting}</Text>
            <Text style={styles.date}>
              {today.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' })}
              {weather ? ` · ${weather.temp}° ${weather.desc}` : ''}
            </Text>
          </View>
          <TouchableOpacity
            style={styles.weatherChip}
            activeOpacity={0.85}
            onPress={() => {
              if (!weatherKey) router.push('/profile');
              else loadWeather();
            }}
          >
            <Ionicons
              name={!weather ? 'partly-sunny-outline' : weather.temp >= 30 ? 'sunny' : weather.temp >= 12 ? 'cloudy-outline' : 'snow'}
              size={16}
              color={C.primary}
            />
            <Text style={styles.weatherChipText} numberOfLines={1}>
              {weather ? weatherTip(weather.temp) : weatherKey ? '获取中' : '设天气'}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.card, styles.heroCard]}
          activeOpacity={0.9}
          onPress={() => setCountdownMode((m) => (m === 'days' ? 'precise' : 'days'))}
        >
          <Text style={styles.heroLabel}>距离 {examYear} 高考</Text>
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
          <Text style={styles.heroHint}>轻点切换 · 精确到分</Text>
        </TouchableOpacity>

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

        {dailyState === 'ok' && daily?.knowledge_body ? (
          <TouchableOpacity style={styles.card} activeOpacity={0.85} onPress={() => setKnowledgeFlipped((v) => !v)}>
            <View style={styles.cardHead}>
              <View style={[styles.cardBadge, styles.badgeBlue]}>
                <Ionicons name="book" size={13} color={C.blue} />
              </View>
              <Text style={styles.cardTitle}>每日知识点</Text>
              <Ionicons name={knowledgeFlipped ? 'chevron-up' : 'chevron-down'} size={16} color={C.text3} />
            </View>
            <Text style={styles.knowledgeBody} numberOfLines={knowledgeFlipped ? undefined : 3}>
              {daily.knowledge_body}
            </Text>
            <Text style={styles.knowledgeHint}>{knowledgeFlipped ? '点击收起' : '点击展开全文'}</Text>
          </TouchableOpacity>
        ) : null}

        {dailyState === 'ok' && daily?.question_text ? (
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={[styles.cardBadge, styles.badgePurple]}>
                <Ionicons name="pencil" size={13} color={C.primary} />
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
              <TouchableOpacity style={styles.qBtn} onPress={() => setShowAnswer((v) => !v)} activeOpacity={0.85}>
                <Ionicons name={showAnswer ? 'eye-off-outline' : 'eye-outline'} size={15} color={C.text2} />
                <Text style={styles.qBtnText}>{showAnswer ? '隐藏答案' : '显示答案'}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.qBtn, styles.qBtnDark]}
                activeOpacity={0.85}
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
        ) : null}

        {dailyState !== 'ok' && (
          <TouchableOpacity
            style={[styles.card, styles.setupCard]}
            activeOpacity={0.85}
            onPress={() => {
              if (dailyState === 'unconfigured') router.push('/profile');
              else void loadDaily();
            }}
          >
            <View style={styles.cardHead}>
              <View style={[styles.cardBadge, styles.badgePurple]}>
                {dailyState === 'loading' ? (
                  <ActivityIndicator size="small" color={C.primary} />
                ) : (
                  <Ionicons name="cloud-outline" size={13} color={C.primary} />
                )}
              </View>
              <Text style={styles.cardTitle}>每日备课</Text>
              {dailyState === 'unconfigured' && <Ionicons name="chevron-forward" size={16} color={C.primary} />}
            </View>
            <Text style={styles.setupText}>{dailyStateText}</Text>
            {dailyState === 'unconfigured' && <Text style={styles.setupCta}>去「我的」完成云端配置 →</Text>}
            {(dailyState === 'error' || dailyState === 'empty') && (
              <Text style={styles.setupCta}>轻点重试 · 也可下拉刷新</Text>
            )}
          </TouchableOpacity>
        )}

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={[styles.cardBadge, styles.badgeGreen]}>
              <Ionicons name="flag" size={13} color={C.green} />
            </View>
            <Text style={styles.cardTitle}>今日三件事</Text>
            <Text style={styles.sectionMeta}>{top3Done}/{top3.length || 0}</Text>
          </View>
          {top3.length > 0 && (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.round(top3Progress * 100)}%` as unknown as number }]} />
            </View>
          )}
          {top3.length > 0 && top3Done === top3.length && (
            <EggLine line={taskDoneLine} tone="soft" style={{ marginTop: 10 }} />
          )}
          {top3.length === 0 && (
            <View style={styles.emptyBox}>
              <Ionicons name="checkbox-outline" size={20} color={C.text3} />
              <Text style={styles.empty}>{taskEmptyLine}</Text>
            </View>
          )}
          {top3.map((t) => (
            <View key={t.id} style={styles.taskRow}>
              <TouchableOpacity style={styles.taskCheck} onPress={() => completeTask(t.id)} hitSlop={HIT_SLOP}>
                {t.status === 'done' ? (
                  <Ionicons name="checkmark-circle" size={22} color={C.green} />
                ) : (
                  <Ionicons name="ellipse-outline" size={22} color={C.border} />
                )}
              </TouchableOpacity>
              <TouchableOpacity style={styles.taskMain} onPress={() => completeTask(t.id)}>
                <Text style={[styles.taskItem, t.status === 'done' && styles.taskDone]} numberOfLines={2}>{t.content}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.taskBtn} onPress={() => swapWithBacklog(t.id)} hitSlop={HIT_SLOP}>
                <Ionicons name="swap-horizontal" size={16} color={C.text3} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.taskBtn} onPress={() => removeTask(t.id)} hitSlop={HIT_SLOP}>
                <Ionicons name="close" size={16} color={C.text3} />
              </TouchableOpacity>
            </View>
          ))}

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder={top3Full ? '今日已满，将进入后备箱…' : '添加任务…'}
              placeholderTextColor={C.text3}
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={() => submitTask(top3Full ? 'backlog' : 'top3')}
              returnKeyType="done"
            />
            <TouchableOpacity style={[styles.addBtn, top3Full && styles.addBtnMuted]} onPress={() => submitTask('top3')} activeOpacity={0.85}>
              <Text style={styles.addBtnText}>{top3Full ? '满' : '今日'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.addBtn, styles.addBtnGhost]} onPress={() => submitTask('backlog')} activeOpacity={0.85}>
              <Text style={styles.addBtnTextGhost}>后备箱</Text>
            </TouchableOpacity>
          </View>

          {backlog.length > 0 && (
            <View style={styles.backlogBox}>
              <Text style={styles.backlogTitle}>后备箱 · {backlog.length}</Text>
              {backlog.map((t) => (
                <View key={t.id} style={styles.taskRow}>
                  <TouchableOpacity
                    style={styles.taskMain}
                    onPress={() => {
                      if (top3Full) return;
                      removeTask(t.id);
                      addTask(t.content, 'top3');
                    }}
                  >
                    <Text style={styles.taskItemBacklog} numberOfLines={1}>{top3Full ? '· ' : '↩ '}{t.content}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.taskBtn} onPress={() => removeTask(t.id)} hitSlop={HIT_SLOP}>
                    <Ionicons name="close" size={16} color={C.text3} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHead}>
            <View style={[styles.cardBadge, styles.badgePurple]}>
              <Ionicons name="headset" size={13} color={C.primary} />
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
            <Ionicons name="play" size={17} color={C.onPrimary} />
            <Text style={styles.focusBtnText}>进入心流</Text>
          </TouchableOpacity>
          {sessions.length > 0 && (
            <Text style={styles.sessionHint}>
              最近一次 {Math.round(sessions[0].duration / 60)} 分钟 · 累计 {sessions.length} 次
              {sessions[0].duration >= 45 * 60 ? ' · 《以父之名》级的坚持' : ''}
            </Text>
          )}
        </View>
      </ScrollView>

      <Modal visible={inFlow} animationType="fade" statusBarTranslucent onRequestClose={exitFlow}>
        <View style={[styles.flow, { paddingTop: insets.top }]}>
          <View style={styles.flowBadge}>
            <Ionicons name="moon" size={14} color={C.inkSub} />
            <Text style={styles.flowHint}>心流进行中 · 通知已静默</Text>
          </View>
          <FlowTimerDisplay />
          {!!flowLine && <EggLine line={flowLine} tone="ink" style={{ marginTop: -20, marginBottom: 16 }} />}
          {Platform.OS === 'android' && (
            <TouchableOpacity style={styles.zenBtn} onPress={openZenMode} activeOpacity={0.85}>
              <Ionicons name="notifications-off-outline" size={16} color={C.inkDim} />
              <Text style={styles.zenBtnText}>开启系统免打扰</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.flowStop} onPress={exitFlow} activeOpacity={0.8}>
            <Text style={styles.flowStopText}>结束心流</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

const STYLES = themedStyles((C) => ({
  // 底色容器：光斑铺在这一层之上、滚动内容之下（container 透明让光斑可见）
  screen: { flex: 1, backgroundColor: C.bg },
  container: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 104 },
  topBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  topBarLeft: { flex: 1, marginRight: 10 },
  greeting: { color: C.text, fontSize: 18, fontWeight: '700', letterSpacing: 0.15 },
  date: { color: C.text3, fontSize: 12, marginTop: 3, lineHeight: 17 },
  weatherChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.primarySoft, borderRadius: R.pill,
    paddingHorizontal: 10, paddingVertical: 6, marginTop: 2, maxWidth: 120,
  },
  weatherChipText: { color: C.primaryDeep, fontSize: 12, fontWeight: '600' },
  // 玻璃卡：半透面透出环境光斑 + 顶缘受光描边；深色模式 glassCard 自动切换为实底
  card: { backgroundColor: C.glassCard, borderRadius: R.lg, padding: 14, marginTop: 10, ...glassRim(C), ...cardShadow },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cardBadge: { width: 26, height: 26, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  badgePurple: { backgroundColor: C.primarySoft },
  badgeBlue: { backgroundColor: C.blueSoft },
  badgeGreen: { backgroundColor: C.greenSoft },
  cardTitle: { fontSize: 15, fontWeight: '700', color: C.text, flex: 1 },
  sectionMeta: { fontSize: 12, color: C.text3, fontWeight: '600', fontVariant: ['tabular-nums'] },
  heroCard: { alignItems: 'center', paddingVertical: 22, backgroundColor: C.primary },
  heroLabel: { color: C.onPrimary, fontSize: 12, letterSpacing: 2, fontWeight: '600', opacity: 0.78 },
  heroDays: { color: C.onPrimary, fontSize: 56, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 4 },
  heroUnit: { fontSize: 20, fontWeight: '600', color: C.onPrimary, opacity: 0.8 },
  heroPrecise: { color: C.onPrimary, fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'], marginTop: 8 },
  heroUnitSm: { fontSize: 15, fontWeight: '500', color: C.onPrimary, opacity: 0.65 },
  heroHint: { color: C.onPrimary, fontSize: 11, marginTop: 8, opacity: 0.5 },
  reminderBanner: {
    backgroundColor: C.orangeSoft, borderRadius: R.md,
    paddingVertical: 10, paddingHorizontal: 12, marginTop: 10, gap: 4,
  },
  reminderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reminderText: { color: C.amberDeep, fontSize: 13, lineHeight: 20, flex: 1 },
  setupCard: { borderWidth: 1, borderColor: C.border },
  setupText: { fontSize: 13, color: C.text3, marginTop: 8, lineHeight: 19 },
  setupCta: { fontSize: 13, color: C.primary, fontWeight: '700', marginTop: 8 },
  knowledgeBody: { fontSize: 14, color: C.text, lineHeight: 22, marginTop: 8 },
  knowledgeHint: { fontSize: 12, color: C.text3, marginTop: 6 },
  questionText: { fontSize: 14, color: C.text, lineHeight: 22, marginTop: 8 },
  answerBox: { flexDirection: 'row', gap: 6, backgroundColor: C.greenSoft, borderRadius: R.sm, padding: 10, marginTop: 8 },
  answerText: { fontSize: 13, color: C.greenDeep, lineHeight: 20, flex: 1 },
  questionBtnRow: { flexDirection: 'row', gap: 8, marginTop: 12 },
  qBtn: {
    flex: 1, flexDirection: 'row', borderWidth: 1, borderColor: C.border, borderRadius: R.sm,
    paddingVertical: 10, alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: C.card,
  },
  qBtnDark: { backgroundColor: C.primary, borderColor: C.primary },
  qBtnText: { fontSize: 13, fontWeight: '600', color: C.text2 },
  qBtnTextDark: { color: C.onPrimary },
  emptyBox: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  empty: { color: C.text3, fontSize: 13, lineHeight: 18, flex: 1 },
  progressTrack: { height: 3, backgroundColor: C.surfaceAlt, borderRadius: 2, marginTop: 8, marginBottom: 2, overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: C.green, borderRadius: 2 },
  taskRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, marginTop: 2 },
  taskCheck: { marginRight: 6 },
  taskMain: { flex: 1 },
  taskItem: { fontSize: 14, paddingVertical: 3, color: C.text, lineHeight: 20 },
  taskDone: { color: C.text3, textDecorationLine: 'line-through' },
  taskItemBacklog: { fontSize: 13, paddingVertical: 3, color: C.text2 },
  taskBtn: { width: 34, height: 34, borderRadius: 9, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  backlogBox: { marginTop: 10, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  backlogTitle: { fontSize: 12, fontWeight: '600', color: C.text3, marginBottom: 2 },
  inputRow: { flexDirection: 'row', marginTop: 10, gap: 6 },
  input: {
    flex: 1, borderWidth: 1, borderColor: C.border, borderRadius: R.sm,
    paddingHorizontal: 11, paddingVertical: 9, fontSize: 14, backgroundColor: C.bg, color: C.text,
  },
  addBtn: { backgroundColor: C.primary, borderRadius: R.sm, paddingHorizontal: 12, justifyContent: 'center', minHeight: 40 },
  addBtnMuted: { opacity: 0.55 },
  addBtnText: { color: C.onPrimary, fontSize: 13, fontWeight: '600' },
  addBtnGhost: { backgroundColor: C.bg, borderWidth: 1, borderColor: C.border },
  addBtnTextGhost: { color: C.text2, fontSize: 13, fontWeight: '600' },
  focusMeta: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  focusMetaText: { fontSize: 12, color: C.primary, fontWeight: '600', fontVariant: ['tabular-nums'] },
  focusBtn: {
    marginTop: 12, backgroundColor: C.primary, borderRadius: R.md,
    paddingVertical: 13, paddingHorizontal: 16,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  focusBtnText: { color: C.onPrimary, fontSize: 15, fontWeight: '700' },
  sessionHint: { marginTop: 8, color: C.text3, fontSize: 12, textAlign: 'center' },
  flow: { flex: 1, backgroundColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  flowBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1,
    borderColor: C.glassDarkBorder, backgroundColor: C.glassDark, borderRadius: R.pill,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  flowHint: { color: C.inkSub, fontSize: 13, letterSpacing: 2 },
  flowTimer: { color: FLOW_BRIGHT, fontSize: 68, fontWeight: '200', marginVertical: 32, fontVariant: ['tabular-nums'] },
  flowStop: {
    borderWidth: 1, borderColor: C.glassDarkBorder, backgroundColor: C.glassDark,
    borderRadius: 24, paddingHorizontal: 32, paddingVertical: 12,
  },
  flowStopText: { color: C.inkText, fontSize: 15 },
  zenBtn: {
    marginTop: 20, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1,
    borderColor: C.glassDarkBorder, backgroundColor: C.glassDark, borderRadius: R.sm,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  zenBtnText: { color: C.inkDim, fontSize: 13 },
}));

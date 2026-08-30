import { View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator, Platform, StyleSheet, BackHandler } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettingsStore } from '@/store/settingsStore';
import { useAuthStore } from '@/store/authStore';
import { useReminderStore, localDateStr } from '@/store/reminderStore';
import { useFocusStore } from '@/store/focusStore';
import { useTaskStore } from '@/store/taskStore';
import { useMistakeStore } from '@/store/mistakeStore';
import { LLM_PRESETS } from '@/lib/llm';
import { fetchDaily } from '@/lib/cloud';
import { writeDailyCache } from '@/lib/background';
import { fetchRepoPaths } from '@/lib/github';
import { R, cardShadow, glassRim, HIT_SLOP, themedStyles, usePalette, useScheme, type ThemeMode } from '@/theme';
import { AmbientGlow } from '@/components/AmbientGlow';
import { jayLineCount, nextJayLine } from '@/lib/jayEggs';

type ViewMode = 'hub' | 'settings' | 'about';
type Sec =
  | 'appearance'
  | 'llm'
  | 'stt'
  | 'tts'
  | 'vision'
  | 'cloud'
  | 'auth'
  | 'search'
  | 'kb'
  | 'reminder'
  | 'sync'
  | 'keepalive';

// 关于页核心能力清单：模块级常量避免每次渲染重建；soft 底 + 语义色图标与全站菜单行一致
const ABOUT_FEATURES: {
  icon: keyof typeof Ionicons.glyphMap;
  color: 'primary' | 'blue' | 'green' | 'orange';
  soft: 'primarySoft' | 'blueSoft' | 'greenSoft' | 'orangeSoft';
  title: string;
  desc: string;
}[] = [
  { icon: 'timer-outline', color: 'primary', soft: 'primarySoft', title: '驾驶舱与心流', desc: '高考倒计时 · 今日三件事 · 全屏心流计时' },
  { icon: 'albums-outline', color: 'blue', soft: 'blueSoft', title: '弹药库', desc: '代码沙盒 · 知识库双链阅读 · 拍照错题本' },
  { icon: 'sparkles-outline', color: 'green', soft: 'greenSoft', title: 'AI 陪伴', desc: '悬浮球对话 · 拍题讲解 · 工具调度' },
  { icon: 'stats-chart-outline', color: 'orange', soft: 'orangeSoft', title: '学习画像', desc: '六维雷达 · 专注热力 · 情绪与横向对标' },
];

function daysToGaokao() {
  const now = new Date();
  const y = now.getFullYear();
  const exam =
    now.getTime() >= new Date(y, 5, 7, 9, 0, 0).getTime()
      ? new Date(y + 1, 5, 7, 9, 0, 0)
      : new Date(y, 5, 7, 9, 0, 0);
  return Math.ceil(Math.max(0, exam.getTime() - now.getTime()) / 86400000);
}

export default function ProfileScreen() {
  const C = usePalette();
  const styles = STYLES[useScheme()];
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<ViewMode>('hub');

  const {
    weatherKey, weatherCity, targetUniversity, targetScore, githubRepo, githubBranch,
    llmProvider, llmBaseUrl, llmModel, llmApiKey,
    sttBaseUrl, sttApiKey, sttModel,
    ttsBaseUrl, ttsApiKey, ttsModel, ttsVoice,
    visionBaseUrl, visionApiKey, visionModel,
    supabaseUrl, supabaseAnonKey, accessKey, tavilyKey, webApiUrl, themeMode, orbStyle, update,
  } = useSettingsStore();
  const { reminders, addReminder, removeReminder } = useReminderStore();
  const sessions = useFocusStore((s) => s.sessions);
  const top3 = useTaskStore((s) => s.top3);
  const mistakes = useMistakeStore((s) => s.mistakes);
  const { email: authEmail, busy: authBusy, error: authError, init, signIn, signUp, signOut } = useAuthStore();

  const [authEmailInput, setAuthEmailInput] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [openSec, setOpenSec] = useState<Record<Sec, boolean>>({
    appearance: true, llm: false, stt: false, tts: false, vision: false, cloud: false,
    auth: true, search: false, kb: false, reminder: false, sync: false, keepalive: false,
  });
  const toggleSec = (k: Sec) => setOpenSec((s) => ({ ...s, [k]: !s[k] }));

  useEffect(() => { void init(); }, [init]);

  // 总设置/关于是页内二级视图：拦截系统返回，回到「我的」中心，而不是跳出到驾驶舱 Tab
  useFocusEffect(
    useCallback(() => {
      if (view === 'hub') return undefined;
      const onBack = () => {
        setView('hub');
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
      return () => sub.remove();
    }, [view])
  );

  const today = localDateStr(new Date());
  const gaokaoDays = useMemo(() => daysToGaokao(), []);
  const todayFocusMin = useMemo(
    () => Math.round(sessions.filter((s) => localDateStr(new Date(s.endedAt)) === today).reduce((sum, s) => sum + s.duration, 0) / 60),
    [sessions, today]
  );
  const weekFocusMin = useMemo(() => {
    const cutoff = Date.now() - 7 * 86400000;
    return Math.round(sessions.filter((s) => new Date(s.endedAt).getTime() >= cutoff).reduce((sum, s) => sum + s.duration, 0) / 60);
  }, [sessions]);
  const top3Done = top3.filter((t) => t.status === 'done').length;
  const upcoming = useMemo(
    () => reminders.filter((r) => r.date >= today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5),
    [reminders, today]
  );
  const displayName = authEmail ? authEmail.split('@')[0] : targetUniversity ? '备考中' : '同学';
  const initial = (displayName[0] || 'G').toUpperCase();

  const pickPreset = (key: string) => {
    const preset = LLM_PRESETS[key];
    if (key === 'custom') { update({ llmProvider: key }); return; }
    update({ llmProvider: key, llmBaseUrl: preset.baseUrl || '', llmModel: preset.model || '' });
  };

  const [reminderDate, setReminderDate] = useState('');
  const [reminderText, setReminderText] = useState('');
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());
  const monthGrid = useMemo(() => {
    const startWeek = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const cells: (string | null)[] = Array(startWeek).fill(null);
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push(`${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`);
    }
    return cells;
  }, [viewYear, viewMonth]);
  const reminderDates = useMemo(() => new Set(reminders.map((r) => r.date)), [reminders]);
  const shiftMonth = (delta: number) => {
    const d = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const submitReminder = () => {
    const content = reminderText.trim();
    const raw = reminderDate.trim();
    if (!content || !raw) return;
    const full = /^\d{1,2}-\d{1,2}$/.test(raw) ? `${viewYear}-${raw}` : raw;
    const m = full.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1) return;
    addReminder(localDateStr(d), content);
    setReminderText('');
  };

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  // 隐藏歌单彩蛋：关于页版本徽章连点 5 次解锁，之后每点一次换一句
  const [eggTaps, setEggTaps] = useState(0);
  const [eggLine, setEggLine] = useState<string | null>(null);
  const tapEgg = () => {
    const n = eggTaps + 1;
    setEggTaps(n);
    if (n >= 5) setEggLine(nextJayLine());
  };
  const runSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    const parts: string[] = [];
    const s = useSettingsStore.getState();
    const day = localDateStr(new Date());
    if (s.supabaseUrl && s.supabaseAnonKey && s.accessKey) {
      try {
        const daily = await fetchDaily(
          { supabaseUrl: s.supabaseUrl, supabaseAnonKey: s.supabaseAnonKey, accessKey: s.accessKey },
          day
        );
        if (daily) {
          writeDailyCache(daily);
          parts.push(`· ${day} 备课内容已预取（驾驶舱离线兜底生效）`);
        } else {
          parts.push('· 云端暂无今日备课内容（等凌晨流水线生成）');
        }
      } catch {
        parts.push('· 备课拉取失败，保留旧缓存兜底');
      }
    } else {
      parts.push('· 未配置 Supabase / 访问密钥，跳过备课预取');
    }
    if (s.webApiUrl && s.accessKey) {
      try {
        await useReminderStore.getState().sync(s.webApiUrl, s.accessKey);
        parts.push(`· 提醒已云同步（${useReminderStore.getState().reminders.length} 条）`);
      } catch {
        parts.push('· 提醒云同步失败（本地数据不受影响）');
      }
    }
    if (/^[\w.-]+\/[\w.-]+$/.test(s.githubRepo.trim())) {
      try {
        const list = await fetchRepoPaths(s.githubRepo.trim(), s.githubBranch.trim() || 'main');
        parts.push(`· Obsidian 目录可达（${list.length} 篇笔记）`);
      } catch (e) {
        parts.push(`· 目录拉取失败（${(e as Error).name === 'AbortError' ? '请求超时' : (e as Error).message}）`);
      }
    } else {
      parts.push('· 未配置 GitHub 仓库，跳过目录检查');
    }
    setSyncResult(parts.join('\n'));
    setSyncing(false);
  };

  const openKeepAlive = async () => {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
        category: 'android.intent.category.LAUNCHER',
        packageName: 'com.vivo.permissionmanager',
        className: 'com.vivo.permissionmanager.activity.BgStartUpManager',
      });
      return;
    } catch {}
    try {
      const pkg = Constants.expoConfig?.android?.package ?? 'com.gaokao.copilot';
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, {
        data: `package:${pkg}`,
      });
      return;
    } catch {}
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_SETTINGS).catch(() => {});
  };

  const appVersion = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? '1.0.0';

  const MenuRow = ({
    icon, color, title, subtitle, onPress, right,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    title: string;
    subtitle?: string;
    onPress: () => void;
    right?: string;
  }) => (
    <TouchableOpacity style={styles.menuRow} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.menuIcon, { backgroundColor: C.primarySoft }]}>
        <Ionicons name={icon} size={18} color={color} />
      </View>
      <View style={styles.menuBody}>
        <Text style={styles.menuTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.menuSub}>{subtitle}</Text>}
      </View>
      {!!right && <Text style={styles.menuRight}>{right}</Text>}
      <Ionicons name="chevron-forward" size={16} color={C.text3} />
    </TouchableOpacity>
  );

  const SecHead = ({ sec, icon, color, title }: { sec: Sec; icon: keyof typeof Ionicons.glyphMap; color: string; title: string }) => (
    <TouchableOpacity style={styles.sectionHead} onPress={() => toggleSec(sec)} activeOpacity={0.85}>
      <Ionicons name={icon} size={16} color={color} />
      <Text style={styles.sectionTitle}>{title}</Text>
      <Ionicons name={openSec[sec] ? 'chevron-up' : 'chevron-down'} size={16} color={C.text3} />
    </TouchableOpacity>
  );

  if (view === 'hub') {
    return (
      <View style={styles.screen}>
        <AmbientGlow />
        <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
        <View style={styles.heroCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.heroMeta}>
            <Text style={styles.heroName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.heroSub} numberOfLines={1}>{authEmail ? authEmail : '未登录 · 本地模式可用'}</Text>
            {!!targetUniversity && (
              <Text style={styles.heroGoal} numberOfLines={1}>
                目标 {targetUniversity}{targetScore != null ? ` · ${targetScore} 分` : ''}
              </Text>
            )}
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{gaokaoDays}</Text>
            <Text style={styles.statLabel}>距高考</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{todayFocusMin}</Text>
            <Text style={styles.statLabel}>今日专注</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{top3Done}/{top3.length || 0}</Text>
            <Text style={styles.statLabel}>今日任务</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{mistakes.length}</Text>
            <Text style={styles.statLabel}>错题</Text>
          </View>
        </View>

        <Text style={styles.blockLabel}>
          本周专注 {weekFocusMin} 分钟
          {weekFocusMin >= 600 ? ' · 《以父之名》级存在感' : weekFocusMin >= 300 ? ' · 《轨迹》不会骗人' : ''}
        </Text>

        <View style={styles.section}>
          <View style={styles.sectionHeadStatic}>
            <Ionicons name="notifications-outline" size={16} color={C.orange} />
            <Text style={styles.sectionTitle}>近期提醒</Text>
          </View>
          {upcoming.length === 0 ? (
            <Text style={styles.placeholder}>暂无未来提醒 · 可在总设置里添加</Text>
          ) : (
            upcoming.map((r) => (
              <View key={r.id} style={styles.reminderItem}>
                <Text style={styles.reminderItemText}>{r.date} · {r.content}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <MenuRow
            icon="settings-outline"
            color={C.primary}
            title="总设置"
            subtitle="外观 · AI · 云端 · 账号 · 知识库"
            onPress={() => setView('settings')}
          />
          <MenuRow
            icon="cloud-download-outline"
            color={C.green}
            title="立即同步"
            subtitle="备课预取 · 提醒 · 知识库可达性"
            onPress={() => {
              setView('settings');
              setOpenSec((s) => ({ ...s, sync: true }));
              void runSync();
            }}
          />
          <MenuRow
            icon="school-outline"
            color={C.blue}
            title="备考目标"
            subtitle={targetUniversity ? `${targetUniversity}${targetScore != null ? ` · ${targetScore} 分` : ''}` : '尚未设定目标大学'}
            onPress={() => {
              setView('settings');
              setOpenSec((s) => ({ ...s, search: true }));
            }}
            right={targetScore != null ? String(targetScore) : undefined}
          />
          <MenuRow
            icon="person-circle-outline"
            color={C.green}
            title="账号"
            subtitle={authEmail ? '已登录，多设备数据一致' : '登录后自动对齐访问密钥'}
            onPress={() => {
              setView('settings');
              setOpenSec((s) => ({ ...s, auth: true, cloud: true }));
            }}
          />
          {Platform.OS === 'android' && (
            <MenuRow
              icon="shield-checkmark-outline"
              color={C.orange}
              title="后台保活"
              subtitle="允许自启动，保证提醒与备课生效"
              onPress={openKeepAlive}
            />
          )}
          <MenuRow
            icon="information-circle-outline"
            color={C.text2}
            title="关于"
            subtitle={`版本 ${appVersion}`}
            onPress={() => setView('about')}
          />
        </View>
      </ScrollView>
      </View>
    );
  }

  if (view === 'about') {
    return (
      <View style={styles.screen}>
        <AmbientGlow />
        <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity style={styles.backRow} onPress={() => setView('hub')} activeOpacity={0.85}>
          <Ionicons name="chevron-back" size={22} color={C.primary} />
          <Text style={styles.backText}>返回「我的」</Text>
        </TouchableOpacity>

        {/* 品牌头卡：Logo + 名称 + 版本徽章 + 定位标语 */}
        <View style={[styles.section, styles.aboutHero]}>
          <View style={styles.aboutLogo}>
            <Ionicons name="school" size={34} color={C.onPrimary} />
          </View>
          <Text style={styles.aboutName}>高考副驾驶</Text>
          <View style={styles.aboutVersionChip}>
            <Text style={styles.aboutVersionText}>
              v{appVersion} · {Platform.OS === 'ios' ? 'iOS' : 'Android'}
            </Text>
          </View>
          <Text style={styles.aboutTagline}>专注 · 错题 · AI 陪伴备考</Text>
          <Text style={styles.aboutSlogan}>本地瞬时响应 · 云端永不关机 · 知识资产专业化治理</Text>
        </View>

        {/* 核心能力：四大模块一览 */}
        <View style={styles.section}>
          <View style={styles.sectionHeadStatic}>
            <Ionicons name="sparkles" size={16} color={C.primary} />
            <Text style={styles.sectionTitle}>核心能力</Text>
          </View>
          {ABOUT_FEATURES.map((f) => (
            <View key={f.title} style={styles.featureRow}>
              <View style={[styles.featureIcon, { backgroundColor: C[f.soft] }]}>
                <Ionicons name={f.icon} size={18} color={C[f.color]} />
              </View>
              <View style={styles.featureBody}>
                <Text style={styles.featureTitle}>{f.title}</Text>
                <Text style={styles.featureDesc}>{f.desc}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* 运行信息：版本 / 构建 / 系统 / 运行环境 / 倒计时 */}
        <View style={styles.section}>
          <View style={styles.sectionHeadStatic}>
            <Ionicons name="information-circle-outline" size={16} color={C.blue} />
            <Text style={styles.sectionTitle}>运行信息</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>应用版本</Text>
            <Text style={styles.infoValue}>v{appVersion}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>构建号</Text>
            <Text style={styles.infoValue}>{Constants.nativeBuildVersion ?? '—'}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>操作系统</Text>
            <Text style={styles.infoValue}>
              {Platform.OS === 'ios' ? 'iOS' : 'Android'} {String(Platform.Version)}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.infoLabel}>运行环境</Text>
            <Text style={styles.infoValue}>
              {Constants.appOwnership === 'expo' ? 'Expo Go（开发模式）' : '独立安装'}
            </Text>
          </View>
          <View style={[styles.infoRow, styles.infoRowLast]}>
            <Text style={styles.infoLabel}>距离高考</Text>
            <Text style={[styles.infoValue, { color: C.primary }]}>{gaokaoDays} 天</Text>
          </View>
        </View>

        {/* 隐私与数据：讲清 BYOK 与本地优先策略，建立信任 */}
        <View style={styles.section}>
          <View style={styles.sectionHeadStatic}>
            <Ionicons name="lock-closed-outline" size={16} color={C.green} />
            <Text style={styles.sectionTitle}>隐私与数据</Text>
          </View>
          <Text style={styles.aboutPrivacy}>
            AI 与搜索服务的 API Key 仅保存在本机，请求由设备直连对应服务商；错题照片、专注记录等数据默认存于本机，仅在手动同步时经你配置的云端中转。应用本身不经手、不持有任何密钥与学习数据。
          </Text>
        </View>

        {/* 隐藏歌单：连点版本徽章 5 次解锁的周杰伦歌名梗彩蛋 */}
        {eggLine && (
          <View style={styles.section}>
            <View style={styles.sectionHeadStatic}>
              <Ionicons name="musical-notes" size={16} color={C.primary} />
              <Text style={styles.sectionTitle}>隐藏歌单</Text>
            </View>
            <Text style={styles.aboutEgg}>{eggLine}</Text>
            <Text style={styles.aboutEggHint}>第 {eggTaps - 4} 句 · 共 {jayLineCount} 句 · 继续点版本徽章换一句</Text>
          </View>
        )}

        <Text style={styles.aboutFooter}>为每一个追梦的高三人而作</Text>
      </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <AmbientGlow />
      <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <TouchableOpacity style={styles.backRow} onPress={() => setView('hub')} activeOpacity={0.85}>
        <Ionicons name="chevron-back" size={22} color={C.primary} />
        <Text style={styles.backText}>返回「我的」</Text>
      </TouchableOpacity>
      <Text style={styles.settingsTitle}>总设置</Text>
      <Text style={styles.settingsHint}>以下为开发与云端配置，日常使用一般只需改外观与账号。</Text>

      <View style={styles.section}>
        <SecHead sec="appearance" icon={themeMode === 'dark' ? 'moon' : 'sunny'} color={C.primary} title="外观" />
        {openSec.appearance && (
          <>
            <View style={styles.presetRow}>
              {([
                { key: 'system', label: '跟随系统', icon: 'phone-portrait-outline' },
                { key: 'light', label: '浅色', icon: 'sunny-outline' },
                { key: 'dark', label: '深色', icon: 'moon-outline' },
              ] as { key: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[]).map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.presetChip, themeMode === opt.key && styles.presetChipActive]}
                  onPress={() => update({ themeMode: opt.key })}
                  activeOpacity={0.85}
                >
                  <Ionicons name={opt.icon} size={13} color={themeMode === opt.key ? C.onPrimary : C.text2} />
                  <Text style={[styles.presetText, themeMode === opt.key && styles.presetTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[styles.label, { marginTop: 14 }]}>AI 球颜色</Text>
            <View style={styles.presetRow}>
              {([
                { key: 'auto' as const, label: '自动', icon: 'contrast-outline' as const },
                { key: 'black' as const, label: '黑球', icon: 'ellipse' as const },
                { key: 'white' as const, label: '白球', icon: 'ellipse-outline' as const },
              ] as const).map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.presetChip, orbStyle === opt.key && styles.presetChipActive]}
                  onPress={() => update({ orbStyle: opt.key })}
                  activeOpacity={0.85}
                >
                  <Ionicons name={opt.icon} size={13} color={orbStyle === opt.key ? C.onPrimary : C.text2} />
                  <Text style={[styles.presetText, orbStyle === opt.key && styles.presetTextActive]}>{opt.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.placeholder}>自动：浅色界面用黑球、深色界面用白球</Text>
          </>
        )}
      </View>

      <View style={styles.section}>
        <SecHead sec="llm" icon="sparkles" color={C.primary} title="AI 模型" />
        {openSec.llm && (
          <>
            <View style={styles.presetRow}>
              {Object.entries(LLM_PRESETS).map(([key, preset]) => (
                <TouchableOpacity
                  key={key}
                  style={[styles.presetChip, llmProvider === key && styles.presetChipActive]}
                  onPress={() => pickPreset(key)}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.presetText, llmProvider === key && styles.presetTextActive]}>{preset.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>API Key</Text>
            <TextInput style={styles.input} placeholder="sk-…" placeholderTextColor={C.text3} value={llmApiKey} onChangeText={(v) => update({ llmApiKey: v })} autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <Text style={styles.label}>Base URL{llmProvider === 'custom' ? '（自定义）' : ''}</Text>
            <TextInput style={styles.input} placeholder="https://api.deepseek.com" placeholderTextColor={C.text3} value={llmBaseUrl} onChangeText={(v) => update({ llmBaseUrl: v })} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>模型名</Text>
            <TextInput style={styles.input} placeholder="deepseek-chat" placeholderTextColor={C.text3} value={llmModel} onChangeText={(v) => update({ llmModel: v })} autoCapitalize="none" autoCorrect={false} />
          </>
        )}
      </View>

      <View style={styles.section}>
        <SecHead sec="stt" icon="mic" color={C.orange} title="语音转文字" />
        {openSec.stt && (
          <>
            <Text style={styles.placeholder}>错题语音反思 → AI 讲解。需支持 ASR 的服务。留空回退 AI 模型配置。</Text>
            <Text style={styles.label}>转写 Base URL（可选）</Text>
            <TextInput style={styles.input} placeholder="留空回退 AI 模型 Base URL" placeholderTextColor={C.text3} value={sttBaseUrl} onChangeText={(v) => update({ sttBaseUrl: v })} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>转写 API Key（可选）</Text>
            <TextInput style={styles.input} placeholder="留空回退 AI 模型 Key" placeholderTextColor={C.text3} value={sttApiKey} onChangeText={(v) => update({ sttApiKey: v })} autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <Text style={styles.label}>转写模型名</Text>
            <TextInput style={styles.input} placeholder="whisper-1" placeholderTextColor={C.text3} value={sttModel} onChangeText={(v) => update({ sttModel: v })} autoCapitalize="none" autoCorrect={false} />
          </>
        )}
      </View>

      <View style={styles.section}>
        <SecHead sec="tts" icon="volume-high" color={C.green} title="语音合成（AI 说话）" />
        {openSec.tts && (
          <>
            <Text style={styles.placeholder}>AI 语音对话播报。需支持 /audio/speech 的服务（OpenAI tts-1、SiliconFlow 等；DeepSeek/智谱无 TTS）。配置后悬浮球可语音对话。</Text>
            <Text style={styles.label}>合成 Base URL</Text>
            <TextInput style={styles.input} placeholder="https://api.openai.com/v1" placeholderTextColor={C.text3} value={ttsBaseUrl} onChangeText={(v) => update({ ttsBaseUrl: v })} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>合成 API Key</Text>
            <TextInput style={styles.input} placeholder="sk-…" placeholderTextColor={C.text3} value={ttsApiKey} onChangeText={(v) => update({ ttsApiKey: v })} autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <Text style={styles.label}>模型名</Text>
            <TextInput style={styles.input} placeholder="tts-1" placeholderTextColor={C.text3} value={ttsModel} onChangeText={(v) => update({ ttsModel: v })} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>音色</Text>
            <TextInput style={styles.input} placeholder="alloy（可选 echo/nova/shimmer 等）" placeholderTextColor={C.text3} value={ttsVoice} onChangeText={(v) => update({ ttsVoice: v })} autoCapitalize="none" autoCorrect={false} />
          </>
        )}
      </View>

      <View style={styles.section}>
        <SecHead sec="vision" icon="eye" color={C.blue} title="视觉模型" />
        {openSec.vision && (
          <>
            <Text style={styles.placeholder}>智谱 GLM-4.6V-Flash 等，配置后可直接读图讲题。</Text>
            <Text style={styles.label}>视觉 Base URL</Text>
            <TextInput style={styles.input} placeholder="https://open.bigmodel.cn/api/paas/v4" placeholderTextColor={C.text3} value={visionBaseUrl} onChangeText={(v) => update({ visionBaseUrl: v })} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>视觉 API Key</Text>
            <TextInput style={styles.input} placeholder="智谱开放平台 API Key" placeholderTextColor={C.text3} value={visionApiKey} onChangeText={(v) => update({ visionApiKey: v })} autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <Text style={styles.label}>视觉模型名</Text>
            <TextInput style={styles.input} placeholder="glm-4.6v-flash" placeholderTextColor={C.text3} value={visionModel} onChangeText={(v) => update({ visionModel: v })} autoCapitalize="none" autoCorrect={false} />
          </>
        )}
      </View>

      <View style={styles.section}>
        <SecHead sec="cloud" icon="cloud" color={C.primary} title="云端" />
        {openSec.cloud && (
          <>
            <Text style={styles.placeholder}>与 Supabase / 管理台对应；访问密钥登录后自动对齐。</Text>
            <Text style={styles.label}>管理台地址</Text>
            <TextInput style={styles.input} placeholder="https://你的项目.vercel.app" placeholderTextColor={C.text3} value={webApiUrl} onChangeText={(v) => update({ webApiUrl: v })} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>Supabase URL</Text>
            <TextInput style={styles.input} placeholder="https://xxx.supabase.co" placeholderTextColor={C.text3} value={supabaseUrl} onChangeText={(v) => update({ supabaseUrl: v })} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>Anon Key</Text>
            <TextInput style={styles.input} placeholder="eyJhbGciOi…" placeholderTextColor={C.text3} value={supabaseAnonKey} onChangeText={(v) => update({ supabaseAnonKey: v })} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>访问密钥</Text>
            <TextInput style={styles.input} placeholder="登录后自动对齐，或手动粘贴" placeholderTextColor={C.text3} value={accessKey} onChangeText={(v) => update({ accessKey: v })} autoCapitalize="none" autoCorrect={false} secureTextEntry />
          </>
        )}
      </View>

      <View style={styles.section}>
        <SecHead sec="auth" icon="person-circle-outline" color={C.green} title="账号登录" />
        {openSec.auth && (
          <>
            {authEmail ? (
              <>
                <Text style={styles.placeholder}>已登录：{authEmail}</Text>
                <TouchableOpacity style={styles.buttonGhost} onPress={() => void signOut()} disabled={authBusy} activeOpacity={0.85}>
                  {authBusy ? <ActivityIndicator size="small" color={C.text2} /> : <Text style={styles.buttonGhostText}>退出登录</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.placeholder}>登录后自动生成访问密钥，多设备数据一致</Text>
                <TextInput style={styles.input} placeholder="邮箱" placeholderTextColor={C.text3} value={authEmailInput} onChangeText={setAuthEmailInput} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" />
                <TextInput style={styles.input} placeholder="密码（至少 6 位）" placeholderTextColor={C.text3} value={authPassword} onChangeText={setAuthPassword} secureTextEntry />
                {!!authError && <Text style={styles.errorText}>{authError}</Text>}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity style={[styles.button, { flex: 1 }]} onPress={() => void signIn(authEmailInput, authPassword)} disabled={authBusy} activeOpacity={0.85}>
                    {authBusy ? <ActivityIndicator size="small" color={C.onPrimary} /> : <Text style={styles.buttonText}>登录</Text>}
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.buttonGhost, { flex: 1 }]} onPress={() => void signUp(authEmailInput, authPassword)} disabled={authBusy} activeOpacity={0.85}>
                    <Text style={styles.buttonGhostText}>注册</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </>
        )}
      </View>

      <View style={styles.section}>
        <SecHead sec="search" icon="search" color={C.blue} title="联网搜索 · 天气 · 目标" />
        {openSec.search && (
          <>
            <Text style={styles.label}>Tavily API Key</Text>
            <TextInput style={styles.input} placeholder="tvly-…" placeholderTextColor={C.text3} value={tavilyKey} onChangeText={(v) => update({ tavilyKey: v })} autoCapitalize="none" autoCorrect={false} secureTextEntry />
            <Text style={styles.label}>OpenWeather API Key</Text>
            <TextInput style={styles.input} placeholder="用于驾驶舱天气" placeholderTextColor={C.text3} value={weatherKey} onChangeText={(v) => update({ weatherKey: v })} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>备用天气城市</Text>
            <TextInput style={styles.input} placeholder="Hangzhou" placeholderTextColor={C.text3} value={weatherCity} onChangeText={(v) => update({ weatherCity: v })} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>目标大学</Text>
            <TextInput style={styles.input} placeholder="如：浙江大学" placeholderTextColor={C.text3} value={targetUniversity} onChangeText={(v) => update({ targetUniversity: v })} />
            <Text style={styles.label}>目标总分（0–750）</Text>
            <TextInput style={styles.input} placeholder="如：630" placeholderTextColor={C.text3} value={targetScore === null ? '' : String(targetScore)} onChangeText={(v) => { const n = parseInt(v, 10); update({ targetScore: Number.isFinite(n) && n > 0 && n <= 750 ? n : null }); }} keyboardType="number-pad" />
          </>
        )}
      </View>

      <View style={styles.section}>
        <SecHead sec="kb" icon="library" color={C.primary} title="知识库" />
        {openSec.kb && (
          <>
            <Text style={styles.label}>GitHub 仓库（owner/repo，需公开）</Text>
            <TextInput style={styles.input} placeholder="your-name/your-vault" placeholderTextColor={C.text3} value={githubRepo} onChangeText={(v) => update({ githubRepo: v })} autoCapitalize="none" autoCorrect={false} />
            <Text style={styles.label}>分支（默认 main）</Text>
            <TextInput style={styles.input} placeholder="main" placeholderTextColor={C.text3} value={githubBranch} onChangeText={(v) => update({ githubBranch: v })} autoCapitalize="none" autoCorrect={false} />
          </>
        )}
      </View>

      <View style={styles.section}>
        <SecHead sec="reminder" icon="calendar" color={C.orange} title="日期提醒" />
        {openSec.reminder && (
          <>
            <View style={styles.calCard}>
              <View style={styles.calHeader}>
                <TouchableOpacity onPress={() => shiftMonth(-1)} hitSlop={HIT_SLOP}>
                  <Ionicons name="chevron-back" size={20} color={C.text2} />
                </TouchableOpacity>
                <Text style={styles.calTitle}>{viewYear} 年 {viewMonth + 1} 月</Text>
                <TouchableOpacity onPress={() => shiftMonth(1)} hitSlop={HIT_SLOP}>
                  <Ionicons name="chevron-forward" size={20} color={C.text2} />
                </TouchableOpacity>
              </View>
              <View style={styles.calWeek}>
                {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
                  <Text key={w} style={[styles.calWeekText, (w === '日' || w === '六') && styles.calWeekend]}>{w}</Text>
                ))}
              </View>
              <View style={styles.calGrid}>
                {monthGrid.map((date, i) =>
                  date === null ? (
                    <View key={`pad-${i}`} style={styles.calCell} />
                  ) : (
                    <TouchableOpacity
                      key={date}
                      style={[styles.calCell, date === today && styles.calCellToday, reminderDate === date && styles.calCellSelected]}
                      onPress={() => setReminderDate(date)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.calDay, date === today && styles.calDayToday, reminderDate === date && styles.calDaySelected]}>
                        {Number(date.slice(8))}
                      </Text>
                      {reminderDates.has(date) && <View style={styles.calDot} />}
                    </TouchableOpacity>
                  )
                )}
              </View>
              <Text style={styles.calHint}>点击日期填入；红点 = 已有提醒</Text>
            </View>
            <Text style={styles.label}>提醒内容</Text>
            <View style={styles.reminderRow}>
              <TextInput style={[styles.input, styles.reminderDateInput]} placeholder="09-10" placeholderTextColor={C.text3} value={reminderDate} onChangeText={setReminderDate} autoCapitalize="none" autoCorrect={false} />
              <TextInput style={styles.input} placeholder="提醒内容" placeholderTextColor={C.text3} value={reminderText} onChangeText={setReminderText} onSubmitEditing={submitReminder} />
            </View>
            <TouchableOpacity style={styles.button} onPress={submitReminder} activeOpacity={0.85}>
              <Text style={styles.buttonText}>添加提醒</Text>
            </TouchableOpacity>
            {reminders.slice().sort((a, b) => a.date.localeCompare(b.date)).map((r) => (
              <View key={r.id} style={styles.reminderItem}>
                <Text style={[styles.reminderItemText, r.date < today && styles.reminderExpired]}>
                  {r.date < today ? '（已过期）' : ''}{r.date} · {r.content}
                </Text>
                <TouchableOpacity onPress={() => removeReminder(r.id)} hitSlop={HIT_SLOP}>
                  <Ionicons name="close" size={16} color={C.text3} />
                </TouchableOpacity>
              </View>
            ))}
          </>
        )}
      </View>

      <View style={styles.section}>
        <SecHead sec="sync" icon="sync" color={C.green} title="手动同步" />
        {openSec.sync && (
          <>
            <Text style={styles.placeholder}>拉取云端备课并检查 Obsidian 目录。</Text>
            <TouchableOpacity style={styles.button} onPress={runSync} disabled={syncing} activeOpacity={0.85}>
              {syncing ? <ActivityIndicator size="small" color={C.onPrimary} /> : (
                <><Ionicons name="cloud-download-outline" size={16} color={C.onPrimary} /><Text style={styles.buttonText}>立即同步</Text></>
              )}
            </TouchableOpacity>
            {!!syncResult && <Text style={styles.syncResult}>{syncResult}</Text>}
          </>
        )}
      </View>

      <View style={styles.section}>
        <SecHead sec="keepalive" icon="shield-checkmark-outline" color={C.orange} title="后台保活" />
        {openSec.keepalive && (
          <>
            <Text style={styles.placeholder}>OriginOS 等系统会管控后台。若提醒/备课不生效，请允许自启动。</Text>
            <TouchableOpacity style={styles.button} onPress={openKeepAlive} activeOpacity={0.85}>
              <Ionicons name="open-outline" size={16} color={C.onPrimary} />
              <Text style={styles.buttonText}>去设置自启动</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
      </ScrollView>
    </View>
  );
}

const STYLES = themedStyles((C) => ({
  // 底色容器：光斑铺在这一层之上、滚动内容之下（container 透明让光斑可见）
  screen: { flex: 1, backgroundColor: C.bg },
  container: { flex: 1 },
  content: { padding: 16, paddingBottom: 104 },
  heroCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: C.glassCard,
    borderRadius: R.lg, padding: 16, gap: 14, ...glassRim(C), ...cardShadow,
  },
  avatar: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: C.onPrimary, fontSize: 24, fontWeight: '800' },
  heroMeta: { flex: 1 },
  heroName: { fontSize: 20, fontWeight: '800', color: C.text },
  heroSub: { fontSize: 13, color: C.text3, marginTop: 2 },
  heroGoal: { fontSize: 13, color: C.primary, fontWeight: '600', marginTop: 4 },
  statsRow: {
    flexDirection: 'row', backgroundColor: C.glassCard, borderRadius: R.lg,
    marginTop: 12, paddingVertical: 14, ...glassRim(C), ...cardShadow,
  },
  statCell: { flex: 1, alignItems: 'center' },
  statNum: { fontSize: 18, fontWeight: '800', color: C.text, fontVariant: ['tabular-nums'] },
  statLabel: { fontSize: 11, color: C.text3, marginTop: 4 },
  statDivider: { width: StyleSheet.hairlineWidth, backgroundColor: C.border },
  blockLabel: { fontSize: 12, color: C.text3, marginTop: 10, marginBottom: 4, marginLeft: 4 },
  menuRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  menuIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  menuBody: { flex: 1 },
  menuTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  menuSub: { fontSize: 12, color: C.text3, marginTop: 2, lineHeight: 16 },
  menuRight: { fontSize: 13, color: C.primary, fontWeight: '700', marginRight: 4 },
  sectionHeadStatic: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 8 },
  backText: { fontSize: 15, color: C.primary, fontWeight: '600' },
  settingsTitle: { fontSize: 22, fontWeight: '800', color: C.text, marginBottom: 4 },
  settingsHint: { fontSize: 12, color: C.text3, lineHeight: 18, marginBottom: 12 },
  section: {
    backgroundColor: C.glassCard, borderRadius: R.lg, padding: 16, marginBottom: 10,
    ...glassRim(C), ...cardShadow,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text, flex: 1 },
  label: { fontSize: 13, color: C.text2, marginTop: 12, marginBottom: 4, fontWeight: '500' },
  input: {
    borderWidth: 1, borderColor: C.border, borderRadius: R.sm,
    paddingHorizontal: 12, paddingVertical: 10, fontSize: 15, backgroundColor: C.bg, color: C.text,
  },
  placeholder: { color: C.text3, fontSize: 13, lineHeight: 20, marginTop: 4 },
  errorText: { color: C.red, fontSize: 13, lineHeight: 20, marginTop: 8 },
  button: {
    backgroundColor: C.primary, borderRadius: R.md, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 12, flexDirection: 'row', gap: 6,
  },
  buttonText: { color: C.onPrimary, fontSize: 15, fontWeight: '700' },
  buttonGhost: {
    borderWidth: 1, borderColor: C.border, borderRadius: R.md, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center', marginTop: 12, backgroundColor: C.bg,
  },
  buttonGhostText: { color: C.text2, fontSize: 15, fontWeight: '600' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  presetChip: {
    borderWidth: 1, borderColor: C.border, borderRadius: R.pill, paddingHorizontal: 14, paddingVertical: 7,
    backgroundColor: C.bg, flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  presetChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  presetText: { fontSize: 13, color: C.text2, fontWeight: '500' },
  presetTextActive: { color: C.onPrimary, fontWeight: '700' },
  reminderRow: { flexDirection: 'row', gap: 8 },
  reminderDateInput: { width: 110 },
  reminderItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.bg, borderRadius: R.sm, paddingVertical: 10, paddingHorizontal: 12, marginTop: 8,
  },
  reminderItemText: { fontSize: 14, color: C.text, flex: 1 },
  reminderExpired: { color: C.text3 },
  calCard: { backgroundColor: C.bg, borderRadius: R.md, padding: 12, marginTop: 8 },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingHorizontal: 4 },
  calTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  calWeek: { flexDirection: 'row' },
  calWeekText: { width: `${100 / 7}%` as unknown as number, textAlign: 'center', fontSize: 11, color: C.text3, paddingVertical: 4, fontWeight: '500' },
  calWeekend: { color: C.red },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: { width: `${100 / 7}%` as unknown as number, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  calCellToday: { borderWidth: 1.5, borderColor: C.primary },
  calCellSelected: { backgroundColor: C.primary },
  calDay: { fontSize: 13, color: C.text, fontVariant: ['tabular-nums'] },
  calDayToday: { color: C.primary, fontWeight: '700' },
  calDaySelected: { color: C.onPrimary, fontWeight: '700' },
  calDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.red, marginTop: 2 },
  calHint: { fontSize: 12, color: C.text3, marginTop: 8, lineHeight: 18 },
  syncResult: { fontSize: 13, color: C.text2, lineHeight: 21, marginTop: 10 },
  // —— 关于页 ——
  aboutHero: { alignItems: 'center', paddingVertical: 24 },
  aboutLogo: {
    width: 76, height: 76, borderRadius: 22, backgroundColor: C.primary,
    alignItems: 'center', justifyContent: 'center', marginBottom: 12, ...cardShadow,
  },
  aboutName: { fontSize: 22, fontWeight: '800', color: C.text },
  aboutVersionChip: {
    marginTop: 10, paddingHorizontal: 12, paddingVertical: 4, borderRadius: R.pill,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.border, backgroundColor: C.bg,
  },
  aboutVersionText: { fontSize: 12, fontWeight: '600', color: C.text2, fontVariant: ['tabular-nums'] },
  aboutTagline: { fontSize: 14, fontWeight: '600', color: C.primary, marginTop: 12 },
  aboutSlogan: { fontSize: 12, color: C.text3, marginTop: 4, textAlign: 'center' },
  featureRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  featureIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  featureBody: { flex: 1 },
  featureTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  featureDesc: { fontSize: 12, color: C.text3, marginTop: 2, lineHeight: 17 },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border,
  },
  infoRowLast: { borderBottomWidth: 0 },
  infoLabel: { fontSize: 14, color: C.text2 },
  infoValue: { fontSize: 14, color: C.text, fontWeight: '600', fontVariant: ['tabular-nums'] },
  aboutPrivacy: { fontSize: 13, color: C.text2, lineHeight: 21 },
  aboutFooter: { fontSize: 12, color: C.text3, textAlign: 'center', marginTop: 6, marginBottom: 8 },
  // —— 隐藏歌单彩蛋 ——
  aboutEgg: { fontSize: 14, color: C.text, lineHeight: 22 },
  aboutEggHint: { fontSize: 12, color: C.text3, marginTop: 8 },
}));

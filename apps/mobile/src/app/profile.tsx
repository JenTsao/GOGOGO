import { View, Text, TextInput, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import Constants from 'expo-constants';
import * as IntentLauncher from 'expo-intent-launcher';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSettingsStore } from '@/store/settingsStore';
import { useAuthStore } from '@/store/authStore';
import { useReminderStore, localDateStr } from '@/store/reminderStore';
import { LLM_PRESETS } from '@/lib/llm';
import { fetchDaily } from '@/lib/cloud';
import { writeDailyCache } from '@/lib/background';
import { fetchRepoPaths } from '@/lib/github';
import { R, cardShadow, HIT_SLOP, themedStyles, usePalette, useScheme, type ThemeMode } from '@/theme';

// Tab 4：我的（配置与调度）
export default function ProfileScreen() {
  const C = usePalette();
  const styles = STYLES[useScheme()];
  const {
    weatherKey, weatherCity, targetUniversity, targetScore, githubRepo, githubBranch,
    llmProvider, llmBaseUrl, llmModel, llmApiKey,
    sttBaseUrl, sttApiKey, sttModel,
    visionBaseUrl, visionApiKey, visionModel,
    supabaseUrl, supabaseAnonKey, accessKey, tavilyKey, webApiUrl, themeMode, update,
  } = useSettingsStore();
  const { reminders, addReminder, removeReminder } = useReminderStore();
  const insets = useSafeAreaInsets(); // 打孔屏/手势条安全区

  // 后台保活：OriginOS 5（iQOO Neo10 等 vivo 系）默认管控自启动与后台耗电，
  // 未加白名单时 expo-background-fetch / 当日提醒通知 / 凌晨备课预取都会被杀。
  // 三级降级：vivo 自启动管理器（ComponentName 直启）→ 本应用详情页 → 系统应用列表
  const openKeepAlive = async () => {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MAIN', {
        category: 'android.intent.category.LAUNCHER',
        packageName: 'com.vivo.permissionmanager',
        className: 'com.vivo.permissionmanager.activity.BgStartUpManager',
      });
      return;
    } catch {
      // 组件不存在（非 vivo 系 / 版本变更）→ 退回应用详情页，页面内含通知/电池/自启动入口
    }
    try {
      const pkg = Constants.expoConfig?.android?.package ?? 'com.gaokao.copilot';
      await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_DETAILS_SETTINGS, {
        data: `package:${pkg}`,
      });
      return;
    } catch {
      // data 不被支持时退回应用列表
    }
    await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APPLICATION_SETTINGS).catch(() => {});
  };

  // 账号登录（多设备一致）：会话恢复 + 变更订阅在 store 内幂等处理
  const { email: authEmail, busy: authBusy, error: authError, init, signIn, signUp, signOut } = useAuthStore();
  const [authEmailInput, setAuthEmailInput] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  useEffect(() => {
    void init();
  }, [init]);

  // 切换预设自动填充默认 baseUrl / 模型；custom 不清空（保留用户已填的自定义配置）
  const pickPreset = (key: string) => {
    const preset = LLM_PRESETS[key];
    if (key === 'custom') {
      update({ llmProvider: key });
      return;
    }
    update({ llmProvider: key, llmBaseUrl: preset.baseUrl || '', llmModel: preset.model || '' });
  };

  const [reminderDate, setReminderDate] = useState('');
  const [reminderText, setReminderText] = useState('');

  // 日历视图：当月网格 + 提醒红点（纯本地数据，点击日期回填输入框）
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth()); // 0-11
  const today = localDateStr(new Date());
  const monthGrid = useMemo(() => {
    const startWeek = new Date(viewYear, viewMonth, 1).getDay(); // 0 = 周日
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

  // 日期允许两种输入：MM-DD（当年）或 YYYY-MM-DD
  const submitReminder = () => {
    const content = reminderText.trim();
    const raw = reminderDate.trim();
    if (!content || !raw) return;
    // MM-DD 先补「日历正在浏览的年份」再按完整日期校验（翻到 2027 年输 01-05 应落 2027 年，而非当前年）
    const full = /^\d{1,2}-\d{1,2}$/.test(raw) ? `${viewYear}-${raw}` : raw;
    const m = full.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (!m) return;
    // 用构造函数解析并检查月份回读，拦截 02-31 之类溢出日期（Date 会静默滚进下月）
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1) return;
    // 归一化为本地日期串，保证驾驶舱横幅能按日匹配
    addReminder(localDateStr(d), content);
    setReminderText('');
  };

  // 手动同步：备课预取（写离线缓存）+ Obsidian 目录连通性检查
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
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
    // 提醒云同步（与错题同走管理台代理）：拉云端差集合并 + 全量镜像上传
    if (s.webApiUrl && s.accessKey) {
      try {
        await useReminderStore.getState().sync(s.webApiUrl, s.accessKey);
        parts.push(`· 提醒已云同步（${useReminderStore.getState().reminders.length} 条，多设备一致）`);
      } catch {
        parts.push('· 提醒云同步失败（本地数据不受影响，下次重试）');
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
    >
      {/* 外观（深色模式） */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name={themeMode === 'dark' ? 'moon' : 'sunny'} size={16} color={C.primary} />
          <Text style={styles.sectionTitle}>外观</Text>
        </View>
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
              accessibilityLabel={`主题：${opt.label}`}
            >
              <Ionicons
                name={opt.icon}
                size={13}
                color={themeMode === opt.key ? C.onPrimary : C.text2}
              />
              <Text style={[styles.presetText, themeMode === opt.key && styles.presetTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      {/* AI 模型 */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="sparkles" size={16} color={C.primary} />
          <Text style={styles.sectionTitle}>AI 模型（OpenAI 兼容协议）</Text>
        </View>
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
        <TextInput
          style={styles.input}
          placeholder="sk-…"
          placeholderTextColor={C.text3}
          value={llmApiKey}
          onChangeText={(v) => update({ llmApiKey: v })}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <Text style={styles.label}>Base URL{llmProvider === 'custom' ? '（自定义）' : ''}</Text>
        <TextInput
          style={styles.input}
          placeholder="https://api.deepseek.com"
          placeholderTextColor={C.text3}
          value={llmBaseUrl}
          onChangeText={(v) => update({ llmBaseUrl: v })}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>模型名</Text>
        <TextInput
          style={styles.input}
          placeholder="deepseek-chat"
          placeholderTextColor={C.text3}
          value={llmModel}
          onChangeText={(v) => update({ llmModel: v })}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* 语音转文字 */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="mic" size={16} color={C.orange} />
          <Text style={styles.sectionTitle}>语音转文字</Text>
        </View>
        <Text style={styles.placeholder}>错题语音反思 → AI 讲解 / 画像情绪词。需 OpenAI / Groq / SiliconFlow 等支持 ASR 的服务（DeepSeek 不支持）。Base URL / Key 留空时回退 AI 模型配置。</Text>

        <Text style={styles.label}>转写 Base URL（可选）</Text>
        <TextInput
          style={styles.input}
          placeholder="留空回退 AI 模型 Base URL"
          placeholderTextColor={C.text3}
          value={sttBaseUrl}
          onChangeText={(v) => update({ sttBaseUrl: v })}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>转写 API Key（可选）</Text>
        <TextInput
          style={styles.input}
          placeholder="留空回退 AI 模型 Key"
          placeholderTextColor={C.text3}
          value={sttApiKey}
          onChangeText={(v) => update({ sttApiKey: v })}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <Text style={styles.label}>转写模型名</Text>
        <TextInput
          style={styles.input}
          placeholder="whisper-1（Groq 用 whisper-large-v3）"
          placeholderTextColor={C.text3}
          value={sttModel}
          onChangeText={(v) => update({ sttModel: v })}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* 视觉模型 */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="eye" size={16} color={C.blue} />
          <Text style={styles.sectionTitle}>视觉模型（错题图片识别）</Text>
        </View>
        <Text style={styles.placeholder}>智谱 GLM-4.6V-Flash（有免费额度），OpenAI 兼容协议。配置 Key 后「AI 讲解错题」会直接读图：识别题面、指出作答错误。</Text>

        <Text style={styles.label}>视觉 Base URL</Text>
        <TextInput
          style={styles.input}
          placeholder="https://open.bigmodel.cn/api/paas/v4"
          placeholderTextColor={C.text3}
          value={visionBaseUrl}
          onChangeText={(v) => update({ visionBaseUrl: v })}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>视觉 API Key</Text>
        <TextInput
          style={styles.input}
          placeholder="智谱开放平台 API Key"
          placeholderTextColor={C.text3}
          value={visionApiKey}
          onChangeText={(v) => update({ visionApiKey: v })}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <Text style={styles.label}>视觉模型名</Text>
        <TextInput
          style={styles.input}
          placeholder="glm-4.6v-flash"
          placeholderTextColor={C.text3}
          value={visionModel}
          onChangeText={(v) => update({ visionModel: v })}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* 云端 */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="cloud" size={16} color={C.primary} />
          <Text style={styles.sectionTitle}>云端（每日备课内容）</Text>
        </View>
        <Text style={styles.placeholder}>与 Supabase 项目对应；访问密钥需先在 SQL 编辑器设置：update profiles set access_key = '...' where user_id = '...'</Text>

        <Text style={styles.label}>管理台地址（错题云同步代理）</Text>
        <TextInput
          style={styles.input}
          placeholder="https://你的项目.vercel.app"
          placeholderTextColor={C.text3}
          value={webApiUrl}
          onChangeText={(v) => update({ webApiUrl: v })}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>Supabase URL</Text>
        <TextInput
          style={styles.input}
          placeholder="https://xxx.supabase.co"
          placeholderTextColor={C.text3}
          value={supabaseUrl}
          onChangeText={(v) => update({ supabaseUrl: v })}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>Anon Key（公开 Key）</Text>
        <TextInput
          style={styles.input}
          placeholder="eyJhbGciOi…"
          placeholderTextColor={C.text3}
          value={supabaseAnonKey}
          onChangeText={(v) => update({ supabaseAnonKey: v })}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>访问密钥（登录后自动填充；也可手动填）</Text>
        <TextInput
          style={styles.input}
          placeholder="登录后自动对齐，或手动粘贴"
          placeholderTextColor={C.text3}
          value={accessKey}
          onChangeText={(v) => update({ accessKey: v })}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />
      </View>

      {/* 账号登录 */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="person-circle-outline" size={16} color={C.green} />
          <Text style={styles.sectionTitle}>账号登录（多设备一致）</Text>
        </View>
        {authEmail ? (
          <>
            <Text style={styles.placeholder}>已登录：{authEmail}（数据经访问密钥自动同步到本账号）</Text>
            <TouchableOpacity style={styles.buttonGhost} onPress={() => void signOut()} disabled={authBusy} activeOpacity={0.85}>
              {authBusy ? <ActivityIndicator size="small" color={C.text2} /> : <Text style={styles.buttonGhostText}>退出登录</Text>}
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.placeholder}>登录后自动生成并回填访问密钥，换设备登录同一账号即数据收敛</Text>
            <TextInput
              style={styles.input}
              placeholder="邮箱"
              placeholderTextColor={C.text3}
              value={authEmailInput}
              onChangeText={setAuthEmailInput}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
            />
            <TextInput
              style={styles.input}
              placeholder="密码（至少 6 位）"
              placeholderTextColor={C.text3}
              value={authPassword}
              onChangeText={setAuthPassword}
              secureTextEntry
            />
            {!!authError && <Text style={styles.errorText}>{authError}</Text>}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity
                style={[styles.button, { flex: 1 }]}
                onPress={() => void signIn(authEmailInput, authPassword)}
                disabled={authBusy}
                activeOpacity={0.85}
              >
                {authBusy ? <ActivityIndicator size="small" color={C.onPrimary} /> : <Text style={styles.buttonText}>登录</Text>}
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.buttonGhost, { flex: 1 }]}
                onPress={() => void signUp(authEmailInput, authPassword)}
                disabled={authBusy}
                activeOpacity={0.85}
              >
                <Text style={styles.buttonGhostText}>注册</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>

      {/* 搜索与目标 */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="search" size={16} color={C.blue} />
          <Text style={styles.sectionTitle}>联网搜索与天气</Text>
        </View>

        <Text style={styles.label}>Tavily API Key（AI 的 searchWeb 工具）</Text>
        <TextInput
          style={styles.input}
          placeholder="tvly-…"
          placeholderTextColor={C.text3}
          value={tavilyKey}
          onChangeText={(v) => update({ tavilyKey: v })}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <Text style={styles.label}>OpenWeather API Key</Text>
        <TextInput
          style={styles.input}
          placeholder="用于驾驶舱天气"
          placeholderTextColor={C.text3}
          value={weatherKey}
          onChangeText={(v) => update({ weatherKey: v })}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>备用天气城市（定位失败或拒绝授权时使用，拼音如 Hangzhou）</Text>
        <TextInput
          style={styles.input}
          placeholder="Hangzhou"
          placeholderTextColor={C.text3}
          value={weatherCity}
          onChangeText={(v) => update({ weatherCity: v })}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>目标大学（用于横向对标）</Text>
        <TextInput
          style={styles.input}
          placeholder="如：浙江大学"
          placeholderTextColor={C.text3}
          value={targetUniversity}
          onChangeText={(v) => update({ targetUniversity: v })}
        />

        <Text style={styles.label}>目标总分（对标差距计算用，0–750）</Text>
        <TextInput
          style={styles.input}
          placeholder="如：630"
          placeholderTextColor={C.text3}
          value={targetScore === null ? '' : String(targetScore)}
          onChangeText={(v) => {
            const n = parseInt(v, 10);
            update({ targetScore: Number.isFinite(n) && n > 0 && n <= 750 ? n : null });
          }}
          keyboardType="number-pad"
        />
      </View>

      {/* 知识库 */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="library" size={16} color={C.primary} />
          <Text style={styles.sectionTitle}>知识库（Obsidian）</Text>
        </View>

        <Text style={styles.label}>GitHub 仓库（格式 owner/repo，需公开）</Text>
        <TextInput
          style={styles.input}
          placeholder="your-name/your-vault"
          placeholderTextColor={C.text3}
          value={githubRepo}
          onChangeText={(v) => update({ githubRepo: v })}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text style={styles.label}>分支（默认 main）</Text>
        <TextInput
          style={styles.input}
          placeholder="main"
          placeholderTextColor={C.text3}
          value={githubBranch}
          onChangeText={(v) => update({ githubBranch: v })}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* 日期提醒 */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="calendar" size={16} color={C.orange} />
          <Text style={styles.sectionTitle}>自定义日期提醒</Text>
        </View>

        {/* 月历红点视图（蓝皮书：点击日期添加提醒，红点标记） */}
        <View style={styles.calCard}>
          <View style={styles.calHeader}>
            <TouchableOpacity onPress={() => shiftMonth(-1)} hitSlop={HIT_SLOP}>
              <Ionicons name="chevron-back" size={20} color={C.text2} />
            </TouchableOpacity>
            <Text style={styles.calTitle}>
              {viewYear} 年 {viewMonth + 1} 月
            </Text>
            <TouchableOpacity onPress={() => shiftMonth(1)} hitSlop={HIT_SLOP}>
              <Ionicons name="chevron-forward" size={20} color={C.text2} />
            </TouchableOpacity>
          </View>
          <View style={styles.calWeek}>
            {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
              <Text key={w} style={[styles.calWeekText, (w === '日' || w === '六') && styles.calWeekend]}>
                {w}
              </Text>
            ))}
          </View>
          <View style={styles.calGrid}>
            {monthGrid.map((date, i) =>
              date === null ? (
                <View key={`pad-${i}`} style={styles.calCell} />
              ) : (
                <TouchableOpacity
                  key={date}
                  style={[
                    styles.calCell,
                    date === today && styles.calCellToday,
                    reminderDate === date && styles.calCellSelected,
                  ]}
                  onPress={() => setReminderDate(date)}
                  activeOpacity={0.7}
                >
                  <Text
                    style={[
                      styles.calDay,
                      date === today && styles.calDayToday,
                      reminderDate === date && styles.calDaySelected,
                    ]}
                  >
                    {Number(date.slice(8))}
                  </Text>
                  {reminderDates.has(date) && <View style={styles.calDot} />}
                </TouchableOpacity>
              )
            )}
          </View>
          <Text style={styles.calHint}>点击日期填入输入框；红点 = 已有提醒（当日显示在驾驶舱横幅）</Text>
        </View>

        <Text style={styles.label}>提醒内容（日期可点上方日历，或手输 MM-DD / YYYY-MM-DD）</Text>
        <View style={styles.reminderRow}>
          <TextInput
            style={[styles.input, styles.reminderDateInput]}
            placeholder="09-10"
            placeholderTextColor={C.text3}
            value={reminderDate}
            onChangeText={setReminderDate}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={styles.input}
            placeholder="提醒内容，如：收物理作业"
            placeholderTextColor={C.text3}
            value={reminderText}
            onChangeText={setReminderText}
            onSubmitEditing={submitReminder}
          />
        </View>
        <TouchableOpacity style={styles.button} onPress={submitReminder} activeOpacity={0.85}>
          <Text style={styles.buttonText}>添加提醒</Text>
        </TouchableOpacity>
        {reminders
          .slice()
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((r) => (
            <View key={r.id} style={styles.reminderItem}>
              <Text style={[styles.reminderItemText, r.date < today && styles.reminderExpired]}>
                {r.date < today ? '（已过期）' : ''}
                {r.date} · {r.content}
              </Text>
              <TouchableOpacity onPress={() => removeReminder(r.id)} hitSlop={HIT_SLOP} accessibilityLabel={`删除提醒 ${r.content}`}>
                <Ionicons name="close" size={16} color={C.text3} />
              </TouchableOpacity>
            </View>
          ))}
      </View>

      {/* 手动同步 */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="sync" size={16} color={C.green} />
          <Text style={styles.sectionTitle}>手动同步</Text>
        </View>
        <Text style={styles.placeholder}>拉取云端最新备课内容并写入离线缓存，同时检查 Obsidian 目录可达性。</Text>
        <TouchableOpacity style={styles.button} onPress={runSync} disabled={syncing} activeOpacity={0.85}>
          {syncing ? (
            <ActivityIndicator size="small" color={C.onPrimary} />
          ) : (
            <>
              <Ionicons name="cloud-download-outline" size={16} color={C.onPrimary} />
              <Text style={styles.buttonText}>立即同步</Text>
            </>
          )}
        </TouchableOpacity>
        {!!syncResult && <Text style={styles.syncResult}>{syncResult}</Text>}
      </View>

      {/* 后台保活：OriginOS（iQOO/vivo 系）默认管控，影响后台唤醒与提醒通知 */}
      <View style={styles.section}>
        <View style={styles.sectionHead}>
          <Ionicons name="shield-checkmark-outline" size={16} color={C.orange} />
          <Text style={styles.sectionTitle}>后台保活（iQOO / vivo / OriginOS）</Text>
        </View>
        <Text style={styles.placeholder}>
          OriginOS 默认管控后台：若当日提醒、凌晨备课预取不生效，请允许本应用「自启动」并关闭后台高耗电限制。
        </Text>
        <TouchableOpacity style={styles.button} onPress={openKeepAlive} activeOpacity={0.85}>
          <Ionicons name="open-outline" size={16} color={C.onPrimary} />
          <Text style={styles.buttonText}>去设置自启动</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const STYLES = themedStyles((C) => ({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 96 },
  // 分组卡片：长表单按域分组，降低视觉密度
  section: {
    backgroundColor: C.card,
    borderRadius: R.lg,
    padding: 16,
    marginBottom: 14,
    ...cardShadow,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  label: { fontSize: 13, color: C.text2, marginTop: 12, marginBottom: 4, fontWeight: '500' },
  input: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: C.bg,
    color: C.text,
  },
  placeholder: { color: C.text3, fontSize: 13, lineHeight: 20, marginTop: 4 },
  errorText: { color: C.red, fontSize: 13, lineHeight: 20, marginTop: 8 },
  button: {
    backgroundColor: C.primary,
    borderRadius: R.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    flexDirection: 'row',
    gap: 6,
  },
  buttonText: { color: C.onPrimary, fontSize: 15, fontWeight: '700' },
  buttonGhost: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.md,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    backgroundColor: C.bg,
  },
  buttonGhostText: { color: C.text2, fontSize: 15, fontWeight: '600' },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  presetChip: {
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: R.pill,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: C.bg,
  },
  presetChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  presetText: { fontSize: 13, color: C.text2, fontWeight: '500' },
  presetTextActive: { color: C.onPrimary, fontWeight: '700' },
  reminderRow: { flexDirection: 'row', gap: 8 },
  reminderDateInput: { width: 110 },
  reminderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.bg,
    borderRadius: R.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  reminderItemText: { fontSize: 14, color: C.text, flex: 1 },
  reminderExpired: { color: C.text3 },
  // 月历红点视图
  calCard: { backgroundColor: C.bg, borderRadius: R.md, padding: 12, marginTop: 8 },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, paddingHorizontal: 4 },
  calTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  calWeek: { flexDirection: 'row' },
  calWeekText: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 11, color: C.text3, paddingVertical: 4, fontWeight: '500' },
  calWeekend: { color: C.red },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: {
    width: `${100 / 7}%`,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  calCellToday: { borderWidth: 1.5, borderColor: C.primary },
  calCellSelected: { backgroundColor: C.primary },
  calDay: { fontSize: 13, color: C.text, fontVariant: ['tabular-nums'] },
  calDayToday: { color: C.primary, fontWeight: '700' },
  calDaySelected: { color: C.onPrimary, fontWeight: '700' },
  calDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: C.red, marginTop: 2 },
  calHint: { fontSize: 12, color: C.text3, marginTop: 8, lineHeight: 18 },
  syncResult: { fontSize: 13, color: C.text2, lineHeight: 21, marginTop: 10 },
}));

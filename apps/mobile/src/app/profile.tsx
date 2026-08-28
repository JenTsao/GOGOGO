import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useAuthStore } from '@/store/authStore';
import { useReminderStore, localDateStr } from '@/store/reminderStore';
import { LLM_PRESETS } from '@/lib/llm';
import { fetchDaily } from '@/lib/cloud';
import { writeDailyCache } from '@/lib/background';
import { fetchRepoPaths } from '@/lib/github';

// Tab 4：我的（配置与调度）
export default function ProfileScreen() {
  const {
    weatherKey, weatherCity, targetUniversity, targetScore, githubRepo, githubBranch,
    llmProvider, llmBaseUrl, llmModel, llmApiKey,
    sttBaseUrl, sttApiKey, sttModel,
    visionBaseUrl, visionApiKey, visionModel,
    supabaseUrl, supabaseAnonKey, accessKey, tavilyKey, webApiUrl, update,
  } = useSettingsStore();
  const { reminders, addReminder, removeReminder } = useReminderStore();

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
          parts.push(`✅ ${day} 备课内容已预取（驾驶舱离线兜底生效）`);
        } else {
          parts.push('⚠️ 云端暂无今日备课内容（等凌晨流水线生成）');
        }
      } catch {
        parts.push('❌ 备课拉取失败，保留旧缓存兜底');
      }
    } else {
      parts.push('⚠️ 未配置 Supabase / 访问密钥，跳过备课预取');
    }
    // 提醒云同步（与错题同走管理台代理）：拉云端差集合并 + 全量镜像上传
    if (s.webApiUrl && s.accessKey) {
      try {
        await useReminderStore.getState().sync(s.webApiUrl, s.accessKey);
        parts.push(`✅ 提醒已云同步（${useReminderStore.getState().reminders.length} 条，多设备一致）`);
      } catch {
        parts.push('❌ 提醒云同步失败（本地数据不受影响，下次重试）');
      }
    }
    if (/^[\w.-]+\/[\w.-]+$/.test(s.githubRepo.trim())) {
      try {
        const list = await fetchRepoPaths(s.githubRepo.trim(), s.githubBranch.trim() || 'main');
        parts.push(`✅ Obsidian 目录可达（${list.length} 篇笔记）`);
      } catch (e) {
        parts.push(`❌ 目录拉取失败（${(e as Error).name === 'AbortError' ? '请求超时' : (e as Error).message}）`);
      }
    } else {
      parts.push('⚠️ 未配置 GitHub 仓库，跳过目录检查');
    }
    setSyncResult(parts.join('\n'));
    setSyncing(false);
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionTitle}>⚙️ 配置（保存到本地 MMKV）</Text>

      <Text style={styles.sectionTitle}>🤖 AI 模型（OpenAI 兼容协议）</Text>
      <View style={styles.presetRow}>
        {Object.entries(LLM_PRESETS).map(([key, preset]) => (
          <TouchableOpacity
            key={key}
            style={[styles.presetChip, llmProvider === key && styles.presetChipActive]}
            onPress={() => pickPreset(key)}
          >
            <Text style={[styles.presetText, llmProvider === key && styles.presetTextActive]}>{preset.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>API Key</Text>
      <TextInput
        style={styles.input}
        placeholder="sk-…"
        placeholderTextColor="#999"
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
        placeholderTextColor="#999"
        value={llmBaseUrl}
        onChangeText={(v) => update({ llmBaseUrl: v })}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>模型名</Text>
      <TextInput
        style={styles.input}
        placeholder="deepseek-chat"
        placeholderTextColor="#999"
        value={llmModel}
        onChangeText={(v) => update({ llmModel: v })}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.sectionTitle}>🎤 语音转文字（错题语音反思 → AI 讲解 / 画像情绪词）</Text>
      <Text style={styles.placeholder}>需 OpenAI / Groq / SiliconFlow 等支持 ASR 的服务（DeepSeek 不支持）。Base URL / Key 留空时回退上面的 AI 模型配置。</Text>

      <Text style={styles.label}>转写 Base URL（可选）</Text>
      <TextInput
        style={styles.input}
        placeholder="留空回退 AI 模型 Base URL"
        placeholderTextColor="#999"
        value={sttBaseUrl}
        onChangeText={(v) => update({ sttBaseUrl: v })}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>转写 API Key（可选）</Text>
      <TextInput
        style={styles.input}
        placeholder="留空回退 AI 模型 Key"
        placeholderTextColor="#999"
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
        placeholderTextColor="#999"
        value={sttModel}
        onChangeText={(v) => update({ sttModel: v })}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.sectionTitle}>👁️ 视觉模型（错题图片识别，GLM-4.6V-Flash）</Text>
      <Text style={styles.placeholder}>智谱视觉模型（有免费额度），OpenAI 兼容协议。配置 Key 后「AI 讲解错题」会直接读图：识别题面、指出作答错误。</Text>

      <Text style={styles.label}>视觉 Base URL</Text>
      <TextInput
        style={styles.input}
        placeholder="https://open.bigmodel.cn/api/paas/v4"
        placeholderTextColor="#999"
        value={visionBaseUrl}
        onChangeText={(v) => update({ visionBaseUrl: v })}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>视觉 API Key</Text>
      <TextInput
        style={styles.input}
        placeholder="智谱开放平台 API Key"
        placeholderTextColor="#999"
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
        placeholderTextColor="#999"
        value={visionModel}
        onChangeText={(v) => update({ visionModel: v })}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.sectionTitle}>☁️ 云端（每日备课内容）</Text>
      <Text style={styles.placeholder}>与 Supabase 项目对应；访问密钥需先在 SQL 编辑器设置：update profiles set access_key = '...' where user_id = '...'</Text>

      <Text style={styles.label}>管理台地址（错题云同步代理）</Text>
      <TextInput
        style={styles.input}
        placeholder="https://你的项目.vercel.app"
        placeholderTextColor="#999"
        value={webApiUrl}
        onChangeText={(v) => update({ webApiUrl: v })}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>Supabase URL</Text>
      <TextInput
        style={styles.input}
        placeholder="https://xxx.supabase.co"
        placeholderTextColor="#999"
        value={supabaseUrl}
        onChangeText={(v) => update({ supabaseUrl: v })}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>Anon Key（公开 Key）</Text>
      <TextInput
        style={styles.input}
        placeholder="eyJhbGciOi…"
        placeholderTextColor="#999"
        value={supabaseAnonKey}
        onChangeText={(v) => update({ supabaseAnonKey: v })}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>访问密钥（登录后自动填充；也可手动填）</Text>
      <TextInput
        style={styles.input}
        placeholder="登录后自动对齐，或手动粘贴"
        placeholderTextColor="#999"
        value={accessKey}
        onChangeText={(v) => update({ accessKey: v })}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />

      <Text style={styles.sectionTitle}>🔐 账号登录（多设备一致）</Text>
      {authEmail ? (
        <>
          <Text style={styles.placeholder}>已登录：{authEmail}（数据经访问密钥自动同步到本账号）</Text>
          <TouchableOpacity style={styles.button} onPress={() => void signOut()} disabled={authBusy}>
            <Text style={styles.buttonText}>退出登录</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.placeholder}>登录后自动生成并回填访问密钥，换设备登录同一账号即数据收敛</Text>
          <TextInput
            style={styles.input}
            placeholder="邮箱"
            placeholderTextColor="#999"
            value={authEmailInput}
            onChangeText={setAuthEmailInput}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
          />
          <TextInput
            style={styles.input}
            placeholder="密码（至少 6 位）"
            placeholderTextColor="#999"
            value={authPassword}
            onChangeText={setAuthPassword}
            secureTextEntry
          />
          {authError && <Text style={styles.placeholder}>{authError}</Text>}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TouchableOpacity
              style={[styles.button, { flex: 1 }]}
              onPress={() => void signIn(authEmailInput, authPassword)}
              disabled={authBusy}
            >
              <Text style={styles.buttonText}>{authBusy ? '处理中…' : '登录'}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, { flex: 1, backgroundColor: '#555' }]}
              onPress={() => void signUp(authEmailInput, authPassword)}
              disabled={authBusy}
            >
              <Text style={styles.buttonText}>注册</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      <Text style={styles.sectionTitle}>🔍 联网搜索（Tavily）</Text>
      <Text style={styles.label}>Tavily API Key（AI 的 searchWeb 工具）</Text>
      <TextInput
        style={styles.input}
        placeholder="tvly-…"
        placeholderTextColor="#999"
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
        placeholderTextColor="#999"
        value={weatherKey}
        onChangeText={(v) => update({ weatherKey: v })}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>备用天气城市（定位失败或拒绝授权时使用，拼音如 Hangzhou）</Text>
      <TextInput
        style={styles.input}
        placeholder="Hangzhou"
        placeholderTextColor="#999"
        value={weatherCity}
        onChangeText={(v) => update({ weatherCity: v })}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>目标大学（用于横向对标）</Text>
      <TextInput
        style={styles.input}
        placeholder="如：浙江大学"
        placeholderTextColor="#999"
        value={targetUniversity}
        onChangeText={(v) => update({ targetUniversity: v })}
      />

      <Text style={styles.label}>目标总分（对标差距计算用，0–750）</Text>
      <TextInput
        style={styles.input}
        placeholder="如：630"
        placeholderTextColor="#999"
        value={targetScore === null ? '' : String(targetScore)}
        onChangeText={(v) => {
          const n = parseInt(v, 10);
          update({ targetScore: Number.isFinite(n) && n > 0 && n <= 750 ? n : null });
        }}
        keyboardType="number-pad"
      />

      <Text style={styles.sectionTitle}>📓 知识库（Obsidian）</Text>

      <Text style={styles.label}>GitHub 仓库（格式 owner/repo，需公开）</Text>
      <TextInput
        style={styles.input}
        placeholder="your-name/your-vault"
        placeholderTextColor="#999"
        value={githubRepo}
        onChangeText={(v) => update({ githubRepo: v })}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.label}>分支（默认 main）</Text>
      <TextInput
        style={styles.input}
        placeholder="main"
        placeholderTextColor="#999"
        value={githubBranch}
        onChangeText={(v) => update({ githubBranch: v })}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={styles.sectionTitle}>📅 自定义日期提醒</Text>

      {/* 月历红点视图（蓝皮书：点击日期添加提醒，红点标记） */}
      <View style={styles.calCard}>
        <View style={styles.calHeader}>
          <TouchableOpacity onPress={() => shiftMonth(-1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.calNav}>‹</Text>
          </TouchableOpacity>
          <Text style={styles.calTitle}>
            {viewYear} 年 {viewMonth + 1} 月
          </Text>
          <TouchableOpacity onPress={() => shiftMonth(1)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.calNav}>›</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.calWeek}>
          {['日', '一', '二', '三', '四', '五', '六'].map((w) => (
            <Text key={w} style={[styles.calWeekText, w === '日' && styles.calWeekend, w === '六' && styles.calWeekend]}>
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
          placeholderTextColor="#999"
          value={reminderDate}
          onChangeText={setReminderDate}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <TextInput
          style={styles.input}
          placeholder="提醒内容，如：收物理作业"
          placeholderTextColor="#999"
          value={reminderText}
          onChangeText={setReminderText}
          onSubmitEditing={submitReminder}
        />
      </View>
      <TouchableOpacity style={styles.reminderAddBtn} onPress={submitReminder}>
        <Text style={styles.reminderAddText}>添加提醒</Text>
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
            <TouchableOpacity onPress={() => removeReminder(r.id)}>
              <Text style={styles.reminderDelete}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}

      <Text style={styles.sectionTitle}>🔄 手动同步</Text>
      <Text style={styles.placeholder}>拉取云端最新备课内容并写入离线缓存，同时检查 Obsidian 目录可达性。</Text>
      <TouchableOpacity style={styles.syncBtn} onPress={runSync} disabled={syncing}>
        {syncing ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Text style={styles.syncBtnText}>🔄 立即同步</Text>
        )}
      </TouchableOpacity>
      {!!syncResult && <Text style={styles.syncResult}>{syncResult}</Text>}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fafafa' },
  button: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 12 },
  buttonText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  sectionTitle: { fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  label: { fontSize: 13, color: '#666', marginTop: 10, marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: '#fff',
  },
  placeholder: { color: '#999', fontSize: 14, lineHeight: 22, marginTop: 4 },
  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  presetChip: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#fff',
  },
  presetChipActive: { backgroundColor: '#111', borderColor: '#111' },
  presetText: { fontSize: 13, color: '#555' },
  presetTextActive: { color: '#fff', fontWeight: '700' },
  reminderRow: { flexDirection: 'row', gap: 8 },
  reminderDateInput: { width: 110 },
  reminderAddBtn: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 10, alignItems: 'center', marginTop: 10 },
  reminderAddText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  reminderItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginTop: 8,
  },
  reminderItemText: { fontSize: 14, color: '#333', flex: 1 },
  reminderDelete: { color: '#999', fontSize: 16, paddingHorizontal: 8 },
  reminderExpired: { color: '#aaa' },
  // 月历红点视图
  calCard: { backgroundColor: '#fff', borderRadius: 12, padding: 12 },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  calNav: { fontSize: 22, color: '#333', paddingHorizontal: 12 },
  calTitle: { fontSize: 15, fontWeight: '600', color: '#333' },
  calWeek: { flexDirection: 'row' },
  calWeekText: { width: `${100 / 7}%`, textAlign: 'center', fontSize: 11, color: '#999', paddingVertical: 4 },
  calWeekend: { color: '#c0392b' },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calCell: {
    width: `${100 / 7}%`,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  calCellToday: { borderWidth: 1, borderColor: '#1a73e8' },
  calCellSelected: { backgroundColor: '#111' },
  calDay: { fontSize: 13, color: '#333' },
  calDayToday: { color: '#1a73e8', fontWeight: '700' },
  calDaySelected: { color: '#fff', fontWeight: '700' },
  calDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: '#e53935', marginTop: 2 },
  calHint: { fontSize: 12, color: '#999', marginTop: 8, lineHeight: 18 },
  // 手动同步
  syncBtn: { backgroundColor: '#111', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 10 },
  syncBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  syncResult: { fontSize: 13, color: '#333', lineHeight: 21, marginTop: 10 },
});

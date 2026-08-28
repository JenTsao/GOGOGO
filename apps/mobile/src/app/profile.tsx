import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useMemo, useState } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useReminderStore, localDateStr } from '@/store/reminderStore';
import { LLM_PRESETS } from '@/lib/llm';
import { fetchDaily } from '@/lib/cloud';
import { writeDailyCache } from '@/lib/background';
import { fetchRepoPaths } from '@/lib/github';

// Tab 4：我的（配置与调度）
export default function ProfileScreen() {
  const {
    weatherKey, weatherCity, targetUniversity, githubRepo, githubBranch,
    llmProvider, llmBaseUrl, llmModel, llmApiKey,
    supabaseUrl, supabaseAnonKey, accessKey, tavilyKey, webApiUrl, update,
  } = useSettingsStore();
  const { reminders, addReminder, removeReminder } = useReminderStore();

  // 切换预设自动填充默认 baseUrl / 模型；custom 留空由用户自填
  const pickPreset = (key: string) => {
    const preset = LLM_PRESETS[key];
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
    if (!content || !/^\d{2,4}-\d{1,2}-\d{1,2}$/.test(raw)) return;
    const full = raw.length === 10 ? raw : `${new Date().getFullYear()}-${raw}`;
    // 归一化为本地日期串，保证驾驶舱横幅能按日匹配
    const d = new Date(full);
    if (Number.isNaN(d.getTime())) return;
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

      <Text style={styles.label}>访问密钥（与 profiles.access_key 一致）</Text>
      <TextInput
        style={styles.input}
        placeholder="你的随机密钥"
        placeholderTextColor="#999"
        value={accessKey}
        onChangeText={(v) => update({ accessKey: v })}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
      />

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
      <Text style={styles.label}>日期（MM-DD 或 YYYY-MM-DD，当日显示在驾驶舱横幅）</Text>
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
            <Text style={styles.reminderItemText}>
              {r.date} · {r.content}
            </Text>
            <TouchableOpacity onPress={() => removeReminder(r.id)}>
              <Text style={styles.reminderDelete}>✕</Text>
            </TouchableOpacity>
          </View>
        ))}
      <Text style={styles.placeholder}>日历红点视图 Phase 3 实现。</Text>

      <Text style={styles.sectionTitle}>🔄 手动同步</Text>
      <Text style={styles.placeholder}>拉取云端最新画像与 Obsidian 目录。Phase 3 接入 Supabase。</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fafafa' },
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
});

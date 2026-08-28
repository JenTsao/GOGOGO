import { View, Text, StyleSheet, TextInput, ScrollView } from 'react-native';
import { useSettingsStore } from '@/store/settingsStore';

// Tab 4：我的（配置与调度）
export default function ProfileScreen() {
  const { deepseekKey, weatherKey, weatherCity, targetUniversity, githubRepo, githubBranch, update } = useSettingsStore();

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionTitle}>⚙️ 配置（保存到本地 MMKV）</Text>

      <Text style={styles.label}>DeepSeek API Key</Text>
      <TextInput
        style={styles.input}
        placeholder="sk-…"
        placeholderTextColor="#999"
        value={deepseekKey}
        onChangeText={(v) => update({ deepseekKey: v })}
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
      <Text style={styles.placeholder}>点击日期添加提醒，红点标记。Phase 3 实现。</Text>

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
});

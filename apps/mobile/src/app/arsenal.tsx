import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAiStore } from '@/store/aiStore';
import { CodeSandbox } from '@/components/CodeSandbox';
import { KnowledgeView } from '@/components/KnowledgeView';
import { MistakeView } from '@/components/MistakeView';
import { BaseConverter } from '@/components/BaseConverter';
import { GlassCard } from '@/components/Glass';
import { AmbientGlow } from '@/components/AmbientGlow';
import { R, cardShadow, themedStyles, usePalette, useScheme } from '@/theme';

// Tab 2：弹药库（工具与知识）
export default function ArsenalScreen() {
  const C = usePalette();
  const styles = STYLES[useScheme()];
  const [tab, setTab] = useState<'code' | 'knowledge' | 'mistake' | 'tools'>('code');
  const runAction = useAiStore((s) => s.runAction);
  const insets = useSafeAreaInsets();

  const TABS: { key: 'code' | 'knowledge' | 'mistake' | 'tools'; label: string; icon: string }[] = [
    { key: 'code', label: '沙盒', icon: 'code-slash' },
    { key: 'knowledge', label: '知识库', icon: 'library' },
    { key: 'mistake', label: '错题本', icon: 'book' },
    { key: 'tools', label: '工具箱', icon: 'construct' },
  ];

  return (
    <View style={styles.screen}>
      {/* 环境光斑：半透玻璃卡透出的色彩来源 */}
      <AmbientGlow />
      <View style={[styles.container, { paddingTop: insets.top + 10 }]}>
      <View style={styles.switch}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
            activeOpacity={0.85}
          >
            <Ionicons name={t.icon as keyof typeof Ionicons.glyphMap} size={14} color={tab === t.key ? C.onPrimary : C.text2} />
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {tab === 'code' ? (
          <CodeSandbox />
        ) : tab === 'knowledge' ? (
          <KnowledgeView />
        ) : tab === 'mistake' ? (
          <MistakeView />
        ) : (
          <BaseConverter />
        )}

        <Text style={styles.sectionTitle}>快捷生成</Text>
        <TouchableOpacity onPress={() => runAction('生成错题本')} activeOpacity={0.85}>
          <GlassCard style={styles.actionBtn}>
            <View style={[styles.actionIcon, styles.iconRed]}>
              <Ionicons name="library" size={17} color={C.red} />
            </View>
            <View style={styles.actionText}>
              <Text style={styles.actionBtnText}>生成错题本</Text>
              <Text style={styles.actionHint}>汇总全部错题，AI 精炼成复习卡片</Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={C.text3} />
          </GlassCard>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => runAction('编译输出')} activeOpacity={0.85}>
          <GlassCard style={styles.actionBtn}>
            <View style={[styles.actionIcon, styles.iconBlue]}>
              <Ionicons name="archive" size={17} color={C.blue} />
            </View>
            <View style={styles.actionText}>
              <Text style={styles.actionBtnText}>编译输出</Text>
              <Text style={styles.actionHint}>PDF 复习 / Anki 卡片 / 纯文本大纲</Text>
            </View>
            <Ionicons name="chevron-forward" size={15} color={C.text3} />
          </GlassCard>
        </TouchableOpacity>
      </ScrollView>
      </View>
    </View>
  );
}

const STYLES = themedStyles((C) => ({
  // 底色容器：光斑铺在这一层之上、内容之下（container 透明让光斑可见）
  screen: { flex: 1, backgroundColor: C.bg },
  container: { flex: 1 },
  switch: {
    flexDirection: 'row',
    marginHorizontal: 16,
    gap: 4,
    backgroundColor: C.surfaceAlt,
    borderRadius: R.sm,
    padding: 3,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabActive: { backgroundColor: C.primary, ...cardShadow },
  tabText: { color: C.text2, fontWeight: '600', fontSize: 12 },
  tabTextActive: { color: C.onPrimary },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 104 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginTop: 18, marginBottom: 8, color: C.text },
  actionBtn: {
    borderRadius: R.md,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  actionIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  iconRed: { backgroundColor: C.redSoft },
  iconBlue: { backgroundColor: C.blueSoft },
  actionText: { flex: 1 },
  actionBtnText: { fontSize: 14, fontWeight: '700', color: C.text },
  actionHint: { marginTop: 2, fontSize: 12, color: C.text3, lineHeight: 16 },
}));

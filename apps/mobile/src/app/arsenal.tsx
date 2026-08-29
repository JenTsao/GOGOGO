import { View, Text, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAiStore } from '@/store/aiStore';
import { CodeSandbox } from '@/components/CodeSandbox';
import { KnowledgeView } from '@/components/KnowledgeView';
import { MistakeView } from '@/components/MistakeView';
import { GlassCard } from '@/components/Glass';
import { R, cardShadow, themedStyles, usePalette, useScheme } from '@/theme';

// Tab 2：弹药库（工具与知识）
// 顶部切换：[代码沙盒] | [知识库] | [错题本]
// 业务入口：一键生成错题本 / 编译输出（驱动 AI 表情状态）
export default function ArsenalScreen() {
  const C = usePalette();
  const styles = STYLES[useScheme()];
  const [tab, setTab] = useState<'code' | 'knowledge' | 'mistake'>('code');
  const runAction = useAiStore((s) => s.runAction);
  const insets = useSafeAreaInsets();

  const TABS: { key: 'code' | 'knowledge' | 'mistake'; label: string; icon: string }[] = [
    { key: 'code', label: '沙盒', icon: 'code-slash' },
    { key: 'knowledge', label: '知识库', icon: 'library' },
    { key: 'mistake', label: '错题本', icon: 'book' },
  ];

  return (
    <View style={[styles.container, { paddingTop: insets.top + 12 }]}>
      {/* 分段控制器：滑动胶囊选中态 */}
      <View style={styles.switch}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
            activeOpacity={0.85}
          >
            <Ionicons name={t.icon as keyof typeof Ionicons.glyphMap} size={15} color={tab === t.key ? C.onPrimary : C.text2} />
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {tab === 'code' ? (
          <CodeSandbox />
        ) : tab === 'knowledge' ? (
          <KnowledgeView />
        ) : (
          <MistakeView />
        )}

        {/* 业务入口：生成错题本 / 编译输出 */}
        <Text style={styles.sectionTitle}>快捷生成</Text>
        <TouchableOpacity onPress={() => runAction('生成错题本')} activeOpacity={0.85}>
          <GlassCard style={styles.actionBtn}>
            <View style={[styles.actionIcon, styles.iconRed]}>
              <Ionicons name="library" size={18} color={C.red} />
            </View>
            <View style={styles.actionText}>
              <Text style={styles.actionBtnText}>生成错题本</Text>
              <Text style={styles.actionHint}>汇总全部错题，AI 精炼成终极复习卡片</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.text3} />
          </GlassCard>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => runAction('编译输出')} activeOpacity={0.85}>
          <GlassCard style={styles.actionBtn}>
            <View style={[styles.actionIcon, styles.iconBlue]}>
              <Ionicons name="archive" size={18} color={C.blue} />
            </View>
            <View style={styles.actionText}>
              <Text style={styles.actionBtnText}>编译输出</Text>
              <Text style={styles.actionHint}>一键生成 PDF 复习 / Anki 卡片包 / 纯文本大纲</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.text3} />
          </GlassCard>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const STYLES = themedStyles((C) => ({
  container: { flex: 1, paddingTop: 12, backgroundColor: C.bg },
  switch: {
    flexDirection: 'row',
    marginHorizontal: 16,
    gap: 6,
    backgroundColor: C.surfaceAlt,
    borderRadius: R.sm,
    padding: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  tabActive: { backgroundColor: C.primary, ...cardShadow },
  tabText: { color: C.text2, fontWeight: '600', fontSize: 13 },
  tabTextActive: { color: C.onPrimary },
  body: { flex: 1 },
  bodyContent: { padding: 16, paddingBottom: 96 },
  sectionTitle: { fontSize: 17, fontWeight: '700', marginTop: 24, marginBottom: 10, color: C.text },
  actionBtn: {
    borderRadius: R.md,
    padding: 14,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  iconRed: { backgroundColor: C.redSoft },
  iconBlue: { backgroundColor: C.blueSoft },
  actionText: { flex: 1 },
  actionBtnText: { fontSize: 15, fontWeight: '700', color: C.text },
  actionHint: { marginTop: 3, fontSize: 12, color: C.text3, lineHeight: 17 },
}));

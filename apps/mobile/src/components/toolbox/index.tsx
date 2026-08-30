import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { cardShadow, themedStyles, usePalette, useScheme } from '@/theme';
import type { ToolEntry } from './shared';
import { BaseConverter } from './BaseConverter';
import { QuadraticSolver } from './QuadraticSolver';
import { PrimeFactor } from './PrimeFactor';
import { PermComb } from './PermComb';
import { FractionCalc } from './FractionCalc';

// 工具箱容器：网格入口 → 工具详情（带返回）。新增工具 = TOOLS 注册表加一行 + 对应组件文件
const TOOLS: ToolEntry[] = [
  { id: 'base', name: '进制转换', desc: '2 / 8 / 10 / 16 互转', icon: 'swap-horizontal', color: 'primary', component: BaseConverter },
  { id: 'quad', name: '一元二次方程', desc: '判别式 · 韦达定理 · 精确根', icon: 'calculator-outline', color: 'green', component: QuadraticSolver },
  { id: 'prime', name: '质因数分解', desc: '幂形式 · 约数个数', icon: 'grid-outline', color: 'orange', component: PrimeFactor },
  { id: 'permcomb', name: '排列组合', desc: 'A(n,m) / C(n,m) 大数精确', icon: 'shuffle-outline', color: 'blue', component: PermComb },
  { id: 'frac', name: '分数计算', desc: '四则运算 · 约分 · 带分数', icon: 'pie-chart-outline', color: 'red', component: FractionCalc },
];

export function Toolbox() {
  const C = usePalette();
  const styles = STYLES[useScheme()];
  const [active, setActive] = useState<ToolEntry | null>(null);

  // 详情视图：返回行 + 活动工具面板（组件引用来自模块级注册表，不会因重渲染重建）
  if (active) {
    const Tool = active.component;
    return (
      <View>
        <View style={styles.backRow}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setActive(null)} activeOpacity={0.85}>
            <Ionicons name="chevron-back" size={16} color={C.primary} />
            <Text style={styles.backText}>工具箱</Text>
          </TouchableOpacity>
          <Text style={styles.backTitle}>{active.name}</Text>
        </View>
        <Tool />
      </View>
    );
  }

  return (
    <View>
      <Text style={styles.gridTitle}>数学工具</Text>
      <View style={styles.grid}>
        {TOOLS.map((t) => {
          // 软色底映射：模板字符串索引 Palette 类型不安全，显式枚举更稳
          const soft: Record<ToolEntry['color'], string> = {
            primary: C.primarySoft,
            green: C.greenSoft,
            orange: C.orangeSoft,
            blue: C.blueSoft,
            red: C.redSoft,
          };
          return (
            <TouchableOpacity key={t.id} style={styles.cell} onPress={() => setActive(t)} activeOpacity={0.85}>
              <View style={[styles.cellIcon, { backgroundColor: soft[t.color] }]}>
                <Ionicons name={t.icon as keyof typeof Ionicons.glyphMap} size={20} color={C[t.color]} />
              </View>
              <View style={styles.cellBody}>
                <Text style={styles.cellName}>{t.name}</Text>
                <Text style={styles.cellDesc}>{t.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={C.text3} />
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const STYLES = themedStyles((C) => ({
  gridTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 8 },
  grid: { gap: 8 },
  cell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.glassCard,
    borderRadius: 16,
    padding: 12,
    ...cardShadow,
  },
  cellIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cellBody: { flex: 1 },
  cellName: { fontSize: 14, fontWeight: '700', color: C.text },
  cellDesc: { fontSize: 11, color: C.text3, marginTop: 2 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  backText: { fontSize: 13, color: C.primary, fontWeight: '600' },
  backTitle: { fontSize: 13, color: C.text3 },
}));

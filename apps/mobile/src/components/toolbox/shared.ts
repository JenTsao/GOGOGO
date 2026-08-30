import { Palette, cardShadow, glassRim, R } from '@/theme';
import type { ComponentType } from 'react';
import type { FontVariant } from 'react-native';

// 工具箱共享样式片段：各工具面板统一「玻璃卡 + 标题行」骨架，避免五份重复定义
export function toolBase(C: Palette) {
  return {
    panel: { backgroundColor: C.glassCard, borderRadius: R.lg, padding: 14, ...glassRim(C), ...cardShadow },
    titleRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6, marginBottom: 10 },
    title: { fontSize: 15, fontWeight: '700' as const, color: C.text },
    titleAside: { fontSize: 11, color: C.text3, marginLeft: 'auto' as const },
    chipRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginBottom: 10 },
    chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.surfaceAlt },
    chipActive: { backgroundColor: C.primary },
    chipText: { fontSize: 12, fontWeight: '600' as const, color: C.text2 },
    chipTextActive: { color: C.onPrimary },
    input: {
      flex: 1,
      backgroundColor: C.surfaceAlt,
      borderRadius: R.sm,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: C.text,
      fontSize: 16,
      fontWeight: '600' as const,
      // as const 会把数组变 readonly，与 RN TextStyle 要求的 FontVariant[]（可变）不兼容，需显式断言
      fontVariant: ['tabular-nums'] as FontVariant[],
    },
    errorText: { fontSize: 12, color: C.red, marginTop: 8, lineHeight: 17 },
    resultRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      backgroundColor: C.surfaceAlt,
      borderRadius: R.sm,
      paddingVertical: 10,
      paddingHorizontal: 12,
      gap: 8,
    },
    resultLabel: { fontSize: 11, color: C.text3, width: 52 },
    resultValue: { flex: 1, fontSize: 15, fontWeight: '700' as const, color: C.text, fontVariant: ['tabular-nums'] as FontVariant[] },
  };
}

/** 工具注册项：容器网格按此渲染，新增工具 = 注册表加一行 */
export interface ToolEntry {
  id: string;
  name: string;
  desc: string;
  icon: string;
  color: keyof Pick<Palette, 'primary' | 'green' | 'orange' | 'blue' | 'red'>;
  component: ComponentType;
}

import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { themedStyles, usePalette, useScheme } from '@/theme';
import { toolBase } from './shared';

// 工具箱 · 一元二次方程 ax² + bx + c = 0：判别式 / 韦达定理 / 精确分数根
// 浮点开方对整系数常见题可以给出「精确分数根」：判别式为完全平方数时根必有理，
// 用整数运算 + gcd 约分展示，避免 0.16666666 这类近似

/** 整数 gcd（约分用） */
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

/** 整数系数的分数约分显示：sign 并入分子；约到最简 */
function fracStr(num: number, den: number): string {
  if (den === 0) return '∞';
  const g = gcd(num, den);
  let n = num / g;
  const d = den / g;
  if (d < 0) {
    n = -n;
  }
  return d === 1 ? `${n}` : `${n}/${Math.abs(d)}`;
}

interface Solution {
  kind: 'two-real' | 'double' | 'complex' | 'linear' | 'degenerate' | 'empty';
  lines: string[];
  delta: number | null;
}

export function QuadraticSolver() {
  const C = usePalette();
  const styles = STYLES[useScheme()];
  const [a, setA] = useState('1');
  const [b, setB] = useState('-3');
  const [c, setC] = useState('2');

  const num = (s: string) => {
    const v = parseFloat(s.trim().replace(/−/g, '-')); // iOS 键盘可能输入 Unicode 负号
    return Number.isFinite(v) ? v : null;
  };

  const sol = useMemo<Solution | null>(() => {
    const A = num(a);
    const B = num(b);
    const D = num(c);
    if (A === null || B === null || D === null) return null;

    // 系数全为整数才尝试精确分数根（小数系数走近似路径）
    const allInt = [A, B, D].every((x) => Number.isInteger(x));

    if (A === 0) {
      if (B === 0) return { kind: D === 0 ? 'degenerate' : 'empty', lines: [], delta: null };
      return {
        kind: 'linear',
        lines: [
          `a = 0，退化为一次方程 ${B}x + ${D} = 0`,
          `x = ${fracStr(-D, B)}` + (allInt ? '' : ` ≈ ${(-D / B).toFixed(6)}`),
        ],
        delta: null,
      };
    }

    const delta = B * B - 4 * A * D;
    const lines: string[] = [];
    // Δ 完全平方 + 整系数 → 有理根，给精确分数
    const sqrtD = Math.sqrt(delta);
    const exact = allInt && delta >= 0 && delta < 2 ** 53 && Number.isInteger(sqrtD);
    const vertex = `顶点 x = ${allInt ? fracStr(-B, 2 * A) : (-B / (2 * A)).toFixed(6)}`;

    if (delta > 0) {
      if (exact) {
        lines.push(`x₁ = ${fracStr(-B + sqrtD, 2 * A)}`, `x₂ = ${fracStr(-B - sqrtD, 2 * A)}`);
      } else {
        lines.push(`x₁ = ${((-B + sqrtD) / (2 * A)).toFixed(6)}`, `x₂ = ${((-B - sqrtD) / (2 * A)).toFixed(6)}`);
        lines.push('（判别式非完全平方数，显示 6 位小数近似）');
      }
      lines.push(vertex);
    } else if (delta === 0) {
      lines.push(allInt ? `x₁ = x₂ = ${fracStr(-B, 2 * A)}` : `x₁ = x₂ = ${(-B / (2 * A)).toFixed(6)}`, vertex);
    } else {
      const re = -B / (2 * A);
      const im = Math.sqrt(-delta) / (2 * A);
      const f = (v: number) => (Math.abs(v) < 1e-10 ? '0' : v.toFixed(6));
      lines.push(`x₁ = ${f(re)} + ${f(Math.abs(im))}i`, `x₂ = ${f(re)} − ${f(Math.abs(im))}i`, `Δ < 0，无实根（共轭复根）`);
    }
    // 韦达定理（对任意系数成立，实/复根都适用）
    lines.push(`韦达：x₁ + x₂ = ${fracStr(-B, A)}，x₁ · x₂ = ${fracStr(D, A)}`);
    return {
      kind: delta > 0 ? 'two-real' : delta === 0 ? 'double' : 'complex',
      lines,
      delta,
    };
  }, [a, b, c]);

  const FIELD = [
    { label: 'a（二次项）', val: a, set: setA },
    { label: 'b（一次项）', val: b, set: setB },
    { label: 'c（常数项）', val: c, set: setC },
  ];

  return (
    <View style={styles.panel}>
      <View style={styles.titleRow}>
        <Ionicons name="calculator-outline" size={16} color={C.green} />
        <Text style={styles.title}>一元二次方程</Text>
        <Text style={styles.titleAside}>ax² + bx + c = 0</Text>
      </View>

      <View style={styles.fieldRow}>
        {FIELD.map((f) => (
          <View key={f.label} style={styles.field}>
            <Text style={styles.fieldLabel}>{f.label}</Text>
            <TextInput
              style={styles.fieldInput}
              placeholder="0"
              placeholderTextColor={C.text3}
              value={f.val}
              onChangeText={f.set}
              keyboardType="numbers-and-punctuation" // 需要负号与小数点，number-pad 没有
              autoCorrect={false}
              selectTextOnFocus
            />
          </View>
        ))}
      </View>

      {sol === null ? (
        <Text style={styles.errorText}>系数里有非法字符（支持负号与小数）</Text>
      ) : (
        <View style={styles.results}>
          {sol.delta !== null && (
            <View style={[styles.resultRow, styles.deltaRow]}>
              <Text style={styles.resultLabel}>判别式</Text>
              <Text style={styles.resultValue}>
                Δ = {sol.delta}
                {sol.kind === 'two-real' && '（Δ > 0，两不等实根）'}
                {sol.kind === 'double' && '（Δ = 0，重根）'}
                {sol.kind === 'complex' && '（Δ < 0，无实根）'}
              </Text>
            </View>
          )}
          {sol.lines.map((line, i) => (
            <View key={i} style={styles.resultRow}>
              <Text style={styles.resultValue}>{line}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const STYLES = themedStyles((C) => ({
  ...toolBase(C),
  fieldRow: { flexDirection: 'row', gap: 8 },
  field: { flex: 1, gap: 4 },
  fieldLabel: { fontSize: 11, color: C.text3 },
  fieldInput: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: C.text,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  results: { marginTop: 12, gap: 6 },
  deltaRow: { backgroundColor: C.primarySoft },
}));

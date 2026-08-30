import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { themedStyles, usePalette, useScheme } from '@/theme';
import { toolBase } from './shared';

// 工具箱 · 分数计算：±×÷ 四则 + 最简分数 / 带分数 / 小数近似
// BigInt 通分运算：分数加减的分母通分极易撞 2^53，7 位分母相乘就超了

type Op = '+' | '−' | '×' | '÷';

const OPS: Op[] = ['+', '−', '×', '÷'];

interface Frac {
  n: bigint; // 分子（可负）
  d: bigint; // 分母（恒正）
}

function gcdBig(a: bigint, b: bigint): bigint {
  a = a < 0n ? -a : a;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
}

function reduce(f: Frac): Frac {
  if (f.d < 0n) return reduce({ n: -f.n, d: -f.d });
  const g = gcdBig(f.n, f.d);
  // d=0n 必须原样保留（不能改成 1n）：调用方靠 A.d === 0n 检测「分母为 0」报错，
  // 此处篡改会让 5/0 被静默算成 1/1。g 恒 ≥ 1n，除法无除零风险
  return { n: f.n / g, d: f.d / g };
}

export function FractionCalc() {
  const C = usePalette();
  const styles = STYLES[useScheme()];
  const [n1, setN1] = useState('1');
  const [d1, setD1] = useState('3');
  const [n2, setN2] = useState('1');
  const [d2, setD2] = useState('6');
  const [op, setOp] = useState<Op>('−');

  const int = (v: string) => v.replace(/[^\d-]/g, '').replace(/(?!^)-/g, '').slice(0, 9); // 仅允许开头的负号
  const bg = (v: string) => BigInt(v || '0');

  const result = useMemo(() => {
    const A = reduce({ n: bg(n1), d: bg(d1) });
    const B = reduce({ n: bg(n2), d: bg(d2) });
    if (A.d === 0n || B.d === 0n) return { error: '分母不能为 0' };
    let R: Frac;
    switch (op) {
      case '+':
        R = { n: A.n * B.d + B.n * A.d, d: A.d * B.d };
        break;
      case '−':
        R = { n: A.n * B.d - B.n * A.d, d: A.d * B.d };
        break;
      case '×':
        R = { n: A.n * B.n, d: A.d * B.d };
        break;
      default:
        if (B.n === 0n) return { error: '除数为 0' };
        R = { n: A.n * B.d, d: A.d * B.n };
    }
    const r = reduce(R);
    const absN = r.n < 0n ? -r.n : r.n;
    // 带分数：|分子| ≥ 分母时拆整数部分（负数先取绝对值再补符号）
    const whole = absN / r.d;
    const rem = absN % r.d;
    const sign = r.n < 0n ? '−' : '';
    const plain = r.d === 1n ? `${r.n}` : `${r.n}/${r.d}`;
    const mixed =
      whole > 0n && r.d > 1n ? (rem === 0n ? `${sign}${whole}` : `${sign}${whole} ${rem}/${r.d}`) : null;
    // 小数近似：分母 ≤ 10⁶ 才除（除尽 6 位内显示精确值，否则带 …）
    let decimal: string | null = null;
    if (r.d !== 0n && r.d <= 10n ** 6n) {
      const q = (absN * 10n ** 8n) / r.d;
      const s = (q / 10n ** 8n).toString() + '.' + (q % 10n ** 8n).toString().padStart(8, '0');
      decimal = `${sign}${s.replace(/0+$/, '')}` + (/^\d+\.\d{8}$/.test(s) ? '…' : '');
    }
    return { plain, mixed, decimal, expr: `${n1 || 0}/${d1 || 1} ${op} ${n2 || 0}/${d2 || 1}` };
  }, [n1, d1, n2, d2, op]);

  const FIELDS: { label: string; val: string; set: (v: string) => void }[] = [
    { label: '分子₁', val: n1, set: setN1 },
    { label: '分母₁', val: d1, set: setD1 },
    { label: '分子₂', val: n2, set: setN2 },
    { label: '分母₂', val: d2, set: setD2 },
  ];

  return (
    <View style={styles.panel}>
      <View style={styles.titleRow}>
        <Ionicons name="pie-chart-outline" size={16} color={C.red} />
        <Text style={styles.title}>分数计算</Text>
        <Text style={styles.titleAside}>自动约分</Text>
      </View>

      {/* 运算符选择 */}
      <View style={styles.chipRow}>
        {OPS.map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.chip, op === k && styles.chipActive]}
            onPress={() => setOp(k)}
            activeOpacity={0.85}
          >
            <Text style={[styles.chipText, op === k && styles.chipTextActive]}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.fracRow}>
        {FIELDS.map((f) => (
          <View key={f.label} style={styles.fracField}>
            <Text style={styles.fracLabel}>{f.label}</Text>
            <TextInput
              style={styles.fracInput}
              placeholder="1"
              placeholderTextColor={C.text3}
              value={f.val}
              onChangeText={(v) => f.set(int(v))}
              keyboardType="numbers-and-punctuation"
              selectTextOnFocus
            />
          </View>
        ))}
      </View>

      {result.error ? (
        <Text style={styles.errorText}>{result.error}</Text>
      ) : (
        <View style={styles.results}>
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>算式</Text>
            <Text style={styles.resultValue}>{result.expr}</Text>
          </View>
          <View style={[styles.resultRow, styles.valueRow]}>
            <Text style={styles.resultLabel}>最简</Text>
            <Text style={styles.resultValue}>{result.plain}</Text>
          </View>
          {result.mixed && (
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>带分数</Text>
              <Text style={styles.resultValue}>{result.mixed}</Text>
            </View>
          )}
          {result.decimal && (
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>小数</Text>
              <Text style={styles.resultValue}>{result.decimal}</Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const STYLES = themedStyles((C) => ({
  ...toolBase(C),
  fracRow: { flexDirection: 'row', gap: 8 },
  fracField: { flex: 1, gap: 4 },
  fracLabel: { fontSize: 11, color: C.text3, textAlign: 'center' },
  fracInput: {
    backgroundColor: C.surfaceAlt,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 9,
    color: C.text,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  results: { marginTop: 12, gap: 6 },
  valueRow: { backgroundColor: C.primarySoft },
}));

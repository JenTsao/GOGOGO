import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { themedStyles, usePalette, useScheme } from '@/theme';
import { toolBase } from './shared';

// 工具箱 · 质因数分解：BigInt 试除到 √n，输出幂形式 + 约数个数
// BigInt 是硬要求：12 位数的因子运算在 Number 上已会撞 2^53 失真

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};

/** BigInt 整数平方根（牛顿迭代）：BigInt 无原生 sqrt，试除终止条件 i*i > n 需要它 */
function isqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = 1n << BigInt(Math.ceil(n.toString(2).length / 2)); // 初值 2^⌈bits/2⌉ ≥ √n
  let y = (x + n / x) >> 1n;
  while (y < x) {
    x = y;
    y = (x + n / x) >> 1n;
  }
  return x;
}

const toSuper = (digits: string) => digits.split('').map((d) => SUPERSCRIPT[d] ?? d).join('');

export function PrimeFactor() {
  const C = usePalette();
  const styles = STYLES[useScheme()];
  const [raw, setRaw] = useState('360');

  const onChange = (v: string) => {
    setRaw(v.replace(/\D/g, '').slice(0, 12)); // 12 位上限：试除 √n ≤ 10⁶，循环量可控
  };

  const result = useMemo(() => {
    const n = BigInt(raw || '0');
    if (n < 2n) return null;
    // 试除：2 单独处理，之后只走奇数
    const factors: { p: bigint; e: number }[] = [];
    let rest = n;
    for (const p of [2n, 3n]) {
      let e = 0;
      while (rest % p === 0n) {
        rest /= p;
        e++;
      }
      if (e) factors.push({ p, e });
    }
    for (let i = 5n, limit = isqrt(rest); i <= limit; i += 2n) {
      let e = 0;
      while (rest % i === 0n) {
        rest /= i;
        e++;
      }
      if (e) factors.push({ p: i, e });
      limit = isqrt(rest); // 除掉因子后上限收缩，合数因子到不了（小因子先被除尽）
    }
    if (rest > 1n) factors.push({ p: rest, e: 1 });
    const divisorCount = factors.reduce((s, f) => s * (f.e + 1), 1);
    const powerForm = factors.map((f) => (f.e > 1 ? `${f.p}${toSuper(String(f.e))}` : `${f.p}`)).join(' × ');
    const expandForm = factors.flatMap((f) => Array(f.e).fill(f.p)).join(' × ');
    return { n, factors, divisorCount, powerForm, expandForm, isPrime: factors.length === 1 && factors[0].e === 1 };
  }, [raw]);

  return (
    <View style={styles.panel}>
      <View style={styles.titleRow}>
        <Ionicons name="grid-outline" size={16} color={C.orange} />
        <Text style={styles.title}>质因数分解</Text>
        <Text style={styles.titleAside}>≤ 12 位整数</Text>
      </View>

      <TextInput
        style={styles.input}
        placeholder="输入正整数"
        placeholderTextColor={C.text3}
        value={raw}
        onChangeText={onChange}
        keyboardType="number-pad"
        selectTextOnFocus
      />

      {result ? (
        <View style={styles.results}>
          {result.isPrime && <Text style={styles.primeTag}>{result.n.toString()} 是质数</Text>}
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>分解式</Text>
            <Text style={styles.resultValue}>{result.powerForm}</Text>
          </View>
          {result.factors.length > 1 && (
            <View style={styles.resultRow}>
              <Text style={styles.resultLabel}>展开</Text>
              <Text style={styles.resultValue}>{result.expandForm}</Text>
            </View>
          )}
          <View style={styles.resultRow}>
            <Text style={styles.resultLabel}>约数个数</Text>
            <Text style={styles.resultValue}>
              {result.divisorCount}（{'Π(eᵢ+1) = '}
              {result.factors.map((f) => `(${f.e}+1)`).join(' × ')}）
            </Text>
          </View>
        </View>
      ) : (
        <Text style={styles.hint}>输入 ≥ 2 的整数开始分解</Text>
      )}
    </View>
  );
}

const STYLES = themedStyles((C) => ({
  ...toolBase(C),
  results: { marginTop: 12, gap: 6 },
  primeTag: {
    alignSelf: 'flex-start',
    backgroundColor: C.greenSoft,
    color: C.greenDeep,
    fontSize: 12,
    fontWeight: '700',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    marginBottom: 2,
  },
  hint: { fontSize: 12, color: C.text3, marginTop: 10, lineHeight: 17 },
}));

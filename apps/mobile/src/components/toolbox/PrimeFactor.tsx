import { View, Text, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useDeferredValue, useMemo, useState } from 'react';
import { themedStyles, usePalette, useScheme } from '@/theme';
import { toolBase } from './shared';

// 工具箱 · 质因数分解：试除到 √n，输出幂形式 + 约数个数
// 输入限 12 位（≤ 10¹² < 2⁵³）：Number 全程精确且比 BigInt 快约两个数量级
// （早先误用 BigInt 且每轮迭代重算牛顿开方：12 位质数 = 50 万次 BigInt 取模 + 每轮 20 次 BigInt 除法，单次键入可卡秒级）
// 另用 useDeferredValue 把大数分解挪到低优先级渲染：键入即时回显，结果稍后补上

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
};

const toSuper = (digits: string) => digits.split('').map((d) => SUPERSCRIPT[d] ?? d).join('');

/** 整数平方根：Math.sqrt 有舍入，floor 可能偏差 1，回调校正（n < 2⁵³ 时 r·r 无溢出） */
function isqrt(n: number): number {
  let r = Math.floor(Math.sqrt(n));
  while (r * r > n) r--;
  while ((r + 1) * (r + 1) <= n) r++;
  return r;
}

export function PrimeFactor() {
  const C = usePalette();
  const styles = STYLES[useScheme()];
  const [raw, setRaw] = useState('360');
  // 12 位质数试除 ~50 万次循环：挪到 deferred 渲染，键入不被阻塞
  const deferredRaw = useDeferredValue(raw);

  const onChange = (v: string) => {
    setRaw(v.replace(/\D/g, '').slice(0, 12)); // 12 位上限：试除 √n ≤ 10⁶，循环量可控
  };

  const result = useMemo(() => {
    const n = parseInt(deferredRaw || '0', 10);
    if (!Number.isFinite(n) || n < 2) return null;
    // 试除：2/3 单独处理，之后只走奇数
    const factors: { p: number; e: number }[] = [];
    let rest = n;
    for (const p of [2, 3]) {
      let e = 0;
      while (rest % p === 0) {
        rest /= p;
        e++;
      }
      if (e) factors.push({ p, e });
    }
    // 上限只在除出因子后收缩（rest 变小才需要更小的 √rest；每轮重算是 BigInt 版的卡顿根源）
    let limit = isqrt(rest);
    for (let i = 5; i <= limit; i += 2) {
      let e = 0;
      while (rest % i === 0) {
        rest /= i;
        e++;
      }
      if (e) {
        factors.push({ p: i, e });
        limit = isqrt(rest);
      }
    }
    if (rest > 1) factors.push({ p: rest, e: 1 });
    const divisorCount = factors.reduce((s, f) => s * (f.e + 1), 1);
    const powerForm = factors.map((f) => (f.e > 1 ? `${f.p}${toSuper(String(f.e))}` : `${f.p}`)).join(' × ');
    const expandForm = factors.flatMap((f) => Array(f.e).fill(`${f.p}`)).join(' × ');
    return { n, factors, divisorCount, powerForm, expandForm, isPrime: factors.length === 1 && factors[0].e === 1 };
  }, [deferredRaw]);

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
          {result.isPrime && <Text style={styles.primeTag}>{result.n} 是质数</Text>}
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

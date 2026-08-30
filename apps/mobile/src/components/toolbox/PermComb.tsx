import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HIT_SLOP, themedStyles, usePalette, useScheme } from '@/theme';
import { toolBase } from './shared';

// 工具箱 · 排列组合 A(n,m) / C(n,m)：BigInt 精确
// C(200,100) ≈ 9×10⁵⁸，Number 早失真；组合数用乘法递推（只乘不除大阶乘），中间值始终整数

type Mode = 'A' | 'C';

/** A(n, m) = n!/(n-m)!：直接连乘 n·(n-1)·…·(n-m+1) */
function perm(n: number, m: number): bigint {
  let acc = 1n;
  for (let k = 0; k < m; k++) acc *= BigInt(n - k);
  return acc;
}

/** C(n, m)：递推 C(n,k) = C(n,k-1)·(n-k+1)/k，k 递增保证整除（先乘后除无舍入） */
function comb(n: number, m: number): bigint {
  const k = Math.min(m, n - m); // 对称性取小侧，运算量减半
  let acc = 1n;
  for (let i = 1; i <= k; i++) {
    acc = (acc * BigInt(n - k + i)) / BigInt(i);
  }
  return acc;
}

export function PermComb() {
  const C = usePalette();
  const styles = STYLES[useScheme()];
  const [mode, setMode] = useState<Mode>('C');
  const [nStr, setNStr] = useState('10');
  const [mStr, setMStr] = useState('3');
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const digits = (v: string) => v.replace(/\D/g, '').slice(0, 3); // n ≤ 999 输入限三位
  const n = parseInt(nStr || '0', 10);
  const m = parseInt(mStr || '0', 10);

  const result = useMemo(() => {
    if (!Number.isFinite(n) || !Number.isFinite(m)) return { error: '输入 n 与 m' };
    if (n < 0 || m < 0) return { error: 'n、m 需为非负整数' };
    if (m > n) return { error: 'm 不能大于 n（A/C 定义要求 m ≤ n）' };
    if (n > 200) return { error: 'n 上限 200（A(200,100) 已是数百位大数）' };
    const value = mode === 'A' ? perm(n, m) : comb(n, m);
    return { value, digits: value.toString().length };
  }, [mode, n, m]);

  const copy = async () => {
    if (!result.value) return;
    await Clipboard.setStringAsync(result.value.toString());
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 1200);
  };

  const formula = mode === 'A' ? 'A(n,m) = n!/(n−m)!' : 'C(n,m) = n! / ((n−m)!·m!)';
  const example =
    mode === 'A' ? '例：8 人排 3 个位置 = A(8,3) = 336' : '例：10 选 3 组队 = C(10,3) = 120';

  return (
    <View style={styles.panel}>
      <View style={styles.titleRow}>
        <Ionicons name="shuffle-outline" size={16} color={C.blue} />
        <Text style={styles.title}>排列组合</Text>
        <Text style={styles.titleAside}>BigInt 精确</Text>
      </View>

      {/* 模式切换：排列 / 组合 */}
      <View style={styles.chipRow}>
        {(['A', 'C'] as Mode[]).map((k) => (
          <TouchableOpacity
            key={k}
            style={[styles.chip, mode === k && styles.chipActive]}
            onPress={() => setMode(k)}
            activeOpacity={0.85}
          >
            <Text style={[styles.chipText, mode === k && styles.chipTextActive]}>
              {k === 'A' ? '排列 A(n,m)' : '组合 C(n,m)'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.nmRow}>
        <View style={styles.nmField}>
          <Text style={styles.nmLabel}>n（总数）</Text>
          <TextInput
            style={styles.nmInput}
            placeholder="10"
            placeholderTextColor={C.text3}
            value={nStr}
            onChangeText={(v) => setNStr(digits(v))}
            keyboardType="number-pad"
            selectTextOnFocus
          />
        </View>
        <View style={styles.nmField}>
          <Text style={styles.nmLabel}>m（取出）</Text>
          <TextInput
            style={styles.nmInput}
            placeholder="3"
            placeholderTextColor={C.text3}
            value={mStr}
            onChangeText={(v) => setMStr(digits(v))}
            keyboardType="number-pad"
            selectTextOnFocus
          />
        </View>
      </View>

      {result.error ? (
        <Text style={styles.errorText}>{result.error}</Text>
      ) : (
        <View style={styles.results}>
          <View style={[styles.resultRow, styles.valueRow]}>
            <Text style={styles.resultValue}>
              {mode}({n},{m}) = {result.value!.toString()}
            </Text>
            <TouchableOpacity onPress={() => void copy()} hitSlop={HIT_SLOP} accessibilityLabel="复制结果">
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={copied ? C.green : C.text2} />
            </TouchableOpacity>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.subText}>
              共 {result.digits} 位 · {formula}
            </Text>
          </View>
          <View style={styles.resultRow}>
            <Text style={styles.subText}>{example}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const STYLES = themedStyles((C) => ({
  ...toolBase(C),
  nmRow: { flexDirection: 'row', gap: 8 },
  nmField: { flex: 1, gap: 4 },
  nmLabel: { fontSize: 11, color: C.text3 },
  nmInput: {
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
  valueRow: { backgroundColor: C.primarySoft },
  subText: { flex: 1, fontSize: 12, color: C.text3, lineHeight: 17 },
}));

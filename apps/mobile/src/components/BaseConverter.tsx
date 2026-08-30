import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HIT_SLOP, R, cardShadow, glassRim, themedStyles, usePalette, useScheme } from '@/theme';

// 工具箱 · 进制转换：2/8/10/16 互转，输入即算（无提交按钮）
// 用 BigInt 做进制解析与格式化：parseInt/Number 超过 2^53 会失真，大数二进制题直接算错

const BASES = [2, 8, 10, 16] as const;
type Base = (typeof BASES)[number];

const BASE_LABEL: Record<Base, string> = { 2: '二进制', 8: '八进制', 10: '十进制', 16: '十六进制' };

/** 任意进制字符串 → BigInt（radix 2-36 精确解析；含非法字符返回 null，空串返回 0n） */
function parseBig(input: string, radix: Base): bigint | null {
  let acc = 0n;
  const B = BigInt(radix);
  for (const ch of input.toLowerCase()) {
    const d = parseInt(ch, 36); // 0-9a-z → 0-35；g-z 对 16 进制会命中 d >= radix 被拦
    if (Number.isNaN(d) || d >= radix) return null;
    acc = acc * B + BigInt(d);
  }
  return acc;
}

export function BaseConverter() {
  const C = usePalette();
  const styles = STYLES[useScheme()];
  const [raw, setRaw] = useState('');
  const [fromBase, setFromBase] = useState<Base>(10);
  const [copied, setCopied] = useState<Base | null>(null);
  // 复制回执 1.2s 复位：卸载后不得再 setState，定时器随组件销毁
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current);
  }, []);

  const trimmed = raw.trim();
  // 输入侧只放行当前进制合法字符（其余吞掉），故解析失败只会发生在切换源进制后
  const parsed = useMemo(() => (trimmed ? parseBig(trimmed, fromBase) : null), [trimmed, fromBase]);
  const invalid = !!trimmed && parsed === null;

  const onChange = (v: string) => {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, fromBase);
    const cleaned = v
      .toLowerCase()
      .split('')
      .filter((c) => alphabet.includes(c))
      .slice(0, 64) // 64 位上限：进制题远够，防超大串 BigInt 卡顿
      .join('');
    setRaw(cleaned.toUpperCase());
  };

  const copy = async (text: string, b: Base) => {
    await Clipboard.setStringAsync(text);
    setCopied(b);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(null), 1200);
  };

  return (
    <View style={styles.panel}>
      <View style={styles.titleRow}>
        <Ionicons name="swap-horizontal" size={16} color={C.primary} />
        <Text style={styles.title}>进制转换</Text>
        <Text style={styles.titleAside}>输入即算</Text>
      </View>

      {/* 源进制选择 */}
      <View style={styles.chipRow}>
        {BASES.map((b) => (
          <TouchableOpacity
            key={b}
            style={[styles.chip, fromBase === b && styles.chipActive]}
            onPress={() => setFromBase(b)}
            activeOpacity={0.85}
          >
            <Text style={[styles.chipText, fromBase === b && styles.chipTextActive]}>{BASE_LABEL[b]}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* 数值输入 */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          placeholder={`输入${BASE_LABEL[fromBase]}数值`}
          placeholderTextColor={C.text3}
          value={raw}
          onChangeText={onChange}
          keyboardType={fromBase === 2 || fromBase === 10 ? 'number-pad' : 'default'}
          autoCapitalize="none"
          autoCorrect={false}
          selectTextOnFocus
        />
        {!!raw && (
          <TouchableOpacity style={styles.clearBtn} onPress={() => setRaw('')} hitSlop={HIT_SLOP} accessibilityLabel="清空输入">
            <Ionicons name="close-circle" size={18} color={C.text3} />
          </TouchableOpacity>
        )}
      </View>
      {invalid && <Text style={styles.errorText}>输入包含 {fromBase} 进制以外的字符，换个源进制或改输入</Text>}

      {/* 结果：四个进制各一行，源进制行高亮 */}
      <View style={styles.rows}>
        {BASES.map((b) => {
          const isSrc = b === fromBase;
          const value = parsed !== null ? (isSrc ? trimmed.toUpperCase() : fmtBig(parsed, b)) : null;
          return (
            <View key={b} style={[styles.row, isSrc && styles.rowSrc]}>
              <Text style={styles.rowLabel}>{BASE_LABEL[b]}</Text>
              <Text style={[styles.rowValue, !value && styles.rowEmpty]} numberOfLines={1}>
                {value ?? '—'}
              </Text>
              <TouchableOpacity
                style={styles.copyBtn}
                disabled={!value}
                onPress={() => value && void copy(value, b)}
                hitSlop={HIT_SLOP}
                accessibilityLabel={`复制${BASE_LABEL[b]}结果`}
              >
                <Ionicons
                  name={copied === b ? 'checkmark' : 'copy-outline'}
                  size={15}
                  color={copied === b ? C.green : C.text2}
                />
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** BigInt → 指定进制字符串（toString 原生支持 2-36；hex 统一大写更易读） */
function fmtBig(n: bigint, radix: Base): string {
  return n.toString(radix).toUpperCase();
}

const STYLES = themedStyles((C) => ({
  panel: { backgroundColor: C.glassCard, borderRadius: R.lg, padding: 14, ...glassRim(C), ...cardShadow },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  title: { fontSize: 15, fontWeight: '700', color: C.text },
  titleAside: { fontSize: 11, color: C.text3, marginLeft: 'auto' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  chip: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.surfaceAlt },
  chipActive: { backgroundColor: C.primary },
  chipText: { fontSize: 12, fontWeight: '600', color: C.text2 },
  chipTextActive: { color: C.onPrimary },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: C.surfaceAlt,
    borderRadius: R.sm,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.text,
    fontSize: 16,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  clearBtn: { padding: 4 },
  errorText: { fontSize: 12, color: C.red, marginTop: 8, lineHeight: 17 },
  rows: { marginTop: 12, gap: 6 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.surfaceAlt,
    borderRadius: R.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  rowSrc: { borderWidth: 1, borderColor: C.primary },
  rowLabel: { fontSize: 11, color: C.text3, width: 52 },
  rowValue: { flex: 1, fontSize: 15, fontWeight: '700', color: C.text, fontVariant: ['tabular-nums'] },
  rowEmpty: { color: C.text3, fontWeight: '400' },
  copyBtn: { padding: 4 },
}));

import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HIT_SLOP, themedStyles, usePalette, useScheme } from '@/theme';
import { toolBase } from './shared';

// 工具箱 · 进制转换：2/8/10/16 互转，输入即算（无提交按钮）
// 用 BigInt 做进制解析与格式化：parseInt/Number 超过 2^53 会失真，大数二进制题直接算错

const BASES = [2, 8, 10, 16] as const;
type Base = (typeof BASES)[number];

const BASE_LABEL: Record<Base, string> = { 2: '二进制', 8: '八进制', 10: '十进制', 16: '十六进制' };

/** 任意进制字符串 → BigInt（radix 2-36 精确解析；支持前导负号；含非法字符或只有负号返回 null） */
function parseBig(input: string, radix: Base): bigint | null {
  const negative = input.startsWith('-');
  const digits = negative ? input.slice(1) : input;
  // 只有负号（无数字位）：返回 null 交给外层当作「输入未完成」，不当 0 也不报错
  if (negative && digits.length === 0) return null;
  let acc = 0n;
  const B = BigInt(radix);
  for (const ch of digits.toLowerCase()) {
    const d = parseInt(ch, 36); // 0-9a-z → 0-35；g-z 对 16 进制会命中 d >= radix 被拦
    if (Number.isNaN(d) || d >= radix) return null;
    acc = acc * B + BigInt(d);
  }
  return negative ? -acc : acc;
}

/** BigInt → 指定进制字符串（toString 原生支持 2-36；hex 统一大写更易读） */
function fmtBig(n: bigint, radix: Base): string {
  return n.toString(radix).toUpperCase();
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
  // 输入侧只放行当前进制合法字符与前导负号（其余吞掉），故解析失败只会发生在切换源进制后
  const parsed = useMemo(() => (trimmed ? parseBig(trimmed, fromBase) : null), [trimmed, fromBase]);
  // 纯负号 = 用户正在输入负数但还没敲数字：不判非法
  const invalid = !!trimmed && parsed === null && trimmed !== '-';

  const onChange = (v: string) => {
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, fromBase);
    const cleaned = v
      .toLowerCase()
      .split('')
      .filter((c, i) => (i === 0 && c === '-') || alphabet.includes(c))
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
            <View key={b} style={[styles.resultRow, isSrc && styles.rowSrc]}>
              <Text style={styles.resultLabel}>{BASE_LABEL[b]}</Text>
              <Text style={[styles.resultValue, !value && styles.rowEmpty]} numberOfLines={1}>
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

const STYLES = themedStyles((C) => ({
  ...toolBase(C),
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clearBtn: { padding: 4 },
  rows: { marginTop: 12, gap: 6 },
  rowSrc: { borderWidth: 1, borderColor: C.primary },
  rowEmpty: { color: C.text3, fontWeight: '400' },
  copyBtn: { padding: 4 },
}));

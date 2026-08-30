import { StyleProp, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { themedStyles, usePalette, useScheme } from '@/theme';

/**
 * 彩蛋金句胶囊：🎧 徽章 + 斜体金句，统一全 App 彩蛋视觉语言。
 * tone='soft' 用于常规玻璃卡（主色浅底徽章）；tone='ink' 用于心流恒深场景（玻璃徽章）。
 */
export function EggLine({
  line,
  tone = 'soft',
  style,
}: {
  line: string;
  tone?: 'soft' | 'ink';
  style?: StyleProp<ViewStyle>;
}) {
  const styles = STYLES[useScheme()];
  const ink = tone === 'ink';
  return (
    <View style={[ink ? styles.inkWrap : styles.softWrap, style]}>
      <View style={ink ? styles.inkChip : styles.softChip}>
        <Ionicons name="headset-outline" size={12} color={ink ? styles.inkText.color : styles.softText.color} />
      </View>
      <Text style={[ink ? styles.inkText : styles.softText, ink && { textAlign: 'center' }]}>{line}</Text>
    </View>
  );
}

const STYLES = themedStyles((C) => ({
  softWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
  } as ViewStyle,
  softChip: {
    width: 22, height: 22, borderRadius: 7, backgroundColor: C.primarySoft,
    alignItems: 'center', justifyContent: 'center',
  } as ViewStyle,
  softText: {
    flex: 1, fontSize: 12.5, lineHeight: 18, color: C.text2, fontStyle: 'italic',
  } as TextStyle,
  inkWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'center', maxWidth: '86%',
  } as ViewStyle,
  inkChip: {
    width: 22, height: 22, borderRadius: 7, backgroundColor: C.glassDark,
    borderWidth: StyleSheet.hairlineWidth, borderColor: C.glassDarkBorder,
    alignItems: 'center', justifyContent: 'center',
  } as ViewStyle,
  inkText: {
    fontSize: 12.5, lineHeight: 18, color: C.inkDim, fontStyle: 'italic',
  } as TextStyle,
}));

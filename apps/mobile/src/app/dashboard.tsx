import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import Svg, { Polygon, Line, Circle, Text as SvgText } from 'react-native-svg';
import { Fragment, useMemo, useState } from 'react';
import { useFocusStore } from '@/store/focusStore';
import { useTaskStore } from '@/store/taskStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { useSandboxStore } from '@/store/sandboxStore';
import { useSettingsStore } from '@/store/settingsStore';
import { localDateStr } from '@/store/reminderStore';

// Tab 3：仪表盘 —— 激进模式画像
// 五维雷达暂基于可计算数据（专注/任务/知识积累）；学科正确率维度待错题本实装后接入
interface RadarDim {
  label: string;
  score: number; // 0-100
}

const SIZE = 220;
const C = SIZE / 2;
const R = 78;

function radarPoint(i: number, total: number, r: number): { x: number; y: number } {
  // 从正上方开始，顺时针分布
  const angle = (Math.PI * 2 * i) / total - Math.PI / 2;
  return { x: C + r * Math.cos(angle), y: C + r * Math.sin(angle) };
}

function polygonPoints(scores: number[], r: number): string {
  return scores
    .map((s, i) => {
      const p = radarPoint(i, scores.length, (r * Math.max(0, Math.min(100, s))) / 100);
      return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    })
    .join(' ');
}

export default function DashboardScreen() {
  const sessions = useFocusStore((s) => s.sessions);
  const top3 = useTaskStore((s) => s.top3);
  const knowledgeCount = useKnowledgeStore((s) => Object.keys(s.cache).length);
  const snippetCount = useSandboxStore((s) => s.snippets.length);
  const { targetUniversity, tavilyKey } = useSettingsStore();

  const [benchmark, setBenchmark] = useState<string | null>(null);
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);

  // 近 7 天每天专注分钟（含今天）
  const dailyMinutes = useMemo(() => {
    const days: { date: string; min: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const date = localDateStr(d);
      const min = Math.round(
        sessions.filter((s) => localDateStr(new Date(s.endedAt)) === date).reduce((sum, s) => sum + s.duration, 0) / 60
      );
      days.push({ date, min });
    }
    return days;
  }, [sessions]);

  // 五维评分（上限 100）
  const dims = useMemo<RadarDim[]>(() => {
    const week = dailyMinutes.slice(-7);
    const weekMin = week.reduce((s, d) => s + d.min, 0);
    const activeDays = week.filter((d) => d.min > 0).length;
    const avgMin = sessions.length ? weekMin / Math.max(1, sessions.filter((s) => Date.now() - new Date(s.endedAt).getTime() <= 7 * 86400000).length) : 0;
    const doneRatio = top3.length ? (top3.filter((t) => t.status === 'done').length / top3.length) * 100 : 0;
    return [
      { label: '专注投入', score: Math.min(100, (weekMin / 300) * 100) },
      { label: '专注深度', score: Math.min(100, (avgMin / 45) * 100) },
      { label: '坚持天数', score: (activeDays / 7) * 100 },
      { label: '任务执行', score: doneRatio },
      { label: '知识积累', score: Math.min(100, ((knowledgeCount + snippetCount) / 20) * 100) },
    ];
  }, [dailyMinutes, sessions, top3, knowledgeCount, snippetCount]);

  const maxDaily = Math.max(30, ...dailyMinutes.map((d) => d.min));
  const strength = [...dims].sort((a, b) => b.score - a.score)[0];
  const weakness = [...dims].sort((a, b) => a.score - b.score)[0];

  // 横向对标：Tavily 搜索目标大学分数线
  const runBenchmark = async () => {
    if (!tavilyKey) {
      setBenchmark('未配置 Tavily Key（在「我的」填写后可用横向对标）');
      return;
    }
    setBenchmarkBusy(true);
    setBenchmark(null);
    try {
      const query = `${targetUniversity || '重点大学'} 2025 高考分数线 各科`;
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyKey, query, max_results: 3, include_answer: true }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { answer?: string; results?: { title: string; url: string }[] };
      const lines = (data.results ?? []).slice(0, 3).map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`);
      setBenchmark(`🔥 ${query}\n${data.answer ? `\n摘要：${data.answer}` : ''}\n\n${lines.join('\n') || '无结果'}`);
    } catch (e) {
      setBenchmark(`对标搜索失败：${(e as Error).message}`);
    } finally {
      setBenchmarkBusy(false);
    }
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.cardTitle}>📊 我的画像</Text>
      <View style={styles.card}>
        {sessions.length === 0 && top3.length === 0 ? (
          <Text style={styles.placeholder}>先开始一次专注或创建任务，画像会随数据积累逐渐清晰</Text>
        ) : (
          <Text style={styles.profileText}>
            💪 优势：<Text style={styles.strength}>{strength.label}</Text>　　⚠️ 待加强：
            <Text style={styles.weakness}>{weakness.label}</Text>
          </Text>
        )}
        <Text style={styles.placeholder}>
          学科正确率维度待错题本实装后接入；卡壳词云依赖笔记情绪分析（语音备忘 Phase 3+）
        </Text>
      </View>

      <Text style={styles.cardTitle}>能力雷达（100 分制）</Text>
      <View style={[styles.card, styles.center]}>
        <Svg width={SIZE} height={SIZE}>
          {/* 网格：25/50/75/100 */}
          {[25, 50, 75, 100].map((lv) => (
            <Polygon
              key={lv}
              points={polygonPoints(new Array(5).fill(lv), R)}
              fill="none"
              stroke="#e3e6eb"
              strokeWidth={1}
            />
          ))}
          {/* 轴线与维度标签 */}
          {dims.map((d, i) => {
            const p = radarPoint(i, dims.length, R);
            const lp = radarPoint(i, dims.length, R + 22);
            return (
              <Fragment key={`ax-${i}`}>
                <Line x1={C} y1={C} x2={p.x} y2={p.y} stroke="#e3e6eb" strokeWidth={1} />
                <SvgText
                  x={lp.x}
                  y={lp.y}
                  fill="#666"
                  fontSize={10}
                  textAnchor="middle"
                  alignmentBaseline="middle"
                >
                  {d.label}
                </SvgText>
              </Fragment>
            );
          })}
          {/* 数据多边形 */}
          <Polygon
            points={polygonPoints(dims.map((d) => d.score), R)}
            fill="rgba(17,17,17,0.12)"
            stroke="#111"
            strokeWidth={2}
          />
          {dims.map((d, i) => {
            const p = radarPoint(i, dims.length, (R * Math.max(0, Math.min(100, d.score))) / 100);
            return <Circle key={`pt-${i}`} cx={p.x} cy={p.y} r={3} fill="#111" />;
          })}
        </Svg>
        <Text style={styles.dimScores}>
          {dims.map((d) => `${d.label} ${Math.round(d.score)}`).join('　')}
        </Text>
      </View>

      <Text style={styles.cardTitle}>近 7 天专注（分钟）</Text>
      <View style={styles.card}>
        <View style={styles.barRow}>
          {dailyMinutes.map((d) => (
            <View key={d.date} style={styles.barCol}>
              <View style={styles.barTrack}>
                <View style={[styles.barFill, { height: `${(d.min / maxDaily) * 100}%` }]} />
              </View>
              <Text style={styles.barMin}>{d.min || ''}</Text>
              <Text style={styles.barLabel}>{d.date.slice(8)}日</Text>
            </View>
          ))}
        </View>
      </View>

      <Text style={styles.cardTitle}>横向对标</Text>
      <View style={[styles.card, styles.center]}>
        <Text style={styles.placeholder}>
          目标：{targetUniversity || '尚未在「我的」设定目标大学'}
        </Text>
        <TouchableOpacity style={styles.benchBtn} onPress={runBenchmark} disabled={benchmarkBusy}>
          {benchmarkBusy ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.benchBtnText}>🔥 搜索分数线差距</Text>
          )}
        </TouchableOpacity>
        {!!benchmark && <Text style={styles.benchResult}>{benchmark}</Text>}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: '#fafafa' },
  cardTitle: { fontSize: 18, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, minHeight: 60 },
  center: { alignItems: 'center' },
  placeholder: { color: '#999', fontSize: 13, lineHeight: 20, marginTop: 4 },
  profileText: { fontSize: 15, lineHeight: 24, color: '#333' },
  strength: { color: '#1c7d2c', fontWeight: '700' },
  weakness: { color: '#c0392b', fontWeight: '700' },
  dimScores: { fontSize: 11, color: '#888', marginTop: 4 },
  barRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', height: 120 },
  barCol: { flex: 1, alignItems: 'center', height: 120 },
  barTrack: { flex: 1, width: '60%', backgroundColor: '#f0f1f3', borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { backgroundColor: '#111', borderRadius: 6 },
  barMin: { fontSize: 10, color: '#666', marginTop: 2, minHeight: 14 },
  barLabel: { fontSize: 10, color: '#aaa' },
  benchBtn: { backgroundColor: '#111', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 18, marginTop: 10 },
  benchBtnText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  benchResult: { fontSize: 13, color: '#333', lineHeight: 21, marginTop: 10, alignSelf: 'stretch' },
});

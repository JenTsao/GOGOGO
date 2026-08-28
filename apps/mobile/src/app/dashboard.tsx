import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal } from 'react-native';
import Svg, { Polygon, Polyline, Line, Circle, Text as SvgText } from 'react-native-svg';
import { Fragment, useMemo, useState } from 'react';
import { useFocusStore } from '@/store/focusStore';
import { useTaskStore } from '@/store/taskStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { useSandboxStore } from '@/store/sandboxStore';
import { useMistakeStore } from '@/store/mistakeStore';
import { useSettingsStore } from '@/store/settingsStore';
import { localDateStr } from '@/store/reminderStore';
import { countNegativeWords } from '@/lib/stt';

// Tab 3：仪表盘 —— 激进模式画像
// 六维雷达基于可计算数据（专注/任务/知识积累 + 错题重做正确率的学科掌握）
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
  const history = useTaskStore((s) => s.history);
  const knowledgeCount = useKnowledgeStore((s) => Object.keys(s.cache).length);
  const snippetCount = useSandboxStore((s) => s.snippets.length);
  const mistakes = useMistakeStore((s) => s.mistakes);
  const { targetUniversity, tavilyKey } = useSettingsStore();

  // 危险学科：错题最多的科目；卡壳词云：错题标签 top5
  const dangerSubject = useMemo(() => {
    if (mistakes.length === 0) return null;
    const count = new Map<string, number>();
    for (const m of mistakes) count.set(m.subject, (count.get(m.subject) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  }, [mistakes]);

  const wordCloud = useMemo(() => {
    const count = new Map<string, number>();
    for (const m of mistakes) for (const t of m.tags) count.set(t, (count.get(t) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [mistakes]);

  // 学科掌握度：已记录重做结果的错题正确率（0-100）
  const masteryRate = useMemo(() => {
    const graded = mistakes.filter((m) => m.correct);
    if (graded.length === 0) return 0;
    return (graded.filter((m) => m.correct === 'right').length / graded.length) * 100;
  }, [mistakes]);
  const gradedCount = mistakes.filter((m) => m.correct).length;

  // 情绪信号：语音反思转写中的消极词 top3（蓝皮书「搞不懂即时加权」）
  const moodSignals = useMemo(
    () => [...countNegativeWords(mistakes.map((m) => m.transcript ?? ''))].sort((a, b) => b[1] - a[1]).slice(0, 3),
    [mistakes]
  );

  const [benchmark, setBenchmark] = useState<string | null>(null);
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

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
      // 学科掌握：错题重做正确率（重做越多越准；未记录重做结果时为 0 并提示）
      { label: '学科掌握', score: masteryRate },
    ];
  }, [dailyMinutes, sessions, top3, knowledgeCount, snippetCount, masteryRate]);

  const maxDaily = Math.max(30, ...dailyMinutes.map((d) => d.min));
  const strength = [...dims].sort((a, b) => b.score - a.score)[0];
  const weakness = [...dims].sort((a, b) => a.score - b.score)[0];

  // 心流热力图：近 7 天（行）× 24 小时（列），格子 = 该小时专注分钟（按会话开始时间归属）
  const heat = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => new Array(24).fill(0));
    const dayIdx: Record<string, number> = {};
    for (let i = 6; i >= 0; i--) dayIdx[localDateStr(new Date(Date.now() - i * 86400000))] = 6 - i;
    const hourTotals = new Array(24).fill(0) as number[];
    for (const s of sessions) {
      const ended = new Date(s.endedAt);
      const di = dayIdx[localDateStr(ended)];
      if (di === undefined) continue;
      const startHour = new Date(ended.getTime() - s.duration * 1000).getHours();
      const min = s.duration / 60;
      grid[di][startHour] += min;
      hourTotals[startHour] += min;
    }
    const peak = hourTotals.indexOf(Math.max(...hourTotals));
    const peakMin = Math.max(...hourTotals);
    return { grid, peak, peakMin };
  }, [sessions]);

  // 任务完成率趋势：taskStore 每日快照（从启用日起积累）
  const trend = useMemo(() => {
    const map: Record<string, { done: number; total: number }> = {};
    for (const h of history) map[h.date] = h;
    const pts: { label: string; rate: number | null }[] = [];
    for (let i = 6; i >= 0; i--) {
      const key = localDateStr(new Date(Date.now() - i * 86400000));
      const h = map[key];
      pts.push({ label: key.slice(8), rate: h && h.total > 0 ? Math.round((h.done / h.total) * 100) : null });
    }
    return pts;
  }, [history]);

  // 折线图几何（0-100% 纵轴）
  const W = 296;
  const H = 116;
  const PAD = 20;
  const tx = (i: number) => PAD + (i * (W - 2 * PAD)) / 6;
  const ty = (rate: number) => H - PAD - (rate * (H - 2 * PAD)) / 100;
  const trendPoints = trend
    .map((t, i) => (t.rate === null ? null : `${tx(i).toFixed(1)},${ty(t.rate).toFixed(1)}`))
    .filter(Boolean)
    .join(' ');

  const heatColor = (min: number) =>
    min <= 0 ? '#f0f1f3' : min < 10 ? '#cfe5d2' : min < 25 ? '#93c29c' : min < 45 ? '#4e9a5f' : '#1c5d2c';

  // 横向对标：Tavily 搜索目标大学分数线
  const runBenchmark = async () => {
    if (!tavilyKey) {
      setBenchmark('未配置 Tavily Key（在「我的」填写后可用横向对标）');
      return;
    }
    setBenchmarkBusy(true);
    setBenchmark(null);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000); // Tavily 偶发慢响应，15s 兜底
    try {
      const query = `${targetUniversity || '重点大学'} 2025 高考分数线 各科`;
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyKey, query, max_results: 3, include_answer: true }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { answer?: string; results?: { title: string; url: string }[] };
      const lines = (data.results ?? []).slice(0, 3).map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`);
      setBenchmark(`🔥 ${query}\n${data.answer ? `\n摘要：${data.answer}` : ''}\n\n${lines.join('\n') || '无结果'}`);
    } catch (e) {
      setBenchmark(`对标搜索失败：${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
      setBenchmarkBusy(false);
    }
  };

  return (
    <>
    <ScrollView style={styles.container}>
      <Text style={styles.cardTitle}>📊 我的画像</Text>
      <TouchableOpacity style={styles.card} activeOpacity={0.8} onPress={() => setDetailOpen(true)}>
        {mistakes.length > 0 && dangerSubject && (
          <Text style={styles.profileText}>
            🔥 危险学科：<Text style={styles.weakness}>{dangerSubject[0]}</Text>
            <Text style={styles.placeholder}>（{dangerSubject[1]} 道错题）</Text>
          </Text>
        )}
        {moodSignals.length > 0 && (
          <>
            <Text style={styles.profileText}>😤 情绪信号（语音反思中的消极词，即时加权）</Text>
            <View style={styles.cloudRow}>
              {moodSignals.map(([word, n]) => (
                <View key={word} style={styles.cloudChip}>
                  <Text style={styles.cloudChipText}>
                    {word} <Text style={styles.cloudCount}>×{n}</Text>
                  </Text>
                </View>
              ))}
            </View>
          </>
        )}
        {sessions.length === 0 && top3.length === 0 ? (
          <Text style={styles.placeholder}>先开始一次专注或创建任务，画像会随数据积累逐渐清晰</Text>
        ) : (
          <Text style={styles.profileText}>
            💪 优势：<Text style={styles.strength}>{strength.label}</Text>　　⚠️ 待加强：
            <Text style={styles.weakness}>{weakness.label}</Text>
          </Text>
        )}
        <Text style={styles.detailHint}>点击查看全屏画像与横向对标 ›</Text>
      </TouchableOpacity>

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

      <Text style={styles.cardTitle}>心流热力（最佳专注时段）</Text>
      <View style={styles.card}>
        {sessions.length === 0 ? (
          <Text style={styles.placeholder}>完成一次专注后，这里会呈现你的时段分布</Text>
        ) : (
          <>
            {heat.peakMin > 0 && (
              <Text style={styles.peakText}>
                🌙 黄金时段：{heat.peak}:00–{(heat.peak + 1) % 24}:00（累计约 {Math.round(heat.peakMin)} 分钟）
              </Text>
            )}
            <View style={styles.heatGrid}>
              {heat.grid.map((row, di) => (
                <View key={`hr-${di}`} style={styles.heatRow}>
                  <Text style={styles.heatDay}>{dailyMinutes[di]?.date.slice(8)}日</Text>
                  {row.map((min, hi) => (
                    <View key={`hc-${di}-${hi}`} style={[styles.heatCell, { backgroundColor: heatColor(min) }]} />
                  ))}
                </View>
              ))}
            </View>
            <View style={styles.heatAxis}>
              {[0, 6, 12, 18, 23].map((h) => (
                <Text key={h} style={[styles.heatAxisText, h === 23 && { marginLeft: -14 }]}>
                  {h}时
                </Text>
              ))}
            </View>
            <View style={styles.legendRow}>
              <Text style={styles.legendText}>少</Text>
              {[0, 10, 25, 45, 60].map((v) => (
                <View key={v} style={[styles.heatCell, { backgroundColor: heatColor(v) }]} />
              ))}
              <Text style={styles.legendText}>多</Text>
            </View>
          </>
        )}
      </View>

      <Text style={styles.cardTitle}>任务完成率趋势（近 7 天）</Text>
      <View style={styles.card}>
        {trendPoints ? (
          <Svg width={W} height={H}>
            {/* 参考线：0/50/100% */}
            {[0, 50, 100].map((lv) => (
              <Line
                key={lv}
                x1={PAD}
                y1={ty(lv)}
                x2={W - PAD}
                y2={ty(lv)}
                stroke="#e3e6eb"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            ))}
            <SvgText x={PAD - 4} y={ty(100) + 3} fill="#aaa" fontSize={9} textAnchor="end">
              100%
            </SvgText>
            <SvgText x={PAD - 4} y={ty(0) + 3} fill="#aaa" fontSize={9} textAnchor="end">
              0%
            </SvgText>
            {trendPoints && (
              <Polyline points={trendPoints} fill="none" stroke="#111" strokeWidth={2} strokeLinejoin="round" />
            )}
            {trend.map((t, i) =>
              t.rate === null ? null : <Circle key={i} cx={tx(i)} cy={ty(t.rate)} r={3} fill="#111" />
            )}
            {trend.map((t, i) => (
              <SvgText key={`xl-${i}`} x={tx(i)} y={H - 4} fill="#aaa" fontSize={9} textAnchor="middle">
                {t.label}
              </SvgText>
            ))}
          </Svg>
        ) : (
          <Text style={styles.placeholder}>暂无完成率快照，完成任务后从今天开始积累</Text>
        )}
      </View>
    </ScrollView>

      {/* 全屏画像详情（蓝皮书：点击画像卡进入，含分维解读与横向对标差距） */}
      <Modal visible={detailOpen} animationType="slide" onRequestClose={() => setDetailOpen(false)}>
        <ScrollView style={styles.modalWrap}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>🧭 画像详情</Text>
            <TouchableOpacity onPress={() => setDetailOpen(false)}>
              <Text style={styles.modalClose}>✕ 关闭</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.card}>
            {mistakes.length > 0 && dangerSubject && (
              <Text style={styles.profileText}>
                🔥 危险学科：<Text style={styles.weakness}>{dangerSubject[0]}</Text>
                <Text style={styles.placeholder}>（{dangerSubject[1]} 道错题，重点盯防）</Text>
              </Text>
            )}
            {mistakes.length > 0 && wordCloud.length > 0 ? (
              <>
                <Text style={styles.profileText}>🩹 最近卡壳词云（错题标签 top5）</Text>
                <View style={styles.cloudRow}>
                  {wordCloud.map(([tag, n]) => (
                    <View key={tag} style={styles.cloudChip}>
                      <Text style={styles.cloudChipText}>
                        {tag} <Text style={styles.cloudCount}>×{n}</Text>
                      </Text>
                    </View>
                  ))}
                </View>
              </>
            ) : (
              <Text style={styles.placeholder}>收录错题并打上卡壳标签，这里会生成你的卡壳词云</Text>
            )}
            {dims.map((d) => (
              <View key={d.label} style={styles.adviceRow}>
                <Text style={styles.adviceScore}>{Math.round(d.score)}</Text>
                <View style={styles.adviceBody}>
                  <Text style={styles.adviceLabel}>{d.label}</Text>
                  <Text style={styles.adviceText}>{ADVICE[d.label]}</Text>
                </View>
              </View>
            ))}
            <Text style={styles.placeholder}>
              学科掌握 = 错题重做正确率，已在错题本记录 {gradedCount} 题{gradedCount === 0 ? '（去错题本标记重做结果吧）' : ''}
            </Text>
          </View>

          <Text style={styles.cardTitle}>横向对标</Text>
          <View style={[styles.card, styles.center]}>
            <Text style={styles.placeholder}>目标：{targetUniversity || '尚未在「我的」设定目标大学'}</Text>
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
      </Modal>
    </>
  );
}

// 六维一句话建议（全屏画像详情用）
const ADVICE: Record<string, string> = {
  专注投入: '每天保证 30–50 分钟专注，总量决定基础盘',
  专注深度: '尝试单次 45 分钟不间断，深度比时长更重要',
  坚持天数: '连续打卡比单日爆发更有效，先保 5 天/周',
  任务执行: '三件事当日清空，避免任务滚雪球',
  知识积累: '多在沙盒跑代码、按需下载笔记，持续积累弹药',
  学科掌握: '错题隔天重做并记录结果，重做越多掌握度越可信',
};

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
  detailHint: { fontSize: 12, color: '#1a73e8', marginTop: 8 },
  // 心流热力图
  peakText: { fontSize: 13, fontWeight: '600', color: '#1c5d2c', marginBottom: 10 },
  heatGrid: { alignSelf: 'stretch' },
  heatRow: { flexDirection: 'row', gap: 2, marginBottom: 2 },
  heatDay: { width: 26, fontSize: 9, color: '#aaa', textAlignVertical: 'center' },
  heatCell: { width: 10, height: 10, borderRadius: 2 },
  heatAxis: { flexDirection: 'row', gap: 2, marginTop: 2, marginLeft: 26 },
  heatAxisText: { width: 48, fontSize: 9, color: '#aaa' },
  legendRow: { flexDirection: 'row', gap: 4, alignItems: 'center', marginTop: 10, alignSelf: 'center' },
  legendText: { fontSize: 10, color: '#aaa' },
  // 全屏画像详情
  modalWrap: { flex: 1, padding: 16, backgroundColor: '#fafafa', paddingTop: 48 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: 22, fontWeight: '700' },
  modalClose: { fontSize: 14, color: '#1a73e8' },
  adviceRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#eee' },
  adviceScore: { width: 40, fontSize: 22, fontWeight: '700', color: '#111', textAlign: 'center' },
  adviceBody: { flex: 1 },
  adviceLabel: { fontSize: 14, fontWeight: '600', color: '#333' },
  adviceText: { fontSize: 12, color: '#777', marginTop: 2, lineHeight: 18 },
  // 卡壳词云
  cloudRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  cloudChip: { backgroundColor: '#fff1f0', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4 },
  cloudChipText: { color: '#b91c1c', fontSize: 13 },
  cloudCount: { color: '#e08a8a', fontSize: 11 },
});

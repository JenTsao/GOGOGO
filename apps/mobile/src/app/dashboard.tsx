import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, Linking } from 'react-native';
import Svg, { Polygon, Polyline, Line, Circle, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Fragment, useMemo, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusStore } from '@/store/focusStore';
import { useTaskStore } from '@/store/taskStore';
import { useKnowledgeStore } from '@/store/knowledgeStore';
import { useSandboxStore } from '@/store/sandboxStore';
import { useMistakeStore } from '@/store/mistakeStore';
import { useMoodStore } from '@/store/moodStore';
import { useSettingsStore } from '@/store/settingsStore';
import { localDateStr } from '@/store/reminderStore';
import { countNegativeWords } from '@/lib/stt';
import { fetchWeekly, WeeklyReview } from '@/lib/cloud';
import MoodCheckin from '@/components/MoodCheckin';
import { C as CLR, R as RAD, cardShadow } from '@/theme';

// Tab 3：仪表盘 —— 激进模式画像
// 六维雷达基于可计算数据（专注/任务/知识积累 + 错题重做正确率的学科掌握）
interface RadarDim {
  label: string;
  score: number; // 0-100
}

const SIZE = 220;
const CX = SIZE / 2;
const RR = 78;

function radarPoint(i: number, total: number, r: number): { x: number; y: number } {
  // 从正上方开始，顺时针分布
  const angle = (Math.PI * 2 * i) / total - Math.PI / 2;
  return { x: CX + r * Math.cos(angle), y: CX + r * Math.sin(angle) };
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
  const insets = useSafeAreaInsets(); // 打孔屏/手势条安全区
  const sessions = useFocusStore((s) => s.sessions);
  const top3 = useTaskStore((s) => s.top3);
  const history = useTaskStore((s) => s.history);
  const knowledgeCount = useKnowledgeStore((s) => Object.keys(s.cache).length);
  const snippetCount = useSandboxStore((s) => s.snippets.length);
  const mistakes = useMistakeStore((s) => s.mistakes);
  const moodCheckins = useMoodStore((s) => s.checkins);
  const { targetUniversity, targetScore, tavilyKey } = useSettingsStore();

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

  // 情绪信号：错题语音反思 + 情绪打卡语音/备注转写中的消极词 top3（蓝皮书「搞不懂即时加权」）
  // 必须返回数组：Map.entries() 是一次性迭代器，被 memo 缓存后首次渲染即耗尽，
  // 之后任意重渲染（开弹窗/切 Tab）都会得到空数组，词云永久消失
  const moodSignals = useMemo(() => {
    const acc = new Map<string, number>();
    for (const [w, n] of countNegativeWords(mistakes.map((m) => m.transcript))) {
      acc.set(w, (acc.get(w) ?? 0) + n);
    }
    for (const [w, n] of countNegativeWords(moodCheckins.map((c) => c.transcript ?? c.summary))) {
      acc.set(w, (acc.get(w) ?? 0) + n);
    }
    return [...acc.entries()];
  }, [mistakes, moodCheckins]);
  const moodTop3 = useMemo(
    () => [...moodSignals].sort((a, b) => b[1] - a[1]).slice(0, 3),
    [moodSignals]
  );

  // 近 7 天情绪轨迹（emoji 行）：打卡越连续，画像情绪面越准
  const moodTrail = useMemo(() => {
    const days: (string | null)[] = [];
    for (let i = 6; i >= 0; i--) {
      const date = localDateStr(new Date(Date.now() - i * 86400000));
      days.push(moodCheckins.find((c) => c.date === date)?.emojiCode ?? null);
    }
    return days;
  }, [moodCheckins]);

  const [benchmark, setBenchmark] = useState<string | null>(null);
  const [benchmarkBusy, setBenchmarkBusy] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  // 周复盘（周 Cron 产物）：详情弹窗打开时拉取
  const [weekly, setWeekly] = useState<WeeklyReview | null>(null);
  const [weeklyState, setWeeklyState] = useState<'idle' | 'loading' | 'none' | 'error'>('idle');

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

  // 六维评分（上限 100）
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

  // 热力色阶（绿色 = 专注量，语义与主题 green 对齐）
  const heatColor = (min: number) =>
    min <= 0 ? '#EEEBF4' : min < 10 ? '#D5EBDD' : min < 25 ? '#9CD3AA' : min < 45 ? '#4E9A5F' : '#1C5D2C';

  // 横向对标数值化：Tavily 检索分数线 → 从摘要/正文提取可信分数 → 与目标总分计算差距
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
      const query = `${targetUniversity || '重点大学'} 2025 高考 录取分数线`;
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: tavilyKey, query, max_results: 5, include_answer: true }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        answer?: string;
        results?: { title: string; url: string; content?: string }[];
      };
      const lines = (data.results ?? []).slice(0, 3).map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`);

      // ---------- 分数数值化 ----------
      // 从 Tavily answer + 各结果正文提取「XXX分」；480–700 为高考分数线可信区间
      //（排除年份 2025、页码、排名等噪声），取最低估 ≈ 最低录取线（对考生最有参考意义）
      const corpus = [data.answer ?? '', ...(data.results ?? []).map((r) => r.content ?? '')].join(' ');
      const scores = [...corpus.matchAll(/(\d{3})\s*分/g)]
        .map((m) => parseInt(m[1], 10))
        .filter((n) => n >= 480 && n <= 700);
      const uniq = [...new Set(scores)].sort((a, b) => a - b);
      const estimate = uniq.length > 0 ? uniq[0] : null;

      const out: string[] = [];
      if (estimate !== null) {
        out.push(`检索到分数区间：${uniq[0]}–${uniq[uniq.length - 1]} 分（按最低估 ${estimate} 分计算）`);
        if (targetScore !== null) {
          const gap = targetScore - estimate;
          if (gap >= 0) {
            out.push(`目标 ${targetScore} 分 → 超出底线 ${gap} 分，保持节奏，向专业录取线冲刺`);
          } else {
            out.push(`目标 ${targetScore} 分 → 差距 ${Math.abs(gap)} 分`);
            // 差距 ≥20 分时联动画像：指向错题最多的危险学科
            if (Math.abs(gap) >= 20 && dangerSubject) {
              out.push(`专项建议：优先补「${dangerSubject[0]}」（当前错题最多的学科，${dangerSubject[1]} 道）`);
            }
          }
        } else {
          out.push('在「我的」填写目标总分，即可自动计算差距与专项建议');
        }
      } else {
        out.push('未能从检索结果解析出分数线数值（省份/批次差异大，请从以下来源确认你所在省份的线）');
      }

      setBenchmark(
        `检索：${query}\n${out.join('\n')}\n\n${data.answer ? `摘要：${data.answer}\n\n` : ''}${lines.join('\n') || '无结果'}`
      );
    } catch (e) {
      setBenchmark(`对标搜索失败：${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
      setBenchmarkBusy(false);
    }
  };

  return (
    <>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
    >
      <MoodCheckin />

      <Text style={styles.cardTitle}>我的画像</Text>
      <TouchableOpacity
        style={[styles.card, styles.profileCard]}
        activeOpacity={0.85}
        onPress={() => {
          setDetailOpen(true);
          // 每次进入详情都刷新周复盘（周 Cron 每周一凌晨产出）
          if (!weekly) {
            const { supabaseUrl, supabaseAnonKey, accessKey } = useSettingsStore.getState();
            if (supabaseUrl && supabaseAnonKey && accessKey) {
              setWeeklyState('loading');
              fetchWeekly({ supabaseUrl, supabaseAnonKey, accessKey })
                .then((w) => {
                  setWeekly(w);
                  setWeeklyState(w ? 'idle' : 'none');
                })
                .catch(() => setWeeklyState('error'));
            } else {
              setWeeklyState('error');
            }
          }
        }}
      >
        <View style={styles.moodTrailRow}>
          {moodTrail.map((e, i) => (
            <Text key={i} style={styles.moodTrailEmoji}>{e ?? '·'}</Text>
          ))}
          <Text style={styles.moodTrailLabel}>近 7 天情绪</Text>
        </View>
        {mistakes.length > 0 && dangerSubject && (
          <View style={styles.signalRow}>
            <Ionicons name="flame" size={14} color={CLR.red} />
            <Text style={styles.profileText}>
              危险学科：<Text style={styles.weakness}>{dangerSubject[0]}</Text>
              <Text style={styles.placeholder}>（{dangerSubject[1]} 道错题）</Text>
            </Text>
          </View>
        )}
        {moodTop3.length > 0 && (
          <>
            <View style={styles.signalRow}>
              <Ionicons name="pulse" size={14} color={CLR.orange} />
              <Text style={styles.profileText}>情绪信号（语音反思 + 打卡备注中的消极词，即时加权）</Text>
            </View>
            <View style={styles.cloudRow}>
              {moodTop3.map(([word, n]) => (
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
            优势：<Text style={styles.strength}>{strength.label}</Text>　　待加强：
            <Text style={styles.weakness}>{weakness.label}</Text>
          </Text>
        )}
        <View style={styles.detailHintRow}>
          <Text style={styles.detailHint}>点击查看全屏画像与横向对标</Text>
          <Ionicons name="chevron-forward" size={13} color={CLR.primary} />
        </View>
      </TouchableOpacity>

      <Text style={styles.cardTitle}>能力雷达（100 分制）</Text>
      <View style={[styles.card, styles.center]}>
        <Svg width={SIZE} height={SIZE}>
          {/* 网格：25/50/75/100 */}
          {[25, 50, 75, 100].map((lv) => (
            <Polygon
              key={lv}
              points={polygonPoints(new Array(dims.length).fill(lv), RR)} // 网格边数必须与维度数一致，否则六边形数据会压进五边形网格扭曲
              fill="none"
              stroke={CLR.border}
              strokeWidth={1}
            />
          ))}
          {/* 轴线与维度标签 */}
          {dims.map((d, i) => {
            const p = radarPoint(i, dims.length, RR);
            const lp = radarPoint(i, dims.length, RR + 22);
            return (
              <Fragment key={`ax-${i}`}>
                <Line x1={CX} y1={CX} x2={p.x} y2={p.y} stroke={CLR.border} strokeWidth={1} />
                <SvgText
                  x={lp.x}
                  y={lp.y}
                  fill={CLR.text2}
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
            points={polygonPoints(dims.map((d) => d.score), RR)}
            fill="rgba(124,58,237,0.18)"
            stroke={CLR.primary}
            strokeWidth={2}
          />
          {dims.map((d, i) => {
            const p = radarPoint(i, dims.length, (RR * Math.max(0, Math.min(100, d.score))) / 100);
            return <Circle key={`pt-${i}`} cx={p.x} cy={p.y} r={3} fill={CLR.primary} />;
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
              <View style={styles.peakRow}>
                <Ionicons name="moon" size={13} color={CLR.green} />
                <Text style={styles.peakText}>
                  黄金时段：{heat.peak}:00–{(heat.peak + 1) % 24}:00（累计约 {Math.round(heat.peakMin)} 分钟）
                </Text>
              </View>
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
                stroke={CLR.border}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
            ))}
            <SvgText x={PAD - 4} y={ty(100) + 3} fill={CLR.text3} fontSize={9} textAnchor="end">
              100%
            </SvgText>
            <SvgText x={PAD - 4} y={ty(0) + 3} fill={CLR.text3} fontSize={9} textAnchor="end">
              0%
            </SvgText>
            {trendPoints && (
              <Polyline points={trendPoints} fill="none" stroke={CLR.primary} strokeWidth={2} strokeLinejoin="round" />
            )}
            {trend.map((t, i) =>
              t.rate === null ? null : <Circle key={i} cx={tx(i)} cy={ty(t.rate)} r={3} fill={CLR.primary} />
            )}
            {trend.map((t, i) => (
              <SvgText key={`xl-${i}`} x={tx(i)} y={H - 4} fill={CLR.text3} fontSize={9} textAnchor="middle">
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
      <Modal
        visible={detailOpen}
        animationType="slide"
        statusBarTranslucent // 延伸进状态栏区，顶部用 insets 避让（替代硬编码 56，不同机型挖孔高度不一）
        onRequestClose={() => setDetailOpen(false)}
      >
        <ScrollView
          style={styles.modalWrap}
          contentContainerStyle={[styles.modalContent, { paddingTop: insets.top + 16 }]}
        >
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleRow}>
              <Ionicons name="compass" size={20} color={CLR.primary} />
              <Text style={styles.modalTitle}>画像详情</Text>
            </View>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setDetailOpen(false)}>
              <Ionicons name="close" size={20} color={CLR.text2} />
            </TouchableOpacity>
          </View>

          {/* 本周复盘（周 Cron：全量数据 + Tavily 考纲/资讯 → LLM 教练复盘） */}
          <Text style={styles.cardTitle}>本周复盘</Text>
          <View style={styles.card}>
            {weeklyState === 'loading' && <ActivityIndicator color={CLR.primary} />}
            {weeklyState === 'error' && <Text style={styles.placeholder}>复盘拉取失败，稍后在画像页重试</Text>}
            {weeklyState === 'none' && (
              <Text style={styles.placeholder}>本周复盘还没生成（每周一凌晨自动产出，需在管理台配置 TAVILY_API_KEY 以获取考纲资讯）</Text>
            )}
            {weeklyState === 'idle' && weekly?.content && (
              <>
                {/* content 是 LLM 产出的 jsonb，字段缺失/null 都要兜住：裸取会让全屏 Modal 崩到只能杀 App */}
                <Text style={styles.adviceText}>{weekly.content.summary ?? ''}</Text>
                {!!weekly.content.syllabusAlert && (
                  <View style={styles.syllabusAlert}>
                    <Ionicons name="warning" size={13} color={CLR.orange} />
                    <Text style={styles.syllabusAlertText}>考纲警示：{weekly.content.syllabusAlert}</Text>
                  </View>
                )}
                {(weekly.content.risks?.length ?? 0) > 0 && (
                  <>
                    <Text style={styles.profileText}>薄弱点与下周权重建议</Text>
                    {(weekly.content.risks ?? []).map((r, i) => (
                      <Text key={i} style={styles.adviceText}>· {r}</Text>
                    ))}
                  </>
                )}
                {(weekly.content.focusAdvice?.length ?? 0) > 0 && (
                  <>
                    <Text style={styles.profileText}>下周专注建议</Text>
                    {(weekly.content.focusAdvice ?? []).map((r, i) => (
                      <Text key={i} style={styles.adviceText}>· {r}</Text>
                    ))}
                  </>
                )}
                {(weekly.content.news?.length ?? 0) > 0 && (
                  <>
                    <Text style={styles.profileText}>本周高考资讯</Text>
                    {(weekly.content.news ?? []).map((n, i) => (
                      <TouchableOpacity key={n?.url ?? i} onPress={() => n?.url && void Linking.openURL(n.url)}>
                        <Text style={styles.newsLink}>· {n?.title ?? '（无标题）'}</Text>
                      </TouchableOpacity>
                    ))}
                  </>
                )}
              </>
            )}
          </View>

          <View style={styles.card}>
            {mistakes.length > 0 && dangerSubject && (
              <View style={styles.signalRow}>
                <Ionicons name="flame" size={14} color={CLR.red} />
                <Text style={styles.profileText}>
                  危险学科：<Text style={styles.weakness}>{dangerSubject[0]}</Text>
                  <Text style={styles.placeholder}>（{dangerSubject[1]} 道错题，重点盯防）</Text>
                </Text>
              </View>
            )}
            {mistakes.length > 0 && wordCloud.length > 0 ? (
              <>
                <Text style={styles.profileText}>最近卡壳词云（错题标签 top5）</Text>
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
                <View style={styles.adviceScoreWrap}>
                  <Text style={styles.adviceScore}>{Math.round(d.score)}</Text>
                </View>
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
            <TouchableOpacity style={styles.benchBtn} onPress={runBenchmark} disabled={benchmarkBusy} activeOpacity={0.85}>
              {benchmarkBusy ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons name="search" size={15} color="#fff" />
                  <Text style={styles.benchBtnText}>搜索分数线差距</Text>
                </>
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
  container: { flex: 1, backgroundColor: CLR.bg },
  content: { padding: 16, paddingBottom: 96 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: CLR.text, marginTop: 18, marginBottom: 8, letterSpacing: 0.3 },
  card: { backgroundColor: CLR.card, borderRadius: RAD.lg, padding: 16, minHeight: 60, ...cardShadow },
  profileCard: { borderWidth: 1, borderColor: CLR.border },
  center: { alignItems: 'center' },
  placeholder: { color: CLR.text3, fontSize: 13, lineHeight: 20, marginTop: 4 },
  profileText: { fontSize: 15, lineHeight: 24, color: CLR.text, flex: 1 },
  strength: { color: CLR.green, fontWeight: '700' },
  weakness: { color: CLR.red, fontWeight: '700' },
  dimScores: { fontSize: 11, color: CLR.text3, marginTop: 8, textAlign: 'center' },
  signalRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  moodTrailRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginBottom: 8 },
  moodTrailEmoji: { fontSize: 16 },
  moodTrailLabel: { fontSize: 11, color: CLR.text3, marginLeft: 6 },
  detailHintRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 10 },
  detailHint: { fontSize: 12, color: CLR.primary, fontWeight: '600' },
  barRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-end', height: 120 },
  barCol: { flex: 1, alignItems: 'center', height: 120 },
  barTrack: { flex: 1, width: '60%', backgroundColor: '#EEEBF4', borderRadius: 6, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { backgroundColor: CLR.primary, borderRadius: 6 },
  barMin: { fontSize: 10, color: CLR.text2, marginTop: 2, minHeight: 14, fontVariant: ['tabular-nums'] },
  barLabel: { fontSize: 10, color: CLR.text3 },
  benchBtn: {
    backgroundColor: CLR.primary,
    borderRadius: RAD.md,
    paddingVertical: 12,
    paddingHorizontal: 20,
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  benchBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  benchResult: { fontSize: 13, color: CLR.text, lineHeight: 21, marginTop: 12, alignSelf: 'stretch' },
  peakRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
  peakText: { fontSize: 13, fontWeight: '600', color: CLR.green },
  heatGrid: { alignSelf: 'stretch' },
  heatRow: { flexDirection: 'row', gap: 2, marginBottom: 2 },
  heatDay: { width: 26, fontSize: 9, color: CLR.text3, textAlignVertical: 'center' },
  heatCell: { width: 10, height: 10, borderRadius: 2 },
  heatAxis: { flexDirection: 'row', gap: 2, marginTop: 2, marginLeft: 26 },
  heatAxisText: { width: 48, fontSize: 9, color: CLR.text3 },
  legendRow: { flexDirection: 'row', gap: 4, alignItems: 'center', marginTop: 10, alignSelf: 'center' },
  legendText: { fontSize: 10, color: CLR.text3 },
  syllabusAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: CLR.orangeSoft,
    borderRadius: RAD.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginTop: 8,
  },
  syllabusAlertText: { fontSize: 13, color: '#8c6b1f', fontWeight: '600', flex: 1, lineHeight: 19 },
  newsLink: { fontSize: 13, color: CLR.blue, textDecorationLine: 'underline', marginTop: 4, lineHeight: 19 },
  cloudRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  cloudChip: { backgroundColor: CLR.redSoft, borderRadius: RAD.sm, paddingHorizontal: 10, paddingVertical: 4 },
  cloudChipText: { color: CLR.red, fontSize: 13 },
  cloudCount: { color: '#e08a8a', fontSize: 11 },
  // 全屏画像详情
  modalWrap: { flex: 1, backgroundColor: CLR.bg },
  modalContent: { padding: 16, paddingTop: 16, paddingBottom: 48 }, // paddingTop 由 insets 动态覆盖
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modalTitle: { fontSize: 22, fontWeight: '800', color: CLR.text },
  modalCloseBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CLR.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adviceRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: CLR.border },
  adviceScoreWrap: {
    width: 46,
    height: 46,
    borderRadius: RAD.sm,
    backgroundColor: CLR.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  adviceScore: { fontSize: 17, fontWeight: '800', color: CLR.primaryDeep, fontVariant: ['tabular-nums'] },
  adviceBody: { flex: 1 },
  adviceLabel: { fontSize: 14, fontWeight: '700', color: CLR.text },
  adviceText: { fontSize: 12, color: CLR.text2, marginTop: 2, lineHeight: 18 },
});

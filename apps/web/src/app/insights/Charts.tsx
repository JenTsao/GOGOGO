'use client';

import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useWebTheme } from '@/lib/webTheme';

export interface InsightData {
  radar: { dim: string; score: number }[];
  focusTrend: { date: string; minutes: number }[];
  moodTrend: { date: string; score: number; emoji: string }[];
  totals: {
    weekMin: number;
    avgSession: number;
    activeDays14: number;
    doneWeek: number;
    weekTasks: number;
    mistakeTotal: number;
    mastered: number;
    graded: number;
    notes: number;
  };
}

// 画像大屏图表：六维雷达 + 近 30 天专注柱状 + 情绪轨迹（recharts 仅在客户端加载）
export function InsightCharts({ data }: { data: InsightData }) {
  const t = data.totals;
  // recharts 的 SVG 属性不支持 CSS 变量，需按主题取具体色值（令牌与 globals.css 对齐）
  const scheme = useWebTheme();
  const grid = scheme === 'dark' ? '#2c2942' : '#e9e4f3';
  const tick = scheme === 'dark' ? '#a9a3c4' : '#555555';
  const primary = scheme === 'dark' ? '#a78bfa' : '#7c3aed';
  const tooltipStyle = {
    contentStyle: { background: 'var(--card-solid)', border: '1px solid var(--border)', borderRadius: 12, color: 'var(--text)' },
    labelStyle: { color: 'var(--text2)' },
    itemStyle: { color: 'var(--text)' },
  } as const;
  return (
    <>
      <div className="stat-grid">
        <div className="panel stat-card">
          <div className="stat-label">近 7 天专注</div>
          <div className="stat-num">
            {t.weekMin}
            <span className="stat-unit"> 分钟</span>
          </div>
          <div className="stat-sub">单次平均 {t.avgSession} 分钟</div>
        </div>
        <div className="panel stat-card">
          <div className="stat-label">坚持天数</div>
          <div className="stat-num">
            {t.activeDays14}
            <span className="stat-unit"> / 14 天</span>
          </div>
          <div className="stat-sub">近两周有专注记录的天数</div>
        </div>
        <div className="panel stat-card">
          <div className="stat-label">任务完成</div>
          <div className="stat-num">
            {t.doneWeek}
            <span className="stat-unit"> / {t.weekTasks}</span>
          </div>
          <div className="stat-sub">近 7 天三件事与后备箱</div>
        </div>
        <div className="panel stat-card">
          <div className="stat-label">错题重做</div>
          <div className="stat-num">
            {t.graded ? Math.round((t.mastered / t.graded) * 100) : 0}
            <span className="stat-unit"> %</span>
          </div>
          <div className="stat-sub">
            已重做 {t.graded} / 共 {t.mistakeTotal} 道
          </div>
        </div>
      </div>

      <div className="split">
        <div className="panel">
          <h2>六维画像</h2>
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={data.radar} outerRadius="72%">
                <PolarGrid stroke={grid} />
                <PolarAngleAxis dataKey="dim" tick={{ fontSize: 13, fill: tick }} />
                <Radar dataKey="score" stroke={primary} fill={primary} fillOpacity={0.28} />
                <Tooltip formatter={(v) => [`${v} 分`, '得分']} {...tooltipStyle} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
          <p className="placeholder">投入/深度/坚持/任务/知识/掌握，口径与手机端一致。</p>
        </div>

        <div className="panel">
          <h2>情绪轨迹</h2>
          {data.moodTrend.length > 1 ? (
            <div className="chart-box">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.moodTrend} margin={{ top: 12, right: 16, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={grid} />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} stroke={grid} />
                  <YAxis domain={[-2, 2]} ticks={[-2, -1, 0, 1, 2]} tick={{ fontSize: 11, fill: tick }} stroke={grid} />
                  <Tooltip
                    formatter={(v) => [`${v}`, '情绪分']}
                    labelFormatter={(label, payload) => {
                      const p = payload?.[0]?.payload as { emoji?: string } | undefined;
                      return `${label} ${p?.emoji ?? ''}`;
                    }}
                    {...tooltipStyle}
                  />
                  <Line type="monotone" dataKey="score" stroke="#f59e0b" strokeWidth={2} dot={{ r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="placeholder">情绪打卡数据不足（手机端「仪表盘」顶部打卡后会同步到云端）。</p>
          )}
        </div>
      </div>

      <div className="panel">
        <h2>近 30 天专注趋势</h2>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.focusTrend} margin={{ top: 12, right: 16, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: tick }} stroke={grid} interval={4} />
              <YAxis tick={{ fontSize: 11, fill: tick }} stroke={grid} />
              <Tooltip formatter={(v) => [`${v} 分钟`, '专注']} {...tooltipStyle} />
              <Bar dataKey="minutes" fill={primary} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </>
  );
}

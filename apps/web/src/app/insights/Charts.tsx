'use client';

import dynamic from 'next/dynamic';

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

// recharts 连同 d3 子依赖约 500KB 且只在 /insights 用：
// dynamic 拆独立 chunk 按需加载 + 关 SSR（图表对 SEO 无意义，服务端预渲染 SVG 纯浪费）
const ChartsClient = dynamic(() => import('./ChartsClient'), {
  ssr: false,
  // 占位声明高度，避免图表 chunk 加载完成后布局跳动
  loading: () => (
    <div className="panel placeholder" style={{ minHeight: 120 }}>
      图表加载中…
    </div>
  ),
});

export function InsightCharts({ data }: { data: InsightData }) {
  return <ChartsClient data={data} />;
}

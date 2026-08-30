'use client';

import { useEffect, useState } from 'react';
import { getDailyKnowledge, type KdSubject } from '@/lib/dailyKnowledge';

/**
 * 全站顶栏「每日一句知识点」：语文文言文 / 数学公式 / 英语高频词按北京日期轮换。
 * 客户端挂载后再计算日期——服务端预渲染的日期会冻结在构建时刻，其他页面会跨天不更新。
 */
export function DailyKnowledge() {
  const [entry, setEntry] = useState<ReturnType<typeof getDailyKnowledge> | null>(null);
  useEffect(() => setEntry(getDailyKnowledge()), []);
  if (!entry) return null;

  return (
    <div className="daily-kd">
      <span className={`kd-chip kd-${ENTRY_TONE[entry.subject]}`}>
        {ENTRY_ICON[entry.subject]} {entry.subject} · {entry.tag}
      </span>
      <span className="kd-text">
        <b>{entry.text}</b>
        <span className="kd-note">{entry.note}</span>
      </span>
    </div>
  );
}

// 学科 → 配色档（soft 底 + deep 文字，与全站语义色一致）与图标
const ENTRY_TONE: Record<KdSubject, 'orange' | 'blue' | 'green'> = {
  语文: 'orange',
  数学: 'blue',
  英语: 'green',
};
const ENTRY_ICON: Record<KdSubject, string> = { 语文: '📜', 数学: '∑', 英语: '🔤' };

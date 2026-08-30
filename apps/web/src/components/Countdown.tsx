'use client';

import { useEffect, useState } from 'react';

// 距高考倒计时：滚动到最近一次 6 月 7 日 09:00（已过自动 +1 年），分钟级刷新
export function Countdown() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(id);
  }, []);

  const y = now.getFullYear();
  const exam =
    now.getTime() >= new Date(y, 5, 7, 9, 0, 0).getTime()
      ? new Date(y + 1, 5, 7, 9, 0, 0)
      : new Date(y, 5, 7, 9, 0, 0);
  const ms = Math.max(0, exam.getTime() - now.getTime());
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);

  return (
    <div className="countdown">
      <span className="countdown-days">{days}</span>
      <span className="countdown-unit">天</span>
      <span className="countdown-sub">
        {hours} 时 {minutes} 分
      </span>
    </div>
  );
}

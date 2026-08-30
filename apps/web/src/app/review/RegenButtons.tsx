'use client';

import { useState, useTransition } from 'react';
import { regenDaily, regenWeekly } from './actions';

// 手动触发生成：LLM 流水线耗时较长（含 Tavily 检索），期间按钮锁定防重复提交
export function RegenButtons() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const run = (fn: (force: boolean) => Promise<{ ok: boolean; message: string }>, force: boolean) => {
    setResult(null);
    // React 18 的 transition 回调必须同步；异步体用立即执行的 async 包裹
    startTransition(() => {
      void (async () => {
        try {
          setResult(await fn(force));
        } catch (e) {
          setResult({ ok: false, message: (e as Error).message });
        }
      })();
    });
  };

  return (
    <div className="regen-bar">
      <button className="btn" onClick={() => run(regenDaily, false)} disabled={pending}>
        生成今日备课
      </button>
      <button className="btn btn-ghost" onClick={() => run(regenDaily, true)} disabled={pending}>
        重新生成今日
      </button>
      <button className="btn" onClick={() => run(regenWeekly, false)} disabled={pending}>
        生成本周复盘
      </button>
      <button className="btn btn-ghost" onClick={() => run(regenWeekly, true)} disabled={pending}>
        重新生成本周
      </button>
      {pending && <span className="filter-pending">生成中（LLM 流水线，约 10-30 秒）…</span>}
      {result && !pending && (
        <span className={result.ok ? 'regen-ok' : 'regen-err'}>{result.message}</span>
      )}
    </div>
  );
}

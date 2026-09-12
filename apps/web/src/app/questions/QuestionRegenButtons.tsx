'use client';

import { useState, useTransition } from 'react';
import { regenQuestions } from './actions';

// 手动触发出题：LLM 流水线（检索 + 多科目命题）耗时较长，期间按钮锁定防重复提交
export function QuestionRegenButtons() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const run = (force: boolean) => {
    setResult(null);
    // React 18 的 transition 回调必须同步；异步体用立即执行的 async 包裹
    startTransition(() => {
      void (async () => {
        try {
          setResult(await regenQuestions(force));
        } catch (e) {
          setResult({ ok: false, message: (e as Error).message });
        }
      })();
    });
  };

  return (
    <div className="regen-bar">
      <button className="btn" onClick={() => run(false)} disabled={pending}>
        生成今日猜题
      </button>
      <button className="btn btn-ghost" onClick={() => run(true)} disabled={pending}>
        重新生成今日
      </button>
      {pending && <span className="filter-pending">出题中（素材检索 + LLM 命题，约 1-3 分钟）…</span>}
      {result && !pending && (
        <span className={result.ok ? 'regen-ok' : 'regen-err'}>{result.message}</span>
      )}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import {
  AGENT_DEFS,
  AGENT_LINES,
  agentsByLine,
  getAgent,
  type AgentDef,
} from '@/lib/agents/registry';

function fmtTime(at: number): string {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

interface AgentRunRecord {
  id: string;
  agentName: string;
  icon: string;
  input: string;
  data: Record<string, unknown>;
  version: string;
  attempts: number;
  at: number;
}

const HISTORY_KEY = 'gk_agents_history';
const HISTORY_LIMIT = 20;
const SNIPPET_CHARS = 300;

function loadHistory(): AgentRunRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const arr = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]');
    return Array.isArray(arr) ? (arr as AgentRunRecord[]) : [];
  } catch {
    return [];
  }
}

/**
 * 命题 Agent 实验室：手动执行单 Agent、查看 JSON 产出。
 * 自动化管线（Filter→Adapter→ItemWriter→Reviewer）由 cron 流水线按需编排，这里负责调试与溯源。
 */
export default function AgentsPage() {
  const [agent, setAgent] = useState<AgentDef>(AGENT_DEFS[0]);
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ data: Record<string, unknown>; version: string; attempts: number; at: number; fromHistory?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<AgentRunRecord[]>([]);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  const maxChars = agent.maxInputChars;
  const overChars = input.length > maxChars;

  const switchAgent = (a: AgentDef) => {
    setAgent(a);
    setInput('');
    setOptions({});
    setError(null);
    setResult(null);
  };

  const run = async () => {
    if (!input.trim() || running) return;
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const r = await fetch('/api/agents/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: agent.id, input, options }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      const record: AgentRunRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        agentName: agent.name,
        icon: agent.icon,
        input: input.slice(0, SNIPPET_CHARS),
        data: data.data as Record<string, unknown>,
        version: data.version as string,
        attempts: data.attempts as number,
        at: Date.now(),
      };
      setResult({ data: record.data, version: record.version, attempts: record.attempts, at: record.at });
      const next = [record, ...loadHistory()].slice(0, HISTORY_LIMIT);
      try {
        window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // 存储满：历史是增值能力
      }
      setHistory(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const viewHistory = (h: AgentRunRecord) => {
    const a = getAgent(agentIdByName(h.agentName));
    if (a) setAgent(a);
    setError(null);
    setResult({ data: h.data, version: h.version, attempts: h.attempts, at: h.at, fromHistory: true });
  };

  const copyResult = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(result.data, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('复制失败：浏览器剪贴板不可用');
    }
  };

  const downloadResult = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: 'application/json;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `agent-${agent.id}-${new Date(result.at).toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <>
      <h1 className="page-title">命题 Agent 实验室</h1>

      <div className="tools-layout">
        {/* 左栏：按线分组的 agent 列表 */}
        <aside className="panel tools-side">
          <div className="panel-head">
            <h2>Agent 清单</h2>
            <span className="badge">{AGENT_DEFS.length} 个</span>
          </div>
          {AGENT_LINES.map((line) => (
            <div key={line}>
              <h3 className="tools-cat">{line}</h3>
              {agentsByLine(line).map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={`tool-card${a.id === agent.id ? ' tool-card-active' : ''}`}
                  onClick={() => switchAgent(a)}
                  title={a.description}
                >
                  <span className="tool-card-icon">{a.icon}</span>
                  <span className="tool-card-body">
                    <span className="tool-card-name">{a.name}</span>
                    <span className="tool-card-desc">{a.description}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* 右栏：执行面板 */}
        <section className="tools-main">
          <div className="panel">
            <div className="panel-head">
              <h2>
                {agent.icon} {agent.name}
                <span className="badge tools-history-badge">{agent.version}</span>
              </h2>
              <span className="badge">temp {agent.temperature}</span>
            </div>
            <p className="tools-input-hint">{agent.inputHint}</p>

            <textarea
              className="tools-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={agent.inputPlaceholder}
              disabled={running}
            />
            <div className={`tools-charcount${overChars ? ' tools-charcount-over' : ''}`}>
              {input.length.toLocaleString()} / {maxChars.toLocaleString()} 字
              {overChars && '（超出部分将被截断）'}
            </div>

            {(agent.options ?? []).map((opt) => (
              <div key={opt.key} className="tools-opt-row">
                <span className="tools-opt-label">{opt.label}</span>
                <div className="chip-row">
                  {opt.choices.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      className={`chip${(options[opt.key] ?? opt.choices[0].value) === c.value ? ' chip-active' : ''}`}
                      onClick={() => setOptions((prev) => ({ ...prev, [opt.key]: c.value }))}
                      disabled={running}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}

            <div className="tools-run-bar">
              <button type="button" className="btn" onClick={run} disabled={running || !input.trim()}>
                {running ? '执行中…' : '▶ 运行 Agent'}
              </button>
              {running && <span className="filter-pending">LLM 处理中（长文任务可达 1-2 分钟）…</span>}
            </div>
          </div>

          {error && (
            <div className="panel">
              <p className="placeholder tools-err">{error}</p>
            </div>
          )}

          {result && (
            <div className="panel">
              <div className="panel-head">
                <h2>
                  产出 JSON
                  {result.fromHistory && <span className="badge tools-history-badge">历史回看</span>}
                  <span className="badge">{result.version}</span>
                  {result.attempts === 2 && <span className="badge">重试后解析成功</span>}
                </h2>
                <div className="tools-result-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={copyResult}>
                    {copied ? '✓ 已复制' : '复制 JSON'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={downloadResult}>
                    下载 .json
                  </button>
                </div>
              </div>
              <pre className="agents-json">{JSON.stringify(result.data, null, 2)}</pre>
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <h2>历史记录</h2>
              {history.length > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    window.localStorage.removeItem(HISTORY_KEY);
                    setHistory([]);
                  }}
                >
                  清空
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="placeholder">还没有运行记录。每次执行自动留痕（仅存本机浏览器），点击可回看产出。</p>
            ) : (
              <div className="tools-history-list">
                {history.map((h) => (
                  <button key={h.id} type="button" className="tools-history-row" onClick={() => viewHistory(h)} title="点击回看完整产出">
                    <span className="tools-history-icon">{h.icon}</span>
                    <span className="tools-history-body">
                      <span className="tools-history-name">{h.agentName}</span>
                      <span className="tools-history-snippet">{h.input || '（无输入）'}</span>
                    </span>
                    <span className="tools-history-time">{fmtTime(h.at)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

// 历史记录只存了 agentName 展示名，回看时反查 id 切换左栏选中态
function agentIdByName(name: string): string {
  return AGENT_DEFS.find((a) => a.name === name)?.id ?? '';
}

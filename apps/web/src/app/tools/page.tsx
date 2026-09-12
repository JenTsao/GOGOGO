'use client';

import { useEffect, useMemo, useState } from 'react';
import { renderMarkdown } from '@/lib/markdown';
import {
  AI_TOOLS,
  TOOL_CATEGORIES,
  toolsByCategory,
  getTool,
  DEFAULT_MAX_INPUT_CHARS,
  loadToolHistory,
  saveToolRun,
  clearToolHistory,
  type AITool,
  type ToolRun,
} from '@/lib/aiTools/registry';

function fmtTime(at: number): string {
  const d = new Date(at);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * AI 工具区：统一入口 + 统一执行面板。
 * 工具清单与全部差异化配置（prompt/选项/上限）来自 lib/aiTools/registry.ts，
 * 本页面不硬编码任何具体工具 —— 新增工具只改 registry。
 */
export default function ToolsPage() {
  const [tool, setTool] = useState<AITool>(AI_TOOLS[0]);
  const [input, setInput] = useState('');
  const [options, setOptions] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ text: string; at: number; fromHistory?: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<ToolRun[]>([]);

  // 历史只在客户端读（localStorage），挂载后再 set，避免水合不匹配
  useEffect(() => {
    setHistory(loadToolHistory());
  }, []);

  const resultHtml = useMemo(
    () => (result ? renderMarkdown(result.text) : ''),
    [result]
  );

  const maxChars = tool.maxInputChars ?? DEFAULT_MAX_INPUT_CHARS;
  const overChars = input.length > maxChars;

  const switchTool = (t: AITool) => {
    setTool(t);
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
      const r = await fetch('/api/tools/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toolId: tool.id, input, options }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      const text = data.text as string;
      const at = Date.now();
      setResult({ text, at });
      if (data.truncated) {
        setError(`提示：输入超过 ${maxChars} 字上限，仅使用了前 ${maxChars} 字。`);
      }
      setHistory(saveToolRun(tool, input, text));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const viewHistory = (h: ToolRun) => {
    const t = getTool(h.toolId);
    if (t) setTool(t);
    setError(null);
    setResult({ text: h.output, at: h.at, fromHistory: true });
  };

  const copyResult = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('复制失败：浏览器剪贴板不可用');
    }
  };

  const downloadResult = () => {
    if (!result) return;
    const blob = new Blob([result.text], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `AI工具区-${tool.name}-${new Date(result.at).toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const wipeHistory = () => {
    clearToolHistory();
    setHistory([]);
  };

  return (
    <>
      <h1 className="page-title">AI 工具区</h1>

      <div className="tools-layout">
        {/* 左栏：工具箱（按分类分组） */}
        <aside className="panel tools-side">
          <div className="panel-head">
            <h2>工具箱</h2>
            <span className="badge">{AI_TOOLS.length} 个</span>
          </div>
          {TOOL_CATEGORIES.map((cat) => (
            <div key={cat}>
              <h3 className="tools-cat">{cat}</h3>
              {toolsByCategory(cat).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`tool-card${t.id === tool.id ? ' tool-card-active' : ''}`}
                  onClick={() => switchTool(t)}
                  title={t.description}
                >
                  <span className="tool-card-icon">{t.icon}</span>
                  <span className="tool-card-body">
                    <span className="tool-card-name">{t.name}</span>
                    <span className="tool-card-desc">{t.description}</span>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        {/* 右栏：执行面板 + 结果 + 历史 */}
        <section className="tools-main">
          <div className="panel">
            <div className="panel-head">
              <h2>
                {tool.icon} {tool.name}
              </h2>
              <span className="badge">{tool.description}</span>
            </div>

            <label className="tools-input-label" htmlFor="tools-input">
              {tool.inputLabel}
            </label>
            <textarea
              id="tools-input"
              className="tools-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={tool.inputPlaceholder}
              disabled={running}
            />
            <div className={`tools-charcount${overChars ? ' tools-charcount-over' : ''}`}>
              {input.length.toLocaleString()} / {maxChars.toLocaleString()} 字
              {overChars && '（超出部分将被截断）'}
            </div>

            {(tool.options ?? []).map((opt) => (
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
                {running ? '生成中…' : '▶ 运行'}
              </button>
              {running && <span className="filter-pending">LLM 处理中，约 10-30 秒，请勿关闭页面…</span>}
            </div>
          </div>

          {error && (
            <div className="panel">
              <p className={`placeholder${result ? ' tools-hint' : ' tools-err'}`}>{error}</p>
            </div>
          )}

          {result && (
            <div className="panel">
              <div className="panel-head">
                <h2>
                  运行结果
                  {result.fromHistory && <span className="badge tools-history-badge">历史回看</span>}
                </h2>
                <div className="tools-result-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={copyResult}>
                    {copied ? '✓ 已复制' : '复制'}
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={downloadResult}>
                    下载 .md
                  </button>
                </div>
              </div>
              {/* renderMarkdown 内 html:false 防注入，与导出路由同一安全模式 */}
              <div className="tools-result lib-md" dangerouslySetInnerHTML={{ __html: resultHtml }} />
            </div>
          )}

          <div className="panel">
            <div className="panel-head">
              <h2>历史记录</h2>
              {history.length > 0 && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={wipeHistory}>
                  清空
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <p className="placeholder">还没有运行记录。每次运行会自动留痕（仅存本机浏览器），点击可回看结果。</p>
            ) : (
              <div className="tools-history-list">
                {history.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    className="tools-history-row"
                    onClick={() => viewHistory(h)}
                    title="点击回看完整结果"
                  >
                    <span className="tools-history-icon">{h.icon}</span>
                    <span className="tools-history-body">
                      <span className="tools-history-name">{h.toolName}</span>
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

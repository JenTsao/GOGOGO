'use client';

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';

// 图谱视图：力导向布局的纯 SVG 实现（对标 Obsidian 关系图谱，零第三方依赖）。
// 物理循环直接改 DOM 属性（不走 setState），数百节点也能满帧；
// 缩放/平移经 svg transform 实现，节点可拖拽、点击打开笔记。

export interface GraphNode {
  path: string;
  folder: string;
  out: number;
  back: number;
  aliases: string[];
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
  deg: number;
  r: number; // 节点半径（度数决定，物理循环里定位标签用）
}

// 顶层目录配色：明暗主题通用的中间调色板（图谱节点色不随主题反转）
const PALETTE = ['#7c3aed', '#2563eb', '#0f9d6e', '#d97706', '#dc2626', '#0891b2', '#c026d3', '#65a30d', '#4f46e5', '#be185d'];
function folderColor(folder: string): string {
  let h = 0;
  for (let i = 0; i < folder.length; i++) h = (h * 31 + folder.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

const W = 900;
const H = 560;

export default function LibraryGraph({
  nodes,
  edges,
  selected,
  onSelect,
}: {
  nodes: GraphNode[];
  edges: [string, string][];
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const simRef = useRef<SimNode[]>([]);
  const circlesRef = useRef<(SVGCircleElement | null)[]>([]);
  const labelsRef = useRef<(SVGTextElement | null)[]>([]);
  const linesRef = useRef<(SVGLineElement | null)[]>([]);

  const [view, setView] = useState({ k: 1, ox: 0, oy: 0 });
  const [hovered, setHovered] = useState<number | null>(null);
  const [ready, setReady] = useState(false);
  const dragRef = useRef<{ kind: 'node' | 'pan'; idx: number; sx: number; sy: number } | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  // 初始化模拟节点（度数 = 出+入，决定节点大小与标签显隐）
  useEffect(() => {
    const byPath = new Map<string, SimNode>();
    const sims: SimNode[] = nodes.map((n, i) => {
      const angle = (i / Math.max(nodes.length, 1)) * Math.PI * 2;
      const s: SimNode = {
        ...n,
        deg: n.out + n.back,
        x: Math.cos(angle) * (140 + (i % 7) * 22),
        y: Math.sin(angle) * (110 + (i % 5) * 20),
        vx: 0,
        vy: 0,
      };
      byPath.set(n.path, s);
      return s;
    });
    const links = edges
      .map(([a, b]) => {
        const s = byPath.get(a);
        const t = byPath.get(b);
        return s && t ? { s, t } : null;
      })
      .filter((l): l is { s: SimNode; t: SimNode } => l !== null);
    for (const l of links) {
      l.s.deg += 1;
      l.t.deg += 1;
    }
    for (const s of sims) s.r = 4 + Math.min(s.deg, 24) * 0.7;
    simRef.current = sims;
    setReady(true);
    return () => {
      simRef.current = [];
    };
    // edges 以数组引用传递，结构变化时必然换引用
  }, [nodes, edges]);

  // 物理循环：斥力（O(n²)，数百节点可接受）+ 弹簧 + 向心力，alpha 衰减自动沉降
  useEffect(() => {
    if (!ready) return;
    const sims = simRef.current;
    if (sims.length === 0) return;
    const byPath = new Map(sims.map((s) => [s.path, s]));
    const links = edges
      .map(([a, b]) => {
        const s = byPath.get(a);
        const t = byPath.get(b);
        return s && t ? [s, t] as const : null;
      })
      .filter((l): l is readonly [SimNode, SimNode] => l !== null);

    let alpha = 1;
    let frames = 0;
    let raf = 0;
    const tick = () => {
      alpha = Math.max(alpha * 0.992, 0.03);
      for (let i = 0; i < sims.length; i++) {
        const a = sims[i];
        for (let j = i + 1; j < sims.length; j++) {
          const b = sims[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) {
            dx = (i % 2 ? 1 : -1) * (1 + i * 0.01);
            dy = (j % 2 ? -1 : 1) * (1 + j * 0.01);
            d2 = dx * dx + dy * dy;
          }
          const rep = (2600 * alpha) / d2;
          const d = Math.sqrt(d2);
          const fx = (dx / d) * rep;
          const fy = (dy / d) * rep;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
        a.vx -= a.x * 0.004 * alpha; // 向心力
        a.vy -= a.y * 0.004 * alpha;
      }
      for (const [s, t] of links) {
        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const d = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const f = (d - 95) * 0.012 * alpha;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        s.vx += fx; s.vy += fy;
        t.vx -= fx; t.vy -= fy;
      }
      const dragging = dragRef.current;
      for (let i = 0; i < sims.length; i++) {
        const s = sims[i];
        if (dragging?.kind === 'node' && dragging.idx === i) {
          s.vx = 0; s.vy = 0;
        } else {
          s.vx *= 0.85; s.vy *= 0.85;
          s.x += Math.max(-12, Math.min(12, s.vx));
          s.y += Math.max(-12, Math.min(12, s.vy));
        }
      }
      // 直改 DOM：React 重渲染每帧几百个元素会卡，这里绕开
      for (let i = 0; i < sims.length; i++) {
        const s = sims[i];
        const c = circlesRef.current[i];
        if (c) { c.setAttribute('cx', String(s.x)); c.setAttribute('cy', String(s.y)); }
        const l = labelsRef.current[i];
        if (l) { l.setAttribute('x', String(s.x)); l.setAttribute('y', String(s.y + s.r + 4)); }
      }
      for (let i = 0; i < links.length; i++) {
        const el = linesRef.current[i];
        if (el) {
          el.setAttribute('x1', String(links[i][0].x));
          el.setAttribute('y1', String(links[i][0].y));
          el.setAttribute('x2', String(links[i][1].x));
          el.setAttribute('y2', String(links[i][1].y));
        }
      }
      if (++frames < 900) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, nodes, edges]);

  // 顶层标签只挂度数靠前的节点（全挂会糊成一片）；hover/选中节点永远显示
  const labeled = new Set<string>();
  if (ready) {
    const top = [...simRef.current].sort((a, b) => b.deg - a.deg).slice(0, 14);
    for (const s of top) labeled.add(s.path);
    if (hovered !== null) labeled.add(simRef.current[hovered]?.path ?? '');
    if (selected) labeled.add(selected);
  }

  const toWorld = (clientX: number, clientY: number, rect: DOMRect) => {
    const { k, ox, oy } = viewRef.current;
    return { x: (clientX - rect.left - rect.width / 2 - ox) / k, y: (clientY - rect.top - rect.height / 2 - oy) / k };
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>, idx: number | null) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { kind: idx === null ? 'pan' : 'node', idx: idx ?? -1, sx: e.clientX, sy: e.clientY };
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    if (drag.kind === 'pan') {
      setView((v) => ({ ...v, ox: v.ox + (e.clientX - drag.sx), oy: v.oy + (e.clientY - drag.sy) }));
      dragRef.current = { ...drag, sx: e.clientX, sy: e.clientY };
    } else {
      const p = toWorld(e.clientX, e.clientY, rect);
      const s = simRef.current[drag.idx];
      if (s) { s.x = p.x; s.y = p.y; }
    }
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const onWheel = (e: ReactWheelEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left - rect.width / 2;
    const my = e.clientY - rect.top - rect.height / 2;
    setView((v) => {
      const k = Math.min(6, Math.max(0.25, v.k * (e.deltaY < 0 ? 1.12 : 0.89)));
      // 缩放围绕光标：保持光标下的世界坐标不动
      const ratio = k / v.k;
      return { k, ox: mx - (mx - v.ox) * ratio, oy: my - (my - v.oy) * ratio };
    });
  };

  const sims = simRef.current;
  const pathToIdx = new Map(sims.map((s, i) => [s.path, i]));

  return (
    <div className="lib-graph">
      <svg
        width="100%"
        height="100%"
        viewBox={`${-W / 2} ${-H / 2} ${W} ${H}`}
        style={{ touchAction: 'none', cursor: dragRef.current?.kind === 'pan' ? 'grabbing' : 'default' }}
        onPointerDown={(e) => onPointerDown(e, null)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onWheel={onWheel}
      >
        <g transform={`translate(${view.ox},${view.oy}) scale(${view.k})`}>
          {edges.map((_, i) => (
            <line
              key={i}
              ref={(el) => { linesRef.current[i] = el; }}
              stroke="var(--border)"
              strokeWidth={1 / view.k}
              opacity={0.7}
            />
          ))}
          {sims.map((s, i) => {
            const r = s.r;
            const isActive = hovered === i || selected === s.path;
            return (
              <g key={s.path}>
                <circle
                  ref={(el) => { circlesRef.current[i] = el; }}
                  r={r}
                  fill={folderColor(s.folder)}
                  stroke={isActive ? 'var(--text)' : 'none'}
                  strokeWidth={2 / view.k}
                  opacity={selected && selected !== s.path && hovered === null ? 0.45 : 0.9}
                  style={{ cursor: 'pointer' }}
                  onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, i); }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    // 拖拽位移极小视为点击（避免拖完跳笔记）
                    const drag = dragRef.current;
                    if (drag?.kind === 'node' && Math.abs(e.clientX - drag.sx) + Math.abs(e.clientY - drag.sy) < 4) onSelect(s.path);
                    dragRef.current = null;
                  }}
                  onPointerEnter={() => setHovered(i)}
                  onPointerLeave={() => setHovered(null)}
                />
                <text
                  ref={(el) => { labelsRef.current[i] = el; }}
                  textAnchor="middle"
                  fontSize={11 / view.k}
                  fill="var(--text2)"
                  style={{ pointerEvents: 'none', userSelect: 'none' }}
                  visibility={labeled.has(s.path) ? 'visible' : 'hidden'}
                >
                  {s.path.split('/').pop()?.replace(/\.md$/, '')}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
      <div className="lib-graph-legend">
        {(() => {
          const folders = [...new Set(sims.map((s) => s.folder))].slice(0, 10);
          return folders.map((f) => (
            <span key={f} className="lib-legend-item">
              <span className="lib-legend-dot" style={{ background: folderColor(f) }} />
              {f === '/' ? '根目录' : f}
            </span>
          ));
        })()}
        <span className="lib-legend-hint">滚轮缩放 · 拖拽平移 · 点击节点打开笔记</span>
      </div>
      {!ready && <div className="placeholder">图谱构建中…</div>}
    </div>
  );
}

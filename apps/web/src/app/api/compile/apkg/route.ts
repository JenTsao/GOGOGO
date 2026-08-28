import { NextRequest, NextResponse } from 'next/server';
import { buildApkg, type AnkiCard } from '@/lib/apkg';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// POST /api/compile/apkg { deckName, cards: [{front, back, tags?}] } → base64 .apkg
// 真正的 Anki 卡片包：zip 内含 SQLite（sql.js wasm 构建），Anki 双击导入
export async function POST(req: NextRequest) {
  let body: { deckName?: string; cards?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '请求体不是合法 JSON' }, { status: 400 });
  }
  const raw = Array.isArray(body.cards) ? body.cards : [];
  const cards: AnkiCard[] = raw
    .filter((c): c is { front: string; back: string; tags?: string[] } => {
      const o = c as { front?: unknown; back?: unknown };
      return typeof o.front === 'string' && typeof o.back === 'string' && !!o.front.trim();
    })
    .map((c) => ({
      front: c.front,
      back: c.back,
      tags: Array.isArray(c.tags) ? c.tags.filter((t): t is string => typeof t === 'string') : undefined,
    }));
  if (cards.length === 0) return NextResponse.json({ error: '没有可导入的卡片（需要 ## 标题 + 内容）' }, { status: 400 });
  if (cards.length > 2000) return NextResponse.json({ error: '单次最多 2000 张卡片' }, { status: 413 });

  try {
    const deckName = (body.deckName ?? '').trim().replace(/[:*?"<>|]/g, '_') || '高考复习';
    const buf = await buildApkg(deckName, cards);
    return NextResponse.json({
      ok: true,
      deckName,
      count: cards.length,
      // 二进制走 base64 过 JSON；客户端还原为 .apkg 下载
      base64: buf.toString('base64'),
    });
  } catch (e) {
    return NextResponse.json({ error: `apkg 构建失败：${(e as Error).message}` }, { status: 500 });
  }
}

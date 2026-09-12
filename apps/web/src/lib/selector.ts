// Selector：把素材池收敛到「今天该练的一篇」——整套系统真正「猜题」的部分。
//
// 公式：今日素材 = 考向热度（gaokao_fit）× 个人薄弱度（错题考点）× 选材时间窗
//
// ⚠️ 待校准参数：GAP_MONTHS_* 是命题选材的时间窗（文章发表日 → 高考日的间隔）。
//    真实值应由回溯研究统计得出（近 5-10 年真题逐篇反查原文发表日期）。
//    在校准前，素材池里全是「刚采集的」文章，严格套时间窗会一条都选不出来，
//    因此内置 fallback：时间窗内无候选时放宽到全池，并在返回值里标记 windowFallback，
//    调用方（页面/日志）据此提示「当前未启用时间窗」。校准后把 STRICT_WINDOW 置 true 即可。
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/** 选材时间窗（月）：待回溯研究校准 */
export const GAP_MONTHS_MIN = 6;
export const GAP_MONTHS_MAX = 18;
/** 校准后改为 true（严格按时间窗过滤，不再放宽） */
export const STRICT_WINDOW = false;

/** 薄弱话题命中时的加分（与 0-10 的 gaokao_fit 同量纲） */
const WEAK_TOPIC_BONUS = 2;

export interface SelectedMaterial {
  id: number;
  title: string;
  url: string;
  content: string;
  sourceName: string;
  category: string;
  topic: string | null;
  difficulty: string | null;
  gaokaoFit: number | null;
  /** true = 时间窗内无候选，已放宽到全池（素材池尚在攒数据 / 参数未校准） */
  windowFallback: boolean;
  reason: string;
}

function monthsAgo(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

/**
 * 从错题推导薄弱话题：优先用 knowledge_point（考点级，需回填），
 * 未回填时退化为统计 tags（卡壳标签）频次——粒度粗但聊胜于无，
 * 完全没有错题数据时返回空数组，Selector 退化为纯热度排序。
 */
export async function getWeakTopics(owner: string, limit = 3): Promise<string[]> {
  const db = supabaseAdmin();
  const { data: byKp } = await db
    .from('mistakes')
    .select('knowledge_point')
    .eq('user_id', owner)
    .not('knowledge_point', 'is', null);

  const counts = new Map<string, number>();
  for (const r of (byKp ?? []) as { knowledge_point: string | null }[]) {
    const k = (r.knowledge_point ?? '').trim();
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  if (counts.size === 0) {
    // 退化路径：卡壳标签频次
    const { data: byTags } = await db.from('mistakes').select('tags').eq('user_id', owner);
    for (const r of (byTags ?? []) as { tags: string[] | null }[]) {
      for (const t of r.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k]) => k);
}

interface MaterialRow {
  id: number;
  title: string | null;
  url: string;
  full_text: string | null;
  source_name: string;
  category: string;
  topic: string | null;
  difficulty: string | null;
  gaokao_fit: number | string | null;
}

/**
 * 选出今日素材并标记（selected_on），避免同一篇被反复出。
 * 无候选时返回 null，调用方降级为 Tavily 现抓或 AI 自拟材料。
 */
export async function selectMaterial(opts: {
  owner: string;
  subject: string;
  date: string;
  difficulty?: string;
  weakTopics?: string[];
}): Promise<SelectedMaterial | null> {
  const db = supabaseAdmin();
  const weak = new Set(opts.weakTopics ?? []);

  const base = db
    .from('source_materials')
    .select('id,title,url,full_text,source_name,category,topic,difficulty,gaokao_fit')
    .eq('user_id', opts.owner)
    .eq('subject', opts.subject)
    .is('selected_on', null)
    .eq('status', 'pooled')
    .not('full_text', 'is', null);

  let q = base;
  if (opts.difficulty) q = q.eq('difficulty', opts.difficulty);
  // 时间窗：发表日在 [max 月前, min 月前] 之间
  q = q.lte('published_at', monthsAgo(GAP_MONTHS_MIN)).gte('published_at', monthsAgo(GAP_MONTHS_MAX));

  let { data, error } = await q.order('gaokao_fit', { ascending: false }).limit(30);
  if (error) throw new Error(`查询素材池失败：${error.message}`);

  let windowFallback = false;
  if ((!data || data.length === 0) && !STRICT_WINDOW) {
    // 放宽：去掉时间窗（初期池子全是新文章，严格过滤会选不出任何东西）
    let q2 = base;
    if (opts.difficulty) q2 = q2.eq('difficulty', opts.difficulty);
    const relaxed = await q2.order('gaokao_fit', { ascending: false }).limit(30);
    if (relaxed.error) throw new Error(`查询素材池失败：${relaxed.error.message}`);
    data = relaxed.data;
    windowFallback = true;
  }

  const rows = (data ?? []) as MaterialRow[];
  if (rows.length === 0) return null;

  // 综合排序：适配度 + 薄弱话题命中加成
  const ranked = rows
    .map((r) => {
      const fit = r.gaokao_fit === null ? 0 : Number(r.gaokao_fit);
      const hit = r.topic && weak.has(r.topic);
      return { row: r, fit, bonus: hit ? WEAK_TOPIC_BONUS : 0, hit };
    })
    .sort((a, b) => b.fit + b.bonus - (a.fit + a.bonus));

  const best = ranked[0];
  const content = (best.row.full_text ?? '').trim();
  if (!content) return null;

  // 标记已用（失败不影响主流程：最坏情况是下次重复选到它）
  await db
    .from('source_materials')
    .update({ selected_on: opts.date, status: 'selected' })
    .eq('id', best.row.id)
    .eq('user_id', opts.owner);

  const parts = [
    `适配度 ${best.fit || '—'}`,
    best.row.topic ? `话题 ${best.row.topic}` : null,
    best.hit ? `命中薄弱点 +${WEAK_TOPIC_BONUS}` : null,
    windowFallback ? '（时间窗未启用：池内暂无窗口内素材）' : null,
  ].filter(Boolean);

  return {
    id: best.row.id,
    title: best.row.title ?? '(无标题)',
    url: best.row.url,
    content,
    sourceName: best.row.source_name,
    category: best.row.category,
    topic: best.row.topic,
    difficulty: best.row.difficulty,
    gaokaoFit: best.row.gaokao_fit === null ? null : Number(best.row.gaokao_fit),
    windowFallback,
    reason: parts.join(' · '),
  };
}

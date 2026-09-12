// 素材采集编排：拉 feed → 去重 → 配额分配 → 补全文 → AI 打分 → 入库。
//
// 三条设计取舍：
// 1. URL 级去重，不做「事件级合并」：Reuters 与 Guardian 报道同一事件是两篇语言风格、
//    句法难度都不同的文章，两篇都可能当素材，合并即损失（这是与原 Horizon 的关键分歧）。
// 2. 打分失败也入库（fit 留空）：素材池有「时间不可补偿」特性——RSS 只提供最新 20-50 条，
//    今天没采的文章三个月后只能走归档渠道补。宁可存一条没分的，也不能因为 AI 抖动丢素材。
// 3. full_text 截断存储：一篇 2000 词全文约 12KB，60 条/天一年就是 260MB，
//    会撑爆 Supabase 500MB 免费额度；而一套阅读题只需要 400 词，截断不影响改编。
import { supabaseAdmin, requireAdminEnv } from '@/lib/supabaseAdmin';
import { MATERIAL_SOURCES, CATEGORY_QUOTA, type MaterialCategory, type SourceDef } from './sources';
import { fetchFeed, fetchFullText } from './rss';
import { analyzeMaterial, llmConfigured, parseTags } from './analyze';

/** 正文低于此长度尝试回源站抓一次（RSS 的 description 往往只是摘要） */
const MIN_FULLTEXT_CHARS = 800;
/** 低于此长度直接丢弃：撑不起一套阅读题 */
const DROP_BELOW_CHARS = 300;
/** 单篇存库上限（字符）—控存储，见文件头取舍 3 */
const STORE_MAX_CHARS = 12000;

export interface CollectOptions {
  /** 本轮最多入库多少条（控 LLM 成本与函数时长） */
  maxPerRun?: number;
  /** 单个源最多取多少条 */
  maxPerSource?: number;
  /** 跳过 AI 打分（快速补量用；产出 fit 为空，Selector 退化为按时间+话题排序） */
  skipScoring?: boolean;
}

export interface SourceReport {
  name: string;
  category: MaterialCategory;
  ok: boolean;
  items: number;
  error?: string;
}

export interface CollectReport {
  startedAt: string;
  dryRun: boolean;
  llmEnabled: boolean;
  sources: SourceReport[];
  fetched: number;
  inserted: number;
  skippedExisting: number;
  skippedShort: number;
  scored: number;
}

/** 简易并发控制：源数量多且都在外网，全并发容易被目标站限流 */
async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const i = cursor++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** 按选材比例把总预算分到各组（保底 3 条，避免小众组被饿死） */
function quotaFor(category: MaterialCategory, budget: number): number {
  const total = Object.values(CATEGORY_QUOTA).reduce((a, b) => a + b, 0);
  return Math.max(3, Math.round((budget * CATEGORY_QUOTA[category]) / total));
}

interface Candidate {
  source: SourceDef;
  title: string;
  url: string;
  publishedAt: string | null;
  content: string;
}

export async function collectMaterials(
  opts: CollectOptions = {}
): Promise<CollectReport> {
  const owner = requireAdminEnv();
  const maxPerRun = opts.maxPerRun ?? 24;
  const maxPerSource = opts.maxPerSource ?? 12;
  const skipScoring = opts.skipScoring === true;
  const llmEnabled = !skipScoring && llmConfigured();

  // 1) 并发拉全部源；单源失败只记状态不中断（广撒网，少一个源不影响大局）
  const reports: SourceReport[] = [];
  const all: Candidate[] = [];

  await mapLimit(MATERIAL_SOURCES, 5, async (src) => {
    try {
      const items = await fetchFeed(src.url);
      const picked = items.slice(0, maxPerSource);
      for (const it of picked) {
        all.push({
          source: src,
          title: it.title,
          url: it.url,
          publishedAt: it.publishedAt,
          content: it.content,
        });
      }
      reports.push({ name: src.name, category: src.category, ok: true, items: picked.length });
    } catch (e) {
      reports.push({
        name: src.name,
        category: src.category,
        ok: false,
        items: 0,
        error: (e as Error).message,
      });
    }
  });

  // 2) 本轮内 URL 去重
  const seen = new Set<string>();
  const deduped = all.filter((c) => {
    if (seen.has(c.url)) return false;
    seen.add(c.url);
    return true;
  });

  // 3) 按选材比例配额切分，保证 lifestyle 不被 NYT 的产量淹没
  const byCategory = new Map<MaterialCategory, Candidate[]>();
  for (const c of deduped) {
    const list = byCategory.get(c.source.category) ?? [];
    list.push(c);
    byCategory.set(c.source.category, list);
  }
  const shortlist: Candidate[] = [];
  for (const [cat, list] of byCategory) {
    // 组内按时间倒序（新的优先），无时间戳的排后面
    list.sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    shortlist.push(...list.slice(0, quotaFor(cat, maxPerRun)));
  }

  // 4) 库内去重：已采过的 URL 不再处理
  const { data: existing } = await supabaseAdmin()
    .from('source_materials')
    .select('url')
    .eq('user_id', owner)
    .in('url', shortlist.map((c) => c.url));
  const have = new Set((existing ?? []).map((r: { url: string }) => r.url));

  let skippedExisting = 0;
  let skippedShort = 0;
  let scored = 0;
  const rows: Record<string, unknown>[] = [];

  // 5) 逐条补全文 + 打分（打分并发 4，是全流程最慢的一环）
  const todo = shortlist.filter((c) => {
    if (have.has(c.url)) {
      skippedExisting++;
      return false;
    }
    return true;
  });

  await mapLimit(todo, 4, async (c) => {
    let body = c.content ?? '';
    if (body.length < MIN_FULLTEXT_CHARS) {
      const full = await fetchFullText(c.url);
      if (full.length > body.length) body = full;
    }
    if (body.length < DROP_BELOW_CHARS) {
      skippedShort++;
      return;
    }

    let fit: number | null = null;
    let reason = '';
    let summary = '';
    let tags: string[] = [];
    if (llmEnabled) {
      const s = await analyzeMaterial(c.title, body, c.source.name);
      if (s) {
        fit = s.score;
        reason = s.reason;
        summary = s.summary;
        tags = s.tags;
        scored++;
      }
    }
    const p = parseTags(tags);
    rows.push({
      user_id: owner,
      source_name: c.source.name,
      category: c.source.category,
      subject: c.source.subject,
      url: c.url,
      title: c.title.slice(0, 300),
      published_at: c.publishedAt,
      full_text: body.slice(0, STORE_MAX_CHARS),
      word_count: p.words ?? Math.round(body.split(/\s+/).length),
      summary_zh: summary || null,
      reason: reason || null,
      gaokao_fit: fit,
      topic: p.topic ?? null,
      genre: p.genre ?? null,
      difficulty: p.difficulty ?? null,
      risk: p.risk ?? 'none',
      form: p.form ?? null,
      ai_tags: tags,
      status: 'pooled',
      prompt_version: llmEnabled ? 'collector-v1' : null,
    });
  });

  // 6) 入库（URL 唯一约束兜底并发重复）
  let inserted = 0;
  if (rows.length) {
    const { data, error } = await supabaseAdmin()
      .from('source_materials')
      .upsert(rows, { onConflict: 'user_id,url', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(`写入 source_materials 失败：${error.message}`);
    inserted = data?.length ?? 0;
  }

  return {
    startedAt: new Date().toISOString(),
    dryRun: false,
    llmEnabled,
    sources: reports,
    fetched: deduped.length,
    inserted,
    skippedExisting,
    skippedShort,
    scored,
  };
}

/** 源可用性验证：RSS 地址会变，长期未跑后先验证一遍 */
export async function verifySources(): Promise<
  { name: string; url: string; category: MaterialCategory; ok: boolean; items: number; error?: string }[]
> {
  return mapLimit(MATERIAL_SOURCES, 6, async (src) => {
    try {
      const items = await fetchFeed(src.url, 12000);
      return { name: src.name, url: src.url, category: src.category, ok: true, items: items.length };
    } catch (e) {
      return {
        name: src.name,
        url: src.url,
        category: src.category,
        ok: false,
        items: 0,
        error: (e as Error).message,
      };
    }
  });
}

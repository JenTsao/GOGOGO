import { supabaseAdmin, requireAdminEnv, ownerUserId } from '@/lib/supabaseAdmin';
import { MaterialPool, type MaterialRow } from './MaterialPool';
import { CATEGORY_LABELS, type MaterialCategory } from '@/lib/collector/sources';
import { GAP_MONTHS_MIN, GAP_MONTHS_MAX, STRICT_WINDOW } from '@/lib/selector';

export const dynamic = 'force-dynamic';

// 素材池：采集流水线的产物视图 + 手动采集入口。
// 这里的素材是「候选池」不是「新闻源」——gaokao_fit 的语义是高考适配度，
// 与新闻热度高度错位（突发时政热度高但几乎不可能命题，旅游手册反之）。

interface Stats {
  total: number;
  avgFit: string;
  selected: number;
  byCategory: Record<string, number>;
}

async function load(): Promise<{ rows: MaterialRow[]; stats: Stats }> {
  requireAdminEnv();
  const db = supabaseAdmin();
  const { data, error } = await db
    .from('source_materials')
    .select(
      'id,source_name,category,subject,url,title,published_at,word_count,summary_zh,gaokao_fit,topic,genre,difficulty,risk,form,status,selected_on,created_at'
    )
    .eq('user_id', ownerUserId())
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as MaterialRow[];
  const fits = rows
    .map((r) => (r.gaokao_fit === null ? null : Number(r.gaokao_fit)))
    .filter((n): n is number => n !== null && Number.isFinite(n));
  const byCategory: Record<string, number> = {};
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;

  return {
    rows,
    stats: {
      total: rows.length,
      avgFit: fits.length ? (fits.reduce((a, b) => a + b, 0) / fits.length).toFixed(1) : '—',
      selected: rows.filter((r) => r.status === 'selected').length,
      byCategory,
    },
  };
}

export default async function MaterialsPage() {
  let rows: MaterialRow[] = [];
  let stats: Stats = { total: 0, avgFit: '—', selected: 0, byCategory: {} };
  let loadError = '';
  try {
    const r = await load();
    rows = r.rows;
    stats = r.stats;
  } catch (e) {
    loadError = (e as Error).message;
  }

  return (
    <div className="main">
      <h1 className="page-title">🌐 素材池</h1>
      <p className="muted-line">
        与命题人共享同一候选池：按高考选材比例（严肃媒体 45% / 生活信息 26% / 专业刊物 16% / 都市小报 13%）
        采集，AI 按「高考适配度」打分，每日猜题流水线从中选取今日命题材料。
      </p>

      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <div className="panel stat-card">
          <div className="stat-label">素材总数</div>
          <div className="stat-num">{stats.total}</div>
          <div className="stat-sub">
            {Object.entries(stats.byCategory)
              .map(([k, v]) => `${CATEGORY_LABELS[k as MaterialCategory] ?? k} ${v}`)
              .join(' · ') || '暂无'}
          </div>
        </div>
        <div className="panel stat-card">
          <div className="stat-label">平均适配度</div>
          <div className="stat-num">{stats.avgFit}</div>
          <div className="stat-sub">0-10 分，≥7 为可直接改编</div>
        </div>
        <div className="panel stat-card">
          <div className="stat-label">已用于命题</div>
          <div className="stat-num">{stats.selected}</div>
          <div className="stat-sub">选中后不重复使用</div>
        </div>
        <div className="panel stat-card">
          <div className="stat-label">选材时间窗</div>
          <div className="stat-num" style={{ fontSize: 22 }}>
            {GAP_MONTHS_MIN}-{GAP_MONTHS_MAX} 月
          </div>
          <div className="stat-sub">
            {STRICT_WINDOW ? '已严格启用' : '未启用（池内暂无窗口内素材，自动放宽）'}
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="panel">
          <p className="risk-line">
            读取失败：{loadError}
            <br />
            若提示表不存在，先在 Supabase SQL Editor 执行一次 supabase/002_source_materials.sql。
          </p>
        </div>
      ) : (
        <MaterialPool initial={rows} />
      )}

      <div className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <h2>设计说明（务必先读）</h2>
        </div>
        <div className="placeholder" style={{ fontSize: 13 }}>
          <p style={{ margin: '6px 0' }}>
            <b>为什么不是「新闻热度」排序</b>：高考选材价值与新闻价值高度错位。战争、灾难、名人八卦新闻价值 9-10，
            但几乎不可能命题；小镇旅游手册、生活科普新闻价值 2-3，却占高考选材约 26%。因此打分内核已整体重定义为「高考适配度」。
          </p>
          <p style={{ margin: '6px 0' }}>
            <b>为什么不做事件级去重</b>：Reuters 与 Guardian 报道同一事件是两篇语言风格、句法难度都不同的文章，
            两篇都可能当素材，合并即损失。本系统只做 URL 级去重。
          </p>
          <p style={{ margin: '6px 0' }}>
            <b>时间不可补偿</b>：RSS 只提供最新 20-50 条，无法回溯历史。今天没采的文章，三个月后只能走
            Wayback 等归档渠道补，成本高一个量级。所以采集应尽早开始，哪怕其他模块还没就绪。
          </p>
          <p style={{ margin: '6px 0' }}>
            <b>选材时间窗待校准</b>：命题人选材是回溯过去某段时间（当前按 {GAP_MONTHS_MIN}-{GAP_MONTHS_MAX} 月），
            真实值需做回溯研究——近 5-10 年真题逐篇反查原文出处与发表日期，统计 gap_months 分布。
            校准前系统自动放宽到全池（页头「未启用」即此状态）。
          </p>
        </div>
      </div>
    </div>
  );
}

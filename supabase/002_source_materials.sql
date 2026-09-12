-- ============================================================
-- 002 · 高考素材池（Horizon 采集能力接入）
-- 在 supabase/schema.sql 之后单独执行一次；全文幂等，可重复跑。
--
-- 设计要点：
-- 1. 存的是「候选素材」不是「新闻」——gaokao_fit 语义是高考适配度，不是新闻热度。
-- 2. published_at 是命脉：命题选材是回溯过去某段时间的文章，
--    选材时间窗（gap_months）一旦由回溯研究得出，Selector 立即依赖此列过滤。
-- 3. embedding 默认留空：1536 维向量约 6KB/条，全量向量化会撑爆 Supabase 500MB 免费额度，
--    只对通过 Selector 精筛的素材生成（见 lib/selector.ts 注释）。
-- ============================================================

create table if not exists public.source_materials (
  id              bigserial primary key,
  user_id         uuid not null references auth.users (id) on delete cascade,

  -- 来源
  source_name     text not null,
  category        text not null,          -- serious-media / professional / lifestyle / tabloid
  subject         text not null default '英语', -- 归属科目（中文源接入后填「语文」）
  url             text not null,
  title           text,
  published_at    timestamptz,            -- ★ 选材时间窗过滤依赖此列，务必保留

  -- 内容
  full_text       text,                   -- RSS 全文或正文抽取结果
  word_count      int,
  summary_zh      text,                   -- AI 中文摘要
  reason          text,                   -- AI 打分理由

  -- AI 评分与结构化标签（Collector agent 产出）
  gaokao_fit      numeric(3,1),           -- 0-10，语义为「高考适配度」（见 lib/collector/analyze.ts）
  topic           text,                   -- 八类母题之一
  genre           text,                   -- 说明文/记叙文/议论文/应用文/新闻报道
  difficulty      text,                   -- easy / medium / hard
  risk            text,                   -- none / 政治敏感 / 宗教 / 暴力 / 争议价值观 / 文化偏见
  form            text,                   -- 阅读 / 完形 / 语法填空
  ai_tags         jsonb,                  -- 原始标签数组（解析规则变更时不丢信息）

  -- 流水线状态
  status          text not null default 'pooled',  -- pooled（在池）/ selected（已选中）/ archived
  selected_on     date,                   -- 被哪天选中过（Selector 排除复用，避免重复出题）
  prompt_version  text,                   -- Collector agent 版本，调 prompt 后对比质量
  embedding       vector(1536),           -- 仅精筛后生成，控免费额度

  created_at      timestamptz not null default now(),

  unique (user_id, url)                   -- URL 级去重（不做事件级合并，见 README 说明）
);

alter table public.source_materials enable row level security;
drop policy if exists "owners manage own source materials" on public.source_materials;
create policy "owners manage own source materials" on public.source_materials
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create index if not exists idx_sm_user_published on public.source_materials (user_id, published_at desc);
create index if not exists idx_sm_user_fit      on public.source_materials (user_id, gaokao_fit desc);
create index if not exists idx_sm_user_status   on public.source_materials (user_id, status);
create index if not exists idx_sm_topic         on public.source_materials (topic);
create index if not exists idx_sm_selected_on   on public.source_materials (user_id, selected_on);

-- pgvector 检索（HNSW）：仅当 embedding 非空才有意义
create index if not exists idx_sm_embedding
  on public.source_materials using hnsw (embedding vector_cosine_ops);

comment on column public.source_materials.gaokao_fit is
  'AI 打分的语义是「高考适配度」而非新闻价值：突发时政新闻价值高但几乎不可能命题，旅游手册类反之。见 lib/collector/analyze.ts';
comment on column public.source_materials.published_at is
  '选材时间窗（发表日→高考日的间隔分布）过滤依赖此列；回溯研究得出 gap_months 后在 lib/selector.ts 启用';
comment on column public.source_materials.embedding is
  '默认留空，仅对通过 Selector 精筛的素材生成——1536 维约 6KB/条，全量向量化会撑爆免费额度';

-- ============================================================
-- 错题挂考点：薄弱度下沉到考点级的前置。
-- 「考向热度 × 个人薄弱度」的右半边依赖它，未挂考点时 Selector 退化为纯热度排序。
-- ============================================================
alter table public.mistakes
  add column if not exists knowledge_point text;

comment on column public.mistakes.knowledge_point is
  '考点标签（如「英语/阅读理解/推理判断」）。未回填时 Selector 的薄弱度权重为 0，仅按考向热度排序';

create index if not exists idx_mistakes_kp on public.mistakes (user_id, knowledge_point);

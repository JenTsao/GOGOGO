-- ============================================================
-- Gaokao Co-pilot · Supabase Schema
-- 10 张核心表 + pgvector 向量检索 + RLS 行级安全策略
-- 执行方式：supabase db reset 或直接在 SQL Editor 运行
-- ============================================================

-- 1. 启用向量扩展（语义检索基础）
create extension if not exists vector;

-- ============================================================
-- 表结构
-- ============================================================

-- profiles: 用户配置与稳定画像
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  access_key text unique, -- 设备访问密钥（get_daily_by_key / 管理台 x-access-key 反查归属）
  target_university text,
  target_score int,
  learning_style jsonb default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- tasks: 任务池（三件事 + 后备箱），status: backlog / top3 / done
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null,
  subject text,
  status text not null default 'backlog' check (status in ('backlog', 'top3', 'done')),
  date date,
  created_at timestamptz default now()
);

-- timer_sessions: 专注原始记录
create table if not exists public.timer_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject text,
  duration int not null,
  efficiency_score numeric,
  interrupt_type text,
  started_at timestamptz default now()
);

-- mood_checkins: 情绪与语音备忘
create table if not exists public.mood_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  emoji_code text,
  voice_note_url text,
  daily_summary text,
  created_at timestamptz default now()
);

-- daily_learning: AI 生成的每日知识与题目
create table if not exists public.daily_learning (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  knowledge_body text,
  question_text text,
  answer text,
  source_note_ids text[],
  created_at timestamptz default now()
);

-- mistakes: 错题本（含语音反思）
create table if not exists public.mistakes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  subject text,
  tags text[],
  image_urls text[],
  voice_note_url text,
  created_at timestamptz default now()
);

-- obsidian_metadata: 笔记缓存与版本快照
create table if not exists public.obsidian_metadata (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  file_path text not null,
  content_hash text,
  version_history jsonb default '[]'::jsonb,
  tags text[] not null default '{}', -- 层级标签（#数学/微积分/导数 + frontmatter tags），sync 时提取
  updated_at timestamptz default now(),
  unique (user_id, file_path)
);

-- knowledge_embeddings: 笔记向量（支撑语义检索）
create table if not exists public.knowledge_embeddings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  note_id uuid references public.obsidian_metadata (id) on delete cascade,
  embedding vector(1536),
  created_at timestamptz default now()
);

-- knowledge_compilations: 编译任务记录
create table if not exists public.knowledge_compilations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  compiled_type text not null check (compiled_type in ('pdf', 'anki', 'outline')),
  download_url text,
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'failed')),
  created_at timestamptz default now()
);

-- reminders: 自定义日期提醒
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  date date not null,
  content text not null,
  is_expired boolean default false,
  created_at timestamptz default now()
);

-- ============================================================
-- 索引
-- ============================================================
create index if not exists idx_tasks_user_status on public.tasks (user_id, status);
create index if not exists idx_knowledge_embeddings_user on public.knowledge_embeddings (user_id);
create index if not exists idx_obsidian_metadata_user_path on public.obsidian_metadata (user_id, file_path);
-- 标签树聚合/重写走 tags 数组过滤，GIN 加速
create index if not exists idx_obsidian_metadata_tags on public.obsidian_metadata using gin (tags);
-- 周复盘 / 同步 / 资源池都按 user_id 过滤排序，缺索引会全表扫描
create index if not exists idx_timer_sessions_user_started on public.timer_sessions (user_id, started_at desc);
create index if not exists idx_mistakes_user_created on public.mistakes (user_id, created_at desc);
create index if not exists idx_reminders_user_date on public.reminders (user_id, date);
create index if not exists idx_knowledge_compilations_user on public.knowledge_compilations (user_id, created_at desc);

-- ============================================================
-- 行级安全策略（RLS）— 云端数据安全的唯一命门
-- 原则：所有表强制 user_id = auth.uid()
-- ============================================================
alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.timer_sessions enable row level security;
alter table public.mood_checkins enable row level security;
alter table public.daily_learning enable row level security;
alter table public.mistakes enable row level security;
alter table public.obsidian_metadata enable row level security;
alter table public.knowledge_embeddings enable row level security;
alter table public.knowledge_compilations enable row level security;
alter table public.reminders enable row level security;

-- 通用策略：仅本人可读写（表结构一致，批量定义）
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles','tasks','timer_sessions','mood_checkins','daily_learning',
    'mistakes','obsidian_metadata','knowledge_embeddings','knowledge_compilations','reminders'
  ]
  loop
    execute format('drop policy if exists %I on public.%I;', t || '_select_self', t);
    execute format('create policy %I on public.%I for select using (auth.uid() = user_id);', t || '_select_self', t);
    execute format('drop policy if exists %I on public.%I;', t || '_write_self', t);
    execute format('create policy %I on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id);', t || '_write_self', t);
  end loop;
end $$;

-- ============================================================
-- 触发器：profiles 随 auth.users 自动创建
-- （正文在文末「Supabase Auth 登录」段落：handle_new_user + ensure_access_key，
--   此处旧版无 access_key 的定义已并入该处，避免 create or replace 双定义）
-- ============================================================

-- ============================================================
-- 语义检索：向量匹配函数 + 索引
-- service_role 调用（绕过 RLS），security definer 内显式过滤 owner
-- ============================================================
create or replace function public.match_notes(
  query_embedding vector(1536),
  owner uuid,
  match_count int default 5
)
returns table (note_id uuid, file_path text, similarity float)
language sql stable
security definer set search_path = public
as $$
  select e.note_id, m.file_path, 1 - (e.embedding <=> query_embedding) as similarity
  from public.knowledge_embeddings e
  join public.obsidian_metadata m on m.id = e.note_id
  where e.user_id = owner
    and e.note_id is not null
  order by e.embedding <=> query_embedding
  limit match_count;
$$;

create index if not exists idx_knowledge_embeddings_vec
  on public.knowledge_embeddings using hnsw (embedding vector_cosine_ops);

-- sync 流程按 note_id 逐文件清理旧向量，补索引避免顺序扫描
create index if not exists idx_knowledge_embeddings_note
  on public.knowledge_embeddings (note_id);

-- 纵深防御：security definer 函数默认授予 PUBLIC EXECUTE，
-- 匿名/普通用户不应调用（web 端经 service_role 调用，显式授权不受影响）
revoke execute on function public.match_notes(vector(1536), uuid, int) from anon, public;
grant execute on function public.match_notes(vector(1536), uuid, int) to service_role;

-- ============================================================
-- 设备访问密钥：移动端免登录读取每日备课内容
-- 密钥由用户在 Supabase SQL 编辑器设置，移动端「我的」填同一密钥：
--   update profiles set access_key = '你的随机密钥' where user_id = '...';
-- ============================================================
alter table public.profiles add column if not exists access_key text;

-- security definer：函数内部显式校验 access_key，不放宽 RLS
create or replace function public.get_daily_by_key(
  access_key text,
  target_date date default (now() at time zone 'Asia/Shanghai')::date
)
returns table (date date, knowledge_body text, question_text text, answer text)
language sql stable
security definer set search_path = public
as $$
  select d.date, d.knowledge_body, d.question_text, d.answer
  from public.daily_learning d
  join public.profiles p on p.user_id = d.user_id
  where p.access_key = get_daily_by_key.access_key
    and d.date = target_date
  -- 无 order by 时返回哪一行不确定；重复行（cron 重投）会导致拿到旧内容
  order by d.created_at desc
  limit 1;
$$;

-- 幂等唯一约束：cron 用「先 select 再 insert」做幂等，Vercel 重投/并发重试会写进同一 date 的多行，
-- 必须有 DB 层兜底（配合 /api/cron/daily 的 upsert）
create unique index if not exists idx_daily_learning_user_date_uni on public.daily_learning (user_id, date);

-- ============================================================
-- 错题本存储桶：图片压缩 + 语音反思
-- 写入仅经管理台 /api/mistakes（service role + x-access-key 鉴权），桶本身不开放匿名写
-- ============================================================
alter table public.mistakes add column if not exists is_mastered boolean; -- 重做结果：true=已掌握 false=仍错 null=未重做

insert into storage.buckets (id, name, public)
values ('mistakes', 'mistakes', true)
on conflict (id) do nothing;

-- compilations 桶：L4 exportNote / 管理台编译产物（大纲/HTML/Anki 包），公开读（下载链接）
insert into storage.buckets (id, name, public)
values ('compilations', 'compilations', true)
on conflict (id) do nothing;

-- mood 桶：情绪打卡语音备忘（公开读）
insert into storage.buckets (id, name, public)
values ('mood', 'mood', true)
on conflict (id) do nothing;

-- mood_checkins 补日期列 + 一人一天一条（同日重打覆盖）
alter table public.mood_checkins add column if not exists date date;
create unique index if not exists idx_mood_checkins_user_date on public.mood_checkins (user_id, date);

-- mistakes 补转写/摘要列：多端同步时语音转写与 AI 识别摘要可回填云端
alter table public.mistakes add column if not exists transcript text;
alter table public.mistakes add column if not exists summary text;

-- weekly_reviews：每周画像复盘 + 资讯检索产物（周 Cron 写入，移动端 RPC 读取）
create table if not exists public.weekly_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  week_start date not null,
  content jsonb not null, -- {summary, risks[], focusAdvice[], syllabusAlert, news[{title,url}]}
  created_at timestamptz not null default now(),
  unique (user_id, week_start)
);
alter table public.weekly_reviews enable row level security;
-- 全文其余 DDL 都可重跑，唯独这里原本裸 create policy：
-- 在已有库上再跑一次 schema.sql 会报 policy already exists 并中断后续函数创建
drop policy if exists "owners manage own weekly reviews" on public.weekly_reviews;
create policy "owners manage own weekly reviews" on public.weekly_reviews
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- 移动端免登录读取最近一次复盘（security definer 内部显式校验 access_key，不放宽 RLS）
create or replace function public.get_weekly_by_key(p_access_key text)
returns table (week_start date, content jsonb)
language sql
security definer
set search_path = public
as $$
  select wr.week_start, wr.content
  from public.weekly_reviews wr
  join public.profiles pr on pr.user_id = wr.user_id
  where pr.access_key = p_access_key
  order by wr.week_start desc
  limit 1
$$;
grant execute on function public.get_weekly_by_key(text) to anon, authenticated;

-- ============================================================
-- Supabase Auth 登录（多设备一致）
-- 登录 = 身份引导层：注册自动建档并生成 access_key，多设备登录同一账号
-- → 同一 access_key → 既有全部同步链路（tasks/timer/mistakes/mood/daily/weekly）自动收敛
-- ============================================================
create extension if not exists pgcrypto;

-- 新用户注册自动建档 + 生成 access_key（旧版手动 update profiles 的方式保留可用）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id, access_key)
  values (new.id, encode(gen_random_bytes(16), 'hex'))
  on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 登录后调用：确保 profiles 行存在且 access_key 非空（兼容 Auth 上线前的手工建档用户），返回 access_key
create or replace function public.ensure_access_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  k text;
begin
  if auth.uid() is null then
    return null;
  end if;
  insert into public.profiles (user_id, access_key)
  values (auth.uid(), encode(gen_random_bytes(16), 'hex'))
  on conflict (user_id) do nothing;
  select access_key into k from public.profiles where user_id = auth.uid();
  if k is null then
    update public.profiles
    set access_key = encode(gen_random_bytes(16), 'hex'), updated_at = now()
    where user_id = auth.uid()
    returning access_key into k;
  end if;
  return k;
end;
$$;
grant execute on function public.ensure_access_key() to authenticated;

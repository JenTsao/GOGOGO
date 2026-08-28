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
create index if not exists idx_daily_learning_user_date on public.daily_learning (user_id, date);
create index if not exists idx_knowledge_embeddings_user on public.knowledge_embeddings (user_id);
create index if not exists idx_obsidian_metadata_user_path on public.obsidian_metadata (user_id, file_path);

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
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

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
  limit 1;
$$;

-- ============================================================
-- 错题本存储桶：图片压缩 + 语音反思
-- 写入仅经管理台 /api/mistakes（service role + x-access-key 鉴权），桶本身不开放匿名写
-- ============================================================
insert into storage.buckets (id, name, public)
values ('mistakes', 'mistakes', true)
on conflict (id) do nothing;

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

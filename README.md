# 高考副驾驶 · Gaokao Co-pilot

基于《高考工作台 · 终极功能蓝皮书》初始化的 Monorepo 项目框架。

核心哲学：**本地瞬时响应 + 云端永不关机 + 知识资产专业化治理**。

## 架构总览

| 层级 | 技术选型 | 目录 |
| :--- | :--- | :--- |
| 移动端 | Expo (React Native) + TypeScript | `apps/mobile` |
| 管理台 | Next.js 14 (App Router) + TypeScript | `apps/web` |
| 云端数据库 | Supabase (PostgreSQL) + pgvector | `supabase/` |
| 状态管理 | Zustand (移动端) + Server Actions (管理台) | — |
| 本地缓存 | MMKV | `apps/mobile/src/store` |

## 目录结构

```
.
├── apps/
│   ├── mobile/            # Expo 移动端：4 Tab + AI 悬浮球
│   │   └── src/
│   │       ├── app/       # 驾驶舱 / 弹药库 / 仪表盘 / 我的
│   │       ├── components/ # AiOrb 磨砂玻璃悬浮球
│   │       └── store/     # taskStore / aiStore / focusStore (Zustand)
│   └── web/               # Next.js 管理台：知识工坊 / 语义检索 / 编译输出
│       └── src/app/
├── supabase/
│   ├── schema.sql         # 10 张核心表 + pgvector + RLS 策略
│   └── config.toml
├── package.json           # pnpm workspace 根
└── pnpm-workspace.yaml
```

## 快速开始

```bash
# 1. 安装依赖
pnpm install

# 2. 配置环境变量
cp apps/web/.env.example apps/web/.env.local
# 填入 Supabase URL / Anon Key 及各类 API Key

# 3. 初始化数据库（在 Supabase SQL Editor 执行 supabase/schema.sql，
#    或本地 supabase start && supabase db reset）

# 4. 启动管理台
pnpm dev:web

# 5. 启动移动端（需 Expo 环境）
pnpm dev:mobile
```

## 数据库 Schema

`supabase/schema.sql` 包含蓝皮书第五章定义的 10 张核心表：
`profiles`、`tasks`、`timer_sessions`、`mood_checkins`、`daily_learning`、
`mistakes`、`obsidian_metadata`、`knowledge_embeddings`(vector 1536)、
`knowledge_compilations`、`reminders`。

已启用 `vector` 扩展并为所有表配置 RLS 行级安全策略（`user_id = auth.uid()`），
这是云端数据安全的唯一命门，切勿关闭。

## 开发阶段（Roadmap）

- **Phase 1（基础闭环）**：Monorepo + Supabase 配置；4 Tab 空壳；驾驶舱倒计时/天气/三件事；基础计时器；管理台只读知识工坊。
- **Phase 2（智能核心）**：Pyodide + Obsidian 下载渲染；AI 悬浮球接入 DeepSeek；凌晨备课流水线；语义检索中心（pgvector）。
- **Phase 3（专业化与后台）**：L4 跨模块调度；PDF/Anki 编译；激进画像系统；后台唤醒（expo-background-fetch）。

> 当前框架已完成：Monorepo 骨架、Supabase Schema、移动端 4 Tab + AI 悬浮球 + 状态管理占位、管理台 3 大菜单骨架。各业务模块已标注 `TODO` 待对应阶段填充。

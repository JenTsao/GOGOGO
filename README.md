# 高考副驾驶 · Gaokao Co-pilot

基于《高考工作台 · 终极功能蓝皮书》实现的高考备考一站式系统。

核心哲学：**本地瞬时响应 + 云端永不关机 + 知识资产专业化治理**。

> AI 编码代理请先阅读 [AGENTS.md](./AGENTS.md)（目录结构、硬性约束、LLM 适配层约定）。

## 功能全景

### 手机端（Expo，4 Tab + AI 悬浮球）

- **🚗 驾驶舱**：2026 高考倒计时（点击切换天/时分）；自动定位天气（expo-location 坐标优先、备用城市兜底）；每日提醒横幅；每日知识点翻转卡 + 每日一题（凌晨备课流水线云端生成，离线缓存兜底）；今日三件事 + 后备箱交换；全屏心流计时器
- **🧰 弹药库**（三个子 Tab）：
  - **代码沙盒**：WebView 内 Monaco + Pyodide 本地跑 Python，5 秒无响应熔断，片段 MMKV 保存
  - **知识库**：GitHub 目录树按需下载，Markdown 渲染，`[[双链]]` 三级解析库内跳转，LaTeX 轻量化，离线缓存
  - **错题本**：拍照/相册 → 压缩入库 → **AI 识别题面**（自动填学科/卡壳标签/摘要）→ 语音反思 → 语音转文字 → 云同步（Supabase Storage）→ 重做结果标记
- **📊 仪表盘**：六维雷达（专注投入/深度/坚持天数/任务执行/知识积累/学科掌握）；近 7 天专注柱状；心流热力；完成率折线；危险学科 + 卡壳词云 + 情绪信号；Tavily 横向对标（目标大学分数线）
- **⚙️ 我的**：多供应商 LLM 配置（DeepSeek/OpenAI/Kimi/GLM/自定义 BYOK）；视觉模型（GLM-4.6V-Flash）；语音转写（whisper）；Tavily / 天气 / 云端 / 管理台代理配置；提醒日历
- **🤖 AI 悬浮球**：L1-L3 对话 + L4 六大工具调度（addTask/setReminder 写操作确认卡片；searchWeb/queryStats/correctCode 直读直返）；错题图片视觉讲解（GLM-4.6V-Flash 读图：识别题面、指出作答错误）

### 管理台（Next.js，Vercel）

- **知识工坊**：GitHub 文件树（勾选多选）+ Monaco 编辑器：保存回写 GitHub（Ctrl/Cmd+S）、拖拽传图自动压缩 WebP、版本快照回滚、AI 精炼工具栏（🤖 合并精炼 / 🧠 Mermaid 知识图谱）
- **语义检索中心**：关键词 `ilike` + pgvector 向量混合检索（HNSW），内容哈希增量向量化；层级标签树（`#数学/微积分` 行内标签/frontmatter 提取，重命名/合并/删除/批量关联）
- **编译与输出**：资源池（笔记 + 错题）→ 纯文本大纲 / **真 .apkg**（sql.js 构建，Anki 双击导入，失败自动降级 TSV）/ 复习 PDF（A4 打印视图，错题照片内嵌），历史最近 10 次

### 云端（Supabase + Vercel Cron）

- **凌晨备课流水线**（每日 04:00 北京时间）：采集昨日任务/错题/提醒 → LLM 生成每日知识点 + 每日一题 → 写 `daily_learning`（幂等）
- 10 张核心表 + RLS（`user_id = auth.uid()`）+ `mistakes` 存储桶；移动端经 `get_daily_by_key` RPC / 管理台代理路由（`x-access-key`）免登录读写
- **后台唤醒**（expo-background-fetch）：当日提醒本地通知（去重）+ 每日备课内容预取

## 目录结构

```
apps/
  mobile/                  # Expo (RN 0.74 + TS)
    src/app/               # index 驾驶舱 / arsenal 弹药库 / dashboard 仪表盘 / profile 我的
    src/components/        # AiOrb（grok-ball 表情球）/ CodeSandbox / KnowledgeView / MistakeView
    src/lib/               # llm 多供应商 / stt 语音转写 / aiTools L4 / cloud / background
    src/store/             # zustand × 8（MMKV 持久化）：task/focus/settings/ai/sandbox/knowledge/reminder/mistake
    assets/grok-ball/      # AI 球资产（HTML 内联引擎）
  web/                     # Next.js 14 (App Router)
    src/app/workshop/      # 知识工坊
    src/app/search/        # 语义检索中心
    src/app/compile/       # 编译与输出
    src/app/api/           # github 代理 / cron/daily 备课 / knowledge sync / search / mistakes
    src/lib/               # llm（供应商注册表加一行即扩）/ supabaseAdmin / access / github
supabase/schema.sql        # 10 张表 + pgvector + match_notes + mistakes 桶 + RLS
.github/workflows/ci.yml   # 安装/类型检查/构建全部在 GitHub Actions（本地零安装）
vercel.json                # Cron：每日备课 04:00 + 每周复盘周一 04:30（北京时间）
```

## 快速开始

```bash
# 1. 安装依赖（或依赖 CI：推送后自动安装验证）
pnpm install

# 2. 管理台环境变量
cp apps/web/.env.example apps/web/.env.local
# Supabase URL/AnonKey、GITHUB_REPO/TOKEN、LLM_PROVIDER+Key、EMBEDDING_*、CRON_SECRET、OWNER_USER_ID

# 3. 初始化数据库：Supabase SQL Editor 执行 supabase/schema.sql（含 mistakes 桶与 access_key 列）

# 4. 启动
pnpm dev:web      # 管理台
pnpm dev:mobile   # 手机端（Expo Go）

# 5. Vercel 部署后配置 Cron：环境变量 CRON_SECRET，定时器自动生效
```

移动端配置（「我的」Tab）：LLM Key（对话/工具）→ 视觉 Key（错题识别/讲解，智谱）→ 转写 Key（语音转文字，Groq 免费 `whisper-large-v3`）→ Supabase URL/AnonKey/访问密钥（`update profiles set access_key='...'`）→ 管理台地址（错题云同步）。

## Roadmap 完成状态

- ✅ **Phase 1 基础闭环**：Monorepo + Schema + CI；4 Tab；驾驶舱倒计时/定位天气/三件事；心流计时器；知识工坊文件树 + 只读编辑器
- ✅ **Phase 2 智能核心**：Pyodide 沙盒 + 知识库渲染 + 双链跳转；AI 悬浮球 L1-L3（多供应商）；凌晨备课流水线；语义检索中心（pgvector 混合检索）
- ✅ **Phase 3 专业化与后台**：L4 六大工具 + 确认卡片；编译输出；六维画像 + Tavily 横向对标；后台唤醒 + 本地提醒通知
- ✅ **Phase 4 错题本**：拍照/压缩/标签/语音反思入库；云同步代理；AI 识别题面 + 读图讲解 + 语音转文字；画像危险学科/卡壳词云/情绪信号全闭环
- ✅ **管理台完整版**：知识工坊可编辑保存 + WebP 传图 + 版本回滚 + AI 精炼/知识图谱；层级标签树管理；真 .apkg + 错题图片进 PDF/Anki

## TODO（对照蓝皮书未完成项）

**移动端**
- [ ] 心流模式强制屏蔽通知（Android DND / iOS Focus 权限，现仅全屏遮罩）
- [ ] `correctCode` 工具当前读沙盒最近保存片段，可升级为读取编辑器实时内容

**云端同步**
- [x] tasks（并集合并 + 墓碑删除）/ timer_sessions（append-only 并集）双向同步，驾驶舱启动静默触发
- [x] mistakes 双向同步：推 → 拉（差集下载离线可用）→ 转写/摘要/重做结果回填

**定时任务（蓝皮书 7 管道已完成 3）**
- [x] `/api/cron/daily` 每日 04:00 备课流水线
- [x] `/api/cron/weekly` 每周一 04:30：周数据聚合 + Tavily 双检索（考纲变动/资讯）→ LLM 教练复盘 → `weekly_reviews` → 画像详情弹窗展示
- [ ] 其余管道（如定时同步 Obsidian 增量向量化 Cron，现手动触发）

**其他**
- [x] 横向对标数值化：目标总分 vs 检索分数线（启发式提取，省份/批次需人工核对）
- [x] APK 构建：`.github/workflows/build-apk.yml`（手动 dispatch 或 `v*` tag 触发，debug 签名可侧载）
- [ ] Supabase Auth 正式登录（多设备一致，替代设备访问密钥方案）

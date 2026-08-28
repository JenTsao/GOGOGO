# 高考副驾驶 · Gaokao Co-pilot

基于《高考工作台 · 终极功能蓝皮书》实现的高考备考一站式系统。

核心哲学：**本地瞬时响应 + 云端永不关机 + 知识资产专业化治理**。

> AI 编码代理请先阅读 [AGENTS.md](./AGENTS.md)（目录结构、硬性约束、LLM 适配层约定）。

## 功能全景

### 手机端（Expo，4 Tab + AI 悬浮球）

- **🚗 驾驶舱**：2026 高考倒计时（点击切换天/时分）；自动定位天气（expo-location 坐标优先、备用城市兜底）；每日提醒横幅；每日知识点翻转卡 + 每日一题（凌晨备课流水线云端生成，离线缓存兜底）；今日三件事 + 后备箱交换；全屏心流计时器（App 内通知静默 + 系统免打扰深链）
- **🧰 弹药库**（三个子 Tab）：
  - **代码沙盒**：WebView 内 Monaco + Pyodide 本地跑 Python，5 秒无响应熔断，片段 MMKV 保存，编辑器内容实时供 AI 工具读取
  - **知识库**：GitHub 目录树按需下载，Markdown 渲染，`[[双链]]` 三级解析库内跳转，LaTeX 轻量化，离线缓存
  - **错题本**：拍照/相册 → 压缩入库 → **AI 识别题面**（自动填学科/卡壳标签/摘要）→ 语音反思 → 语音转文字 → 云同步 → 重做结果标记 → AI 读图讲解
- **📊 仪表盘**：情绪打卡（5 档 emoji + 备注 + 语音备忘转文字）；六维雷达（专注投入/深度/坚持天数/任务执行/知识积累/学科掌握）；近 7 天专注柱状；心流热力；完成率折线；危险学科 + 卡壳词云 + 情绪信号；**横向对标数值化**（目标总分 vs 检索分数线，差距 ≥20 分联动危险学科给专项建议）；每周复盘（考纲警示 + 教练建议 + 资讯）
- **⚙️ 我的**：Supabase Auth 登录/注册（多设备一致）；多供应商 LLM 配置（DeepSeek/OpenAI/Kimi/GLM/自定义 BYOK）；视觉模型（GLM-4.6V-Flash）；语音转写（whisper）；Tavily / 天气 / 云端 / 管理台代理配置；目标大学 + 目标总分；提醒日历（红点标记）
- **🤖 AI 悬浮球**：L1-L3 对话 + L4 六大工具调度（addTask/setReminder 写操作确认卡片；searchWeb/queryStats/correctCode 实时读编辑器代码/exportNote 接通编译管线 返回下载链接）；错题图片视觉讲解（GLM-4.6V-Flash 读图）

### 管理台（Next.js，Vercel）

- **知识工坊**：GitHub 文件树（勾选多选）+ Monaco 编辑器：保存回写 GitHub（Ctrl/Cmd+S）、拖拽传图自动压缩 WebP、版本快照回滚、AI 精炼工具栏（🤖 合并精炼 / 🧠 Mermaid 知识图谱）
- **语义检索中心**：关键词 `ilike` + pgvector 向量混合检索（HNSW），内容哈希增量向量化；层级标签树（`#数学/微积分` 行内标签/frontmatter 提取，重命名/合并/删除/批量关联）
- **编译与输出**：资源池（笔记 + 错题）→ 纯文本大纲 / **真 .apkg**（sql.js 构建，Anki 双击导入，失败自动降级 TSV）/ 复习 PDF（A4 打印视图，错题照片内嵌），历史最近 10 次

### 云端（Supabase + Vercel Cron）

- **凌晨备课流水线**（每日 04:00）：采集昨日任务/错题/提醒 → LLM 生成每日知识点 + 每日一题 → 写 `daily_learning`（幂等）
- **Obsidian 向量化**（每日 04:10）：笔记哈希增量 → 分块 → embedding 1536 → pgvector（每轮 30 篇自动收敛全量）
- **周复盘**（每周一 04:30）：近 7 天全量数据 + Tavily 双检索（考纲变动/资讯）→ LLM 教练复盘 → `weekly_reviews` → 手机画像详情展示
- **11 张核心表** + RLS（`user_id = auth.uid()`）+ mistakes/mood/compilations 存储桶
- **云同步**：tasks（并集合并 + 墓碑删除）/ timer_sessions（append-only 并集）/ mistakes（推→拉→回填）/ mood（同日覆盖 upsert），驾驶舱启动静默触发，离线本地优先
- **Supabase Auth**：邮箱密码登录，注册触发器自动建档并生成 access_key，登录自动回填——多设备登录同一账号即数据收敛
- **后台唤醒**（expo-background-fetch）：当日提醒本地通知（去重）+ 每日备课内容预取

## 目录结构

```
apps/
  mobile/                  # Expo (RN 0.74 + TS)
    src/app/               # index 驾驶舱 / arsenal 弹药库 / dashboard 仪表盘 / profile 我的
    src/components/        # AiOrb（grok-ball 表情球）/ CodeSandbox / KnowledgeView / MistakeView / MoodCheckin
    src/lib/               # llm 多供应商 / stt 语音转写 / aiTools L4 / cloud / background / supabase（MMKV 会话）
    src/store/             # zustand × 10（MMKV 持久化）：task/focus/settings/ai/sandbox/knowledge/reminder/mistake/mood/auth
    assets/                # grok-ball AI 球资产 + sandbox（Monaco+Pyodide HTML）
  web/                     # Next.js 14 (App Router)
    src/app/workshop/      # 知识工坊（编辑/传图/版本/精炼）
    src/app/search/        # 语义检索中心（混合检索 + 标签树）
    src/app/compile/       # 编译与输出（大纲/.apkg/PDF）
    src/app/api/           # github 代理（tree/raw/save/image/versions）/ workshop/refine / tags
                           # compile/apkg / export / cron（daily/weekly/knowledge）
                           # knowledge sync / search / mistakes / mood / tasks sync / timer sync
    src/lib/               # llm（供应商注册表加一行即扩）/ apkg / knowledgeSync / supabaseAdmin / access / github
supabase/schema.sql        # 11 张表 + pgvector + RPC + Auth 触发器 + 存储桶 + RLS
.github/workflows/ci.yml   # 安装/类型检查/构建全部在 GitHub Actions（本地零安装）
.github/workflows/build-apk.yml  # APK 打包（dispatch 或 v* tag 触发）
vercel.json                # Cron：04:00 备课 / 04:10 向量化 / 周一 04:30 复盘（北京时间）
```

## 快速开始

```bash
# 1. 安装依赖（或依赖 CI：推送后自动安装验证）
pnpm install

# 2. 管理台环境变量
cp apps/web/.env.example apps/web/.env.local
# Supabase URL/AnonKey、GITHUB_REPO/TOKEN、LLM_PROVIDER+Key、EMBEDDING_*、TAVILY_API_KEY、CRON_SECRET、OWNER_USER_ID

# 3. 初始化数据库：Supabase SQL Editor 执行 supabase/schema.sql
#    （11 张表 + 桶 + Auth 触发器 + ensure_access_key，改动后重跑幂等）

# 4. 启动
pnpm dev:web      # 管理台
pnpm dev:mobile   # 手机端（Expo Go）

# 5. Vercel 部署：环境变量配好后 Cron 自动生效；APK 用 GitHub Actions 构建
```

移动端配置（「我的」Tab，按顺序）：
1. **Supabase URL + Anon Key** → 注册/登录 → 访问密钥自动回填
2. **LLM Key**（对话/L4 工具，DeepSeek 等）→ **视觉 Key**（错题识别/讲解，智谱 GLM-4.6V-Flash）→ **转写 Key**（语音转文字，推荐 Groq `whisper-large-v3` 免费）
3. **Tavily Key**（对标/资讯）→ 天气自动定位无需 Key（备用城市可填）
4. **管理台地址**（错题/情绪/任务云同步代理）

## Roadmap 完成状态

蓝皮书 Phase 1-4 全部完成，超出原计划的增强：

- ✅ **Phase 1 基础闭环**：Monorepo + Schema + CI；4 Tab；驾驶舱倒计时/定位天气/三件事；心流计时器；知识工坊文件树 + 只读编辑器
- ✅ **Phase 2 智能核心**：Pyodide 沙盒 + 知识库渲染 + 双链跳转；AI 悬浮球 L1-L3（多供应商）；凌晨备课流水线；语义检索中心
- ✅ **Phase 3 专业化与后台**：L4 六大工具 + 确认卡片；编译输出；六维画像 + 横向对标；后台唤醒
- ✅ **Phase 4 错题本**：AI 识别题面 + 读图讲解 + 语音转文字；重做结果喂雷达；情绪打卡全闭环
- ✅ **Phase 5 出厂增强**：知识工坊可编辑/传图/版本回滚/AI 精炼；标签树管理；真 .apkg；错题/情绪/任务/专注全量云同步；周复盘 Cron；对标数值化；DND 心流静默；Supabase Auth 多设备一致

## TODO（锦上添花级）

- [ ] 错题正确率按科目细分进雷达（现为整体掌握维度）
- [ ] 错题间隔重复（SRS）提醒
- [ ] 每周复盘推送为本地通知
- [ ] 数据导出全量备份（JSON）

## 技术取舍（诚实记录）

- **Anki 产物**：真 .apkg（sql.js 构建 SQLite，内容哈希 guid 去重）；服务端构建失败自动降级为 TSV 导入格式
- **PDF**：浏览器打印视图（A4 排版）而非服务端直出——嵌入中文字体需数 MB 字体文件，不值得
- **多设备任务合并**：并集 + 墓碑，无版本向量——A 端删除后 B 端未拉取又推送会复活（单用户可接受）
- **对标分数线**：启发式数值提取（480-700 可信区间），省份/批次差异需人工核对来源
- **DND**：App 自身通知可真静默；其他 App 通知只能深链引导用户开系统免打扰（Android 沙箱限制）
- **后台唤醒**：Expo Go 不支持 background fetch，需 build-apk.yml 构建版

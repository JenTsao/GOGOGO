# 高考副驾驶 · Gaokao Co-pilot

基于《高考工作台 · 终极功能蓝皮书》实现的高考备考一站式系统。

核心哲学：**本地瞬时响应 + 云端永不关机 + 知识资产专业化治理**。

> AI 编码代理请先阅读 [AGENTS.md](./AGENTS.md)（目录结构、硬性约束、LLM 适配层约定）。

## 功能全景

### 手机端（Expo，4 Tab + AI 悬浮球）

- **🚗 驾驶舱**：2026 高考倒计时（点击切换天/时分）；自动定位天气（expo-location 坐标优先、备用城市兜底）；每日提醒横幅；每日知识点翻转卡 + 每日一题（凌晨备课流水线云端生成，离线缓存兜底）；今日三件事 + 后备箱交换；全屏心流计时器（App 内通知静默 + 系统免打扰深链）
- **🧰 弹药库**（三个子 Tab）：
  - **代码沙盒**：WebView 内 Monaco + Pyodide 本地跑 Python，5 秒无响应熔断，片段 MMKV 保存，编辑器内容实时供 AI 工具读取
  - **知识库**：GitHub 目录树按需下载，Markdown 渲染（Obsidian 语法：callout 类型图标 / `==高亮==` / `#标签` / 脚注 / `%%注释%%` 剔除 / `![[嵌入]]` 降级），`[[双链]]` 三级解析库内跳转，LaTeX 轻量化（四种分隔符），代码高亮（仅登记语言），离线缓存
  - **错题本**：拍照/相册 → 压缩入库 → **AI 识别题面**（自动填学科/卡壳标签/摘要）→ 语音反思 → 语音转文字 → 云同步 → 重做结果标记 → AI 读图讲解
- **📊 仪表盘**：情绪打卡（5 档 emoji + 备注 + 语音备忘转文字）；能力雷达（5 项固定：专注投入/深度/坚持天数/任务执行/知识积累 + **按科目细分的学科掌握轴**，有重做记录的科目各占一轴、最多 5 轴，附正确率明细 chip）；近 7 天专注柱状；心流热力；完成率折线；危险学科 + 卡壳词云 + 情绪信号；**横向对标数值化**（目标总分 vs 检索分数线，差距 ≥20 分联动危险学科给专项建议）；每周复盘（考纲警示 + 教练建议 + 资讯）
- **⚙️ 我的**：Supabase Auth 登录/注册（多设备一致）；多供应商 LLM 配置（DeepSeek/OpenAI/Kimi/GLM/自定义 BYOK）；视觉模型（GLM-4.6V-Flash）；语音转写（whisper）；Tavily / 天气 / 云端 / 管理台代理配置；目标大学 + 目标总分；提醒日历（红点标记）
- **🤖 AI 悬浮球**：L1-L3 对话 + L4 六大工具调度（三级审批工作流：工具按风险分级，结合审批策略 auto/suggest/ask 决策是否弹确认卡片，决策与执行全程审计留痕）；错题图片视觉讲解（GLM-4.6V-Flash 读图）

### 管理台（Next.js，Vercel）

- **知识工坊**：GitHub 文件树（勾选多选）+ Monaco 编辑器：保存回写 GitHub（Ctrl/Cmd+S）、拖拽传图自动压缩 WebP、版本快照回滚、AI 精炼工具栏（🤖 合并精炼 / 🧠 Mermaid 知识图谱）
- **知识库**：对标 Obsidian 的只读阅读区——目录树 + Obsidian 全语法渲染阅读（大纲锚点 / callout 着色 / frontmatter 标签与别名 / 字数·阅读时长）；`[[双链]]` **三级解析**库内跳转（全路径 → 文件名 → 别名，断链置灰标注）；**全库力导向图谱**（`[[双链]]` 关系索引 + 零依赖 SVG 物理布局，滚轮缩放 / 拖拽平移 / 点击跳转，顶层目录着色）；反链/出链面板（未解析出链 ❓ 标注）+ 全局未解析双链汇总 + **Ctrl+K 快速切换器** + 书签与最近阅读（localStorage）
- **AI 工具区**：可插拔工具框架——注册表加一条定义即上新工具（页面卡片/执行面板/API 全自动生效）；预置 7 个高考工具（笔记润色 / 考点提炼 / 智能出题（题型×难度）/ 概念讲解 / 解题诊断 / 复习计划 / 记忆加工），结果 Markdown 渲染 + 复制/下载 + 本机历史回看
- **每日猜题**：知识库考点锚 + 外部时文 → LLM 命题的产物阅读页（材料来源溯源、答案折叠、审题立意指导），可手动触发/重新生成
- **语义检索中心**：关键词 `ilike` + pgvector 向量混合检索（HNSW），内容哈希增量向量化；层级标签树（`#数学/微积分` 行内标签/frontmatter 提取，重命名/合并/删除/批量关联）
- **编译与输出**：资源池（笔记 + 错题）→ 纯文本大纲 / **真 .apkg**（sql.js 构建，Anki 双击导入，失败自动降级 TSV）/ 复习 PDF（A4 打印视图：自动目录 + 标题锚点 + 公式/代码高亮 + callout 着色 + 打印断页优化，错题照片内嵌），历史最近 10 次

### 云端（Supabase + Vercel Cron）

- **凌晨备课流水线**（每日 04:00）：采集昨日任务/错题/提醒 → LLM 生成每日知识点 + 每日一题 → 写 `daily_learning`（幂等）
- **Obsidian 向量化**（每日 04:10）：笔记哈希增量 → 分块 → embedding 1536 → pgvector（每轮 30 篇自动收敛全量）
- **每日猜题流水线**（每日 04:20）：按科目执行——Tavily 全文检索时文素材（语文取人民日报等时评出论述类阅读+作文猜测；英语取新闻语料出阅读理解+语法填空）→ 知识库笔记按科目关键词随机 3 篇作考点锚（每天自然轮换）→ 提示词预算装配（材料不可截断、锚点按剩余空间注入）→ LLM 严格 JSON 命题 → 写 `daily_questions`（按科目幂等，单科目失败不拖垮其他）。未配 Tavily 自动降级 AI 自拟材料（来源标注「AI 生成」）；移动端经 `get_questions_by_key` RPC 免登录读取
- **周复盘**（每周一 04:30）：近 7 天全量数据 + Tavily 双检索（考纲变动/资讯）→ LLM 教练复盘 → `weekly_reviews` → 手机画像详情展示
- **12 张核心表** + RLS（`user_id = auth.uid()`）+ mistakes/mood/compilations 存储桶
- **云同步**：tasks（并集合并 + 墓碑删除）/ timer_sessions（append-only 并集）/ mistakes（推→拉→回填）/ mood（同日覆盖 upsert），驾驶舱启动静默触发，离线本地优先
- **Supabase Auth**：邮箱密码登录，注册触发器自动建档并生成 access_key，登录自动回填——多设备登录同一账号即数据收敛
- **后台唤醒**（expo-background-fetch）：当日提醒本地通知（去重）+ 每日备课内容预取

## 目录结构

```
apps/
  mobile/                  # Expo (RN 0.74 + TS)
    src/app/               # index 驾驶舱 / arsenal 弹药库 / dashboard 仪表盘 / profile 我的
    src/components/        # AiOrb（grok-ball 表情球）/ CodeSandbox / KnowledgeView / MistakeView / MoodCheckin
    src/lib/               # llm 多供应商 / stt 语音转写 / aiTools L4 / agentPolicy 工具审批内核（风险分级+审批策略+审计）/ cloud / background / supabase（MMKV 会话）
    src/store/             # zustand × 10（MMKV 持久化）：task/focus/settings/ai/sandbox/knowledge/reminder/mistake/mood/auth
    assets/                # grok-ball AI 球资产 + sandbox（Monaco+Pyodide HTML）
  web/                     # Next.js 14 (App Router)
    src/app/workshop/      # 知识工坊（编辑/传图/版本/精炼）
    src/app/library/       # 知识库阅读区（渲染/图谱/双链/书签）
    src/app/tools/         # AI 工具区（可插拔工具框架）
    src/app/questions/     # 每日猜题阅读页（手动触发共用流水线）
    src/app/search/        # 语义检索中心（混合检索 + 标签树）
    src/app/compile/       # 编译与输出（大纲/.apkg/PDF）
    src/app/api/           # github 代理（tree/raw/save/image/versions）/ workshop/refine / tags
                           # compile/apkg / export / cron（daily/weekly/knowledge/questions）
                           # knowledge sync / search / mistakes / mood / tasks sync / timer sync
                           # tools/run（AI 工具区统一执行）/ library（note/graph）
    src/lib/               # llm（供应商注册表加一行即扩）/ aiTools/registry（工具注册表）/ questionSubjects（科目命题注册表）
                           # promptBudget（提示词 token 预算）/ apkg / markdown（markdown-it + KaTeX 引擎）/ knowledgeSync / supabaseAdmin / access / github
supabase/schema.sql        # 12 张表 + pgvector + RPC + Auth 触发器 + 存储桶 + RLS
.github/workflows/ci.yml   # 安装/类型检查/构建全部在 GitHub Actions（本地零安装）
.github/workflows/build-apk.yml  # APK 打包（dispatch 或 v* tag 触发）
vercel.json                # Cron：04:00 备课 / 04:10 向量化 / 04:20 猜题 / 周一 04:30 复盘（北京时间）
```

## 快速开始

```bash
# 1. 安装依赖（或依赖 CI：推送后自动安装验证）
pnpm install

# 2. 管理台环境变量
cp apps/web/.env.example apps/web/.env.local

# 3. 初始化数据库（见部署教程第 2 步）

# 4. 启动
pnpm dev:web      # 管理台 http://localhost:3000
pnpm dev:mobile   # 手机端（Expo Go 扫码）
```

完整部署（Supabase → Vercel → 手机 → APK）见下方部署教程。

## 部署教程

### 第 1 步：Supabase 数据库（免费额度够用一整年）

1. [supabase.com](https://supabase.com) 免费注册 → **New project**（区域选 Singapore，离中国最近）
2. 左侧 **SQL Editor** → 粘贴 [supabase/schema.sql](./supabase/schema.sql) 全文 → **Run**（幂等，可重复执行）
   - 一次创建：12 张表 + RLS 策略 + `match_notes`/`get_questions_by_key` RPC + Auth 注册触发器 + 4 个存储桶
3. 记下两串凭据（**Settings → API**）：
   - `Project URL`（形如 `https://xxx.supabase.co`）
   - `anon public` Key（公开 Key，可进客户端）
4. 开启邮箱认证（默认已开）：**Authentication → Providers → Email** 保持 Enabled；本地测试可先在 **Authentication → Sign In / Up** 关闭「Confirm email」（正式使用建议开启）

### 第 2 步：管理台部署 Vercel

1. 本仓库推到 GitHub，[vercel.com](https://vercel.com) → **Add New Project** → 导入仓库
2. Framework Preset 自动识别 Next.js，**Root Directory** 填 `apps/web`
3. 配置环境变量（**Settings → Environment Variables**）：

   | 变量 | 必填 | 说明 |
   |---|---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | ✅ | 第 1 步的 Project URL |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | 第 1 步的 anon Key |
   | `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Supabase **service_role** Key（Settings → API；仅服务端写数据，勿泄露） |
   | `GITHUB_REPO` | ✅ | Obsidian 仓库，如 `你的用户名/notes` |
   | `GITHUB_BRANCH` | | 默认 `main` |
   | `GITHUB_TOKEN` | 私有仓库必填 | [GitHub → Settings → Developer settings → Fine-grained tokens](https://github.com/settings/personal-access-tokens)，仅授予该仓库 Contents 读权限 |
   | `LLM_PROVIDER` | ✅ | `deepseek` / `openai` / `moonshot` / `glm` |
   | `LLM_MODEL` | | 留空用默认；DeepSeek 填 `deepseek-chat` |
   | `DEEPSEEK_API_KEY` 等 | ✅ | 与 LLM_PROVIDER 对应的 Key |
   | `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL` / 对应 Key | 用语义检索则填 | 向量维度锁 1536 |
   | `TAVILY_API_KEY` | 用周复盘/对标/每日猜题则填 | [tavily.com](https://tavily.com) 免费 1000 次/月；未配置时猜题自动降级 AI 自拟材料 |
   | `CRON_SECRET` | ✅ | 随机长字符串，Cron 任务鉴权 |
   | `OWNER_USER_ID` | ✅ | 你的 Supabase 用户 UUID（Authentication → Users 里复制） |

4. **Deploy** → 拿到 `https://你的项目.vercel.app`（下称「管理台地址」）
5. Cron 自动生效（[vercel.json](./vercel.json)）：04:00 备课 / 04:10 向量化 / 04:20 猜题 / 周一 04:30 周复盘（北京时间）
   - 注意：Vercel Hobby 计划 Cron 任务在项目部署后才会触发；首次全量向量化可在语义检索中心手动点「同步」加速

### 第 3 步：手机端配置（Expo Go 或 APK）

1. 安装 [Expo Go](https://expo.dev/go)（Android）→ 电脑跑 `pnpm dev:mobile` 扫码；或直接用第 4 步的 APK
2. 打开 App → **我的** Tab，按顺序填写：
   1. **Supabase URL + Anon Key**（第 1 步凭据）→ 🔐 **注册/登录** → 访问密钥自动回填（多设备登录同一账号即数据同步）
   2. **管理台地址**（第 2 步的 vercel.app 地址，错题/情绪/任务云同步代理）
   3. **LLM Key**（对话 + L4 工具；[DeepSeek](https://platform.deepseek.com) 充 10 元用一学期）→ **视觉 Key**（[智谱开放平台](https://open.bigmodel.cn)领 GLM-4.6V-Flash 免费额度）→ **转写 Key**（[Groq](https://console.groq.com) 免费 `whisper-large-v3`）
   4. **Tavily Key**（对标/资讯）+ 天气自动定位免配置
3. 功能验证清单：驾驶舱出现天气与倒计时 → 弹药库错题拍照 AI 识别 → 悬浮球对话 → 仪表盘雷达出图 → 明早 04:30 后驾驶舱出现「每日知识点」

### 第 4 步：构建正式 APK（后台唤醒/常驻使用必做）

Expo Go 不支持 background fetch，日常使用建议装构建版：

1. GitHub 仓库 → **Actions** → 选 **Build APK** workflow → **Run workflow**（或推送 `v*` tag 自动触发）
2. 构建完成（约 15 分钟）→ 该次运行页 **Artifacts** 下载 `app-release.apk`
3. 传到手机安装（debug 签名，可直接侧载；如需上架需自行配置正式签名）
4. 系统设置里允许「后台弹出界面 / 无限制省电策略」，提醒通知与后台同步才稳定

### 日常使用速查

| 时间 | 发生什么 |
|---|---|
| 随时记 | 错题拍照 30 秒入库；情绪打卡；语音反思自动转写 |
| 每天 04:00-04:30 | 云端自动备课 + 笔记向量化 + **每日猜题（语文时评阅读/作文押题 + 英语阅读/语法填空）** + 周一复盘 |
| 早上打开 App | 每日知识点/一题已就位；四路云同步静默完成；管理台「每日猜题」页看当天押题（答案默认折叠，先做再看） |
| 每周一 | 仪表盘画像详情出现教练复盘 + 考纲警示 + 资讯 |
| 心流学习 | 进入心流 → App 通知静默 → 一键开系统免打扰 |
| 周末 | 知识工坊整理笔记 → 编译 .apkg 导入 AnkiDroid；AI 工具区一键润色/出题/做记忆口诀 |

### 月度成本

全部免费额度内：Supabase（500MB DB + 1GB Storage）+ Vercel Hobby + Tavily 1000 次/月 + 智谱/Groq 免费额度；唯一硬成本 DeepSeek ≈ ¥1-5/月。

### 故障排查

- **手机读不到每日知识点**：查「我的」Supabase URL/Anon Key 是否填对 → 已登录且访问密钥非空 → 云端 SQL 查 `daily_learning` 当日是否有行（04:00 Cron 是否正常，Vercel Logs 看 `/api/cron/daily`）
- **每日猜题缺科目/缺材料**：Vercel Logs 看 `/api/cron/questions`（部分科目失败不影响其他科目）；材料来源「AI 生成」= Tavily 未配置或当日未抓到合格时文；先跑一轮「知识库同步」能提升考点锚命中
- **错题同步失败**：管理台地址末尾别带 `/`；访问密钥与登录账号一致；Vercel Logs 看 `/api/mistakes` 报错
- **语义检索没结果**：先手动点「同步」跑一轮；`.env.local` 的 `EMBEDDING_*` 是否配置
- **知识工坊文件树为空**：`GITHUB_REPO` 格式为 `owner/repo`（无 https 前缀）；私有仓库确认 token 权限
- **Cron 没触发**：Vercel 项目必须至少成功部署过一次；Hobby 计划仅生产环境生效

## Roadmap 完成状态

蓝皮书 Phase 1-4 全部完成，超出原计划的增强：

- ✅ **Phase 1 基础闭环**：Monorepo + Schema + CI；4 Tab；驾驶舱倒计时/定位天气/三件事；心流计时器；知识工坊文件树 + 只读编辑器
- ✅ **Phase 2 智能核心**：Pyodide 沙盒 + 知识库渲染 + 双链跳转；AI 悬浮球 L1-L3（多供应商）；凌晨备课流水线；语义检索中心
- ✅ **Phase 3 专业化与后台**：L4 六大工具 + 确认卡片；编译输出；六维画像 + 横向对标；后台唤醒
- ✅ **Phase 4 错题本**：AI 识别题面 + 读图讲解 + 语音转文字；重做结果喂雷达；情绪打卡全闭环
- ✅ **Phase 5 出厂增强**：知识工坊可编辑/传图/版本回滚/AI 精炼；标签树管理；真 .apkg；错题/情绪/任务/专注全量云同步；周复盘 Cron；对标数值化；DND 心流静默；Supabase Auth 多设备一致
- ✅ **Phase 6 智能扩展**：知识库阅读区（全语法渲染 + 力导向图谱 + Ctrl+K）；AI 工具区（可插拔注册表，7 工具）；每日猜题流水线（知识库考点锚 + 时文 → 按科目命题）；AI 悬浮球三级审批工作流（风险分级 + 策略配置 + 审计日志）；提示词 token 预算装配（材料/锚点优先级注入）

## TODO（锦上添花级）

- [x] 错题正确率按科目细分进雷达（每科一轴，最多 5 轴 + 正确率明细 chip）
- [ ] 错题间隔重复（SRS）提醒
- [ ] 每周复盘推送为本地通知
- [ ] 数据导出全量备份（JSON）
- [ ] 审批策略设置 UI（「我的」页三选项，当前可改 MMKV `settings.approvalPolicy`）
- [ ] AI 工具审计日志查看页（数据已落 MMKV `ai_tool_audit`，环形 50 条）
- [ ] 每日猜题接入驾驶舱（RPC `get_questions_by_key` 已就绪）
- [ ] 更多猜题科目（数学/物理等纯知识库出题，`questionSubjects.ts` 加一条定义即可）
- [ ] 知识库：未解析双链一键去工坊创建对应笔记
- [ ] 知识库图谱落库（并入向量同步管道，替代全库扫描 + 内存缓存）

## 技术取舍（诚实记录）

- **Anki 产物**：真 .apkg（sql.js 构建 SQLite，内容哈希 guid 去重）；服务端构建失败自动降级为 TSV 导入格式
- **PDF**：浏览器打印视图（A4 排版）而非服务端直出——嵌入中文字体需数 MB 字体文件，不值得
- **公式渲染**：KaTeX 固定 `output:'mathml'`——产物只有 MathML，打印 HTML / Anki 卡片无需引入 `katex.min.css` 与 20+ 个 woff2 字体即可自包含；代价是渲染质量取决于浏览器 MathML 实现（2026 主流浏览器均原生支持）
- **代码高亮**：自研轻量 tokenizer（python/js/json/bash/sql 五族，关键字/字符串/注释/数字/函数名）而非 highlight.js——打印与卡片只需关键字级可读性，省掉一个较大依赖与整套 CSS 主题
- **多设备任务合并**：并集 + 墓碑，无版本向量——A 端删除后 B 端未拉取又推送会复活（单用户可接受）
- **对标分数线**：启发式数值提取（480-700 可信区间），省份/批次差异需人工核对来源
- **DND**：App 自身通知可真静默；其他 App 通知只能深链引导用户开系统免打扰（Android 沙箱限制）
- **后台唤醒**：Expo Go 不支持 background fetch，需 build-apk.yml 构建版
- **工具审批工作流**：三级风险（low 直读 / medium 外部副作用或写数据）+ 用户策略（auto/suggest/ask）——suggest 下 searchWeb/exportNote 也会弹确认卡，牺牲一点流畅换取「AI 动了什么」全程可审计；审计存 MMKV 环形 50 条，不追溯云端
- **提示词预算**：token 用「≈2 字符/token」混合近似（中英文折中，误差 <15%）而非引入 tokenizer 依赖——预算装配只求不撑爆上下文，不求精确计费；材料不可截断、辅助锚点按优先级让位
- **每日猜题材料**：外部时文原文直接落库不经 LLM 复述（防失真省 token）；Tavily 抓不到合格全文（<500 字）即降级 AI 自拟并标注来源，宁可用 AI 材料也不出「伪真题」——题目必须严格基于给定材料
- **知识库图谱索引**：Supabase 不存笔记正文，双链关系靠服务端并发扫描 GitHub 原文提取（并发 6，防限速），**内存缓存 10 分钟**——冷启动秒级到十秒级，命中毫秒级；未做 DB 持久化避免动 schema，笔记量大后可并入向量同步管道落库

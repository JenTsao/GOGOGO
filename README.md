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
   - 一次创建：11 张表 + RLS 策略 + `match_notes` 向量检索函数 + Auth 注册触发器 + 4 个存储桶
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
   | `TAVILY_API_KEY` | 用周复盘/对标则填 | [tavily.com](https://tavily.com) 免费 1000 次/月 |
   | `CRON_SECRET` | ✅ | 随机长字符串，Cron 任务鉴权 |
   | `OWNER_USER_ID` | ✅ | 你的 Supabase 用户 UUID（Authentication → Users 里复制） |

4. **Deploy** → 拿到 `https://你的项目.vercel.app`（下称「管理台地址」）
5. Cron 自动生效（[vercel.json](./vercel.json)）：04:00 备课 / 04:10 向量化 / 周一 04:30 周复盘（北京时间）
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
| 每天 04:00-04:30 | 云端自动备课 + 笔记向量化 + 周一复盘 |
| 早上打开 App | 每日知识点/一题已就位；四路云同步静默完成 |
| 每周一 | 仪表盘画像详情出现教练复盘 + 考纲警示 + 资讯 |
| 心流学习 | 进入心流 → App 通知静默 → 一键开系统免打扰 |
| 周末 | 知识工坊整理笔记 → 编译 .apkg 导入 AnkiDroid |

### 月度成本

全部免费额度内：Supabase（500MB DB + 1GB Storage）+ Vercel Hobby + Tavily 1000 次/月 + 智谱/Groq 免费额度；唯一硬成本 DeepSeek ≈ ¥1-5/月。

### 故障排查

- **手机读不到每日知识点**：查「我的」Supabase URL/Anon Key 是否填对 → 已登录且访问密钥非空 → 云端 SQL 查 `daily_learning` 当日是否有行（04:00 Cron 是否正常，Vercel Logs 看 `/api/cron/daily`）
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

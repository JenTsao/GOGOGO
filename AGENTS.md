# AGENTS.md — Gaokao Co-pilot（高考副驾驶）

> 本文件供 AI 编码代理（Trae / Claude Code / Cursor 等）阅读，提供项目全貌与硬性约束。

## 项目定位

高考备考一站式系统：**本地瞬时响应 + 云端永不关机 + 知识资产专业化治理**。
完整蓝图见 `项目书.md`（16 项技术选型、10 张数据表、3 个开发阶段）。

## 目录结构

```
apps/
  mobile/    # Expo (React Native 0.74 + TypeScript) 手机端，4 Tab + AI 悬浮球
    src/app/         # expo-router 页面：index(驾驶舱) arsenal(弹药库) dashboard(仪表盘) profile(我的)
    src/components/  # AiOrb（grok-ball WebView 表情球）
    src/store/       # zustand：taskStore / focusStore / settingsStore / aiStore（MMKV 持久化）
    assets/grok-ball/  # AI 球资产（HTML 内联引擎）
  web/       # Next.js 14 (App Router) 管理台
    src/app/workshop/   # 知识工坊：GitHub 文件树 + Monaco 只读编辑器
    src/app/api/github/ # Route Handler 代理 GitHub API（token 仅服务端）
    src/lib/            # supabase.ts / github.ts
supabase/    # schema.sql（10 张表 + pgvector + RLS 全部 user_id = auth.uid()）
.npmrc       # node-linker=hoisted（Expo+pnpm 官方推荐，否则 RN gradle 插件路径解析为 null）
.github/workflows/ci.yml  # CI：安装/类型检查/构建全部在 GitHub Actions 完成
.github/workflows/build-apk.yml  # APK 打包：expo prebuild（CNG）→ gradle assembleRelease → artifact（手动触发或 push v* tag）
```

## 硬性约束（必须遵守）

1. **本地禁止安装任何依赖**。安装、类型检查、构建一律由 `.github/workflows/ci.yml` 执行。
   添加依赖 = 手动编辑对应 `package.json`，让 CI 去装。mobile 依赖须兼容 Expo SDK 51。
2. **RLS 是数据安全命门**：所有 Supabase 表必须启用行级安全且 `user_id = auth.uid()`。
3. **Secrets 不进代码仓库**：web 用 `.env.local`（参考 `.env.example`）；GITHUB\_TOKEN 仅服务端 Route Handler 使用；移动端用户密钥存 MMKV（settingsStore）。
4. **提交前确认 CI 会跑过**：`pnpm --filter @gk/mobile lint`、`pnpm --filter @gk/web lint`、`pnpm --filter @gk/web build`。

## 关键命令

```bash
pnpm dev:mobile   # 本地开发（需 node_modules 时提示用户跑 CI 或手动 pnpm install）
pnpm dev:web
pnpm build:web
pnpm lint         # 全 workspace 类型检查
```

APK 打包：GitHub Actions「Build APK」workflow（手动 dispatch 或推送 `v*` tag 触发），产物在 Actions artifact 下载（debug keystore 签名，可直接侧载）；`apps/mobile/android/` 为 CNG 动态生成目录，已 gitignore，勿手动提交。

## 环境变量

| 变量                                               | 位置          | 用途                                        |
| ------------------------------------------------ | ----------- | ----------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL` / `ANON_KEY`          | web         | Supabase 客户端                              |
| `GITHUB_REPO` / `GITHUB_BRANCH` / `GITHUB_TOKEN` | web 服务端     | 知识工坊读取 Obsidian 仓库                        |
| `LLM_PROVIDER` / `LLM_MODEL` / 各供应商 `*_API_KEY`  | web 服务端     | 备课流水线 / 语义检索（见 `apps/web/src/lib/llm.ts`） |
| `EMBEDDING_PROVIDER` / `EMBEDDING_MODEL`         | web 服务端     | 向量化（维度锁 1536）                             |
| `CRON_SECRET` / `OWNER_USER_ID`                  | web 服务端     | Cron 鉴权 / 数据归属用户 UUID                     |
| DeepSeek / OpenWeather / Tavily / LLM Key        | mobile MMKV | 用户在「我的」Tab 自填（含 L4 searchWeb 工具）        |

## 当前进度（Phase 1 完成，Phase 2 进行中）

- ✅ Monorepo（pnpm workspace）+ Supabase schema + CI
- ✅ 移动端 4 Tab；驾驶舱：倒计时 / 自动定位天气（expo-location，坐标优先、配置城市兜底）/ 今日三件事 + 后备箱（MMKV 持久化）；全屏心流计时器（会话记录持久化）
- ✅ 管理台知识工坊：文件树（勾选多选）+ Monaco 可编辑保存（contents API 提交，Ctrl/Cmd+S）+ AI 精炼工具栏（合并精炼 / Mermaid 知识图谱，mermaid 动态渲染）+ 版本快照回滚（obsidian_metadata.version_history，需 OWNER_USER_ID）+ 拖拽传图自动压缩 WebP 上传 assets/
- ✅ 弹药库：代码沙盒（WebView 内 Monaco + Pyodide，5 秒无响应熔断，片段 MMKV 保存，同名覆盖）+ 知识库（GitHub 目录树按需下载，react-native-markdown-display 渲染，[[双链]] 库内跳转，LaTeX 轻量 Unicode 化，frontmatter 剥离）
- ✅ AI 悬浮球对话（L1-L3）：多供应商 OpenAI 兼容协议（DeepSeek/OpenAI/Kimi/GLM/自定义），BYOK 存 MMKV
- ✅ 凌晨备课流水线：`/api/cron/daily`（vercel.json 每日 04:00 北京时间），service role 写 daily\_learning，幂等
- ✅ 语义检索中心：`/api/knowledge/sync`（内容哈希增量向量化）+ `/api/search`（关键词 ilike + pgvector rpc match\_notes 混合检索），schema.sql 已补 match\_notes + hnsw 索引
- ✅ 驾驶舱消费 daily_learning：知识点翻转卡 + 每日一题（显示答案 / AI讲题，复用 aiStore.ask）；移动端经 `get_daily_by_key` RPC 免登录读取（profiles.access_key 设备密钥，security definer，不放宽 RLS）
- ✅ L4 工具调度：`src/lib/aiTools.ts` 6 大工具 schema + 执行器（addTask/setReminder 写操作走确认卡片 aiStore.confirmToolCall；searchWeb/queryStats/exportNote/correctCode 直读直返）；LLM 层支持 OpenAI 兼容 tool_calls
- ✅ 编译与输出：`/compile` 资源池勾选 → 纯文本大纲 / Anki TSV（## 标题=正面）/ PDF（浏览器打印视图 A4），历史最近 10 次 localStorage；纯客户端文本变换零新增依赖，.apkg 与错题源待错题本实装
- ✅ 画像系统：仪表盘 react-native-svg 六维雷达（专注投入/深度/坚持天数/任务执行/知识积累/学科掌握）+ 近 7 天专注柱状 + 心流热力 + 完成率折线 + Tavily 横向对标（目标大学分数线）
- ✅ 后台唤醒：`src/lib/background.ts` expo-background-fetch（15 分钟级）+ expo-notifications（当日提醒去重通知）+ 每日备课内容预取 MMKV（驾驶舱云失败时兜底）；Expo Go 下 Android 不支持 background fetch，需构建版
- ✅ 错题本（Phase 4）：弹药库第3子Tab `MistakeView`（拍照/相册 → image-manipulator 压缩 1080px/JPEG → 学科/标签/语音反思 expo-av → 本地 MMKV 优先）；云同步经管理台 `/api/mistakes` 代理（x-access-key 反查 profiles.access_key，service role 写 Storage `mistakes` 桶，无匿名写策略）；画像接入危险学科 + 卡壳词云（mistakeStore tags）；编译资源池 `/api/mistakes/pool`（OWNER 归属元数据）
- ✅ 错题重做结果：detail 标记 ✅正确/❌仍错 → 雷达第 6 维「学科掌握」（重做正确率）；云端 `mistakes.is_mastered`（POST 携带 / PATCH 回写）
- ✅ 知识库 [[双链]] 跳转：wikilink → `wiki:` 链接，onLinkPress 按精确路径/后缀/文件名三级解析跳转，未命中提示
- ✅ 语音转文字 + 错题 AI 讲解：`src/lib/stt.ts`（OpenAI 兼容 /audio/transcriptions，中文锁定；DeepSeek 无 ASR，settingsStore 提供 sttBaseUrl/sttApiKey/sttModel 独立配置，留空回退 LLM 配置）；转写结果存 mistake.transcript（AI 讲解上下文 + 仪表盘情绪信号：countNegativeWords 消极词扫描「搞不懂即时加权」）；MistakeView 详情页 🤖 AI 讲解入口（优先视觉读图，未配置回退文本）
- ✅ 视觉讲解：GLM-4.6V-Flash 接入（settingsStore visionBaseUrl/visionApiKey/visionModel，默认智谱 OpenAI 兼容）；llm.ts 支持 OpenAI 视觉 content 数组（ChatContentPart + imageTextContent）；aiStore.askVision（不传工具，历史文本照带）；MistakeView AI 讲解优先读图（本地图 → base64 data URL），未配 Key 回退文本讲解
- ✅ 错题多模态识别：llm.ts `recognizeMistake`（视觉模型 → JSON {subject,tags,summary} 容错解析）；收录弹窗「🔍 AI 识别题面」自动填学科/卡壳标签/题面摘要（summary 存 mistake.summary，可手改），讲解上下文与详情页均携带
- ⏳ 可继续增强：Supabase Auth 正式登录（多设备一致）

## LLM 适配层

- Web 服务端：`apps/web/src/lib/llm.ts`（chatCompletion / embedTexts / parseJsonLoose），供应商注册表新增 = 加一行
- 移动端 BYOK：`apps/mobile/src/lib/llm.ts`（LLM\_PRESETS + chatWithLlm），配置存 settingsStore（llmProvider/llmBaseUrl/llmModel/llmApiKey）
- Embedding 维度锁定 1536（与 knowledge\_embeddings.vector(1536)、match\_notes 一致），换供应商必须保持 1536

## 代码风格

- TypeScript 严格模式；中文注释，注释写「为什么」而非「是什么」
- zustand store 不可变更新（禁直接改 state 字段），MMKV 快照用 JSON 序列化，读写都要 try/catch 兜底
- 移动端组件保持函数式 + hooks；网络请求必须可取消（cleanup 置 cancelled 标志）且失败静默降级
- 命名：store 文件与 hook 同名（`useXxxStore`）；路由文件即 Tab 名


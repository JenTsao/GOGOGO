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
    src/app/workshop/   # 知识工坊：GitHub 文件树 + Monaco 编辑（保存回写 / Ctrl+S / 拖拽传图 WebP / 版本回滚 / AI 精炼工具栏）
    src/app/search/     # 语义检索中心：混合检索 + 层级标签树（重命名/合并/删除/批量关联）
    src/app/compile/    # 编译与输出：大纲 / 真 .apkg（sql.js）/ PDF 打印视图（错题图片内嵌）
    src/app/api/github/ # Route Handler：tree/raw/save/image/versions（token 仅服务端）
    src/app/api/        # workshop/refine（合并精炼+Mermaid）tags（标签管理）compile/apkg cron/daily knowledge/sync search mistakes
    src/lib/            # supabaseAdmin / github（含 commitMarkdown/commitBinary/rawUrl）/ llm / apkg（Anki SQLite 构建器）
supabase/    # schema.sql（10 张表 + pgvector + RLS 全部 user_id = auth.uid()）
.npmrc       # node-linker=hoisted（Expo+pnpm 官方推荐，否则 RN gradle 插件路径解析为 null）
.github/workflows/ci.yml  # CI：安装/类型检查/构建全部在 GitHub Actions 完成
.github/workflows/build-apk.yml  # APK 打包：expo prebuild（CNG）→ gradle assembleRelease → artifact（每次推送 main 且涉及 mobile 自动触发，或 push v* tag）
```

## 硬性约束（必须遵守）

1. **本地禁止安装任何依赖**。安装、类型检查、构建一律由 `.github/workflows/ci.yml` 执行。
   添加依赖 = 手动编辑对应 `package.json`，让 CI 去装。mobile 依赖须兼容 Expo SDK 51。
1b. **全仓 React 锁 18.2.0**（Expo SDK 51 上限；Next 14.2 兼容），由根 `pnpm.overrides` 强制。
   禁止单边升级——双版本 React 在 hoisted 安装下会产生嵌套副本，Next 预渲染 /404 /500 时报
   `Cannot read properties of null (reading 'useRef')`。
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
- ✅ 语义检索中心：`/api/knowledge/sync`（内容哈希增量向量化 + extractTags 提取 #行内/frontmatter 标签存 obsidian_metadata.tags，GIN 索引）+ `/api/search`（关键词 ilike + pgvector rpc match_notes 混合检索），schema.sql 已补 match_notes + hnsw 索引
- ✅ 层级标签树管理：`/api/tags` GET（树聚合 + byPath 映射）/ POST（rename/merge/delete 子层级跟随重写数组，assign 批量关联笔记）；search 页左栏树 UI（点击筛选、勾选结果批量加标签）
- ✅ 驾驶舱消费 daily_learning：知识点翻转卡 + 每日一题（显示答案 / AI讲题，复用 aiStore.ask）；移动端经 `get_daily_by_key` RPC 免登录读取（profiles.access_key 设备密钥，security definer，不放宽 RLS）
- ✅ L4 工具调度：`src/lib/aiTools.ts` 6 大工具 schema + 执行器（addTask/setReminder 写操作走确认卡片 aiStore.confirmToolCall；searchWeb/queryStats/correctCode 直读直返；exportNote 接通管理台 `/api/export` 服务端编译：fetchRawFile 采集 → 大纲/打印HTML/真.apkg → Storage compilations 公开桶 → knowledge_compilations 记录 → 返回下载 URL；笔记从知识库已下载缓存定位，pdf 产物为 A4 打印 HTML 开箱调起打印）；LLM 层支持 OpenAI 兼容 tool_calls
- ✅ 编译与输出：`/compile` 资源池勾选（笔记+错题）→ 纯文本大纲 / **真 .apkg**（`lib/apkg.ts` sql.js wasm 构建 SQLite schema ver 11 + jszip，guid=内容哈希去重，失败自动降级 TSV，依赖 serverComponentsExternalPackages）/ PDF（浏览器打印视图 A4，错题照片 `<img>` 内嵌；Anki 背面同样嵌图），历史最近 10 次 localStorage
- ✅ 画像系统：仪表盘 react-native-svg 六维雷达（专注投入/深度/坚持天数/任务执行/知识积累/学科掌握）+ 近 7 天专注柱状 + 心流热力 + 完成率折线 + Tavily 横向对标（目标大学分数线）
- ✅ 后台唤醒：`src/lib/background.ts` expo-background-fetch（15 分钟级）+ expo-notifications（当日提醒去重通知）+ 每日备课内容预取 MMKV（驾驶舱云失败时兜底）；Expo Go 下 Android 不支持 background fetch，需构建版
- ✅ 错题本（Phase 4）：弹药库第3子Tab `MistakeView`（拍照/相册 → image-manipulator 压缩 1080px/JPEG → 学科/标签/语音反思 expo-av → 本地 MMKV 优先）；云同步经管理台 `/api/mistakes` 代理（x-access-key 反查 profiles.access_key，service role 写 Storage `mistakes` 桶，无匿名写策略）；画像接入危险学科 + 卡壳词云（mistakeStore tags）；编译资源池 `/api/mistakes/pool`（OWNER 归属元数据）
- ✅ 错题重做结果：detail 标记 ✅正确/❌仍错 → 雷达第 6 维「学科掌握」（重做正确率）；云端 `mistakes.is_mastered`（POST 携带 / PATCH 回写）
- ✅ 知识库 [[双链]] 跳转：wikilink → `wiki:` 链接，onLinkPress 按精确路径/后缀/文件名三级解析跳转，未命中提示
- ✅ 语音转文字 + 错题 AI 讲解：`src/lib/stt.ts`（OpenAI 兼容 /audio/transcriptions，中文锁定；DeepSeek 无 ASR，settingsStore 提供 sttBaseUrl/sttApiKey/sttModel 独立配置，留空回退 LLM 配置）；转写结果存 mistake.transcript（AI 讲解上下文 + 仪表盘情绪信号：countNegativeWords 消极词扫描「搞不懂即时加权」）；MistakeView 详情页 🤖 AI 讲解入口（优先视觉读图，未配置回退文本）
- ✅ 视觉讲解：GLM-4.6V-Flash 接入（settingsStore visionBaseUrl/visionApiKey/visionModel，默认智谱 OpenAI 兼容）；llm.ts 支持 OpenAI 视觉 content 数组（ChatContentPart + imageTextContent）；aiStore.askVision（不传工具，历史文本照带）；MistakeView AI 讲解优先读图（本地图 → base64 data URL），未配 Key 回退文本讲解
- ✅ 错题多模态识别：llm.ts `recognizeMistake`（视觉模型 → JSON {subject,tags,summary} 容错解析）；收录弹窗「🔍 AI 识别题面」自动填学科/卡壳标签/题面摘要（summary 存 mistake.summary，可手改），讲解上下文与详情页均携带
- ✅ 情绪打卡：`MoodCheckin` 组件（仪表盘顶部，emoji 5 档 + 备注 + 语音备忘 ≤1min + 转写）；`moodStore`（MMKV 本地优先，同日覆盖，经管理台 `/api/mood` 云同步：x-access-key 鉴权 → mood 桶语音上传 → mood_checkins upsert，schema 已补 date 列 + user_id,date 唯一索引 + mood 桶）；画像联动：近 7 天情绪轨迹行 + 情绪信号合并错题转写与打卡转写/备注的消极词
- ✅ tasks/timer 云同步：`/api/tasks/sync`（并集合并 + 墓碑删除：removeTask/swap/complete 记墓碑 {content,status}，云端按墓碑删行后并集插入 missing，返回规范池云端 id 重建本地；已知取舍：A 端删除后 B 端未拉到合并结果再推同任务会复活，无版本向量）+ `/api/timer/sync`（append-only 并集：按 duration+started_at 精确去重，双端差集收敛，focusStore 上限提至 200）；驾驶舱挂载时静默触发（tasks/focus/mood/mistake 全量 sync，失败静默）
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


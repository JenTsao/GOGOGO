# Gaokao Co-pilot 缺陷审查与修复报告

审查范围：`apps/mobile/src`、`apps/web/src`、`supabase/schema.sql`、工程配置。
方法：4 路并行代码审查（移动端 store/lib、移动端页面组件、Web API/lib、Web 页面 + SQL + 配置），逐条回读源码核验后才落修复。
已修复 29 处，另有 2 项因需要重建依赖锁文件无法在本地落地，列为待办。

## 执行摘要

最严重的一类是**静默数据丢失**：任务同步用 await 之前的快照覆盖本地，导致同步飞行期间新增的任务本地与云端同时消失；错题同步在合入云端条目时按固定 200 条截断，未上传的本地错题会被直接切掉。其次是**功能永久失效**：知识工坊的 Ctrl+S 保存因 Monaco `onMount` 只触发一次而捕获了过期闭包，快捷键实际上从未生效；Web 端 GitHub 路径做整体 `encodeURIComponent`，把 `/` 编码成 `%2F`，导致所有子目录笔记读写 404；向量化同步让「内容未变」的笔记也消耗处理预算，笔记数超过单轮上限后全量永远无法收敛。安全方面，`/api/github/save`、`/api/github/image`、`/api/workshop/refine`、`/api/knowledge/sync` 完全无鉴权，公网部署等同于开放写仓库和刷 LLM 额度。

## 一、数据丢失与数据损坏

`apps/mobile/src/store/taskStore.ts` 的 `syncTasks` 在发起请求前固定了 `pool` 快照，随后用云端返回的规范池整体覆盖本地并写盘。请求飞行期间用户新增的任务既不在上传快照里，也不在云端返回中，本地 MMKV 与云端同时抹除且不可恢复。修复方式是在覆盖前按服务端去重键 `status|content|date` 补回本地独有增量，并改用 `await` 之后重新取的 `get()` 快照而非请求前的 `pool`。

同文件的 `swapWithBacklog` 使用 `task!` 类型断言展开可能不存在的任务，运行时断言不生效，当 id 不在 `top3` 时会 push 一条 `id`/`content` 均为 `undefined` 的幽灵任务并落盘，重启后无法删除。已改为找不到任务即放弃；同时墓碑状态从写死的 `'top3'` 改为 `task.status`，否则已完成任务迁移后云端残留 done 行会让任务复活。

`apps/mobile/src/store/mistakeStore.ts` 有三处问题。`downloadToDoc` 拼接目标路径时漏了分隔符，文件实际落到文档根目录而非 `mistakes/`。合入云端条目时用 `[...additions, ...current].slice(0, 200)` 截断，本地存在但未同步的错题会被优先切掉——这些错题只存在于本地，切掉即永久丢失，现改为裁剪前先保留未同步条目。原实现在「拉」和「回填」两个阶段对 `/api/mistakes` 做了两次完全相同的全表 GET，弱网下同步耗时翻倍，现合并为一次请求。

`apps/mobile/src/store/reminderStore.ts` 的 `sync` 同样用 `await` 之前的 `local` 快照做并集，同步窗口内新增的提醒会丢失，已改为合并前重新读取最新状态。

`apps/mobile/src/store/moodStore.ts` 的 `checkIn` 在重新打卡时未继承 `cloudUrl`，已上传的语音链接丢失，他端拉取后无法播放；现按是否重新录音区分处理（重新录音则清空待重传，否则继承）。

## 二、功能永久失效

`apps/web/src/app/workshop/page.tsx` 的 Monaco `onMount` 只在编辑器首次挂载时触发一次，而编辑器在 `selected === null` 时就已挂载，于是 `addCommand` 注册的回调永久闭包捕获了那个时刻的 `save`，其首行 `if (!path) return` 直接返回，Ctrl/Cmd+S 静默无反应。修复方式是引入 `saveRef` 在每次渲染同步最新闭包。

同一文件的拖拽处理把 `preventDefault()` 放在提前 `return` 之后，拖入非图片文件（或未选中文件）时浏览器默认行为会用该文件替换当前页，编辑器未保存内容直接丢失。已将 `preventDefault()` 提到函数首行。

`apps/web/src/lib/github.ts` 对路径整体调用 `encodeURIComponent`，把目录分隔符 `/` 编码为 `%2F`，GitHub 不会还原，导致任何位于子目录的笔记在拉取、取 SHA、提交时全部 404。同文件末尾的 `rawUrl` 用的是正确的逐段编码，属于内部实现不一致。现抽出 `encodeRepoPath` 统一为逐段编码，四处调用点与 `rawUrl` 全部改用该 helper。同时路径穿越判断由 `includes('..')` 改为按段等值判断，避免误伤含连续点的合法文件名。

`apps/web/src/lib/knowledgeSync.ts` 的循环把 `processed++` 放在哈希比对之前，内容未变的笔记同样消耗 `limit` 预算，而每轮又总是从列表头部开始扫描，于是位置靠后的笔记永远排不到——「多跑几轮即全量收敛」的注释并不成立。现改为未变更笔记不消耗预算、未同步过的笔记优先排序，并增加扫描上限防止打爆 GitHub 速率限制。

同文件的「幽灵笔记清理」以仓库全量树为依据，但 `fetchRepoTree` 一直忽略 GitHub 的 `truncated` 标记：树被截断时，树外的笔记会被当成已删除而连同元数据与向量一起删除。现 `fetchRepoTree` 返回 `truncated`，`truncated` 为真时跳过清理。删除向量时也补上了 `user_id` 条件。

`apps/mobile/src/lib/background.ts` 把 `TaskManager.defineTask` 与 `BackgroundFetch.registerTaskAsync` 放在同一个 `try` 里，而 `defineTask` 对已定义的同名任务会直接抛错（热重载、二次初始化必然触发），抛错后注册语句永不执行，后台唤醒静默失效。已拆成两个 `try`。

`apps/mobile/src/app/dashboard.tsx` 的情绪信号 `useMemo` 返回的是 `Map.entries()`——一个一次性迭代器而非数组。首次渲染后被消耗殆尽，之后任何重渲染（打开画像弹窗、切 Tab 回来）都会得到空数组，词云永久消失。已改为返回数组。

`apps/mobile/src/store/authStore.ts` 的订阅用模块级布尔量 `subscribed` 做幂等标记，但用户在「我的」更换 Supabase 配置后 `getSupabase()` 会重建客户端，布尔量仍为 `true`，新客户端永远拿不到订阅，登录后邮箱不更新。改为按客户端实例记录。

## 三、崩溃路径

`dashboard.tsx` 的周复盘区块直接访问 `weekly.content.summary`、`risks.length`、`news.length`，而 `fetchWeekly` 对 RPC 返回零校验；`content` 为 `null` 或缺字段时全屏 Modal 崩溃，用户只能杀 App。已全部改为可选链与空值兜底。

`apps/mobile/src/store/authStore.ts` 的 `init` 中 `await sb.auth.getSession()` 未被保护，网络异常抛出后 `ready` 永不置位，UI 永久停留在加载态；`void bootstrap()` 也没有 catch。现已包裹 try/catch 并保证 `ready` 一定置位。

`apps/mobile/src/lib/llm.ts` 的 `recognizeMistake` 在 `end <= start` 时会对空串执行 `JSON.parse` 抛 `SyntaxError`，且 `JSON.parse` 本身无保护；`chatWithLlm` 没有超时，供应商挂起会让悬浮球永远停在「思考中」。已分别加边界判断与 60 秒 `AbortController`。`lib/stt.ts` 的转写同样补了超时，`countNegativeWords` 补了空值判断。

`apps/mobile/src/store/focusStore.ts` 的 `new Date(s.started_at).toISOString()` 遇到非法时间戳会抛 `RangeError` 导致整轮同步挂掉，已改为先规整再过滤。`apps/web/src/app/api/timer/sync/route.ts` 有同样问题，一并修复。

`apps/web/src/app/api/mistakes/route.ts` 的 PATCH 对 `body.transcript.slice()` 未判空，客户端显式传 `null` 清空字段时会返回 500，已改为支持显式清空。

`apps/web/src/app/compile/page.tsx` 对 `mistakes.tags` / `image_urls` / `created_at` 裸调用 `.map`、`.slice`，这些列在 schema 中可空，历史或手工插入的行会导致整页白屏，已全部兜底。

`apps/mobile/src/lib/aiTools.ts` 的 Tavily 结果直接 `r.content.slice(0, 120)`，该字段在无摘要时会被省略，已补默认值。

## 四、安全

`/api/github/save`、`/api/github/image`、`/api/workshop/refine`、`/api/knowledge/sync` 四个接口此前完全无鉴权。前两个可让任何人向 Obsidian 仓库提交文件，后两个可无限消耗 LLM 与 embedding 额度。在 `apps/web/src/lib/access.ts` 新增 `isAdminRequest` / `adminUnauthorized`，四个接口加上闸门。该闸门为可选配置：设置 `ADMIN_TOKEN` 环境变量后即强制校验（前端需带 `x-admin-key` 头），未设置时保持原有行为，避免本地开发被挡。**部署到公网前必须配置 `ADMIN_TOKEN`。**

## 五、数据库

`supabase/schema.sql` 补齐 `timer_sessions`、`mistakes`、`reminders`、`knowledge_compilations` 四张表的 `user_id` 索引——周复盘、同步、资源池查询都按 `user_id` 过滤排序，而 `timer_sessions` 是持续增长的 append-only 表。为 `daily_learning` 增加 `(user_id, date)` 唯一索引，原「先查后插」的幂等在 Cron 重投或并发重试下会写入重复行；`/api/cron/daily` 相应改为 `upsert`。`get_daily_by_key` RPC 原本 `limit 1` 而无 `order by`，重复行时返回哪条不确定，已加 `order by created_at desc`。`weekly_reviews` 的 RLS policy 是全文件唯一不可重跑的 DDL，在已有库上再执行一次 schema.sql 会报 `policy already exists` 并中断后续函数创建，已加 `drop policy if exists` 前置。

## 六、其他 Web 修复

`apps/web/src/app/search/page.tsx` 的递归标签树把父节点的 `active` 原样透传给所有子节点，选中「数学」会让整排子层级一起高亮。改为传递 `activePath`，由每个节点自行判断是否命中。`apps/web/src/app/workshop/page.tsx` 与 `compile/page.tsx` 的 fetch 原先先 `json()` 再判 `ok`，非 2xx 且响应体为 HTML 时会抛出「Unexpected token '<'」掩盖真实原因，已统一为先判 `ok`。

## 七、待办（需重建依赖，本地不可执行）

`pnpm-lock.yaml` 与 `package.json` 严重失同步。移动端 importer 只记录了 10 个依赖，而 `apps/mobile/package.json` 声明了 26 个；lock 中没有 `overrides:` 段，说明根 `package.json` 的 `pnpm.overrides` 从未落盘，导致同时存在 `react@18.2.0` 与 `react@18.3.1` 两份——正是 AGENTS.md 警告的双版本 React 场景。更严重的是作为 `@react-navigation/*` peer 的 `react-native-safe-area-context` 被解析到 `5.9.1`、`react-native-screens` 到 `4.27.0`，二者都要求 RN ≥ 0.76，而本项目锁定 RN 0.74，表现是 Expo Go 正常但独立 APK 启动即崩。已在根 `package.json` 的 `pnpm.overrides` 补上 `react-native-safe-area-context: 4.10.5` 做双重钉死，但锁文件本身需要在 CI 或本地执行一次 `pnpm install` 后重新提交。Vercel 部署默认使用 `--frozen-lockfile`，当前状态会直接报 `ERR_PNPM_OUTDATED_LOCKFILE`。

另一项待确认：`storage.objects` 上没有任何 policy。若 Supabase 对公开桶的匿名读不自动放行，则 `mistakes` / `mood` / `compilations` 三个桶的 `getPublicUrl` 直链会全部 403，表现为错题照片、打卡语音、编译产物下载失效。若线上出现该现象，补三条 `for select using (bucket_id = '...')` 策略即可。

## 八、验证

对两个 app 分别执行 `tsc --noEmit`。Web 端仅剩 `mermaid`、`sql.js`、`jszip` 三个 `Cannot find module`；移动端仅剩一批 `Cannot find module`（Expo/ RN 包）以及 `authStore.ts` 两处 `TS7006`（因 `@supabase/supabase-js` 类型不可解析导致的隐式 any，改动前后一致）。这些均为本地未安装依赖所致——按 AGENTS.md 约定，安装与构建由 `.github/workflows/ci.yml` 完成，本次未在本地执行安装。所有 `TS2307` 与 `TS7006` 均为既有项，非本次修改引入。

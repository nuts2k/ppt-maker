# M4 桌面复核工作台 V2 — 实施计划

> V2 重构版实施计划（V1 计划已作废）。顺序执行，每步完成后跑对应验证再进入下一步。画布内核（ReviewCanvas / TextBlockOverlay / TextBlockHandle / TextEditor / SliderCompare / useCanvasTransform）**不改动交互逻辑**，仅允许样式 token 调整。

## 阶段 A：main 进程执行层（UI 无关，可独立验证）

- [x] A1 `src/main/activity-log.ts`：按 deckId 追加写 userData jsonl；`activity:list` IPC；单元可测（纯函数 + fs）
- [x] A2 `src/main/runner/deck-runner.ts`：串行队列、断点续跑 from 计算、stop 语义、DeckRunEvent 广播、事件同步写 ActivityLog
- [x] A3 `src/main/ipc/deck.ts`：新增 `deck:run-start` / `deck:run-stop` / `deck:status-detailed`（stages + lastError + stageDurations 聚合自 manifest attempts）
- [x] A4 `src/main/ipc/slide.ts`：移除 `slide:run`；accept-clean / accept-pptx / export handler 追加 ActivityLog 记录
- [x] A5 `src/main/ipc/channels.ts` + preload：类型与桥接同步更新

验证：`pnpm typecheck`；dev 模式对真实 deck 触发 run-start，观察事件序列与 jsonl 落盘。

**实施补充（阶段 A 实际产出，供后续阶段对齐）**

- 新增 `src/shared/stages.ts`：`RUN_STAGE_SEQUENCE` / `RunStage` / `STAGE_LABELS` 单点定义。design.md 中两处"10 阶段"实为不同集合——执行序列（含 `validate-review`、不含 `init`）与 core `SlideStage`（含 `init`、无 `validate-review`）。轨道与事件一律采用执行序列。
- `validate-review` 无 manifest 记录：展示状态由下游 `mask === completed` 反推；断点续跑判据跳过该阶段（否则每轮从它重来）。
- 新增 `src/main/slide-detail.ts`（聚合纯函数）与 `src/main/deck-context.ts`（从 slide 工作区逐级回溯 deck，slide 实际位于 `<deck>/slides/page-NN` 两层）。
- `SlideDetail` 额外提供 `absWorkspacePath` 与 `pageLabel`，renderer 不再自行拼接路径。
- IPC 与 runner 注册移到 `app.whenReady()` 一次性执行（原先在 `createWindow` 内，macOS 重建窗口会触发重复注册报错）。
- renderer alias `@shared` 已配好（electron.vite.config.ts + tsconfig.web.json）。
- desktop 包接入 vitest（28 个测试）：`vitest.config.ts` + `test/`，含真实 OCR 流水线端到端（假窗口驱动 DeckRunner，无需 GUI 与 API key）。
- `pipeline-store` 暂改为走 DeckRunner 的过渡实现以保持编译通过，阶段 B1 按计划由 run-store 取代。

**遗留（非本阶段引入，pre-existing）**：`pnpm format:check` 仍有 3 处 V1 lint 报错——`TextBlockOverlay.tsx` 的 `noUselessFragments` / `useSemanticElements`，`SlidePage.tsx` 的 `useExhaustiveDependencies`（Cmd+S 存在过期闭包风险）。分别留待阶段 E2 与阶段 D 处理。

## 阶段 B：renderer 状态层

- [x] B1 删除 `pipeline-store`；新建 `run-store`（订阅 deck:run-progress，1s ticker 计时）
- [x] B2 `deck-store` 改造：status-detailed 数据结构；page-done 增量刷新
- [x] B3 新建 `activity-store`；`ui-store` 路由与队列面板态
- [x] B4 待办队列派生 selector（耐久层 + 会话层合并，见 design.md 3.2）

验证：`pnpm typecheck`；store 单测（队列派生逻辑必测：failed/stale/待验收 clean/待验收 pptx 四组）。

**实施补充（阶段 B 实际产出，供后续阶段对齐）**

- **可测性约定**：纯逻辑模块（`run-reducer` / `run-bridge` / `deck-merge` / `todo-queue` / `activity-format` / `run-types`）一律用相对 `.js` 导入且不触碰 `window`，因此能同时被 vite（renderer）与 vitest + `tsconfig.node.json`（NodeNext）解析；zustand store 文件保留 `@/`、`@shared` alias 风格。测试只针对纯函数，不 import store。
- **单一订阅**：`run-store` 是 `deck:run-progress` 的唯一订阅方，`subscribe(onEvent?)` 把事件扇出给其它 store；扇出规则在 `stores/run-bridge.ts`（纯函数，已单测），由 `hooks/useRunBridge.ts` 在 `App` 根挂载一次。`page-done` → `deck-store.refreshSlide`；`run-done` → deck 全量刷新 + `activity.load` 覆盖乐观追加。
- `deck-store.refreshSlide` 权衡：main 无单页 detailed IPC（阶段 A 已定型），实现为拉全量后**只替换该页对象**且不置 loading，避免批量执行时卡片整片重渲染。
- 待办队列：每页最多一项，优先级 `failed > revalidate > accept-pptx > accept-clean`；组内 `pageLabel` 用 `Intl.Collator` 数字序。`validation-failed` 仅存在于会话层，重启后由耐久层归入失败组（已在代码注释与测试中固化）。
- `ui-store`：取消 V1 的 `welcome` 视图，改为 `console | slide`；新增 `openSlide` / `backToConsole` 与队列/活动面板展开态。**`DeckPage` 暂充当 console 视图**，阶段 C 由 `ConsolePage` 取代。
- `SlidePage` 为过渡适配（阶段 D 重写）：改用 `run-store` 派生——`stageStatuses` = 耐久层 `slide.stages` 叠加本次 run 的 `liveStages`；闸门由 `sessionResults[slideId]` 推导；单页执行走 `runSlide`（与批量共用 DeckRunner 队列）。
- `StageProgress` 轨道改用 `RUN_STAGE_SEQUENCE`（原为含 `init`、缺 `validate-review` 的旧序列），与卡片轨道、活动日志同源。
- 测试增至 84 个（新增 56）：`run-reducer` 17、`activity-format` 16、`todo-queue` 13、`deck-store-merge` 5、`run-bridge` 5。`pnpm typecheck` / `pnpm test` / `pnpm build` 三项全绿。

**遗留（未变，仍为 pre-existing）**：`pnpm format:check` 3 处 V1 lint 报错——`TextBlockOverlay.tsx` 的 `noUselessFragments` / `useSemanticElements`（阶段 E2），`SlidePage.tsx` 的 `useExhaustiveDependencies`（Cmd+S 过期闭包，阶段 D 随工具栏重写处理）。

## 阶段 C：控制台（ConsolePage）

- [x] C1 AppShell / top-nav 重做（DESIGN.md top-nav 规格 + 导出主按钮 + doctor chip）
- [x] C2 RunControlBar：空闲摘要态 + 执行进度态 + 停止控制
- [x] C3 SlideCard 重做：阶段轨道 10 点 + 当前阶段中文名 + 计时 + 失败错误条；SlideCardGrid 布局
- [x] C4 TodoQueuePanel：四组分组、计数、点击直达
- [x] C5 ActivityPanel：折叠抽屉、日期分组
- [x] C6 空态（未打开 deck）与创建/打开流程衔接

验证：`pnpm typecheck` / `pnpm test`（101 项）/ `pnpm build` 三项全绿；`biome check` 无新增报错。**dev 模式真实 deck 全流程走查待人工执行**（打开、批量执行、卡片实时推进、停止、失败展示、重启后状态恢复）。

**实施补充（阶段 C 实际产出，供后续阶段对齐）**

- 新增共享基元 `renderer/lib/stage-view.ts`（纯函数，17 个单测）：`deriveStageViews` 合并耐久层 + 会话层产出 10 阶段展示态、`currentStageView`（优先 running，其次第一个未完成 = 断点续跑起点）、`completedStageCount` / `hasFailingStage` / `formatElapsed` / `elapsedSince`，以及**状态色唯一表** `STAGE_DOT_CLASS` 与 `STAGE_STATUS_TEXT`。轨道、卡片、控制条、日志一律取该表，组件内禁止自行拼色。同样采用相对 `.js` 导入以便 vitest 解析。
- `tailwind.config.ts` 补齐 DESIGN.md 签名色（coral / forest / cream / peach / mint / yellow / mustard）。此前配置缺失这些 token，是 V1 用 `error` / `warning` 等文档外颜色的根因。失败态一律 `signature-coral`、失效态 `signature-mustard`、待验收强调 `signature-cream`。
- **拖拽区并入 TopNav**：原 AppShell 的 44px 空白标题栏 + 64px 导航共占 108px。改为导航条自身 `WebkitAppRegion: drag` + `pl-20` 让开红绿灯，交互簇显式 `no-drag`。后续在 TopNav 内新增可点元素必须放进该 no-drag 容器，否则点击会被拖拽吞掉。
- **计时重渲染驱动**：SlideCard 与 RunControlBar 均须 `useRunStore((s) => s.tick)` 订阅 1s ticker，耗时由 `stageStartedAt` 实时算出而非存增量。新增任何展示耗时的组件都要照做。
- **zustand 订阅纪律**：逐字段 selector，派生（队列分组、日期分组、活动页过滤）一律放组件内 `useMemo`。selector 内返回新数组/新对象会触发无限重渲染——`SlideCardGrid` 因此订阅 `slides` 后再 memo 过滤，而不是用 `activeSlides()`。
- SlideCard 外层用 `div + role="button"`（而非 `<button>`）：阶段轨道在传入 `onStageClick` 时会渲染按钮，`button` 嵌套非法。阶段 D 的 StageRail 复用同一 `StageTrack`（`size="md"`）即可获得"从该阶段重跑"入口。
- 活动日志的拉取集中在 `ConsolePage`（deckPath 变化时 load / 清空），`ActivityPanel` 只消费 store，避免折叠展开触发重复 IPC。
- 删除 V1 残留：`pages/DeckPage.tsx`、`components/deck/SlideCard.tsx`、`components/deck/SlideGrid.tsx`（全仓 grep 确认无引用）。`App.tsx` 路由改为 `ConsolePage`。

**遗留（未变，仍为 pre-existing）**：`biome check` 3 处 V1 报错——`TextBlockOverlay.tsx` 的 `noUselessFragments` / `useSemanticElements`（阶段 E2），`SlidePage.tsx` 的 `useExhaustiveDependencies`（阶段 D 随工具栏重写处理）。

## 阶段 D：单页复核（SlidePage 壳层重写）

- [ ] D1 SlideToolbar：运行此页 / 从阶段重跑菜单 / 保存与脏标记 / 页间导航
- [ ] D2 StageRail 常驻 + 失败阶段错误详情
- [ ] D3 AcceptFlow：accept-clean（SliderCompare + 清单 + 接受/拒绝重跑）、accept-pptx（清单 + 确认）
- [ ] D4 侧边栏三块视觉重做（属性 / 来源 / 低置信度队列），画布内核接入回归
- [ ] D5 队列"处理下一项"导航闭环

验证：画布全部 V1 交互回归（选中/双击编辑/拖拽/右键分类/includeInMask/缩放平移）；验收记录写入 manifest 后用 CLI `deck status` 核对。

## 阶段 E：收尾

- [ ] E1 doctor 启动提示 + 导出前警告
- [ ] E2 DESIGN.md 合规走查（对照 token 表逐组件核对；无 hover 新增样式；display ≤ 500 weight）
- [ ] E3 全量验证：`pnpm format:check && pnpm typecheck && pnpm test && pnpm build`
- [ ] E4 真实 deck 端到端：创建 → 批量 → 逐页验收 → 导出 → PowerPoint 打开确认

## 回滚点

- 阶段 A 完成即 commit（main 层独立可回滚）；C、D 各自完成后 commit。
- 风险文件：`ipc/channels.ts`（类型契约中枢）、`deck-store`（多处消费）。改动前先全仓 grep 消费点。

## 遗留清理

- [x] 移除 `slide:run` 通道后确认 renderer 无残留调用
- [x] 删除 pipeline-store 及其引用（阶段 B 收口，全仓 grep 已确认无残留）
- [ ] `out/` 构建产物按现有仓库习惯处理（当前被 git 跟踪，保持现状，不在本任务内改变策略）

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

- [x] D1 SlideToolbar：运行此页 / 从阶段重跑菜单 / 保存与脏标记 / 页间导航
- [x] D2 StageRail 常驻 + 失败阶段错误详情
- [x] D3 AcceptFlow：accept-clean（SliderCompare + 清单 + 接受/拒绝重跑）、accept-pptx（清单 + 确认）
- [x] D4 侧边栏三块视觉重做（属性 / 来源 / 低置信度队列），画布内核接入回归
- [x] D5 队列"处理下一项"导航闭环

验证：`pnpm typecheck` / `pnpm test`（125 项）/ `pnpm build` 三项全绿；`biome check` 无新增报错。**dev 模式画布交互回归与 CLI `deck status` 核对待人工执行**（选中/双击编辑/拖拽/右键分类/includeInMask/缩放平移；验收记录写入 manifest 后用 CLI 核对）。

**实施补充（阶段 D 实际产出，供后续阶段对齐）**

- **验收闸门判定改为两层合并**（关键修正）：新增 `renderer/lib/accept-gate.ts` 的 `deriveAcceptGate(slide, sessionResult)` —— 会话层 `gate === "manual"` 且 `stoppedAt` 是验收阶段时优先采用，否则回落耐久层（产出阶段 completed 且验收阶段未 completed）。V1 与阶段 B 的过渡实现只认会话层，**重启后待办队列里的"待验收"项点进去是一片画布、无从验收**，队列的"点一次到达"承诺形同失效。`todo-queue` 已改为复用同一 `awaitingAcceptance`，杜绝"队列说待验收、页面打不开验收面板"的语义漂移。优先级同队列：`accept-pptx > accept-clean`。
- **新增纯逻辑模块**（均相对 `.js` 导入、不触碰 `window`，可被 vitest 直接消费）：`lib/accept-gate.ts`（13 测试）、`lib/slide-nav.ts`（7 测试，`orderedActiveSlides` / `adjacentSlides`，页序与队列同为 `Intl.Collator` 数字序，**不做环形导航**——首尾禁用按钮）、`stores/todo-queue.ts` 追加 `flattenTodoQueue` / `nextTodoItem`（6 测试，**环形扫描**：走到末尾回绕队首，因为处理完的项会离队而前面的组可能还没做完）。测试增至 125 个（新增 26）。
- **计时订阅下沉**：`SlideToolbar` 与 `StageRail` 各自订阅 `run-store.tick`，SlidePage 只订阅非计时字段。若由页面透传耗时，整页——包括画布——会每秒重渲染。新增任何展示耗时的组件都要照此办理（与阶段 C 同一纪律）。
- **切页状态重置改用 `key`**：`App.tsx` 以 `<SlidePage key={selectedSlideId} />` 触发重挂载，视图态/侧边栏页签/临时提示自然回到初始值。原先写成 `useEffect(..., [slideId])` 会被 biome `useExhaustiveDependencies` 判为多余依赖（effect 体内并未读取 slideId），这是 React 惯用解法而非绕过 lint。
- **视图态三选一**：`canvas` / `compare` / `accept` 共用同一壳层，验收布局自带右栏清单，此时隐藏复核侧边栏以免双侧栏。闸门签名 `slideId:stage:source` 变化时自动切入验收——含 `source` 是为了「拒绝重跑 → 再次停在同一闸门」能重新进入；用户手动切回画布后签名不变，不会被强行拉回。
- **重复入队防护**：`pageBusy = runStatus !== "idle" && currentSlideId === slideId` 时禁用「运行此页」「从阶段重跑」与验收动作。DeckRunner 的 `queue.some` 去重只覆盖**排队中**的页，正在执行的项已 shift 出队列，再次入队会让同一页跑两遍。其它页执行中时本页仍可入队（DeckRunner 支持同 deck 追加）。
- **StageRail**：复用 `StageTrack size="md"` 与 `STAGE_DOT_CLASS` 唯一色表，点位可点即「从该阶段重跑」，下方一行阶段中文名与点位对齐（轨道横跨整页宽，10 个标签有余量）。错误条合并耐久层 `slide.lastError`（优先，带阶段与时间戳）与会话层 `sessionResult.error`（兜底：`PIPELINE_RUN_FAILED` 这类前置失败没有 manifest 记录）。
- **AcceptFlow 清单与 CLI 对齐**：条目 key 直接取 CLI `runAcceptClean` / `runAcceptPptx` 的 `DEFAULT_CHECKLIST`（clean 4 项、pptx 5 项，V1 的 clean 清单漏了 `sizeCorrect`）。拒绝验收 = 从产出阶段重跑，clean 提供 mask/clean 两档、pptx 一档（`REJECT_RERUN_STAGES`）。
- **删除**：`components/pipeline/AcceptPanel.tsx`、`components/pipeline/StageProgress.tsx`（被 AcceptFlow / StageRail 取代），连带删掉 `stage-view.ts` 的 `mergeStageStatuses`（它是"兼容 StageProgress"的适配器，唯一消费者消失后即死代码）及其测试。
- **侧边栏视觉**：去掉 `pipeline` 页签（StageRail 已常驻），三块统一 14px 字号（不再使用文档外的 12px）、去掉全部 `hover:` 样式（DESIGN.md 只定义 Default / Active-Pressed）、选中态改用背景色调切换（对齐 `pricing-tier-card-featured` 的做法），输入控件 `rounded-sm` + hairline。`includeInMask` 的约束提示改为 mustard 底 + ink 文字——mustard 作为白底前景色对比度不足。
- 阶段 B 遗留的 `SlidePage.tsx` `useExhaustiveDependencies`（Cmd+S 过期闭包）已随工具栏重写修复：`handleSave` 用 `useCallback` 包装并进入 effect 依赖。

**遗留**

- `biome check` 仍有 2 处 V1 报错，均在画布内核 `TextBlockOverlay.tsx`（`useSemanticElements` / `noUselessFragments`），按计划留待阶段 E2。阶段 D 未新增任何报错。
- **验收清单未逐项落库**：IPC `AcceptOptions` 只有 `acceptedBy` / `note`（阶段 A 定型），CLI 侧 `checklist` 落为默认全 true。UI 强制全勾才允许提交，语义等价，但要真实反映"用户勾了哪几项"需扩展 IPC 契约（channels + slide.ts + preload），不在本阶段范围。
- **验收前无自动检查数值**：`autoCheckSummary` 由 CLI 在 accept 执行时返回，验收**前**读不到（manifest 的 check report 未经 `status-detailed` 暴露）。当前在验收提交后以页面级反馈条展示。若要前置展示需新增只读 IPC。

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

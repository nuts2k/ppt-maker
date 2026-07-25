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

- [x] E1 doctor 启动提示 + 导出前警告
- [x] E2 DESIGN.md 合规走查（对照 token 表逐组件核对；无 hover 新增样式；display ≤ 500 weight）
- [x] E3 全量验证：`pnpm format:check && pnpm typecheck && pnpm test && pnpm build`
- [ ] E4 真实 deck 端到端：创建 → 批量 → 逐页验收 → 导出 → PowerPoint 打开确认（**需人工执行**，见下）

**实施补充（阶段 E 实际产出）**

- **检查项按影响面分两级**（E1 的关键决策）：新增 `renderer/lib/doctor-view.ts`（纯函数，16 个单测）把 doctor 检查项分成关键项 `platform / swift / powerpoint / font-microsoft-yahei` 与基线项 `node / pnpm`。启动提示只看关键项——基线项在打包后的应用里缺失是常态，本机实测即为佐证：`node v25.8.0` 相对 Node 24 LTS 基线报 warn，若不分级则每次启动都要弹一条与用户无关的警告。chip 的计数仍覆盖全部检查项，与下拉明细同口径，分级只影响提示时机而非诚实计数。
- **导出判据比启动提示更窄**：`EXPORT_CHECK_IDS` 只含 `powerpoint` 与 `font-microsoft-yahei`。Swift 缺失不影响已完成页的拼装（`deck export` 只做 pptx 组装，不跑 OCR），不该在导出时二次打扰。字体缺失不会让 `deck export` 抛错（`assertPptxFontReady` 只在单页 `slide pptx` 路径生效），而是让新生成的占位页在 PowerPoint 里静默字体回退——这正是必须在导出**前**告知的理由。
- **提示形态为条形而非模态**：DESIGN.md 没有模态语言，且 PRD F5.1 要求「不阻止打开」。新增 `components/layout/DoctorNoticeBar.tsx`，启动提示（动作＝「知道了」）与导出确认（动作＝「仍要导出」/「取消」）复用同一条，与既有导出结果条同处顶栏下方一列。chip 与下拉抽成 `components/layout/DoctorChip.tsx`，报告仍由 `TopNav` 持有并透传——导出警告要用同一份数据，chip 自行拉取会出现两份报告不一致。
- **E2 走查结论**：颜色全部落在 DESIGN.md token 内（实测使用中的 `bg-/text-/border-/ring-` 自定义色 27 个，无一例外）；字重只有 `font-medium`(500) × 80 与 `font-normal`(400) × 1，无 600+；圆角全部 `rounded-xs/sm/md/lg/full`；全仓无 `hover:`、无 `shadow`。修正三类偏差：
  - **12px 字号清零**（18 处）：`text-xs` 低于 DESIGN.md 最小档（body-md 14px），统一改为 `text-sm`，沿用阶段 D 侧边栏已确立的方向。活动日志时间列随之从 `w-16` 放宽到 `w-20`，否则 14px 的 `12:34:56` 会被截断。
  - **画布分类色映射到文档内 token**：`#16a34a / #9ca3af / #f59e0b` 三个文档外强调色（DESIGN.md 明确禁止签名色板外新增强调色）改为 `success-border / border-strong / signature-mustard`，语义分别是「已确认版面文字」「对象整合符号」「不确定」，最后一项与全局「待处理＝mustard」同色。
  - **tailwind config 清理**：删掉 9 个从未被引用的文档外 token（`error*` / `warning*` / `block-*`），新增 `display-md`(32px/1.2) 一档并把 `DeckEmptyState` 的 `text-[32px] leading-[1.2]` 换掉——tailwind 默认刻度的 14/16/18/20/24px 恰好对上 DESIGN.md，只有 32px 档缺失。
- **保留的例外（两处，均在画布标注层）**：`TextBlockOverlay` 的块内文字与 `TextEditor` 的编辑框同为 `text-[10px]`。尺寸由识别框 bbox 决定，用界面字号会溢出小块；两者必须同号，否则双击进入编辑时文字会跳大。已在代码注释中写明理由。
- **biome 报错清零**：阶段 A 起挂账的 2 处 V1 报错已修 —— `noUselessFragments`（多余 fragment 包裹 `HANDLE_POSITIONS.map`，改为条件短路直出数组）、`useSemanticElements`（块内含 8 个手柄按钮与编辑态 textarea，`<button>` 会构成非法嵌套，按 `SlideCard` 同一模式加 `biome-ignore` 并说明）。
- **E3 结果**：`pnpm format:check`（142 文件）/ `pnpm typecheck`（3 包）/ `pnpm test`（cli 78 + desktop 141 = 219）/ `pnpm build` 四项全绿。desktop 测试较阶段 D 增加 16 个（`doctor-view`）。

**E4 走查中发现的三个缺陷（均为 M4 早期埋下，非 E 阶段引入，已修复）**

E4 一开始就卡住，连续暴露三个问题。共同特征是**失败被静默吞掉**，界面上一律表现为「点了没反应」：

1. **单页复核完全打不开**（`ipc/slide.ts`）：`slide:load-review` / `save-review` 把路径写成 `<ws>/review/text-blocks.json`，真实位置是 `<ws>/stages/review/text-blocks.json`。readFile 失败被 `catch { return null }` 吞掉 → 画布 0 个文字块、侧边栏三块全空、控制台无任何报错。已提成文件内常量 `REVIEW_RELATIVE_PATH` 并注明必须与 CLI 三处（`review.ts` / `assist-review.ts` / `validate-review.ts`）一致。注意 `slide:load-image` 无此问题——它读 `manifest.assets` 的 path，是数据驱动的，所以图片一直正常显示，更难联想到路径错误。
2. **「标记已复核」这个动作在 UI 里从未实现**：renderer 全仓搜 `reviewStatus` 只有读、没有写。`assist-review` 只自动确认高置信块，其余需人工确认，但界面上无从操作 → `mask/run.ts:152` 门禁「存在未复核却参与 mask 的文字块」必然失败，整条流水线走不下去。补齐两档：PropertyPanel 单块「标记已复核」+ SlideToolbar 整页「全部标为已复核 N」。纯逻辑在 `lib/review-status.ts`（8 个单测），`accepted_with_risk` 不被批量覆盖（它带 `riskAcceptance` 记录，语义不同）。
3. **断点续跑死锁**（`slide-detail.ts` 的 `computeResumeStage`）：原实现 `if (TRANSIENT.has(stage)) continue` 直接跳过 `validate-review`。用户保存复核后 `text-blocks.json` 的 sha 变化，mask 报「在校验后已改动，请重新运行 validate-review」，而续跑起点恒为 mask、永不回头校验——**点多少次「运行此页」都不动**。改为：判据仍只看持久阶段（避免每轮从头），但起点**回退到未完成阶段前最近的瞬态阶段**；下游已完成则不回退（说明当时校验通过过）。回退安全，validate-review 是纯离线幂等的毫秒级校验。
   - 此改动打破了 3 个既有测试，它们恰好把死锁行为固化成断言（`.toBe("mask")` / `.not.toBe("validate-review")`）。已重写并在用例名与注释中写明死锁场景，防止被「修复」回去。

**E4 遗留待查（下个会话接手点）**

- **失败反馈链路存疑**（问题 C，未动）：mask 在前置校验就抛错，manifest 里 `attempts: []`，耐久层 `extractLastError` 读不到东西，错误只存在于会话层 `sessionResult.error`。三次失败用户全程只感觉到「不动」。需确认 StageRail 的错误条在这种「无 manifest 记录的前置失败」下是否真的渲染。
- **画布滚轮 preventDefault 失效**（pre-existing，`useCanvasTransform.ts:88`）：React 18+ 把 wheel 注册为 passive listener，`e.preventDefault()` 被忽略并刷屏警告。缩放平移本身正常（`overflow-hidden` 兜住了），但 Cmd/Ctrl+滚轮拦不住浏览器页面级缩放。修法是改用原生 `addEventListener("wheel", h, { passive: false })`。属画布内核，M4 计划划了「不改交互逻辑」的红线，需确认后再动。
- **路径常量重复 5 处**：`stages/review/text-blocks.json` 在 CLI 三处 + desktop 一处各自定义，正是缺陷 1 的根因。根治需提到 `@ppt-maker/core` 统一导出，会动 CLI 三个文件，未做。

**E4 当前测试数据状态**

- deck 工作区：`~/test/ppttest-2026-07-25`（2 页，源图来自 `~/test/ppttest/`，已裁/补白为 16:9）
- `page-01`：60 块（53 layout_text + 7 uncertain 已全部分类完），阶段 `init/ocr/review/assist-review` completed，mask 及之后 pending
- `page-02`：95 块，全部 layout_text
- 本机 doctor：关键项全 pass，仅 `node v25.8.0` 偏离 Node 24 基线（基线项，不触发启动提示、不拦截导出）
- `.env` 已配（根目录，网关 `gpt-image-2` 可用，探测 HTTP 200）

**E4 待人工执行**（需 GUI、真实 PPT 截图与 API key，无法在无头环境完成）

**新会话接手步骤**：`pnpm desktop` 启动 → 打开 `~/test/ppttest-2026-07-25` → 进 page-01 → 工具栏「全部标为已复核 40」→ **⌘S 保存**（不保存则磁盘仍是旧文件）→「运行此页」，此时应先跑 validate-review 刷新 sha 再进 mask。clean 阶段会真实调 `gpt-image-2` 上传图片，需确认上传。活动日志在 `~/Library/Application Support/@ppt-maker/desktop/activity/*.jsonl`，用它判断「不动」到底是卡住还是快速失败。

1. 创建：从图片目录新建 deck，确认卡片网格与页数正确。
2. 批量：「处理全部」跑完整流水线，观察卡片轨道实时推进、控制条计时、停止语义、失败页错误条。
3. 逐页验收：从待办队列点进单页，走 accept-clean（SliderCompare + 清单）与 accept-pptx，确认「处理下一项」闭环；验收记录用 CLI `deck status` / `slide report` 核对。
4. 导出：确认导出前警告在本机（关键项全 pass）**不**出现，导出成功条给出原生/占位页数。
5. PowerPoint 打开导出的 pptx，确认字体与版面。

## 回滚点

- 阶段 A 完成即 commit（main 层独立可回滚）；C、D 各自完成后 commit。
- 风险文件：`ipc/channels.ts`（类型契约中枢）、`deck-store`（多处消费）。改动前先全仓 grep 消费点。

## 遗留清理

- [x] 移除 `slide:run` 通道后确认 renderer 无残留调用
- [x] 删除 pipeline-store 及其引用（阶段 B 收口，全仓 grep 已确认无残留）
- [x] tailwind config 孤儿 token 清理（阶段 E 收口：`error*` / `warning*` / `block-*` 共 9 个）
- [ ] `out/` 构建产物按现有仓库习惯处理（当前被 git 跟踪，保持现状，不在本任务内改变策略）

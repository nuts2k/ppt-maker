# 桌面端切换工作区

## Goal

桌面端运行中能换到另一个 Deck 工作区，不必退出重启应用。

来源：M4 归档时记下的一条遗留缺陷（`ROADMAP.md` M4「已知缺口」、归档任务 `07-22-desktop-review-workbench/implement.md`），
在 `07-28-review-ux-convergence` 中被显式列入 Out of Scope，至今无主。

## Background

打开与创建工作区的入口只存在于欢迎空态 `DeckEmptyState`（`apps/desktop/src/renderer/components/console/DeckEmptyState.tsx:24`、`:34`），
而该组件仅在 `deckPath === null` 时渲染（`apps/desktop/src/renderer/pages/ConsolePage.tsx:55`）。
一旦打开任何 deck，`deckPath` 不再回到 null，入口随之消失——换 deck 只能重启进程。

### 代码现状（2026-07-29 核对）

- `deck:open` 是无状态查询，handler 只调 `buildDeckStatus(path)`（`apps/desktop/src/main/ipc/deck.ts:146`），
  main 侧不持有「当前 deck 会话」，因此切换在 IPC 层没有需要拆除的东西。
- 唯一在 main 侧跨 deck 持有状态的是 `DeckRunner`（`apps/desktop/src/main/runner/deck-runner.ts:34`），
  它持有 `deckPath` / `deckId` / `queue`，且 `start()` 已会拒绝「已有其他 deck 正在执行」。
- renderer 侧持有 deck 相关状态的 store 共五个：
  - `deck-store`（有 `reset()`，`deck-store.ts:148`）
  - `run-store`（有 `reset()` 与 `stop()`，`run-store.ts:169` / `:50`）
  - `slide-store`（有 `reset()` 与 `dirty` 未保存标志，`slide-store.ts:161` / `:21`）
  - `activity-store`（有 `reset()`，`activity-store.ts:47`）
  - `ui-store`（**没有 `reset()`**，持有 `currentView` / `selectedSlideId` / `selectedBlockId`，`ui-store.ts:9`）
- 现有 `reset()` 调用点只有一处：`ReviewPage.tsx:119` 的卸载清理。切换 deck 目前不触发任何 reset。
- 目录选择走 `window.api.system.selectDirectory()`（`apps/desktop/src/preload/index.ts:103` → `main/ipc/system.ts:22`），
  原生 `dialog.showOpenDialog`，可直接复用。
- 顶栏整条 `h-16` 是 macOS hiddenInset 拖拽区（`TopNav.tsx:111`），其中可交互元素必须显式 `no-drag`。
- 下拉面板已有可抄的既有模式：`DoctorChip.tsx:52`（绝对定位面板 + 点外关闭 effect）。
- 未保存复核改动目前只有黄点提示 + 手动 ⌘S 保存（`SlideToolbar.tsx:211`、`ReviewPage.tsx:233`），
  离开单页视图时静默丢弃，无确认。

## Requirements

- **R1 入口**：顶栏当前 deck 名称/路径块（`TopNav.tsx:117-128`）变为可点区域，点开下拉菜单，
  含「打开其他工作区…」与「从图片目录创建…」两项，分别复用 `DeckEmptyState` 现有的
  `handleOpen` / `handleCreate` 逻辑。下拉交互抄 `DoctorChip.tsx:52`。可点区域必须显式 `no-drag`。
  未打开 deck 时顶栏该块本就不渲染，空态入口保持不变。

- **R2 状态清零**：切换成功后所有 deck 相关状态归零，不残留上一个 deck 的页卡片、阶段轨道、
  待办队列、活动日志、选中页与选中块。涉及全部五个 store；`ui-store` 需新增 `reset()`
  （`currentView` 回 `console`，`selectedSlideId` / `selectedBlockId` 置 null，两个面板展开态回默认）。

- **R3 失败不牺牲当前 deck**：必须先 `deck:open` 成功、再清零并套用新状态。
  顺序反了会导致选错目录时掉进空态、把好好的当前 deck 弄丢。
  失败时停在当前 deck，错误沿用现有错误条呈现。

- **R4 执行中禁止切换**：`runStatus !== "idle"` 时下拉两项禁用，并给出「执行中不可切换，请先停止」。
  与导出按钮现有口径一致（`TopNav.tsx:60` 的 `exportDisabled` 已含 `running`）。
  不做「自动 stop 后切换」：`stop()` 只停队列，已发起的阶段仍在跑，其事件会打到新 deck 的界面上。

- **R5 未保存改动拦一次**：`slide-store.dirty` 为 true 时，点下拉任一项先弹确认
  「当前页有未保存的复核改动，切换将丢弃」+「仍要切换」/「取消」，复用 `DoctorNoticeBar` 样式。
  取消则不切换且草稿保留。不做自动保存：`saveReview()` 会连带作废下游阶段
  （`main/save-invalidation.ts` 的 `decideInvalidation`），而用户在切 deck 的当口看不到「哪些阶段被作废」的提示。

## Acceptance Criteria

- [ ] AC1 已打开 deck 时，顶栏名称/路径块可点并展开含两项的下拉；点击面板外关闭。（R1）
- [ ] AC2 顶栏可点区域的点击不被拖拽区吞掉，下拉能正常展开。（R1）
- [ ] AC3 选「打开其他工作区…」并选定另一个合法 deck 目录后，顶栏名称与路径更新为新 deck；
      卡片网格、阶段轨道、待办队列、活动日志均为新 deck 内容，无上一个 deck 的残留条目。（R2）
- [ ] AC4 切换前处于单页复核视图时，切换后视图回到控制台，选中页与选中块为空。（R2）
- [ ] AC5 选一个非 deck 工作区的目录导致 open 失败时，顶栏路径与卡片网格仍是原 deck，
      错误信息以现有错误条呈现。（R3）
- [ ] AC6 `runStatus !== "idle"` 时下拉两项为禁用态并带「执行中不可切换，请先停止」提示；
      停止执行后恢复可用。（R4）
- [ ] AC7 单页复核改动未保存（黄点在）时点下拉任一项，先出确认条；
      点「取消」不切换且改动仍在（黄点仍在、内容未丢）；点「仍要切换」才切换。（R5）
- [ ] AC8 「从图片目录创建…」在已打开 deck 的状态下可用，创建成功后直接切到新建的 deck。（R1 R2）
- [ ] AC9 `pnpm format:check && pnpm typecheck && pnpm test && pnpm build` 全绿；
      新增的 store 清零与禁用判定有单测覆盖（基线 418 例，新增后不减少）。

## Out of Scope

- 「最近打开的工作区」历史列表与快捷重开——单人本地使用，原生目录框自带最近位置记忆，YAGNI。
- 原生应用菜单项与 ⌘O 快捷键。
- 多工作区同时打开 / 多窗口。
- 「返回控制台」路径上同样存在的未保存改动静默丢弃：本任务只在切换工作区这一路径上加确认，
  不顺手扩大到复核页返回（已知不一致，留待后续）。
- 工作区目录合法性校验的增强，沿用 `deck:open` 现有报错。

## Technical Notes

- 改前端前先读 `DESIGN.md`（颜色、圆角、间距、按钮样式）与 `.trellis/spec/frontend/`
  （尤其 `state-management.md` 里 `07-28` 沉淀的状态派生约定）。
- 验证：`pnpm format:check && pnpm typecheck && pnpm test && pnpm build`。
  改 `main` 侧或 `@cli/src` 后必须重启 `pnpm dev`，HMR 只覆盖 renderer。
- 真机走查方式：`cd apps/desktop && REMOTE_DEBUGGING_PORT=9222 pnpm dev`，
  用 CDP 的 `Runtime.evaluate` / `Input.dispatchMouseEvent` 驱动界面；
  原生目录选择框 CDP 够不到，打开工作区需走 `import('/stores/deck-store.ts')` 拿 store 调 `openDeck`
  （`window.api` 被 contextBridge 冻结，无法打桩）。
- 走查工作区：`~/test/ppttest-walkthrough-E2`（干净基线副本）；
  `~/test/ppttest-walkthrough-E1` 继续跑会烧 gpt-image-2；`~/test/ppttest-2026-07-25.bak-baseline` 勿动。
  本任务需要两个工作区才能验证切换，可再复制一份 E2 作为切换目标。

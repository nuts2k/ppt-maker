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

- [x] AC1 已打开 deck 时，顶栏名称/路径块可点并展开含两项的下拉；点击面板外关闭。（R1）
- [x] AC2 顶栏可点区域的点击不被拖拽区吞掉，下拉能正常展开。（R1）
- [x] AC3 选「打开其他工作区…」并选定另一个合法 deck 目录后，顶栏名称与路径更新为新 deck；
      卡片网格、阶段轨道、待办队列、活动日志均为新 deck 内容，无上一个 deck 的残留条目。（R2）
- [x] AC4 切换前处于单页复核视图时，切换后视图回到控制台，选中页与选中块为空。（R2）
- [x] AC5 选一个非 deck 工作区的目录导致 open 失败时，顶栏路径与卡片网格仍是原 deck，
      错误信息以现有错误条呈现。（R3）
- [x] AC6 `runStatus !== "idle"` 时下拉两项为禁用态并带「执行中不可切换，请先停止」提示；
      停止执行后恢复可用。（R4）
- [x] AC7 单页复核改动未保存（黄点在）时点下拉任一项，先出确认条；
      点「取消」不切换且改动仍在（黄点仍在、内容未丢）；点「仍要切换」才切换。（R5）
- [x] AC8 「从图片目录创建…」在已打开 deck 的状态下可用，创建成功后直接切到新建的 deck。（R1 R2）
- [x] AC9 `pnpm format:check && pnpm typecheck && pnpm test && pnpm build` 全绿；
      新增的 store 清零与禁用判定有单测覆盖（基线 418 例，新增后不减少）。

## 走查结果（2026-07-30，CDP 驱动真机）

九条 AC 全部通过。校验：format 176 文件、typecheck 干净、**459 例全过**（core 76 + desktop 290 + cli 93，
基线 418 → 新增 41）、`pnpm build` 三段成功。

走查方式：`REMOTE_DEBUGGING_PORT=9222 pnpm dev` + CDP。**点击一律用 `Input.dispatchMouseEvent` 而非 `el.click()`**——
no-drag 漏标恰恰表现为「真人点不动、脚本点得动」，用 `el.click()` 会让 AC2 假通过。
源工作区 `~/test/ppttest-walkthrough-E2`，切换目标 `~/test/ppttest-switch-target`（E2 的副本，
已把 `name` 改成「切换目标 Deck」、`deckId` 换成新的——两边 deckId 不同才能暴露「按 deckId 判断变化」这类 bug）。

三条打了折扣的验证，如实记录：

- **AC2** 除真实鼠标事件点开外，另取了 computed style `webkitAppRegion === "no-drag"` 作为静态证据。
  严格说 CDP 注入的事件是否完全等价于窗口层命中测试无法自证，两条证据叠加后认为可信。
- **AC6** 的「执行中」用 `run-store.setState({status:"running"})` 模拟，未真跑一轮流水线（会烧 gpt-image-2）。
  验的是 UI 派生逻辑，判据函数另有单测。
- **AC7** 的第三条「点『仍要切换』才切换」未在真机验证：它会打开原生目录框，CDP 够不到。
  由 `workspace-menu.test.ts` 的「确认『仍要切换』后才真正切换」覆盖。

## 实现中发现并一并修掉的既有竞态

切换能力把四处「await 后无条件 set」从几乎不可触发变成了常规路径——旧 deck 的请求飞在半空时切过去，
返回后就把旧数据写进新 deck 的界面，且完全静默。四处均已加守卫并配回归测试
（`apps/desktop/test/store-race-guard.test.ts`，13 例）：

| 位置 | 判据 |
|---|---|
| `deck-store.refreshStatus()` | `get().deckPath !== deckPath` 则丢弃（成功与失败两条路径都守） |
| `deck-store.refreshSlide()` | 同上 |
| `slide-store.loadSlide()` | `get().workspacePath !== workspacePath` 则丢弃，同时覆盖切页与切换工作区两条失效路径 |
| `activity-store.load()` | 模块内 `listSeq` 最后请求 wins；`reset()` 里一并 `listSeq += 1`，堵住 reset 到新 load 之间的空档 |

测试做过变异验证（守卫逐处改成 `if (false)` 重跑）：13 例中 9 例转红、4 例正对照保持绿，
确认守卫不是恒真也能过。其中 `refreshSlide` 的用例第一版在变异下没红（两个 deck 用了不同 slideId，
`replaceSlide` 找不到就原样返回），已改成两边同名 `page-01` 后转红。

## 遗留（未处理，非本任务引入）

- 切换失败的错误文案是原始 IPC 报错（`Error invoking remote method 'deck:open': Error: ENOENT…`），
  技术化但可见。属 `openDeck` 既有错误处理。
- 工作区命名用 `new Date().toISOString()` 取 UTC 日期，本地入夜后创建会「提前一天」
  （走查实证：本地 07-30 20:25 创建出 `tiny-images-2026-07-31`）。既有规则，本次只是原样抽取。
- 为让三个 store 进得了 test 的类型图，新增了 `test/renderer-window.d.ts`（ambient `window: { api: IpcApi }`）
  并把 `slide-store.ts` 的两个 import 由 `@/lib/...` 改为相对 `.js`（同 `run-bridge.ts` 的既有取舍）。
  代价：main 侧误写 `window.api` 不再被类型系统拦住（`window.document` 之类仍会报错）。
  更干净的替代是让 `lib/ipc-client.ts` 改用 `(globalThis as { api?: IpcApi }).api` 把断言收在一处，
  再让 `deck-store` / `activity-store` 也统一走 `getApi()`（`slide-store` 已经是）。收益偏小，未做。
- 切换后新 deck 首次执行时 ticker 重启与 IPC 订阅存续，只做了代码论证未真机跑
  （`startTicker` 唯一调用点在事件处理里、守卫为 `tickerHandle !== null`；订阅句柄在 `useRunBridge`
  的 effect cleanup 里，`reset()` 的浅合并动不到它）。真机验证需跑一轮流水线，会烧 API。

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

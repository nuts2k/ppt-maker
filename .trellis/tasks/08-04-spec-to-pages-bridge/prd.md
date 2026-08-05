# 规格产出到建页的衔接

## Goal

补上 M6 留下的接缝：规格已经在 deck 里了，但界面上没有一条直达的「按这份规格把页建出来」。
用户在策划工作台产出规格后回到控制台，看到的是空页面网格与一句指向「添加页面」的提示，
而「添加页面」的生成档只认**外部规格文件**和**重新产初稿**两条路，不认这个 deck 自己
刚写好的规格。

## Background：真实触发场景

2026-08-04，用户在策划工作台生成规格后回控制台，页面网格为空，不知道下一步该点什么。
排查确认这不是误操作，是 M6 三个子任务之间的接缝——② 做编辑器、③ 做对话，
「规格产出后怎么变成页」两边都默认对方管了。

## 确认事实（代码查证，实现时若与代码不符须先回本节订正）

| # | 事实 | 位置 |
|---|---|---|
| F1 | `reconcileDeckSpec` 返回**三类**：`newEntries` / `missingPages` / `drifted` | `apps/cli/src/deck/content-spec.ts:148` |
| F2 | 渲染层 `classifyOutdatedPages(slides)` 只分 `drifted` / `missing` / `notApplicable`，**没有 newEntries**——它只吃 `slides`，拿不到 spec 条目 | `apps/desktop/src/renderer/lib/planning-core.ts:47` |
| F3 | 「规格影响」面板在 `drifted.length === 0 && missing.length === 0` 时**整个不渲染**，所以零页 deck 在策划页看不到任何建页提示 | `apps/desktop/src/renderer/pages/PlanningPage.tsx:1076` |
| F4 | `SlideDetail` **已带 `specEntryId`**（「生成页对应的规格条目；非生成页为 null」），因此 newEntries 可在渲染层纯前端算出，**不需要新 IPC** | `apps/desktop/src/main/ipc/channels.ts:63` |
| F5 | `SourcePicker` 生成档只有两条路 `SpecMode = "file" \| "draft"`（选已有规格文件 / 从构思产初稿），是 M5 E1 的设计 | `apps/desktop/src/renderer/components/console/SourcePicker.tsx:60` |
| F6 | CLI `runDeckGenerate` 已用 `reconcileDeckSpec` 做**幂等**：已生成且未改动的条目会被跳过。既有确认文案已如此声明 | `apps/cli/src/deck/generate.ts:166`、`source-picker-core.ts:101` |
| F7 | 付费确认已有两套可复用：`buildGenerateConfirm(callCount)`（最多 N 次，可能更少）与 `buildRegenerateBatchConfirm(pageLabels)`（确切 N 次） | `source-picker-core.ts:101`、`planning-core.ts:68` |
| F8 | 建页任务与规格写入的互斥防线已存在，两侧都已接线 | `DeckRunner.isSourceTaskRunning`、`PlanningPage.tsx:153` |
| F9 | 控制台零页空态文案现为「用右上角『添加页面』从图片、PDF 或内容规格加进来」 | `ConsolePage.tsx:394` |
| F10 | **`DeckGenerateOptions.specPath` 本来就是可选的**，注释原文：「外部规格文件；deck 内已有权威副本时可省略（等价于『只对账、补缺页』）」。`runDeckGenerate` 在省略时读 `loadDeckContentSpec(deck.path)`。即「用当前 deck 的规格建页」**CLI 侧早就有**，桌面端只是没接 | `apps/cli/src/deck/generate.ts:37`、`:200` |
| F11 | `runDeckGenerate` **没有条目子集选项**：它对 `reconciliation.newEntries` 全量循环建页，串行、单页失败不中断 | `apps/cli/src/deck/generate.ts:243` |
| F12 | 读 deck 内规格的 IPC **已存在**：`deck:read-deck-spec` → `loadDeckContentSpec`，**无规格时返回 `null`**。控制台可直接复用，零新增通道 | `apps/desktop/src/main/ipc/deck.ts:406`、`preload/index.ts:85` |
| F13 | `SourceTaskBar` 是 `ConsolePage.tsx:222` 的**局部组件**，策划页看不到建页进度；但 `useSourceTaskStore` 是全局的，策划页可订阅 | `ConsolePage.tsx:222`、`stores/source-task-store.ts:22` |

**结论**：CLI 侧的「按 deck 内规格补缺页」能力齐全且幂等，缺的是界面入口与可见性。
唯一可能需要动 CLI 的是**条目子集**（见 D2）。

## 已定决策

| # | 决策 | 理由 |
|---|---|---|
| D1 | 「按规格建页」入口**只放策划页**的「规格影响」面板，新增「待建页」一档；控制台零页空态改为指路去策划工作台，**不动 SourcePicker** | 痛点发生在「刚产出规格」那一刻，出口就该在那里；`SourcePicker` 的「规格来源」两档回答的是*从哪拿规格*，「用当前 deck 的」回答的是*用已经拿到的*，并成三选一难解释；一个能力一个入口，省掉两处文案与付费确认各自演化（M6 的 `formatSpecHistoryWarning` 已有「两处措辞须一致」的教训） |
| D2 | 待建页**可逐条勾选、默认全选**；为此给 `runDeckGenerate` 加**可选** `entryIds`，省略时行为与今天逐字相同 | 建页是按次计费且不可撤销，M6 自己的真机走查用的就是「先建一页试水」；同一面板里「待建页」与「已过时」两档并排，一个能勾一个不能会很别扭；CLI 改动是纯增量可选参数，不动契约形状 |
| D3 | 待建页条目的显示复用初稿列表既有的 `summarizeSpec` 呈现（pageType + 标题），**不裸露 `specEntryId`** | 条目尚未建页，没有 `pageLabel`；裸 id 对用户无意义，而初稿列表已经解决过同一个呈现问题 |
| D4 | 建页进度必须在策划页可见：把 `SourceTaskBar` 从 `ConsolePage` 提取为共享组件，两页共用 | 在策划页发起、进度只在控制台可见，等于点完什么都没发生——正是本任务要修的那类断点。抄一份第二个进度条会再次踩「两处措辞须一致」 |
| D5 | 建页完成后**留在策划页**，给完成提示与「去控制台」按钮，不自动跳转、不自动跑流水线 | 自动跳会打断还想继续改规格的人；自动跑流水线越过付费与人工确认纪律（父任务 A8） |
| D6 | 规格有未保存草稿（dirty）时建页按钮禁用，沿用既有 drifted 那档的守卫与措辞口径 | 建页按磁盘现值走，草稿未落盘就建页会建出与界面所见不符的页；`PlanningPage.tsx:153` 已有同款守卫 |

## Requirements

- **R1 待建页一档**：策划页「规格影响」面板新增「待建页」，列出 `newEntries`
  （规格里有条目、deck 里还没建页）。默认全选、可逐条取消，条目按 D3 显示 pageType + 标题。
- **R2 面板渲染条件放宽**：现为 `drifted.length === 0 && missing.length === 0` 即整个不渲染
  （F3），须改为三类任一非空即渲染。零页 deck 是本任务的主场景，不放宽等于什么都看不到。
- **R3 建页动作**：勾选后经一次付费确认发起建页，走既有 `startSourceTask({kind:"generate"})`，
  **不传 specPath**，由 CLI 读 deck 内规格（F10）。确认文案给**确切**次数（勾选集合即执行集合）。
- **R4 CLI 条目子集**：`runDeckGenerate` 加可选 `entryIds`，过滤 `newEntries`；省略时行为不变。
  未知 id **整体拒绝**，不部分执行（沿用 `SPEC_PAGE_NOT_FOUND` 的既有口径）。
- **R5 进度可见**：`SourceTaskBar` 提取为共享组件，策划页与控制台共用一份（D4）。
- **R6 结果呈现**：建页完成后留在策划页给完成提示与「去控制台」按钮（D5）；
  部分成功如实分别报出成功页与失败条目，不吞失败。
- **R7 控制台空态指路**：零页空态调既有 `deck:read-deck-spec`（F12）；规格存在且有待建条目时，
  文案改为写明条数并指向策划工作台；无规格或读不到时退回现有文案（F9），不报错。
- **R8 守卫**：规格 dirty 时建页禁用（D6）；与既有建页任务 / 流水线互斥沿用 F8 的防线，
  不新造第二套判据。

## Acceptance Criteria

- [ ] A1 零页 deck + 6 条规格：策划页「规格影响」面板显示「待建页 6 条」，默认全选，
      逐条取消后按钮上的数字同步变化
- [ ] A2 只勾 1 条建页 → **只发起 1 次图像生成**，deck 内只多出 1 页；
      其余 5 条仍留在待建页一档
- [ ] A3 付费确认写明**确切**次数与不可撤销（父任务 A8 口径），且次数等于勾选数
- [ ] A4 建页过程中策划页能看见进度（第 N/M 页），不需要切到控制台
- [ ] A5 建页完成后策划页给出完成提示与「去控制台」按钮，且**不自动跳转、不自动跑流水线**
- [ ] A6 部分失败（造一条注定失败的条目）时成功页与失败条目分别如实报出，成功的页不回滚
- [ ] A7 规格有未保存草稿时建页按钮禁用且 title 说明原因
- [ ] A8 控制台零页空态：deck 有规格时写明「N 条待建页」并指向策划工作台；
      **deck 无规格时退回原文案且不报错**
- [ ] A9 CLI `runDeckGenerate` 省略 `entryIds` 时行为与改动前逐字一致
      （既有 deck-generate 用例一条断言都不改）；传未知 id 整体拒绝
- [ ] A10 测试基线不低于 **948**，R1–R8 每条有对应用例
- [ ] A11 `format:check` / `typecheck` / `test` / `build` 四关全绿

## Out of Scope

- **失联页（missing）那一档不碰**：依旧只有文案、没有动作。删页是破坏性操作，且正确处置
  往往是「恢复规格条目」而非删页，做对它需要单独想清楚。另开任务。
- 改 `reconcileDeckSpec` 的三类语义或任何 M5 生成侧契约。
- 自动建页 / 自动跑流水线：付费门槛（父任务 A8）不动。
- 动 `SourcePicker` 的生成档（D1）；重做 M5 的 `deck spec-draft` 单轮初稿路径。

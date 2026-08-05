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
| F4 | `SlideDetail` **已带 `specEntryId`**（「生成页对应的规格条目；非生成页为 null」，经 `DeckStatusSlide` 继承而来，字段本体在 `channels.ts:64`），因此 newEntries 可在渲染层纯前端算出，**不需要新 IPC**。同源继承的还有 `removed: boolean`（:39）与 `sourceKind`（:47），即渲染层判「已软删除」用 `slide.removed`、判生成页用 `slide.sourceKind === "generated"` | `apps/desktop/src/main/ipc/channels.ts:64`、`:115` |
| F5 | `SourcePicker` 生成档只有两条路 `SpecMode = "file" \| "draft"`（选已有规格文件 / 从构思产初稿），是 M5 E1 的设计 | `apps/desktop/src/renderer/components/console/SourcePicker.tsx:60` |
| F6 | CLI `runDeckGenerate` 已用 `reconcileDeckSpec` 做**幂等**：已生成且未改动的条目会被跳过。既有确认文案已如此声明 | `apps/cli/src/deck/generate.ts:166`、`source-picker-core.ts:101` |
| F7 | 付费确认已有两套可复用：`buildGenerateConfirm(callCount)`（最多 N 次，可能更少）与 `buildRegenerateBatchConfirm(pageLabels)`（确切 N 次） | `source-picker-core.ts:101`、`planning-core.ts:68` |
| F8 | 建页任务与规格写入的互斥防线已存在，两侧都已接线 | `DeckRunner.isSourceTaskRunning`、`PlanningPage.tsx:153` |
| F9 | 控制台零页空态文案现为「用右上角『添加页面』从图片、PDF 或内容规格加进来」 | `ConsolePage.tsx:396`（:394 是标题行「当前 Deck 还没有任何页面」） |
| F10 | **`DeckGenerateOptions.specPath` 本来就是可选的**，注释原文：「外部规格文件；deck 内已有权威副本时可省略（等价于『只对账、补缺页』）」。`runDeckGenerate` 在省略时读 `loadDeckContentSpec(deck.path)`。即「用当前 deck 的规格建页」**CLI 侧早就有**，桌面端只是没接 | `apps/cli/src/deck/generate.ts:37`、`:200` |
| F11 | `runDeckGenerate` **没有条目子集选项**：它对 `reconciliation.newEntries` 全量循环建页，串行、单页失败不中断 | `apps/cli/src/deck/generate.ts:250`（`total` 在 :246；对账在 :233–242） |
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
  三种入参各有确定语义，不得混同：

  | 入参 | 语义 | 理由 |
  |---|---|---|
  | 省略 `entryIds` | 建全部 `newEntries` | 与引入本参数之前逐字同义（A9） |
  | `entryIds: []` | **一条都没选** → 抛 `SPEC_SELECTION_EMPTY` | 空数组与省略是两回事。它按次计费，静默什么都不做会让调用方以为建过了；沿用 `regenerate-batch` 对空选择集的既有口径，不新增错误码 |
  | 含规格里**没有**的条目 | **整体拒绝**，一页都不建 → 抛 `SPEC_PAGE_NOT_FOUND` | 沿用既有口径。确认框按 N 条给用户看，实跑 N-1 条是静默不一致，而这里每一条都要花钱 |

  **「未知」的判据是规格里根本没有这个条目。** 已经建过页的 id（在规格里、不在 `newEntries` 里）
  **不算未知**，落进既有 `skipped` 的幂等口径而非报错：界面勾选来自一份可能稍旧的页面快照，
  把「刚在别处被建掉的条目」判成错误，会让一次本该正常的补页整批失败；而幂等跳过本来就是
  `deck generate` 的既定行为（F6），没有理由为本任务另立一套判据。
- **R5 进度可见**：`SourceTaskBar` 提取为共享组件，策划页与控制台共用一份（D4）。
- **R6 结果呈现**：建页完成后留在策划页给完成提示与「去控制台」按钮（D5）；
  部分成功如实分别报出成功页与失败条目，不吞失败。
- **R7 控制台空态指路**：零页空态调既有 `deck:read-deck-spec`（F12）；规格存在且有待建条目时，
  文案改为写明条数并指向策划工作台；无规格或读不到时退回现有文案（F9），不报错。
- **R8 守卫**：规格 dirty 时建页禁用（D6）；与既有建页任务 / 流水线互斥沿用 F8 的防线，
  不新造第二套判据。

## Acceptance Criteria

> 走查工作区（2026-08-05 建，不进仓库）：`~/test/wt-bridge-spec`（零页 + 4 条规格）、
> `~/test/wt-bridge-nospec`（零页无规格，验切 deck）、`~/test/wt-bridge-allbuilt`。
> 驱动方式见记忆「桌面端真机走查方法」；原生确认框 CDP 够不到，靠 System Events 按屏幕坐标点。

- [x] A1 零页 deck + 6 条规格：策划页「规格影响」面板显示「待建页 6 条」，默认全选，
      逐条取消后按钮上的数字同步变化
      —— 真机以 4 条规格验：默认全选，取消后 4→3→2→1 同步，「全选」随之取消
- [x] A2 只勾 1 条建页 → **只发起 1 次图像生成**，deck 内只多出 1 页；
      其余 5 条仍留在待建页一档
      —— 真机：manifest 由 0 页变 1 页（`slides/page-01`），待建页一档收缩为 3 条
- [x] A3 付费确认写明**确切**次数与不可撤销（父任务 A8 口径），且次数等于勾选数
      —— 真机截图：「将调用 **1** 次图像生成」/「按次计费且不可撤销」，
      默认按钮是**取消**（`system.ts:89` 的 `defaultId: 1`），误按回车不会花钱
- [x] A4 建页过程中策划页能看见进度（第 N/M 页），不需要切到控制台
      —— 真机：「第 **1/1** 项 · 正在生成 entry-001」，**分母是勾选数不是待建总数**
- [x] A5 建页完成后策划页给出完成提示与「去控制台」按钮，且**不自动跳转、不自动跑流水线**
      —— 真机：全程停在策划页，完成提示 +「去控制台」+「知道了」，无任何东西自动开跑
- [~] A6 部分失败（造一条注定失败的条目）时成功页与失败条目分别如实报出，成功的页不回滚
      —— **失败分支未实测**。数据链路已核（`source-task-runner.ts` 如实映射
      `created`/`failed`/`skipped`，三个数各有渲染且失败段标 `state-failed`），
      缺的是渲染取证：造一条注定失败的条目不可靠且要花钱。留作后续。
- [x] A7 规格有未保存草稿时建页按钮禁用且 title 说明原因
      —— 真机：禁用 + title「请先保存规格，再按磁盘现值建页」
- [x] A8 控制台零页空态：deck 有规格时写明「N 条待建页」并指向策划工作台；
      **deck 无规格时退回原文案且不报错**
      —— 真机两条分支均通过；另逐帧验了「A(有规格) → B(无规格)」切 deck，
      **没有出现 B 上显示 A 条数的那一帧**（复核期补的快照归属守卫生效）
- [x] A9 CLI `runDeckGenerate` 省略 `entryIds` 时行为与改动前逐字一致
      （既有 deck-generate 用例一条断言都不改）；传未知 id 整体拒绝
      —— 省略路径上 `targets` 就是 `newEntries` 同一个数组引用；既有断言零改动
- [x] A10 测试基线不低于 **948**，R1–R8 每条有对应用例
      —— 实测 **1000**（core 156 / desktop 571 / CLI 273）
- [x] A11 `format:check` / `typecheck` / `test` / `build` 四关全绿

**走查抓到、纯函数测不到的一处缺陷**（已修并真机复验）：完成提示把「用户取消勾选」
导致的 `skipped` 说成「此前已经建过页」。`skipped` 在本任务后含两类，
**默认全选时第二类恒为 0，怎么写都看不出来**；一旦逐条取消就必然说反——而逐条勾选
正是 D2 的核心能力。当时 15 条用例没有一条走过「取消勾选后建页」这条路径。

修法不是改文案，而是换判据：渲染层知道用户勾了几条，因此
`alreadyBuilt = requested − created − failed`，只报「勾了却没被执行的」，
用户自己取消的那部分根本不报。顺带修掉第二句假话——失败提示原本写着
「逐条原因见活动日志」，而活动日志里只有一条汇总记录，指了个空处。

复验（真机，另花 1 次生成）：待建 3 条、取消 2 条留 1 条、建成 1 页 →
「已建立 1 页。每页都需要你逐张确认源图。」，待建页一档 3→2 同步收缩。

## Out of Scope

- **失联页（missing）那一档不碰**：依旧只有文案、没有动作。删页是破坏性操作，且正确处置
  往往是「恢复规格条目」而非删页，做对它需要单独想清楚。另开任务。
- 改 `reconcileDeckSpec` 的三类语义或任何 M5 生成侧契约。
- 自动建页 / 自动跑流水线：付费门槛（父任务 A8）不动。
- 动 `SourcePicker` 的生成档（D1）；重做 M5 的 `deck spec-draft` 单轮初稿路径。

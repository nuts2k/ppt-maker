# 子任务④ 技术设计：桌面端新建来源入口收口

本文件只管「怎么做」。范围、约束与验收在 `prd.md`。

## §1 边界

**做**：桌面端呈现与入口。**不做**：任何来源侧的业务逻辑 —— ②③ 已交付的 CLI 函数是唯一实现，
④ 一律调用，不在桌面端重写判定（`requiresSourceAcceptance`、16:9 容差、漂移计算全都不碰）。

四个已定决策 **E1–E4 的权威定义在 `prd.md`〈已定决策〉**，本文件只承接其技术形态，
不复述结论 —— 两份决策表迟早漂移。下文出现的 E1–E4 均指 `prd.md` 那张表。

## §2 数据面：IPC 契约扩展

### 2.1 硬约束：`channels.ts` 是类型交界，不得引用 `@cli/*`

`tsconfig.web.json` 的 `paths` 只有 `@/*` 与 `@shared/*`，**没有 `@cli/*`**；而 renderer 侧
多处 `import type { SlideDetail } from "../../main/ipc/channels.js"`，会把 `channels.ts`
拉进 web 项目一起类型检查。因此 `channels.ts` 里出现任何 `@cli` 导入都会让
`pnpm -r typecheck` 在 renderer 项目下失败。

现状之所以没炸，是因为 `channels.ts` 至今只引 `@ppt-maker/core` 与相对的 `shared/stages.js`。
**这条约束在 ④ 必须显式守住**，它直接决定了下面两处类型的归属。

### 2.2 `DeckStatusSlide` 增三个字段

CLI `deckStatus` 早已返回，桌面端 IPC 层把它们丢掉了（`main/ipc/deck.ts:32` 的
`buildDeckStatus` 只透传 `status.slides`，类型上被 `DeckStatusSlide` 截断）：

```ts
// main/ipc/channels.ts
readonly sourceKind: SlideSourceKind | null;   // core 已导出，直接引
readonly specEntryId: string | null;
readonly specDrift: SpecDriftStatus | null;
```

CLI 的 `DeckSlideStatus` 另有 `blockingStage` / `started` 两个字段，**本次不接** ——
桌面端已有合并了会话层的 `blockingStageView`，接进来会变成同一件事的第二个判据来源
（`state-management.md`〈错误条要指名出问题的阶段〉正是这条的教训）。

### 2.3 两处类型要挪进 core

| 类型 | 现位置 | 去处 | 理由 |
|---|---|---|---|
| `SpecDriftStatus`（`in-sync｜drifted｜missing`） | `apps/cli/src/deck/status.ts` 内联字面量联合 | core | 它是 ①③④ 三方共识的枚举，按 §2.1 桌面端引不到 CLI，复制一份必然漂移 |
| `PdfExtractionReport` 及其四个子类型 | `apps/cli/src/pdf/report.ts` | core | renderer 要渲染报告 → 类型必须过 `channels.ts` → 按 §2.1 引不到 CLI |

**这正是 HANDOFF 判断 3 预告的「④ 唯一可预见的 core 改动」，现已确认真的需要。**

只挪**类型与 zod schema**，`writeExtractionReport` / `formatExtractionReport` /
`extractionReportRelativePath` 留在 CLI —— 它们是 CLI 的落盘与终端格式化职责，
core 不承担 IO。计算 `specDrift` 的逻辑同样留在 CLI，不下沉。

备选方案（channels.ts 自声明一份展示用 DTO + main 侧映射）已否决：那是把一整个 schema
复制第二份并配一段纯样板映射，比挪类型重得多，且两份定义迟早漂移。

## §3 统一来源选择界面（W2）

### 3.1 一个组件、两个入口

`SourcePicker` 模态，三档来源。**新建与追加共用同一个组件**，差别只有目标 deck：

| 入口 | 位置 | 目标 deck |
|---|---|---|
| 新建 | `DeckEmptyState` 主行动改为「新建 Deck」 | 用户选的新目录，建完 `switchWorkspace` 过去 |
| 追加 | `ConsolePage` 的「添加页面」 | 当前 `deckPath`，一律追加到末尾 |

「打开已有 Deck」保持不变。三种来源在 CLI 侧两个建页命令都是「deck 不存在则创建、
存在则追加末尾」，形态本就同构 —— 界面必须保住这条，否则父任务 A2 的混合 deck 走查
（1/3 页导入、2 页抽取、4–6 页生成）在桌面端做不出来。

### 3.2 三档各自的表单

| 档 | 新建 | 追加 | 调用 |
|---|---|---|---|
| 图片目录（`imported`） | 选一个目录 | 选一个或多个图片文件 | `createDeckWorkspace` / 逐个 `addSlideToDeck` |
| PDF 文档（`extracted`） | 选文件 + 可选页码范围（`3-8,12`，原样传 `--pages`） | 同左 | `extractPdfToDeck` |
| 内容规格（`generated`） | 见 §3.3 | 同左 | `runDeckGenerate` |

页码范围输入框只做「非空即原样传」，**不在桌面端解析或校验** —— 解析器在 CLI 侧，
写第二份就是同一个语法两套实现。非法输入由 CLI 报错，界面照常显示原因。

### 3.3 `generated` 档的两条路（E1）

```
○ 选一个已有规格文件        → 文件选择器
○ 从一段构思文本生成初稿    → 多行文本框 → runDeckSpecDraft → 落盘到 <deck>/content-spec.json
                              → 展示条目数与每页标题 → 用户确认后再 runDeckGenerate
```

第二条**必须让用户先看到初稿再决定是否生成图** —— 分页由模型给出且不具约束力
（`spec-draft.ts:33` 原文），直接连跑等于把一次不可控的分页结果变成 N 次付费调用。

`spec-draft` 是一次性、无对话（M6 边界）。④ **不做**规格条目的桌面端编辑：那是 M6
「内容策划工作台」的核心，提前做等于吃掉下个里程碑。用户要改规格就改那个 JSON 文件，
改完由 §6 的漂移标注如实提示。

## §4 长任务通道与互斥（W3 / W4）

### 4.1 新开一条通道，不复用 `DeckRunner`

抽取与生成都是长任务，但**不是流水线执行**：`DeckRunner` 的队列单元是 slide，而建页任务
执行时 slide 还不存在。硬塞进去要给 runner 加一类没有 slideId 的队列项，污染它现有的
`page-done` / `stage-start` 事件语义。

新增：

```ts
// main/ipc/channels.ts
type SourceTaskKind = "import" | "extract" | "generate" | "regenerate";
sourceTask: {
  start(deckPath: string | null, request: SourceTaskRequest): Promise<SourceTaskResult>;
}
// 进度：webContents.send("deck:source-task-progress", event)
```

`extractPdfToDeck` 的 `onProgress(message: string)` 与 `runDeckGenerate` 的
`onProgress(DeckGenerateProgress)` 形状不同，在 main 侧归一为一种进度事件
（`{taskId, index, total, phase, message}`）再送 renderer，renderer 只认归一后的形状。

### 4.2 与 `DeckRunner` 互斥（RK-C）

两者都写 deck manifest 与 slide manifest，并发写必然损坏数据。规则：

- 建页任务启动前检查 `runner.isRunning()`，为真则拒绝并说明原因（不静默失败）。
- 建页任务运行中，`RunControlBar` 的「处理全部」与单页「运行此页」禁用，理由写进 `title`。
- 建页任务自身是**串行单例**，同时只允许一个。

### 4.3 完成后的刷新与竞态守卫（RK-D）

新建场景下 `deckPath` 由 `null` 变为新路径 —— 这正是 `state-management.md`
〈新增一个「切换维度」的能力，会把既有竞态从不可触发变成常规路径〉点名的形态。
建页任务的响应到达时必须比对 `deckPath` 身份，不一致即丢弃（失败路径同样要守）。

任务完成后一律 `refreshStatus()`；新建场景走既有 `switchWorkspace`（它已带状态清零）。

## §5 批量源图确认：审片视图（W6，E2）

### 5.1 序列取自待办队列，不另写 filter

成员集合 = `deriveTodoQueue` 的 `confirm-source` 组，**不在视图里另写一份
`sourceKind === "generated" && ...`**。同一件事在两处展示必须同源
（`state-management.md`〈错误条要指名出问题的阶段〉的自查条）。

### 5.2 可达 ≠ 待办

从卡片点进一个**已确认**的 `generated` 页也要能进（看图、重新生成、换源），此时视图
呈现「已确认」态而非一个看着还能按的「接受」。这是 `state-management.md`
〈一个判据兼职两件事〉的原样复用：`accept-gate.ts` 已把「可达」与「待办」拆成
原子判据，源图这一侧要照同样的形状补齐，**不得**用 `awaitingSourceConfirm` 同时当
入口可见性判据。

### 5.3 布局与动作

```
┌────────────────────────────────────────────────┐
│ 源图确认        已确认 3/12          [返回控制台] │   ← 计数 tabular-nums
├────────────────────────────────────────────────┤
│                                                │
│              大图（aspect-video）                │
│                                                │
├────────────────────────────────────────────────┤
│ page-04 · 生成 · 规格条目 e3f1                   │
│ [接受] [重新生成] [换源]                          │   ← primary / secondary / ghost
├────────────────────────────────────────────────┤
│ ▢▢▣▢▢▢▢▢▢▢▢▢  ← 缩略图带，可跳选，已确认页打勾    │
└────────────────────────────────────────────────┘
```

- 「接受」是本视图唯一 primary，回车触发，接受后自动跳下一张；最后一张接受完回控制台。
- 「重新生成」二次点击确认（E3），附一个**可选**的调整说明输入 —— `note` 在 CLI 侧本就
  可选（不给则按现有规格重出一次），强制填写会丢掉「重掷一次」的能力。
- 「换源」直接复用既有 `window.api.slide.replaceSource`，不写第二套。
- 键盘：`Enter` 接受、`←/→` 切页、`Esc` 返回控制台。六态由 `components/ui/Button` 基座给。

### 5.4 入口

1. 待办队列「待确认源图」组标题上一个「逐张确认」按钮；
2. 批量生成完成面板上的「去确认」按钮；
3. 卡片点击 —— `generated` 且停在源图确认的页，点卡片进审片视图而不是复核页
   （那页还没 OCR，复核页后半屏全是空面板）。

## §6 卡片来源与漂移标注（W5）

| 信息 | 视觉 | 位置 | 理由 |
|---|---|---|---|
| 来源（导入/抽取/生成） | `caption` 中性 `ink-muted`，**不上色** | 缩略图左上角（与 `removed` 徽标互斥） | 来源是常态信息，不是「要你管」。给常态上色就是旧版 9 个绿点的同一个错误 |
| 规格漂移 `drifted` | `state-stale` 色 + 「规格已更新」 | 详情行 | `stale` 的语义正是「上游已变更」，与漂移的定义精确对应 |
| 规格失联 `missing` | `state-stale` 色 + 「规格条目已失联」 | 详情行 | 同上 |

**漂移必须只是标注**：不得进入待办队列、不得影响任何阶段状态、不得让卡片状态点变色。
父任务 A13 明确要求「所有页的阶段状态均不改变」，且漂移是纯派生、改回原样自动消失。

详情行的优先级链在 `SlideCard.tsx:136` 已有（`errorText ?? todoReason ?? 进度描述`），
漂移插在 `todoReason` **之后**、进度描述之前 —— 它比「待我处理」弱，比常态强。

## §7 抽取报告呈现（W3，E4）

- **完成面板**：抽取结束后展示，`建立 N 页 / 跳过 M 页`，跳过逐条给
  「第 7 页 · 1224×792 pt · 宽高比偏离 16:9 达 12.3%」。原因文案直接用报告里
  `reason.message`（②已写好完整中文），`reason.code` 只用于分组，**不在桌面端重拼文案**。
- **活动日志**：`kind: "deck-extract"`，`detail` 写摘要，`ActivityRecord` 新增可选
  `reportPath`；`ActivityPanel` 对带 `reportPath` 的记录给「查看报告」重新打开该面板。
  可选字段对既有 jsonl 天然兼容（旧记录读出来是 `undefined`）。
- 每页的 `hasExtractableText`（父任务 A5）**不靠报告**：它已在每页
  `manifest.source`（`source-contracts.ts:35`），走页级来源详情呈现，重抽后也不会失真。

## §8 付费门槛（W7，E3）

| 动作 | 门槛 | 形式 |
|---|---|---|
| 批量生成 N 页 | 原生 `messageBox` | 写明「将调用 N 次图像生成，不可撤销」 |
| 单张重新生成 | 二次点击 | 按钮文案变「确认重新生成？」，失焦或超时复位 |
| 规格初稿 | 一次确认 | 按钮明示「将调用模型生成初稿」 |

桌面端现状是一进 run 就 `confirmApi: true, confirmUpload: true`
（`RunControlBar.tsx:54`）—— 那条**不改**：流水线的云调用是用户点「处理全部」的直接后果，
且不按图片张数计费。生成是另一回事，不套用同一条。

## §9 兼容

- 旧 deck（无 `source` 字段）：CLI 加载期归一化已保证 `sourceKind` 有值（子任务① 的 RK4），
  桌面端不做任何迁移。
- 移除页：`sourceKind` 为 `null`（CLI 不加载移除页的工作区），卡片不显示来源徽标。
- 无规格文件的 deck：`specDrift` 全为 `null`，漂移标注整体不出现。
- `AppView` 从二态变三态：`ui-store.reset()` 与 `INITIAL_STATE` 要一并覆盖新视图，
  切换工作区时必须回落到 `console`。

## §10 风险与回滚点

| # | 风险 | 防线 / 回滚 |
|---|---|---|
| RK-A | 两处类型挪进 core 波及 CLI 既有 import 与测试 | 纯类型移动、无行为变更；CLI 侧保留 re-export 过渡即可。若挪动引发连锁改动超出预期，回滚为 §2.3 的备选 DTO 方案（代价是重复定义） |
| RK-B | 第三个 `AppView` 波及 `AppShell` / `TopNav` / 既有导航测试 | 先只加视图与路由、跑全量测试确认零回归，再接入口 |
| RK-C | 建页任务与 `DeckRunner` 并发写 manifest | §4.2 双向互斥，且需一条「runner 运行中启动建页任务被拒绝」的回归用例 |
| RK-D | 新建 deck 使 `deckPath` 成为可变维度，激活既有竞态 | §4.3 身份守卫；按 `state-management.md` 的要求配正对照用例并做变异验证 |
| RK-E | 审片视图误用 `awaitingSourceConfirm` 当入口判据 | §5.2 拆原子判据；用例锁住「已确认的 generated 页仍可进入审片视图」 |

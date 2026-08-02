# 子任务④：桌面端新建来源入口收口

父任务：`.trellis/tasks/07-31-page-sources-and-content-generation/`（M5，阶段二最后一个子任务）

## 目标

把 ①②③ 三轮做出的三种页面来源（`imported` / `extracted` / `generated`）在桌面端**一次性**
收口成统一的入口，并补齐 `generated` 来源真正可用所必需的批量源图确认界面。

②③ 刻意只保证「数据落盘可读」，没做任何界面 —— 桌面端呈现归 ④ 独占。

## 父任务已定、不得改动的约束

来自父任务 `implement.md` 的 2.4 与 `prd.md` 的 D5：

- **实现前必读 `DESIGN.md`**（项目 CLAUDE.md 的硬约束）。
- **统一设计「新建 deck 时选来源」，不做三次零散增补。** 三种来源现在都齐了，这是唯一一次
  能一把设计干净的机会；分三次加会长成三个并列按钮加三条各不相同的表单。
- **含批量源图确认界面**：批量生成后逐张接受 / 重新生成。生成图不满意的概率高，
  这个界面的效率直接决定 `generated` 来源好不好用。
- 界面**必须支持往已有 deck 追加**，不能只做「新建」，否则父任务 A2 的混合来源走查无法进行。

## 确认事实（代码勘查所得）

### ④ 要消费的 CLI 数据面（原则上不需要新增 core 契约）

| 能力 | 位置 | 关键签名 |
|---|---|---|
| PDF 抽取 | `apps/cli/src/pdf/extract.ts:123` | `extractPdfToDeck({pdfPath, deckPath, pages?, deckName?, onProgress?})` → `{deckCreated, reportPath, report}` |
| 批量生成 | `apps/cli/src/deck/generate.ts:166` | `runDeckGenerate({deckPath, specPath?, confirmUpload, onProgress?})` → `{created, failed, skipped, reconciliation}`；`onProgress` 逐条目 `start/done/failed` |
| 单页重生成 | `apps/cli/src/deck/regenerate.ts:85` | `runDeckRegenerate({deckPath, page, note?, confirmUpload})` → `{attemptId, revisionNotes, invalidated, requiresAcceptance}`；`note` **机械追加**进规格条目，生成前即写回 |
| 规格初稿 | `apps/cli/src/deck/spec-draft.ts:38` | `runDeckSpecDraft({fromPath, outputPath, confirmApi})` → 一次调用、无对话 |
| 抽取报告 | `apps/cli/src/pdf/report.ts` | `PdfExtractionReport{created[], skipped[]}`，`skipped[].reason.code` 已结构化为四值枚举 |
| 逐页来源与漂移 | `apps/cli/src/deck/status.ts:44` `DeckSlideStatus` | 已含 `sourceKind` / `specEntryId` / `specDrift`（`in-sync｜drifted｜missing｜null`）/ 生成溯源指针 |

两个建页命令都是「deck 不存在则创建，存在则追加末尾」，形态刻意同构。

### 桌面端起点

**已有**（子任务① 铺的，直接复用）：

- `deck:create` IPC 只接一个图片目录（`main/ipc/deck.ts:152`，imported 独苗）。
- 空态入口只有「打开已有 Deck / 从图片目录创建」两个按钮（`DeckEmptyState.tsx:58`）。
- 源图确认闸门全线打通：`shared/stages.ts:19`、`renderer/lib/accept-gate.ts:87`
  （`awaitingSourceConfirm`，纯耐久层判据）、`main/ipc/slide.ts` 的 `slide:accept-source`。
- 待办队列已有「待确认源图」组（`stores/todo-queue.ts:83`，优先级仅次于 `failed`）。
- 单页视图已有「确认源图 / 换源」成对按钮（`SlideToolbar.tsx:268`）与其编排
  （`ReviewPage.tsx:405` / `:434`）。

**缺的即 ④ 的全部工作**：

- `SlideDetail`（`main/ipc/channels.ts:52`）不含 `sourceKind` / `specDrift` / `specEntryId`
  —— CLI `deckStatus` 已返回，桌面端 IPC 层把它们丢掉了。
- 没有任何 PDF / 生成的入口，没有来源选择界面。
- 没有抽取报告的呈现。
- 卡片（`SlideCard.tsx`）不显示来源，也不标注规格漂移。
- 没有批量源图确认界面（现只能逐页进 `ReviewPage` 一张张确认）。

### 长任务与云调用的既有形态

- 长任务只有 `DeckRunner` 一条通道：`main/runner/deck-runner.ts:309` 经
  `webContents.send("deck:run-progress", event)` 推事件，renderer 侧 `run-bridge` 消费。
  PDF 抽取与批量生成都是长任务，但**不是流水线执行**，是否复用该通道待设计。
- 桌面端目前对云调用不做二次确认：一进 run 即 `confirmApi: true, confirmUpload: true`
  （`RunControlBar.tsx:54`、`ReviewPage.tsx:265`）。生成/重生成是**按次付费**，
  这条现状不能直接照搬。

## 必须带进实现的四条判断（来自 ①②③ 的教训）

1. **不要在桌面端重写判定。** `requiresSourceAcceptance` 单点定义于
   `packages/core/src/source-contracts.ts:89`；16:9 容差在 `geometry.ts:74` / `constants.ts:4`。
   ② 特意把 16:9 判定留在 TS 侧不下沉进 Swift，防的就是「同一个容差两份实现」。
2. **多代资产禁止裸 `role` 查找。** `content_spec` / `generation_prompt` / `reference_text`
   每次重生成各出一份，必然多代。判据见 `.trellis/spec/backend/contracts.md`
   〈多代资产与「当前产物」选取契约〉；现成写法见 `main/slide-detail.ts` 的
   `currentSourceImageAsset` / `currentSuccessAsset`。**子任务① 的四个必现缺陷里有三个源于此。**
3. **抽取报告 schema 目前在 `apps/cli/src/pdf/report.ts`，不在 core。** ② 刻意没挪。
   ④ 要在桌面端读它，可能需要挪进 core —— 这是 ④ 唯一可预见的 core 改动，动之前先确认真需要。
4. **批量确认界面别做成「155 个输入框铺满列表」。** 《静默失败思考指南》：只读展示是一句
   隐含断言「这份数据是对的」；启发式断言必须留人工推翻的入口，但入口不必常驻。

## 已定决策（brainstorm 2026-08-01）

| ID | 决策 | 结论 |
|---|---|---|
| E1 | `generated` 的规格从哪来 | **选已有规格文件 + 内置构思框调 `spec-draft`**。不做则用户须手写符合 schema 的 JSON，`generated` 在桌面端等于不可用 |
| E2 | 批量源图确认的形态 | **独立审片视图**（第三个 `AppView`）。判断生成图好坏必须看大图，卡片缩略图不足以判断 |
| E3 | 付费操作的误触门槛 | **批量弹原生框、单张二次点击**。重生成是审片视图的核心高频动作，每次弹框会毁掉 E2 的效率 |
| E4 | 抽取报告的可见性 | **完成面板 + 活动日志可回溯**。不常驻版面，但也不能「关了就再也找不到」 |

## 需求

- **R1 数据面补齐**：`SlideDetail` 带上 `sourceKind` / `specEntryId` / `specDrift`。
  CLI `deckStatus` 已返回，桌面端 IPC 层把它们截断了；其余六项需求都依赖这一项。
- **R2 统一来源选择界面**：一个组件、两个入口（新建 deck / 追加到当前 deck），三档来源。
  **不做三次零散增补**（父任务硬约束）。
- **R3 PDF 抽取入口**：选文件 + 可选页码范围，页码原样传给 CLI，桌面端不解析不校验。
- **R4 生成入口**：按 E1 提供两条路（选规格文件 / 构思文本产初稿）。构思文本产出的初稿
  **必须先让用户看到条目再决定是否生成图**，不连跑。
- **R5 长任务进度**：抽取与生成过程有逐条目进度，且与流水线执行 `DeckRunner` **双向互斥**。
- **R6 逐页来源与漂移标注**：控制台卡片显示来源；`specDrift` 为 `drifted` / `missing` 时
  如实标注，且**不进入待办队列、不影响任何阶段状态**。
- **R7 批量源图确认界面**：按 E2 的独立审片视图，逐张接受 / 带可选说明重新生成 / 换源。
- **R8 抽取报告呈现**：按 E4，含建立页与跳过页的结构化原因。
- **R9 付费门槛**：按 E3。

## 验收标准

- [ ] U1 控制台卡片逐页显示来源（导入 / 抽取 / 生成），旧 deck（无 `source` 字段）打开后
      同样显示且无迁移步骤；移除页不显示来源徽标。
- [ ] U2 从空态「新建 Deck」进来源选择，三档来源各能建出 deck 并落到控制台。
- [ ] U3 在已有 deck 上用同一个来源选择界面**追加**页面，三档各追加一次，
      既有页零改动（阶段状态与已确认产物全不变）—— 父任务 A2 的桌面端一半。
- [ ] U4 PDF 抽取完成后弹出报告面板：建立页数、跳过页数、每条跳过带页号/尺寸/原因；
      关掉后能从活动日志重新打开同一份报告（父任务 A5 的界面一半）。
- [ ] U5 混合宽高比的 PDF 抽取后命令不整体失败，非 16:9 页出现在跳过列表里（父任务 A6）。
- [ ] U6 粘一段构思文本 → 产出规格初稿 → 界面显示条目数与逐页标题 → 用户确认后才发起生成。
- [ ] U7 批量生成 N 页后，全部 `generated` 页进入待办队列「待确认源图」组；
      同 deck 内的 `imported` / `extracted` 页不受影响（父任务 A9）。
- [ ] U8 审片视图逐张确认：大图可辨，回车接受并自动跳下一张，最后一张接受后回控制台；
      顶部计数为等宽数字。
- [ ] U9 审片视图里带一句说明重新生成，说明回写规格条目，新图替换后该页重新回到待确认
      （父任务 A12 的界面一半）。
- [ ] U10 **已确认**的 `generated` 页仍能进入审片视图（可达 ≠ 待办），呈现「已确认」态，
      仍可重新生成 / 换源。
- [ ] U11 手工编辑规格文件中第 4 页的条目后，只有第 4 页卡片标注「规格已更新」，
      其余页零变化，**所有页阶段状态不变**；改回原样后标注消失（父任务 A13 的界面一半）。
- [ ] U12 流水线执行中启动建页任务被明确拒绝并说明原因；建页任务运行中「处理全部」禁用。
- [ ] U13 批量生成前弹出原生确认框并写明调用次数；单张重新生成为二次点击。
- [ ] U14 `pnpm -r build && pnpm format:check && pnpm -r typecheck && pnpm -r test` 全绿。

## 不做

- **规格条目的桌面端编辑**：那是 M6「内容策划工作台」的核心，在 ④ 做等于提前吃掉下个里程碑。
  用户改规格就改 JSON 文件，改完由 U11 的漂移标注如实提示。
- **对话式内容策划**：同上，M6。`spec-draft` 是一次性、无对话。
- **在桌面端重写任何来源侧判定**：16:9 容差、`requiresSourceAcceptance`、漂移计算、
  页码范围解析一律调 CLI / core 既有实现。
- **改动 CLI 的来源契约**：④ 原则上只消费。唯二的 core 改动是两处类型的移动
  （见 `design.md` §2.3），无行为变更。
- **暗色主题**：DESIGN.md 已列为 Known Gaps，不在本任务范围。
- **父任务阶段三的集成走查**：A1–A13 的端到端验证归父任务，④ 只交付界面并自验 U1–U14。

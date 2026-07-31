# 复核与验收链路三处缺陷

## Goal

修掉复核与验收链路上三处让人「想做的事做不了」的缺陷，全部由 2026-07-30 真机使用时暴露。

按严重性排序：R1 会让错误内容静默进入最终产物且用户无法阻止；R2、R3 是操作不便。

## Background

三条都落在 07-28 体验收敛之后的界面上。收敛方向（减入口、降噪）本身没错，
但有三处把「确实需要的动作」一并砍掉或埋掉了。

## Requirements

### R1 「已一致」的块必须能修正文本（最严重）

**现状**：`BlockListPanel.tsx:489-500` 按分区三分支渲染——

| 分区 | 渲染 | 能否改文本 |
|---|---|---|
| `text-pending`（双源不一致） | `TextDiffRow` | 能，有 textarea |
| `classification-pending` | `ClassificationRow` | 不能，只能改分类 |
| `agreed`（双源一致） | `<p>{block.text}</p>` | **不能，纯文本无入口** |

**根因**：`partitionOf`（`lib/review-partition.ts:43`）以 `compareBlockSources(block).agrees`
二分，隐含假设「双源一致 ⇒ 正确」。但 OCR 与 AI 文本助手完全可能犯同一个错——
字形相近（己/已、末/未）、专有名词、品牌名、行业术语。同错即被判为「无需改动」，
只读展示，一路进最终 PPTX，用户没有任何界面手段拦截（改分类只会推到
`classification-pending`，那一档同样不能改文本）。

**要求**：`agreed` 档保留只读展示，但提供就地转编辑（点击文本进入编辑态）。
不要一上来就渲染 155 个 textarea——那会把 07-28 收敛掉的视觉噪音原样加回来。

**两条已确认的良性副作用**（无需额外处理，但实现时不要破坏）：

- 改 `block.text` 后该项**仍留在「已一致」档**，不会跳走：`partitionOf` 看的是 `sources` 里
  OCR/助手的原始文本，与 `block.text` 无关。正好避开 07-28 修过的「目标项传送」那个坑。
- 改文本只失效 `pptx` + `accept-pptx`，不重做底图（`text` 不在 `maskInvalidationProjection`
  的字段清单里，见 `packages/core/src/text-blocks.ts:426`）。即不烧图像 API，符合预期。

### R2 验收后仍能重做底图

**现状**：`accept-gate.ts` 的 `awaitingFinalConfirm` 判据是「`pptx` 完成 **且** `accept-pptx` 未完成」。
验收一写入判据即不成立，最终确认页不再出现，而「重做底图」是页面内的按钮，随之消失。
此后界面上**没有任何办法**重做底图：改文字不触发（`text` 不在 mask 投影里），
改了再改回去更不行（整份文档与上次保存相同，`decideInvalidation` 直接返回 `null`）。
只剩 CLI `slide run --from clean`。

**要求**：把「页面可达性」与「是否待办」拆成两个判据。

| 判据 | 口径 | 用途 |
|---|---|---|
| 可进入最终确认页 | `pptx` 已完成（不看 accept 状态） | 工具栏「最终确认」档是否出现 |
| 待办队列项 | `pptx` 完成 **且** `accept-pptx` 未完成（维持现状） | `todo-queue` 不得把已验收页重列为待办 |

**两处实现细节**：

- 已验收页进入最终确认页时，「完成」按钮不应原样呈现——`accept-final` 虽是幂等的
  （cli 测试「重复调用幂等：状态不变且不追加 attempt」），但按钮长得像还没验收会误导。
  改为显示已验收状态，只留「重做底图」与「在 PowerPoint 中打开」。
- `ReviewPage.tsx:147-158` 的 `gateSignature` effect 现在只要闸门非 null 就 `setViewMode("final")`。
  放宽后**不得**让已验收页一进单页就自动跳到最终确认——用户进已验收页多半是想看复核内容。
  自动切换只在「待确认」时发生；已验收页默认 `review` 档，「最终确认」档可点但不自动进。

### R3 最终确认页的操作不得被检查明细挤出视口

**现状**（真机实测，右栏 `w-96 overflow-y-auto`，内容 2089px / 可视 559px，需滚 3.7 屏）：

| 区块 | 高度 | 占比 |
|---|---|---|
| 标题说明 | 104px | 5% |
| **`CheckSummary` 自动检查明细** | **1416px** | **68%** |
| 「在 PowerPoint 中打开」 | 42px | 2% |
| 备注 | 114px | 5% |
| 「完成」/「退回重做」 | 253px | 12% |

一份**全部通过**的检查清单占了 68% 面积，把三个真正要操作的东西全推到视口外
1083px 处。检查全过时正是明细价值最低的时候。

**要求**：两条并用——

- `CheckSummary` 在全部通过时折叠为一行摘要（形如 `PPTX 自动检查 · 全部通过 ▾`），
  点开才展开明细；**存在失败项时默认展开**（失败才是需要看的时候）。
- 操作区（打开 PPTX / 备注 / 完成）在右栏底部 sticky，无论明细多长都在手边。

## Acceptance Criteria

- [x] AC1 「已一致」档的块点击文本后可编辑，改完保存能落盘。（R1）
- [x] AC2 改完文本后该项仍在「已一致」档、位置不变，不发生跨分区跳转。（R1）
- [x] AC3 只改文本保存后，失效范围是 `pptx` + `accept-pptx`，`mask` / `clean` 保持完成，
      不触发图像 API 调用。（R1）
- [x] AC4 已验收的页进入单页后，工具栏「最终确认」档可点，进去后「重做底图」与
      「在 PowerPoint 中打开」均可用。（R2）
- [x] AC5 已验收的页进入单页时默认停在「文本复核」档，不自动跳到最终确认。（R2）
- [x] AC6 已验收的页在最终确认页显示已验收状态，不再呈现可点的「完成」按钮。（R2）
- [x] AC7 已验收的页**不出现在待办队列**里。（R2 的回归保护）
- [x] AC8 自动检查全部通过时 `CheckSummary` 呈折叠态；点开可看明细。（R3）
- [x] AC9 存在失败项时 `CheckSummary` 默认展开。（R3）
- [x] AC10 在 1280×800 视口下进入最终确认页，「在 PowerPoint 中打开」与「完成」
      **无需滚动即可见**。（R3）
- [x] AC11 `pnpm format:check && pnpm typecheck && pnpm test && pnpm build` 全绿；
      基线 459 例不减少。

## Out of Scope

- 重新引入 07-28 撤掉的「从阶段重跑 ▾」九个入口。本任务只补 `clean` 这一个语义有效的重做。
- 改 `maskInvalidationProjection` 的字段口径（把 `text` 纳入 mask 失效）。
  那会让每次改字都触发付费图像调用，与 `save-invalidation.ts:7-8` 的既有决策相悖。
- 双源比对算法本身（如何减少「两个来源同时认错」）。本任务只保证人能改。
- 最终确认页的整体重新布局；R3 只做折叠与 sticky 两处。

## Technical Notes

- 改前端先读 `DESIGN.md` 与 `.trellis/spec/frontend/state-management.md`
  （Common Mistakes 五条，尤其「覆盖式派生」与「切换维度」两条）。
- `todo-queue` 与最终确认页共用 `accept-gate.ts` 的判据，R2 拆判据时两处都要跟到，
  否则会重演该文件注释里记的「队列显示待最终确认、页面里打不开确认页」那类语义漂移。
- 验证：`pnpm format:check && pnpm typecheck && pnpm test && pnpm build`。
- 真机走查方式见任务 `07-29-desktop-workspace-switch` 的 prd.md「走查结果」一节：
  `REMOTE_DEBUGGING_PORT=9222 pnpm dev` + CDP，点击用 `Input.dispatchMouseEvent`。
  AC10 需把窗口设为 1280×800 再量 `getBoundingClientRect`。
  现成素材：`~/test/ppttest-2026-07-31`（用户手工建的，含已验收与待验收页）、
  `~/test/ppttest-walkthrough-E2`（干净基线，2 页）。

## 走查结果（2026-07-31，CDP 驱动真机）

方式同 `07-29-desktop-workspace-switch`：`REMOTE_DEBUGGING_PORT=9222 pnpm dev` + CDP，
窗口 `Emulation.setDeviceMetricsOverride` 设为 1280×800，点击一律用
`Input.dispatchMouseEvent`、输入用 `Input.insertText`，位置量测走 `getBoundingClientRect`。

素材：`~/test/ppttest-2026-07-31`（page-01 全阶段已验收、page-02 停在文本复核门）。
需要「待确认」与「有失败项」两个状态时，复制出探针工作区 `ppttest-reviewgaps-probe`
直接改 `manifest.json` 的阶段状态与 `stages/pptx/check.json`——不跑流水线，
**全程零付费接口调用**（`clean` attempts 前后均为 1）。走查后原素材经 `diff -r` 确认
未被改动，探针工作区已删除。

### 实测记录

| AC | 观测 |
|---|---|
| AC1 | 「已一致」档第 18 行段落点一下即转 textarea，值为原文「信息收集助手」，焦点已在其中 |
| AC2 | 输入后仍是第 18 行、徽标仍为「已一致」、列表仍 42 行，另多出「已修改」标记；store 里 `text`/`lines`/`updatedAt` 三项同步 |
| AC3 | 完整已验收页保存返回 `invalidated: ["pptx","accept-pptx","report"]`；`mask`/`clean`/`accept-clean` 保持 completed，`clean` attempts 不变 |
| AC4 | 已验收页工具栏「最终确认」档在列且可点，进去后「重做底图」「在 PowerPoint 中打开」`disabled` 均为 false |
| AC5 | 已验收页进单页后选中态是「文本复核」，未自动跳档；未验收页仍自动跳到「最终确认」（无回归） |
| AC6 | 已验收页右栏标题「本页已验收」，按钮只剩检查摘要 / 回到文本复核 / 重做底图 / 打开 PPTX，无「完成」、无备注框，横幅「已完成最终确认」在位 |
| AC7 | `deriveTodoQueue` 对 page-01（pptx+accept-pptx 均 completed）不产出任何项，队列只剩 page-02 的「需文本复核」 |
| AC8 | 全部通过时右栏只有一行「PPTX 自动检查 全部通过 ▾」、明细 0 条；点一下展开 6 条并出现「收起」 |
| AC9 | 构造一条 `text-content: failed` 后进页即展开，未通过项文案在位；此时不提供「收起」（失败正是要看的时候） |
| AC10 | 右栏可视 559px（top 241 / bottom 800），`scrollTop=0` 时「在 PowerPoint 中打开」560–602、「完成」728–768，全部在视口内。内容高从改前的 2089px 降到 762px；即便构造出失败项使内容涨到 2134px，两个按钮位置不变——sticky 生效 |

### 两处未在真机验证

- **「重做底图」点下去之后**：只验到按钮可点，没有真的点——它会重跑 `clean`，
  调用付费图像接口。失效→重跑那条链路本身未改动（沿用 `rerunFrom`）。
- **`accept-final` 的幂等性**：已验收页界面上已无「完成」入口，无从触发；
  CLI 侧「重复调用幂等：状态不变且不追加 attempt」用例仍绿。

### 与 PRD 的一处偏离

R2 原文写「只留『重做底图』与『在 PowerPoint 中打开』」。实现保留了「回到文本复核」：
它与「重做底图」同属退回重做，删掉会给已验收页造出一个新的「想做的事做不了」——
正是本任务要修的那类缺陷。AC6 只要求「显示已验收状态、不再呈现可点的完成按钮」，
该项已满足。备注框随「完成」一并撤除（没有写入去处的输入框是假控件）。

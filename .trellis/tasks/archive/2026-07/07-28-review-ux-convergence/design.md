# 技术设计：复核工作台操作体验收敛

## 1. 边界

改动全部落在 `apps/desktop`，外加 `apps/cli/src/report/run.ts` 一处（R6）。
**不改动**：core 的阶段图与契约、CLI 的执行序列、`open-design/`。

`apps/desktop/src/shared/stages.ts` 的 `RUN_STAGE_SEQUENCE` 只服务桌面端展示与续跑判据，
与 CLI 的 `runSlideRunFrom` 序列是两份独立定义，改它不影响 CLI 行为。

## 2. `RUN_STAGE_SEQUENCE` 移除 `report` 的影响面（R2.1）

全仓引用共 6 处，全在桌面端：

| 位置 | 现行为 | 移除后 |
|---|---|---|
| `renderer/lib/stage-view.ts:89` `deriveStageViews` | 生成 10 个轨道视图 | 9 个，轨道自动变 9 格 |
| `main/slide-detail.ts:182` `deriveStageDetails` | 聚合 10 阶段状态 | 9 阶段 |
| `main/slide-detail.ts:214` `computeResumeStage` | `report` 未完成即整页未完成 | 验收后整页即完成，返回 null |
| `renderer/components/slide/SlideToolbar.tsx:263` | 渲染重跑菜单 | 随 R1.2 整体删除 |
| `shared/stages.ts:24` `RunStage` 类型 | 含 `"report"` | 类型收窄，编译期即可暴露残留引用 |
| `shared/stages.ts:47/51` `isRunStage`/`runStageIndex` | 认 `report` | 不再认 |

**`STAGE_LABELS` 保留 `report: "生成报告"` 条目。** 它服务 `stageLabel()`，而活动日志会收到
CLI 报上来的 report 阶段事件（R2.2 的补跑仍会产生日志）。移除标签会让日志退化成显示英文
stage id。类型上 `STAGE_LABELS` 需从 `Record<RunStage, string>` 放宽为
`Record<RunStage | "report", string>`（或独立的 `StageLabelKey`），这是刻意的不对称：
**执行序列**与**展示词表**本就是两件事。

`resolveInvalidationTarget("report")` 将抛「无法失效未知阶段」。这是期望行为——移除后不应
再有任何调用方传 report，抛错优于静默。

## 3. `deck-runner` 兜底的处置（R2.4）

`deck-runner.ts:88-99` 现逻辑：

```
resume === null 时：
  批量模式（requested === null）→ continue（跳过该页）
  显式点名单页          → from = "report"
```

移除 report 后 `from = "report"` 既非法（`RunStage` 已不含它）也无意义。改为：

```
resume === null → 一律 continue（跳过）
```

显式点名一个已全部完成的页时，队列为空，`start` 返回既有的
`{ accepted: false, message: "没有需要执行的页面" }`。文案需改写为能表达
「该页已全部完成，无需执行」的说法，否则用户点「运行此页」会看到一句听起来像出错的提示。

**这条与 R5 互补**：用户改了内容并保存后，R5 会失效下游，`computeResumeStage` 不再返回
null，「运行此页」正常工作。二者合起来才构成完整语义：**没有变更就没有可执行的事，
有变更就一定跑得动。** 单独实施任何一条都会留下缺口，故 R5 必须先于 R2.4 落地。

## 4. 验收后自动补跑 report（R2.2 / R2.3）

落点：`main/ipc/slide.ts` 的 `slide:accept-final` handler（`:174`）。

```
runAcceptFinal(...)            // 已有，成功后 accept-clean / accept-pptx 双记录已写盘
  ↓ 成功
runSlideReport(...)            // 新增，静默
  ↓ 失败
log(workspacePath, "report", "report", "failure", ...)   // 只记日志
  ↓ 无论成败
return { acceptedPath, autoCheckSummary }                // 返回值不变
```

- report 的前置依赖 `accept-pptx` 此时刚写为 completed，`assertStageDependenciesCompleted`
  可通过。顺序不可颠倒。
- 失败必须 `catch` 吞掉：验收记录已落盘，让 report 的异常冒泡会把「验收成功」翻转成
  「验收失败」，与 `ReviewPage.tsx:192` 已确立的口径冲突（那里 `refreshSlide` 失败同样吞掉）。
- 不改 IPC 返回类型，避免 renderer 侧连带改动。renderer 对 report 补跑无感知——它本就不该
  知道这个阶段存在。

## 5. 保存复核的粒度失效（R5）

落点：`main/ipc/slide.ts` 的 `slide:save-review`（`:65`）。现实现只做「parse → 写盘 → 校验」。

新流程：

```
1. parsed = TextReviewDocumentSchema.parse(document)
2. previous = await loadTextReviewDocument(ws)        // 写盘前读旧文档，可能为 null
3. 写盘
4. target = decideInvalidation(previous, parsed)      // 纯函数，新增
5. target !== null → invalidateSlideStage({ stage: target, reason: "保存复核内容" })
6. 校验（既有）
7. return { valid, errors, warnings, invalidated }    // 返回值新增 invalidated
```

`decideInvalidation` 判据（新增纯函数，放 `main/` 侧或 `shared/`，附单元测试）：

| 条件 | 失效目标 | 连带下游 |
|---|---|---|
| `previous === null` | `null` | — |
| `maskInvalidationProjection` 变了 | `"mask"` | clean / accept-clean / pptx / accept-pptx |
| 投影未变，但文档序列化不同 | `"pptx"` | accept-pptx |
| 完全相同 | `null` | — |

- `maskInvalidationProjection`（`packages/core/src/text-blocks.ts:426`）只提取几何/分类/
  `includeInMask`/`maskParams`，`mask/run.ts:328` 已用同一函数做输入指纹——**口径必须同源**，
  不得在此另写一份字段清单。
- **不得一律失效 `mask`**：`invalidate.ts` 的语义是强制重做而非幂等跳过，一律失效会让每次
  保存都触发 clean 的付费调用（gpt-image-2）。这是归档记录显式警告过的坑
  （`07-26-review-flow-simplification/implement.md:443`）。
- `invalidateStageAndDownstream`（`stage-graph.ts:84`）跳过 `pending` 状态的阶段，
  所以在 mask 从未跑过的页上保存是安全的 no-op。
- 「文档序列化不同」用 `JSON.stringify(previous) !== JSON.stringify(parsed)` 即可：
  `reviewStatus`/`updatedAt`/`sources` 的变化都应触发 pptx 重跑吗？——**`updatedAt` 与
  `reviewStatus` 不影响 PPTX 输出**，但 `pptx/run.ts:187` 的输入指纹本就含整个文档的
  `sha256File`，任何字段变化都会让它重跑。此处与 pptx 自身的指纹口径保持一致即可，
  不额外收窄，否则会出现「我们判定不用重跑、pptx 自己判定要重跑」的两套语义。

### 5.1 失效结果必须反映到界面（R5.4）

`ReviewPage.handleSave` 在保存成功后已调 `refreshSlide(slideId)`（`:192`，E1 修复）。
现在还需：`invalidated` 非空时**先 `clearLiveStages(slideId)` 再 `refreshSlide`**。

原因是 `implement.md:369` 记录过的同一个坑：`deriveStageViews` 是「耐久层打底、会话层覆盖」
（`stage-view.ts:85-87`），而 `run-done` 刻意保留 `liveStages`（`run-reducer.ts:124`）。
上一轮 run 留在会话层的 `mask/clean/pptx: completed` 会盖住刚写下的 stale，表现为
「磁盘 stale、轨道一片绿」。`clearLiveStages` 是已有解法，两条人工失效路径
（`rerunFrom`、`handleBackToReview`）都在用，保存路径要加入第三条。

## 6. 文本复核列表重构（R3）

### 6.1 模块划分

新增 `renderer/lib/review-filter.ts`（纯函数，遵循既有约定：不触碰 `window`、
用相对 `.js` 导入，以便 vitest 直接消费）：

```
export type ReviewFilter = "unreviewed" | "text-pending" | "classification-pending" | "agreed" | "all"
export const REVIEW_FILTER_ORDER: readonly ReviewFilter[]
export const REVIEW_FILTER_LABELS: Record<ReviewFilter, string>
export function matchesFilter(block, filter): boolean
export function filterCounts(blocks): Record<ReviewFilter, number>
export function defaultFilter(blocks, intent: ReviewEntryIntent): ReviewFilter
export function nextUnreviewedId(visible, currentId): string | null
```

`matchesFilter` 中的三个标签档**直接复用 `review-partition.ts` 的 `partitionOf`**，
不复制判据。`review-partition.ts` 保留 `partitionOf` / `REVIEW_PARTITION_LABELS` /
`unreviewedBlockIds`；删除 `partitionBlocks` / `REVIEW_PARTITION_ORDER` /
`ReviewPartitionGroup`（分组结构随 R3.1 消失），`orderedReviewBlocks` 退化为恒等序
（即 `text-blocks.json` 存储顺序），可直接删除并让调用方用 `blocks` 本身。

### 6.2 顺序稳定性——本次改动的核心不变量

**列表渲染顺序恒等于 `blocks` 数组顺序，任何编辑都不重排。**

这是 R3 全部收益的来源，也是最容易在后续迭代中被无意破坏的一条。实现上要求：

- 渲染直接 `blocks.map(...)`，不经过任何 `sort` / `groupBy`；
- 筛选只做 `filter`，不做重排；
- 「已复核淡化项」不从 DOM 移除，只加视觉态。

`review-partition.ts:11` 已有的注释（「分区内保持输入数组顺序，不做任何重排序」）要升级为
文件级不变量说明，并在 `BlockListPanel` 顶部注释中复述——它现在是整个界面的地基。

### 6.3 已复核淡化项的会话集合（R3.4）

标记已复核后该项仍显示，需要一个「本次筛选会话内曾可见」的集合：

```
const [stickyIds, setStickyIds] = useState<ReadonlySet<string>>(new Set())
```

- 标记已复核时把该 id 加入 `stickyIds`；
- 可见集合 = `blocks.filter(b => matchesFilter(b, filter) || stickyIds.has(b.id))`；
- 切换筛选、切换页面（`slideId` 变化）时清空 `stickyIds`。

不把它做成持久状态：它表达的是「你刚才在这一屏做过什么」，跨页/跨筛选保留没有意义，
且会让集合无限增长。

### 6.4 键盘流（R3.5 / R3.9）

- `moveBy` 的推进域从「三分区展平序」改为**当前可见集合**。跨分区自动展开的逻辑
  （`BlockListPanel.tsx:116-132`）随分组结构一并删除。
- 新增 `nextUnreviewedId(visible, currentId)`：在**当前可见集合**内从当前项之后找第一个
  `reviewStatus === "unreviewed"`，走到末尾**回绕**到开头继续找；无结果返回 null。
  回绕语义与 `todo-queue.ts:229` 的 `nextTodoItem` 一致。调用方在返回 null 时给明确提示
  （「当前筛选下已无未复核项」），不得静默失败（AC9）。
- 键位判定统一加进 `review-keyboard.ts` 的 `resolveReviewKeyAction`，新增
  `{ kind: "next-unreviewed" }`。**不得在组件里就地判键**——该文件存在的唯一理由就是让键盘流
  可测（`review-keyboard.ts:1-8`）。
- 键位取 `⌘↓`（macOS 首期平台）。`review-keyboard.ts:48` 现在对 `metaKey` 一律 passthrough
  以放行 ⌘S，新判定必须**排在该分支之前**并只截获 `⌘ArrowDown`，其余 ⌘ 组合继续放行。
- 输入法组字放行（`:45`）保持在最前，不受影响——中文复核是主场景，这条不能动。

### 6.5 筛选默认值的上下文（R3.6）

`defaultFilter(blocks, intent)`：

| intent | 条件 | 默认档 |
|---|---|---|
| `"sweep"` | 有未复核项 | `unreviewed` |
| `"sweep"` | 未复核数为 0 | `all` |
| `"targeted"` | — | `all` |

`intent` 由 `ReviewPage` 持有并透传：默认 `"sweep"`；`handleBackToReview`
（`ReviewPage.tsx:318`）在切回复核视图时置 `"targeted"`；切页（`slideId` 变化）时复位为
`"sweep"`。

`BlockListPanel` 内以 `useState(() => defaultFilter(...))` 取初值，之后由用户自由切换——
默认值只决定**打开时**看到什么，不是持续约束。`intent` 变化时需重算一次初值
（用 `slideId + intent` 作为 key 或 effect 依赖），否则「回到文本复核」不会生效。

### 6.6 已修改标记（R3.7）

判据 `block.updatedAt !== null`，与 `text-blocks.ts:275` `isHumanTouched` 的其中一项同源。
仅作视觉标记，不参与筛选、不影响任何判定逻辑——它回答的是「我刚才动过哪几块」。

## 7. report 产物记录按 attempt 匹配（R6）

`apps/cli/src/report/run.ts` 现按 `role` 取第一条匹配资产。改为先取该阶段的
`lastSuccessfulAttemptId`，再按 `role + attemptId` 双条件匹配——口径照抄
`main/slide-detail.ts:101` 的 `currentSuccessAsset`：

```
const attemptId = manifest.stages.find(s => s.stage === stage)?.lastSuccessfulAttemptId
if (attemptId == null) return undefined
return manifest.assets.find(a => a.role === role && a.attemptId === attemptId)
```

涉及 `clean_record`（stage `clean`）与 `pptx_check`（stage `pptx`）两处。
验证基准：真实工作区 `~/test/ppttest-2026-07-25` page-01 的 `clean_record` 有 clean-001 与
clean-002 两条，修复后 report 应读出 `outsideMaskDiff = 0.0439`（clean-002 的值）。

## 8. 实施顺序与依赖

```
R5（保存粒度失效）  ──必须先于──> R1（删重跑菜单）
                    └─────────────> R2.4（deck-runner 兜底）
R6（report attempt）──应先于──> R2.2（验收自动补跑 report）
R3（列表重构）      独立
R4（确认页文案）    独立
```

R5 先行是硬约束：删掉「从阶段重跑」菜单前，保存必须已经能把改动传下去，否则中间任何一个
提交点上用户都是被堵死的。R6 先行是软约束：先修数据口径，再让 report 变成每页必跑，
避免把错误指标批量写进工作区。

## 9. 兼容性与回滚

- **工作区数据无迁移**：本任务不改任何持久化契约。`RUN_STAGE_SEQUENCE` 变短只影响桌面端
  对既有 manifest 的**读取与展示**；manifest 里已有的 `report` 阶段状态继续存在，只是不再
  出现在轨道上。旧工作区打开即用，新工作区在旧版本上打开也正常。
- **回滚粒度**：R1–R6 各自独立提交，可单独 revert。唯一的顺序耦合是 R5 → R1/R2.4
  （见 §8），revert R5 时必须连带 revert R1。
- **测试基线**：`apps/desktop/test` 已有 `accept-gate` / `slide-nav` 等用例引用
  `RUN_STAGE_SEQUENCE` 构造夹具，长度从 10 变 9 后需确认这些用例仍成立（它们按序列长度
  生成全 completed 的夹具，不硬编码 10，预期无需改动但必须实跑确认）。

## 10. 取舍记录

- **为什么不冻结分区而是拆掉分区**：冻结（进页快照一次）改动更小，但改完分类的块会滞留在
  「分类待确认」区，标题计数与内容当场矛盾，且重进页面又会重排。治标。
- **为什么不让界面「跟着跳」**：保留分组 + 自动展开目标区 + 滚动跟随，项仍会移动，
  在 155 项的页面上每次改分类伴随一次跨屏滚动，比不动更晕。
- **为什么保留 report 阶段而非删除**：`report.json` 是唯一的结构化留档（自动检查 + 人工接受
  记录），CLI 的 `formatSlideReport` 在消费，也是未来批量质检的唯一数据源。要削减的是它的
  可见性，不是它本身。
- **为什么保留「重做底图」**：clean 会真失败或真产出坏底板，`CheckSummary` 正在展示残留像素
  与 mask 外改动率；看到指标不对却无重试入口，是另一种堵死。改文案让它说实话即可。

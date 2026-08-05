# 技术设计：规格产出到建页的衔接

> 决策 D1–D6 与事实 F1–F13 见 `prd.md`，本文不重复论证，只写怎么落。

## 1. 边界

**不动的**：`reconcileDeckSpec` 的三类语义、`ContentSpecSchema`、指纹口径、
`buildPageGenerationPrompt`、`SCHEMA_VERSION`、`applySpecChange` 的唯一写入口地位。
本任务**不写规格**，只读规格 + 建页。

**改动面**：CLI 一个可选参数、IPC 契约两个可选字段、渲染层一个纯函数 + 两个页面 + 一次组件提取。

## 2. 数据流

### 2.1 算「待建页」（纯前端，零新增 IPC）

策划页已同时持有两边：`planning-store` 的 `spec`（`deck:read-deck-spec`）与
`deck-store` 的 `slides`。`SlideDetail` 已带 `specEntryId`（F4），因此：

```
pendingEntries = spec.entries.filter(e => !builtEntryIds.has(e.specEntryId))
builtEntryIds  = slides.filter(s => !s.removed && s.sourceKind === "generated")
                       .map(s => s.specEntryId)
```

新函数 `classifyPendingEntries(spec, slides)` 放 `renderer/lib/planning-core.ts`，
与既有 `classifyOutdatedPages` 并列。

呈现口径（D3）注意：`summarizeSpec(spec: ContentSpec)`（`source-picker-core.ts:55`）**入参是整份规格、
不支持条目子集**。因此待建页的呈现走「先 `summarizeSpec(spec)` 得到全量 `SpecPageSummary[]`，
再按待建 id 过滤」，**不要**改 `summarizeSpec` 的签名去迁就本任务。

### 2.2 口径必须与 CLI 逐条对齐（本任务最大的正确性风险）

CLI 的 `collectGeneratedPages`（`content-spec.ts:100`）做两次过滤：
**跳过 `removedAt !== null`**（105 行）、**跳过 `source.kind !== "generated"`**（112 行）。
渲染层少任何一条，界面上的「待建 N 条」就与实际建出的页数对不上，而付费确认写的正是这个 N。

由此推出一条**既有语义**，本任务第一次把它暴露到界面上：

> 一页被软删除后，它的规格条目会重新出现在「待建页」里——因为 CLI 侧同样把它当
> `newEntries`，再建一次会得到一页新的。

这不是缺陷，也不在本任务的修改范围内，但**必须有测试钉住**，否则将来谁改了任一侧的过滤条件都不会有人发现。

### 2.3 发起建页

```
PlanningPage
  → buildCreatePagesConfirm(selectedIds)         // 确切次数，见 §4
  → startSourceTask(target, {kind:"generate", entryIds})   // 不传 specPath
  → source-task-store.run
  → IPC deck:runSourceTask
  → SourceTaskRunner case "generate"             // 透传 entryIds
  → runDeckGenerate({deckPath, entryIds, confirmUpload:true})
      → loadDeckContentSpec(deck.path)           // specPath 省略时读 deck 内规格（F10）
      → reconcileDeckSpec → newEntries → 按 entryIds 过滤 → 串行建页
```

### 2.4 结果回流

`SourceTaskResult` 经 store 回到策划页，成功页数与失败条目分别呈现（R6）。
建页会改变 `slides`，因此完成后须 `refreshStatus()`，「待建页」一档随之收缩。

## 3. 契约改动（两处，都是纯增量可选字段）

### 3.1 CLI `DeckGenerateOptions`（`apps/cli/src/deck/generate.ts:35`）

```ts
/** 只建这些条目；省略＝建全部 newEntries（与改动前逐字同义）。未知 id 整体拒绝 */
readonly entryIds?: readonly string[];
```

过滤点在 `reconcileDeckSpec` 之后、建页循环之前（`generate.ts:243` 一带）。
未知 id 抛 `SPEC_PAGE_NOT_FOUND`（既有错误码，`error-handling.md:33` 已登记
「整体拒绝，不部分执行」的口径，本任务沿用，不新增错误码）。

**空数组不等于省略**：`entryIds: []` 抛 `SPEC_SELECTION_EMPTY`，判点排在 `confirmUpload`
检查之后、任何 I/O 之前。省略才是「建全部」，两者语义相反，让空数组悄悄落进「建全部」
是最坏的一种默认值。renderer 侧因此在 0 勾选时禁用按钮，而不是发一个空数组下来。

**已建过页的 id 不算未知**：判据是「规格里有没有这个条目」，而不是「它在不在 `newEntries` 里」。
在规格里但已建过页的条目落进既有 `skipped`，不报错——界面待建列表来自一份可能稍旧的页面快照
（R4 已记理由）。因此校验对象是 `spec.entries`，**不是** `reconciliation.newEntries`。

**校验须在建页循环之前**，与该文件既有的「会失败的校验一律前移」纪律一致
（`generate.ts:177` 注释）——否则建到第 3 页才发现第 5 个 id 是错的，钱已经花了。
实现上更前一步：有 `--spec` 时读完外部规格即校验（**建 deck 之前**，不留半成品目录，
外部规格与落盘副本的条目集合相同）；无 `--spec` 时规格来自 deck 内部，判点在读到它之后，
而那条路径本就不会新建 deck。

**进度分母与 `skipped` 都取过滤后的集合**。分母不跟着过滤，界面上的「第 1/6 页」就与实际
执行次数对不上，而那个数字正是 §4 付费确认里给用户看的那个。`skipped` 随之含两类：
已建过的，与本次没勾选的。

### 3.2 IPC `SourceTaskRequest` 的 generate 分支（`channels.ts:305`）

```ts
| {
    readonly kind: "generate";
    /** 外部规格文件；省略＝用 deck 内已有规格（CLI 侧本就支持，见 F10） */
    readonly specPath?: string;
    readonly entryIds?: readonly string[];
    readonly deckName?: string;
  }
```

`specPath` 由必填改为可选是**放宽**，既有调用方（SourcePicker 两条路）一律照旧传值，不受影响。

## 4. 付费确认

新增 `buildCreatePagesConfirm(count)` 放 `renderer/lib/planning-core.ts`，与
`buildRegenerateBatchConfirm` 并列而不是复用 `buildGenerateConfirm`——两者口径不同：

| 函数 | 口径 | 为什么 |
|---|---|---|
| `buildGenerateConfirm`（既有） | 「**最多** N 次，实际可能更少」 | SourcePicker 传整份规格，CLI 会跳过已建的 |
| `buildCreatePagesConfirm`（新） | 「**将调用 N 次**」 | 勾选集合即执行集合，次数是确切值 |

把确切次数塞进「最多 N 次」的文案里，等于让用户以为可能更少——付费门槛的可信度就是靠这个数字立住的（`channels.ts:463`）。

### 4.1 「确切」的一处限定：快照过旧时实跑会 **< N**

勾选集合算自 `slides` 的一份快照。若某条目在快照之后、执行之前已在别处被建掉，CLI 会按
R4 的幂等口径跳过它，实际调用次数因此少于确认框里的 N。这个缺口**只在这一个方向上发生**，
仍然选「确切」口径，三条理由：

1. **方向安全**：实跑只会更少，绝不会多。付费确认真正要守的是「不多花用户没点头的钱」，
   这条在任何时序下都严格成立。
2. **发生面很窄**：建页任务与规格写入互斥（F8），同一 App 内不可能有第二次建页并发跑掉条目；
   缺口只来自「控制台那边刚建完、策划页的 `refreshStatus` 还没落地」或有人在 App 外直接跑 CLI。
   常规路径下进页与任务结束各拉一次状态，快照是新的。
3. **改成「最多」的代价更大**：那样它就与 `buildGenerateConfirm` 那种**常态性**不确定
   （整份规格 vs 只补待建，差额可能是十几条）混为一谈。把一个几乎总是精确的数字写成上限，
   会让用户对所有确认框里的数字一律打折——付费门槛就是这样失去可信度的。

因此：文案维持「将调用 N 次」，可靠性靠**让 N 本身保持新鲜**（进入策划页与任务结束后
`refreshStatus()`，见 §2.4）来兑现，而不是靠把话说软。

## 5. 组件提取

`SourceTaskBar` 现为 `ConsolePage.tsx:222` 的局部组件。提取到
`renderer/components/` 下共享，控制台与策划页各自渲染同一个组件。
它已完全由 `useSourceTaskStore` 驱动、不吃 props（除 `className`），提取是纯搬运。

**不抄第二份**：两处进度文案分歧是 M6 反复踩过的坑（`formatSpecHistoryWarning` 注释）。

## 6. 控制台空态（R7）

`GridEmptyState` 现在是纯展示组件（`ConsolePage.tsx:382`）。改为由 `ConsolePage` 在
零页时调 `window.api.deck.readDeckSpec(deckPath)`，把「待建条数」传进去：

- 规格存在且有待建条目 → 写明条数 + 指向策划工作台
- 规格不存在（返回 `null`）或读失败 → **退回现有文案**（F9），不报错、不阻塞

读失败必须静默降级：空态是「告诉你现在能干什么」的地方，在这里弹错误只会把一个
本来就一无所有的界面变得更吓人。

## 7. 兼容性与回滚

- 两处契约改动都是可选字段，省略即旧行为。既有 `deck-generate` 用例**一条断言都不该改**
  ——要是改了，说明默认路径的行为变了，那就是做错了。
- 回滚点：CLI 的 `entryIds` 单独成提交。若它出问题，`git revert` 该提交后界面退化为
  「全量建页」（勾选框全禁用或整体隐藏），其余功能不受影响。
- 渲染层新增的都是新函数与新分支，不改既有函数签名。

## 8. 前端设计

实现前必读 `DESIGN.md`。「待建页」一档与既有「已过时」一档在同一面板内并排，
必须共用同一套栅格、勾选控件与标题层级——两档视觉不一致会让人以为是两种不同性质的东西。

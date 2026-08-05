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

**校验须在建页循环之前**，与该文件既有的「会失败的校验一律前移」纪律一致
（`generate.ts:177` 注释）——否则建到第 3 页才发现第 5 个 id 是错的，钱已经花了。

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

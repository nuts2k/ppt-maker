# planning 视图技术设计（M6 子任务②）

本文只定义**本任务内部**的实现形状。跨子任务契约在父任务
`08-02-content-planning-workbench/design.md`，一字不改，此处只引用。

## 1. 边界

不动的东西（父任务 A7 + 本任务边界引用）：

- `ContentSpecSchema` / `specViewFingerprintValues` / `buildPageGenerationPrompt` / `SCHEMA_VERSION`
- `SpecChangeRecord` / `PlanningMessage` 的记录形状
- `applySpecChange` 六步顺序（`apps/cli/src/deck/spec-edit.ts:269`）

**写盘只走 `applySpecChange`**：渲染进程与 main 都不得调 `writeDeckContentSpec`。
main 侧对 CLI 模块的引用沿用既有 `@cli/...` 别名（`main/ipc/deck.ts:5-16` 已是此形态），
不新建通信层。

本任务**不做对话**（③）。左栏本轮由历史面板占用（E5）。

## 2. 视图与路由

### 2.1 AppView 第四项

`ui-store.ts:11` 的联合类型加 `"planning"`，`App.tsx` 加一个分支。
新增两个 action，与 `openSourceReview` 同形——**对外唯一入口**，调用方不得自己
`setView("planning")` 再补状态：

```ts
/** 打开当前 deck 的规格工作台（控制台「改规格」入口） */
openPlanning(): void;
/** 新建策划：deck 已由调用方建好并切过工作区，这里只切视图 */
openPlanningForNewDeck(): void;
```

两者的差别只在**空规格时的初始态**：`openPlanning` 进来若无 `content-spec.json`
显示引导空态；`openPlanningForNewDeck` 直接展开一个待填的 `style` 输入。
这个差别记在 planning-store 的 `justCreated` 上，不进 ui-store——它是编辑器的
一次性初始态，不是视图路由的属性。

**不绑 `key`**：编辑器有未保存草稿，换 deck 之外的任何重挂载都会丢草稿
（与 `SourceReviewPage` 不绑 key 同理，`App.tsx:38` 注释已说明该取舍）。

### 2.2 两个入口

| 入口 | 位置 | 行为 |
|---|---|---|
| 改规格 | 控制台顶栏 / deck 已打开时 | `openPlanning()`，读 `<deck>/content-spec.json` |
| 新建策划 | 控制台空态 + 顶栏下拉 | 选父目录 + 填 deck 名 → `deck:create-empty` → 切工作区 → `openPlanningForNewDeck()` |

新建走原生 `showOpenDialog` 选**父目录**（复用 SourcePicker 选图片目录的既有形态），
deck 名在界面内输入。落点为 `<父目录>/<deck 名>`；`createEmptyDeckWorkspace`
内部 `assertDeckDoesNotExist` 会拒绝已存在的目录，重名由它报错，桌面端不另写一份判定。

## 3. IPC 契约（新增）

全部落在 `main/ipc/deck.ts`，类型进 `main/ipc/channels.ts`，preload 逐条转发。

| 通道 | 入参 | 出参 | 备注 |
|---|---|---|---|
| `deck:create-empty` | `parentDir, name` | `DeckStatusResult` | 包 `createEmptyDeckWorkspace`（`workspace.ts:210`），写活动日志 |
| `deck:read-deck-spec` | `deckPath` | `ContentSpec \| null` | 包 `loadDeckContentSpec`（`content-spec.ts:51`），**无规格返回 null 不抛错** |
| `deck:apply-spec-change` | `deckPath, nextSpec, summary` | `ApplySpecChangeResult` | `origin` 恒为 `"manual"`；`"proposal"` 留给 ③ |
| `deck:list-spec-history` | `deckPath` | `SpecChangeRecord[]` | 包 `listSpecChangeRecords`（`planning-store.ts:88`） |
| `deck:rollback-spec-change` | `deckPath, recordId` | `ApplySpecChangeResult` | 包 `rollbackSpecChange`（`spec-edit.ts:377`） |

**不新增 `deck:preview-spec-change`**：手工保存不做事前预告，理由见 §4.3。
③ 的模型提案需要它时再加，那时才有真实调用方。

批量重生成**不走新通道**，接进既有 `SourceTaskRunner`（§5.2）。

## 4. 编辑器：状态模型与保存

### 4.1 状态归属

新建 `renderer/stores/planning-store.ts`：

```ts
interface PlanningState {
  /** 磁盘现值。null = 该 deck 尚无规格 */
  readonly saved: ContentSpec | null;
  /** 编辑中的草稿。null = 未进入编辑（与 saved 一致） */
  readonly draft: ContentSpec | null;
  readonly saving: boolean;
  /** 上一次保存的结果，用于结果条与 historyWritten 告警 */
  readonly lastResult: ApplySpecChangeResult | null;
  readonly justCreated: boolean;
}
```

**脏判定用 `diffContentSpec(saved, draft)` 而不是 `JSON.stringify` 比对**：后者会把
纯位置变化、时间戳差异都算成脏。`diffContentSpec` 是 core 纯函数、渲染进程可直接
import（`planning-contracts.ts:187`），且它的 `modified` 口径**复用指纹投影**
（`planning-contracts.ts:158` 注释），与「这一页会不会过时」天然同源。

脏 = `styleChanged || added.length || removed.length || modified.length || reordered`。

### 4.2 离开拦截

E2 选了显式保存，代价就是必须堵住三个出口，缺一个就会静默丢编辑：

1. 切视图（`backToConsole` / `openSlide` / `openSourceReview`）
2. 切工作区（换 deck）
3. 关窗（`before-quit` / `close`）

前两个在 planning 页内用 `window.api.system.confirm` 拦；关窗需要 main 侧参与——
渲染进程的 `beforeunload` 在 Electron 里不可靠。**本轮只做前两个**，关窗一路
用「保存后才关得干净」的现实约束兜底，并在 `implement.md` 里列为已知缺口。
（理由：main 侧关窗拦截要动窗口生命周期，属于应用级改动，不该由一个视图捎带引入。）

### 4.3 保存流程

```
点「保存」
  → applySpecChange({deckPath, nextSpec: draft, origin: "manual", summary})
  → 成功：saved = result.spec，draft 清空，结果条如实报告
  → 失败：草稿保留，错误条显示翻译后的原因（§7.1）
```

**保存前不做过时预告**，三条理由：

1. 保存不花钱、不发起任何图像生成，A8 的付费门槛不适用；
2. `previewSpecChange` 会再做一遍全 deck 对账（`spec-edit.ts:338-340`），
   保存路径就变成读两遍 22 个 JSON，而 E2 刚把对账频次降到一次编辑会话一次；
3. `applySpecChange` 的返回值里已经有 `drifted` / `missing`，**事后如实报告**信息量
   完全相同，且是真实结果而非预测。

`style` 的爆炸半径是 deck 级（父任务 prd 结构事实 4），这一点靠**字段旁的常驻说明**
承担，不靠弹框：「风格会拼进每一页的提示词，改它将使全部已生成页过时」。
静态文案、零运行时代价、且改之前就看得见——比改完再弹框更早。

### 4.4 字段与控件

| 字段 | 控件 | 依据 |
|---|---|---|
| `style.description` | 大文本框 + 常驻爆炸半径说明 | D2：下游吃的就是散文，不拆结构化 |
| `pageType` | 单行输入 | 自由文本，schema 无枚举 |
| `textGroups` | 分组增删改 + 组内条目增删改 | V2 |
| `visualIntent` | 多行文本框 | |
| `revisionNotes` | 列表，**每条可删** | R3 明列的 M5 缺口修补 |

**`textGroups` 的分量呈现（V3）**：该区块常驻一句
「这些文字同时是该页 OCR 复核的比对基准，重生成后会一并更新」。
真正的下游影响发生在重生成时（`replace-source.ts:70` 写新 `reference_text` 资产），
所以确认框里的措辞归 §5.3，编辑器里只做静态告知。

条目**不做拖拽排序**：`diffContentSpec` 已把纯位置变化单列为 `reordered` 且不改指纹
（`planning-contracts.ts:135` 注释），但排序交互的收益低于它引入的键盘可达性成本
（DESIGN.md 六态是硬性要求）。列表用「上移/下移」按钮，两个态就够。

## 5. 过时页清单与批量重生成

### 5.1 清单数据源

**取全量，不取增量**。V4 要求列出全部已过时页，而 `ApplySpecChangeResult.drifted`
只含**本次新增**过时的页（`spec-edit.ts:67` 注释）。全量来自
`deck:status-detailed` 的 `specDrift === "drifted"`——`DeckStatusSlide` 已带该字段
（实测 `~/test/wt4-spec-2026-08-02` 的 page-04 即为 `drifted`）。

`missing`（条目被删导致页面失联）**单列一节且不可勾选**：它没有对应条目，
重生成无从谈起。给出的动作是指引去控制台删页，不在本视图代劳。

非 `generated` 页永远不进清单——`collectGeneratedPages`（`content-spec.ts:112`）
只认 `generated`，这是 M5 A2 的既有保证，本任务不得破坏。
`~/test/wt4-append` 的 11 页里只有 page-11 有 `specEntryId`，正是这条的真实样本。

### 5.2 执行路径：接进 SourceTaskRunner

`SourceTaskKind` 加 `"regenerate-batch"`，`SourceTaskRequest` 加一支：

```ts
| {
    readonly kind: "regenerate-batch";
    /** 页标签数组；空数组由 CLI 侧 SPEC_SELECTION_EMPTY 拒绝，桌面端不另判 */
    readonly pageLabels: readonly string[];
    readonly note?: string;
  }
```

**不新开通道**的理由是既有机制刚好全都需要：与流水线的**双向互斥**
（`channels.ts:269`）、归一后的进度事件、活动日志落点。另起一条路等于把这三件
事各写第二遍，而 M5 已经为「建页任务不复用 DeckRunner」付过一次这样的代价。

main 侧包 `runDeckRegenerateBatch`（`regenerate-batch.ts:227`），
`selection` 恒为 `{kind: "labels", labels}` —— **不用 `all-drifted`**：确认框是按
用户勾选的 N 页给出的，而 `all-drifted` 在 CLI 侧重新解析一次集合，两次解析之间
deck 可能已变，实跑页数与确认页数就会不一致（`regenerate-batch.ts:19` 注释正是
这条纪律）。勾选即事实，原样传下去。

### 5.3 付费确认

复用 `window.api.system.confirm`（原生框）+ 新增
`buildRegenerateBatchConfirm(pageLabels)`，放 `renderer/lib/planning-core.ts`
（与 `source-picker-core.ts` 同构：纯函数、不碰 `window`、可被 vitest 直接测）。

文案必须写明**确切页数**与**不可撤销**。与 `buildGenerateConfirm` 的「最多 N 次」
不同，这里是**确切值**：页是用户逐个勾选的，不存在 CLI 侧的跳过对账。
措辞还须包含 §4.4 提到的下游影响：这些页的 OCR 复核基准会随之更新，
且重生成后每页都要重新逐张确认源图（`SourceTaskResult.regenerated.requiresAcceptance`
恒为 true）。

## 6. 历史面板与回滚

左栏，倒序列出 `listSpecChangeRecords` 的记录。每条显示时间、`origin`、`summary`、
受影响条目数。

展开后的逐条 diff **直接读记录字段渲染，不重算**：`SpecChangeRecord` 里已经存了
`styleBefore` / `styleAfter` / `entriesBefore` / `entriesAfter`（父任务 design §3.2），
且 `entriesBefore` 与 `entriesAfter` 逐位配对、同一位置说的是同一个条目
（`planning-contracts.ts:185` 注释）。再调一次 `diffContentSpec` 等于让历史展示与
记录内容各算一份，两者一旦漂移，界面会对同一条记录给出与回滚不同的说法。

回滚：`rollbackSpecChange` → 返回 `ApplySpecChangeResult` → 与保存同一条结果处理。
文案必须说清 **回滚是一次新的前进，不抹历史**（父任务 design §3.3）。

**零变更记录的区分（① 留给 ② 的待定）**：`fingerprints` 为空的记录（如不带
`--note` 的 `deck regenerate` 记的「受影响 0 条」）用次级样式显示并标注
「无内容变更」。理由：这类记录记的是**重生成事件**本身，语义有效，删掉是撒谎；
但混在真变更里会淹没历史列表——一叠记录里绝大多数若是它，用户就不看历史了。
按 DESIGN.md「有颜色 = 要你管」的同一逻辑，无变更记录不该有任何视觉重量。

## 7. 三个坑的解法

### 7.1 一页坏，全盘存不下

`applySpecChange` 的第 3 步 `collectGeneratedPages` 会对**每一页**调
`loadSlideWorkspace`（`content-spec.ts:108`），任一页 manifest 损坏就整体抛错，
而错误里没有「是哪一页」这个信息。用户在改一句 `style` 时看到一个陌生的
workspace 错误，无从解释。

**解法：main 侧只在失败路径上补齐上下文。**

```
catch (error) {
  const detailed = await buildDeckStatusDetailed(deckPath)   // 已对单页损坏容错
  const broken = detailed.slides.filter(s => s.lastError?.code === "WORKSPACE_LOAD_FAILED")
  if (broken.length) throw new Error(`保存失败：${labels} 的页面数据损坏，修好后才能改规格`)
  throw error                                                 // 不是这个原因，原样上抛
}
```

`buildDeckStatusDetailed`（`main/ipc/deck.ts:60`）**已经**对单页 manifest 损坏做了
容错并把原因记进 `lastError`（`:98-113`），复用它即可，不写第二份探测逻辑。
代价只在失败路径上多读一遍 —— 正常保存零额外开销。

**不给 `applySpecChange` 加「跳过对账」的开关**：跳过对账就拿不到 `drifted` /
`missing`，而这两个值正是保存后更新过时清单所必需的。为省一次读盘换掉功能本身，
不划算；且 E2 已把对账频次降到一次编辑会话一次。

### 7.2 `historyWritten === false` 必须出声

规格已保存但这次改动没进历史——既回看不到也回滚不了。结果条用**警示样式**
（非成功样式）明说这一点，并指向左栏历史面板。
文案参考 CLI 侧现成的 `formatSpecHistoryWarning`（`spec-edit.ts:470`），
两处措辞保持一致。

**不得静默吞掉**：静默等于让用户以为有后悔药。

### 7.3 旧格式与零页 deck

- **旧格式**（`~/test/ppttest-2026-07-25`，无 `source` 字段、无 `content-spec.json`）：
  `deck:read-deck-spec` 返回 `null` → 显示引导空态，**不写任何文件**。
  打开视图这个动作本身必须零副作用（A6：不被改写）。
- **零页 deck**：`slides: []`，清单区为空态，编辑与保存照常。
  `collectGeneratedPages` 对空数组返回空数组，`drifted` 恒为空。

## 8. 测试策略（E4）

**离线（vitest）覆盖全部逻辑分支**：

- 纯函数进 `renderer/lib/planning-core.ts`，按 frontend/quality-guidelines
  「渲染层的规则测在纯函数产物上，不测渲染结果」——本项目没有 DOM 测试库。
- 脏判定、清单分类（drifted / missing / 非 generated 不入列）、确认文案、
  零变更记录判定，全部是纯函数，可直接断言。
- main 侧 IPC handler 的错误翻译（§7.1）用临时 deck 目录 + 故意写坏一页 manifest 验证。
- 批量重生成的分支（勾选子集、失败不终止、**未勾选页字节不变**）用可注入的
  stub generator（`DeckRegenerateBatchOptions.generate`，`regenerate-batch.ts:33`）。
  字节不变是文件系统事实，与图像内容无关，stub 验得同样严格。

**真机走查只做一次 1 页真实调用**，证明批量路径确实接到了 `replace-source` 的
`referenceText` 通道。开跑前必须先 `deck status --json` 确认 drifted 集合
——`~/test/wt4-spec-2026-08-02` 的基线里 page-04 **本来就是 drifted**，
照搬脚本改另一条会变成 2 页 = 2 倍花费（W1 教训）。走查在 scratchpad 副本上做。

**断言必须变异验证**（frontend/quality-guidelines「断言必须变异验证过」）：
「未勾选页字节不变」这类零副作用断言，先让它红一次再信它——M6 子任务① 三次
变异验证都抓到了东西。

## 9. 不做

- 对话、模型提案、背景材料输入（③）。
- `deck:preview-spec-change` 通道（无真实调用方，③ 需要时再加）。
- 条目拖拽排序（§4.4）。
- 关窗时的未保存拦截（§4.2，列为已知缺口）。
- 在本视图内删页（失联页指引去控制台，不代劳）。
- 暗色主题（DESIGN.md Known Gaps，全应用统一未做）。

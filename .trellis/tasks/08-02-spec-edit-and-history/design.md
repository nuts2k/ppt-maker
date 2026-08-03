# 技术设计：规格编辑与变更日志底座（M6 子任务①）

父任务 `design.md` 定的四件跨子任务契约在本文中只被引用与实现，不被重定义。
本文只写本任务内部的模块划分、签名、算法与失败语义。

## 1. 分层：为什么入口在 CLI、类型在 core

`specViewFingerprint` 在 `apps/cli/src/providers/page-generation.ts:21`，
core 因为被渲染进程直接 import 而不能拉 `node:crypto` / `node:fs`
（`packages/core/src/content-spec-contracts.ts:135`）。因此：

| 放哪 | 放什么 | 判据 |
|---|---|---|
| `packages/core` | 记录类型与 zod schema、`diffContentSpec`、`applyRollbackToSpec` | 纯函数、零 Node 依赖、渲染进程要用 |
| `apps/cli` | `applySpecChange`、`previewSpecChange`、jsonl 读写、批量重生成、CLI 命令 | 要文件系统与哈希 |

桌面端（子任务②③）通过 main 进程 `import { … } from "@cli/deck/spec-edit.js"` 复用，
沿用 `apps/desktop/src/main/ipc/deck.ts:10` 已有的引用方式；渲染进程只 import core 的纯函数。

## 2. 文件清单

**新增**

| 文件 | 内容 |
|---|---|
| `packages/core/src/planning-contracts.ts` | `SPEC_CHANGE_RECORD_V`、`AffectedEntry`、`SpecChangeRecordSchema` / `SpecChangeRecord`、`SpecChangeOrigin`、`diffContentSpec`、`applyRollbackToSpec` |
| `apps/cli/src/deck/planning-store.ts` | `planning/` 路径常量与「按需创建」的目录保障、`appendSpecChangeRecord`、`listSpecChangeRecords` |
| `apps/cli/src/deck/spec-edit.ts` | `applySpecChange`、`previewSpecChange`、`rollbackSpecChange` |
| `apps/cli/src/deck/regenerate-batch.ts` | `runDeckRegenerateBatch`、`formatDeckRegenerateBatchResult` |

**改动**

| 文件 | 改什么 |
|---|---|
| `packages/core/src/index.ts` | 导出 planning-contracts |
| `apps/cli/src/deck/generate.ts:208` | 直调 `writeDeckContentSpec` → 走 `applySpecChange`（C3） |
| `apps/cli/src/deck/regenerate.ts:176-178` | `appendRevisionNote` 的写回改走 `applySpecChange` |
| `apps/cli/src/deck/regenerate.ts:103` | 抽出单页执行体供批量复用（见 §6） |
| `apps/cli/src/index.ts` | 注册 `deck spec-apply` / `deck spec-history` / `deck spec-rollback`；`deck regenerate` 增 `--pages` / `--all-drifted` |

`PlanningMessage` 与 `session.jsonl` 属于子任务③，本任务**只**建 `planning/` 目录约定，不预写会话文件。

## 3. core 侧契约与纯函数

```ts
// packages/core/src/planning-contracts.ts
export const SPEC_CHANGE_RECORD_V = 1;              // 局部版本轴，不挂 SCHEMA_VERSION

export type SpecChangeOrigin = "manual" | "proposal" | "rollback";

export interface AffectedEntry {
  readonly specEntryId: string;
  readonly index: number;                            // 变更时在 entries 数组中的位置
  readonly value: ContentSpecEntry | null;           // null = 该时刻不存在
}

export interface SpecChangeRecord {                  // 字段与父任务 design §3.2 逐字一致
  readonly v: 1; readonly recordId: string; readonly at: string;
  readonly origin: SpecChangeOrigin; readonly summary: string;
  readonly styleBefore: ContentSpecStyle; readonly styleAfter: ContentSpecStyle;
  readonly entriesBefore: readonly AffectedEntry[]; readonly entriesAfter: readonly AffectedEntry[];
  readonly fingerprints: readonly { specEntryId: string; before: string | null; after: string | null }[];
  readonly conversationRef: string | null; readonly rollbackOf: string | null;
}
export const SpecChangeRecordSchema: z.ZodType<SpecChangeRecord>;   // v 用 z.literal(1)
```

### 3.1 `diffContentSpec`

```ts
export interface ContentSpecDiff {
  readonly styleChanged: boolean;
  readonly entriesBefore: readonly AffectedEntry[];
  readonly entriesAfter: readonly AffectedEntry[];
  readonly added: readonly string[];     // specEntryId
  readonly removed: readonly string[];
  readonly modified: readonly string[];
  readonly reordered: boolean;
}
export function diffContentSpec(before: ContentSpec, after: ContentSpec): ContentSpecDiff;
```

规则：

- 以 `specEntryId` 为主键做左右外连接。仅在 before 出现 → `removed`，`entriesBefore` 记其原
  index 与值、`entriesAfter` 记 `value: null`；仅在 after 出现 → `added`，反之。
- 两侧都有且**深比较不等**（`pageType` / `textGroups` / `visualIntent` / `revisionNotes`）→ `modified`。
- **纯位置变化单独表达**：两侧都有、值相等但 index 不等，记 `reordered: true`，
  并把该条目按「值相等」处理，不进 `modified`。理由：位置变化不改指纹，不该让页面变过时。
  但它必须进 `entriesBefore` / `entriesAfter`，否则回滚恢复不出原顺序。
- 输出按 after 的 index 升序；`removed` 的按 before 的 index 升序追加。确定性排序是回滚可重放的前提。

### 3.2 `applyRollbackToSpec`

```ts
export function applyRollbackToSpec(current: ContentSpec, target: SpecChangeRecord): ContentSpec;
```

算法（顺序固定，保证可重放）：

1. `style = target.styleBefore`；
2. 从 `current.entries` 中删除所有「`target.entriesBefore` 里 `value === null`」的 `specEntryId`
   （这些是那次变更新增出来的条目）；
3. 对 `target.entriesBefore` 里 `value !== null` 的项，按 `index` **升序**处理：
   已存在同 id → 原地替换值并移动到 `index`；不存在 → 在 `index` 处插入（`index > 长度` 时追加）；
4. `specId` / `createdAt` 沿用 `current`，`updatedAt` 由调用方更新。

未被记录触及的条目原样保留——这是「回滚是一次新的前进」的直接体现：回滚只撤销那一次变更，
不把后续无关变更一并抹掉。

## 4. `applySpecChange`（S1）

```ts
// apps/cli/src/deck/spec-edit.ts
export interface ApplySpecChangeOptions {
  readonly deckPath: string;
  readonly nextSpec: ContentSpec;          // 全量新规格；specEntryId 由调用方分配，模型不得编造
  readonly origin: SpecChangeOrigin;
  readonly summary: string;
  readonly conversationRef?: string | null;
  readonly rollbackOf?: string | null;
  readonly now?: () => string;             // 测试注入
  readonly newRecordId?: () => string;     // 测试注入
}
export interface ApplySpecChangeResult {
  readonly spec: ContentSpec;              // 落盘后的规格
  readonly record: SpecChangeRecord;
  readonly historyWritten: boolean;        // 第 5 步失败为 false，不影响前四步
  readonly drifted: readonly DriftedPage[];// 本次变更导致过时的页
  // `missing` 是复核期补的：`--dry-run` 会预告「确认后 N 页规格失联」，
  // 落盘后的结果若不带它，用户据以决定的那个数字就凭空蒸发了
  readonly missing: readonly DriftedPage[];// 条目被删导致失联的页
}
```

执行顺序（不可拆）：

1. `loadDeckContentSpec(deckPath)` 取 `previous`（可为 `null`，即 C3 的首次导入）；
2. 归一化：`specId` / `createdAt` 强制沿用 `previous`（`previous === null` 时用 `nextSpec` 的值），
   `updatedAt = now()`（C4）；
3. `ContentSpecSchema.parse`（`superRefine` 的 `specEntryId` 唯一性在此把关）；
4. `diffContentSpec(previous ?? 空规格, normalized)`，对受影响条目两侧各算
   `specViewFingerprint(style, entry)`（条目不存在的一侧记 `null`）;
   **style 变了则所有条目都是受影响条目**——style 进指纹投影，改它波及全 deck；
5. `writeDeckContentSpec(deckPath, normalized)`（内部即 `writeJsonAtomic`）；
6. 组装 `SpecChangeRecord`（`recordId = randomUUID()`）并 `appendSpecChangeRecord`；
   **失败只 `console.error` 并置 `historyWritten: false`，绝不上抛、绝不回滚第 5 步**。

`drifted` 由 §5 的同一实现算出，在第 5 步之后基于新指纹与各页 `source.specEntrySha256` 比对。

### 4.1 收编两处既有写入

- `generate.ts:208`：`origin: "manual"`，`summary: "deck generate 导入外部规格：<文件名>"`。
  注意该写入发生在 deck 落位前的临时目录还是落位后——实现时以代码为准，
  若在临时目录内，则 `planning/` 随 `rename` 一并落位，无需特殊处理。
- `regenerate.ts:176`：`appendRevisionNote` 产出的新规格交给 `applySpecChange`，
  `origin: "manual"`，`summary: "重生成追加说明：<note 首行，截断 60 字>"`。
  保持既有时序不变——**先写规格再出图**（`regenerate.ts:61` 注释的理由仍成立）。

收编后 `writeDeckContentSpec` 的生产调用方只剩 `applySpecChange` 一个（A①-8）。
为防止回潮，在 `content-spec.ts` 的该函数上加一行注释指明唯一合法调用方。

## 5. 过时预告（S7）

```ts
export interface DriftedPage {
  readonly slideId: string; readonly pageLabel: string;
  readonly specEntryId: string; readonly before: string | null; readonly after: string | null;
}
export function previewSpecChange(deckPath: string, nextSpec: ContentSpec): Promise<{
  readonly diff: ContentSpecDiff;
  readonly willDrift: readonly DriftedPage[];   // 落盘后将变为已过时的页
  readonly willMiss: readonly DriftedPage[];    // 条目被删 → 页面失联（status 的 "missing"）
}>;
```

判据与既有口径**必须一致**：复用 `specViewFingerprint(style, entry)` 与
`source.specEntrySha256` 的比对（`apps/cli/src/deck/status.ts:219`、
`apps/cli/src/deck/content-spec.ts:159`）。已经处于 `drifted` 的页不重复计入 `willDrift`——
界面要说的是「因这次变更**新增**过时的页」。**不写任何文件**。

## 6. 批量重生成（S4 / C2）

`runDeckRegenerate`（`regenerate.ts:103`）当前是「校验 → 定位页 → 读规格 → 推断条目 →
写说明 → 出图 → 换源 → 更 manifest」的一整块。拆法：

```ts
// regenerate.ts：保持导出签名不变，内部委托
export async function runDeckRegenerate(options): Promise<DeckRegenerateResult>;
async function regenerateOnePage(ctx: DeckRegenerateContext, page: ResolvedPage): Promise<...>;

// regenerate-batch.ts
export interface DeckRegenerateBatchOptions {
  readonly deckPath: string;
  readonly selection: { kind: "labels"; labels: readonly string[] } | { kind: "all-drifted" };
  readonly confirmUpload: boolean;                 // 一次确认覆盖 N 页
  readonly onProgress?: (e: BatchProgressEvent) => void;
  readonly onBeforeUpload?: (info) => void;
}
export interface DeckRegenerateBatchResult {
  readonly regenerated: readonly PageOutcome[];
  // `code` 对齐既有 `DeckGenerateFailure`：调用方分辨失败类型不该靠匹配中文消息
  readonly failed: readonly { pageLabel: string; code: string; message: string }[];
  readonly skipped: readonly { pageLabel: string; reason: string }[];
}
```

- **选页**：`all-drifted` 用 §5 同一比对取当前已过时页；`labels` 按页标签或 slideId 定位，
  定位不到即整体拒绝（`INVALID_INPUT`），不做「部分匹配就开跑」——批量的确认对话框
  是按 N 页给用户看的，实际跑 N-1 页属于静默不一致。
- **串行**：沿用 `generate.ts:226` 的理由（网关限流未知）。不引入并发。
- **单页失败不终止**：每页 `try/catch`，失败记入 `failed` 继续下一页；
  退出码沿用「一页都没成才算失败」（`index.ts:654`）。
- **`referencePath` 通道**：逐页复用 `regenerateOnePage`，因而必然走
  `replace-source.ts:66` 的新 `reference_text` 分支（`regenerate.ts:193` 现状即如此）。
  批量路径**不得**另拼 `replaceSlideSource` 调用。
- **`--note` 批量可用**：逐页追加同一句说明。D7 原文的主路径就是「重生成时附带一句说明」，
  批量没道理反而做不到；「不支持」还要靠再立一条 `--note` 与 `--pages` 互斥禁令来兜，
  多一条禁令比多一个能力更容易出错。
- **进度**：`onProgress` 写 stderr，格式对齐 `deck generate`：`[i/N] 重生成 <页标签>…`；
  结果用 `formatDeckRegenerateBatchResult` 写 stdout。无 JSON 模式（与 `deck generate` 一致）。
- **A①-2 的保证来自结构**：批量只对选中页调 `regenerateOnePage`，未选中页在整条路径上
  不被读写。测试以页目录递归内容哈希前后比对来证明，而不是靠人工检查。

## 7. jsonl 存储（S2）

```ts
// apps/cli/src/deck/planning-store.ts
export const DECK_PLANNING_DIR = "planning";
export const DECK_SPEC_HISTORY_PATH = "planning/spec-history.jsonl";
export function appendSpecChangeRecord(deckPath: string, record: SpecChangeRecord): Promise<boolean>;
export function listSpecChangeRecords(deckPath: string, options?: { limit?: number }): Promise<SpecChangeRecord[]>;
```

照搬 `apps/desktop/src/main/activity-log.ts` 的三件事：

1. **串行尾巴队列**（`activity-log.ts:14,29`）：模块级 `let tail: Promise<void>`，
   按 deckPath 分键，避免同进程并发 `appendFile` 交错写坏行；
2. **写失败只 `console.error`**（`activity-log.ts:37`），不 reject——日志是旁路。
   与 activity-log 的唯一差别：`appendSpecChangeRecord` **返回 `boolean`** 而非 `void`
   （成功 true、捕获异常后 false）。理由：`applySpecChange` 要如实返回 `historyWritten`，
   而「吞掉异常又不返回成败」会让调用方只能恒报成功——那条硬验收用例就是假绿，
   子任务②③ 也就无从提示用户「这次改动没进历史」。吞异常与如实回报不矛盾，
   不上抛才是纪律，藏住结果不是。
3. **读取坏行跳过**（`activity-log.ts:57`）：整文件读入、按 `\n` 切、空行 `continue`、
   `JSON.parse` 与 `SpecChangeRecordSchema.safeParse` 双层保护，失败行静默丢弃不中断。
   文件不存在返回 `[]`。`limit` 走 `reverse().slice(0, limit)` 的展示层限量（`activity-log.ts:64`）。

路径一律经 `resolveDeckPath(deckPath, …)` 做越界校验（`apps/cli/src/deck/workspace.ts:39`）。
目录用 `mkdir(resolveDeckPath(deckPath, "planning"), { recursive: true })` 按需创建，
**只在 append 时创建，读路径绝不创建**（A①-4：只读命令跑完旧 deck 目录内容零变化）。
无轮转、无体积上限——与 activity-log 一致，M6 不引入轮转。

## 8. 回滚（S3）

```ts
export function rollbackSpecChange(options: {
  deckPath: string; recordId: string;
}): Promise<ApplySpecChangeResult>;
```

1. `listSpecChangeRecords` 找 `recordId`，找不到抛 `FoundationError("SPEC_HISTORY_RECORD_NOT_FOUND")`；
2. `loadDeckContentSpec` 取当前规格（无规格 → `INVALID_INPUT`）；
3. `applyRollbackToSpec(current, target)`；
4. 交给 `applySpecChange`，`origin: "rollback"`、`rollbackOf: recordId`、
   `summary: "回滚：<目标记录 summary>"`。

于是回滚自身也被记一条，历史只增不减（A①-9）。**不提供删除历史的能力。**

## 9. CLI 命令面

沿用 commander 与既有惯例：stdout 给结果、stderr 给过程、语义化确认开关、
错误经顶层 catch 打 `错误：<message>` 并 `process.exitCode = 1`（`index.ts:746`）。

| 命令 | 参数 | 行为 |
|---|---|---|
| `deck spec-apply <deck>` | `--file <path>`（必填）、`--summary <text>`、`--dry-run` | 读文件 → `parse` → `--dry-run` 走 `previewSpecChange` 只打印将过时页数；否则 `applySpecChange(origin: "manual")`，stdout 打印 recordId 与过时页清单 |
| `deck spec-history <deck>` | `--limit <n>`（默认 20）、`--json` | 倒序列出记录：时间、origin、summary、受影响条目数、recordId |
| `deck spec-rollback <deck>` | `--record <recordId>`（必填） | 走 §8，打印新 recordId 与过时页清单 |
| `deck regenerate <deck>` | 新增 `--pages <labels...>`、`--all-drifted`，与既有 `--page` **三选一且必选**；`--spec-entry` 仅与 `--page` 合法 | 单页走原路径；批量走 §6 |

新增稳定错误码：`SPEC_HISTORY_RECORD_NOT_FOUND`、`SPEC_SELECTION_EMPTY`
（`--all-drifted` 选不出页）、`SPEC_PAGE_NOT_FOUND`（`--pages` 有定位不到的标签）。
Phase 3 登记进 `.trellis/spec/backend/error-handling.md`。

## 10. 契约不动的证明方式（A①-5）

改完后跑：

```
git diff -- packages/core/src/content-spec-contracts.ts packages/core/src/constants.ts \
            apps/cli/src/providers/page-generation.ts
```

预期：`ContentSpecSchema` / `specViewFingerprintValues` / `buildPageGenerationPrompt` /
`SCHEMA_VERSION` 的定义与函数体逐字未变。`content-spec-contracts.ts` 已知合法差异只有阶段一
那段顶部块注释（已在 `a04926c` 提交），本任务不再新增该文件的改动。

## 11. 不做与理由

- **不给 `planning/` 加全仓版本轴**：见父任务 design §3.2。
- **不做并发编辑保护**：单机单用户，`writeJsonAtomic` 保证不写坏文件，「后写覆盖先写」为已接受行为。
- **不做历史轮转/截断**：与 activity-log 保持一致；文件无限增长，读取端限量。
- **不做 CLI 细粒度字段编辑选项**（C1）：整份替换一条路。
- **不动 `deck run` / `status` 的正确性判据**：S6 只补测试，除非查出真缺陷。
- **不碰桌面端**：IPC 与界面是子任务②。

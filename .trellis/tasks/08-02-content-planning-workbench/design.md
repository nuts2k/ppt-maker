# M6 技术设计（父任务：跨子任务契约）

本文只定义**三个子任务共用、任一方擅自改动就会在集成时炸**的四件事：
规格写入路径与变更日志、模型提案契约、planning 会话文件布局、D7 放宽的口径。
各子任务的内部实现留给各自的 `design.md`。

## 1. 边界：M6 在契约之上，不动契约本身

`ContentSpecSchema` / `specViewFingerprintValues` / `buildPageGenerationPrompt` /
`SCHEMA_VERSION` 在本里程碑内**一字不改**（PRD A7）。M6 新增的全部结构都是
**旁路数据**：删除它们，deck 的生成、复核、导出链路必须照常工作。

这条约束的实际含义：

- 变更日志、会话记录、背景材料副本都不是 deck 正确性的输入。
- CLI 的任何正确性路径（`deck run` / `generate` / `status` / `export`）不得读 `planning/`。
- 唯一读 `planning/` 的是用户显式发起的回看与回滚动作，文件缺失时该动作不可用即可，
  不得让 deck 整体加载失败。

## 2. 规格写入必须经统一入口

**契约**：`content-spec.json` 的任何写入，一律走 core/CLI 侧新增的单一编辑入口
（暂名 `applySpecChange`），**禁止**任何调用方直接调 `writeDeckContentSpec`。

理由：变更日志靠写入路径捎带落盘。留第二条写入路径，日志就会漏记，而漏记的表现是
「历史里没有这次改动」——一种事后无法察觉、也无法补救的静默损坏。

该入口的职责是不可拆的一组：

1. 校验新规格（`ContentSpecSchema.parse`，沿用既有约束）；
2. 计算受影响条目的新旧指纹（`specViewFingerprint`，口径唯一来源不变）；
3. 更新 `updatedAt`；
4. 原子写规格（`writeJsonAtomic`）；
5. 追加一条变更记录。

第 5 步失败**不回滚**前四步，只记 stderr——日志是旁路，不允许它反过来阻断规格保存
（照搬 `apps/desktop/src/main/activity-log.ts` 的纪律：写失败只记 stderr，绝不上抛）。

`revisionNotes` 的「只增不改」由旧写入路径（`deck regenerate`）保证，schema 不做限制。
M6 允许在工作台里删除已累积的 `revisionNotes` 条目——这是 PRD R3 明列的缺口修补，
走的同样是本入口，因此同样会被记进日志。

## 3. 变更日志契约

### 3.1 落点

```
<deck>/
  content-spec.json          ← 既有，权威规格（唯一正确性输入）
  planning/
    spec-history.jsonl       ← 变更日志（追加写）
    session.jsonl            ← 对话记录（追加写）
    materials/               ← 背景材料副本（纯文本 / Markdown）
  slides/…
```

`planning/` 整个目录可删，删后只失去回看与回滚能力。

### 3.2 记录形状

类型定义放 `packages/core/src/planning-contracts.ts`（与 `content-spec-contracts.ts` 同理：
渲染进程也要 import，core 保持零运行时依赖）。

```ts
// 每条记录自带局部版本号 v，**不用全仓 SCHEMA_VERSION**。
// 理由见 PRD 背景第 5 条：SCHEMA_VERSION 是全仓共用常量且各契约写死 z.literal，
// 旁路文件挂上去等于把自己绑进一次全仓迁移。坏行跳过即可，不需要全局版本轴。
const SPEC_CHANGE_RECORD_V = 1;

interface AffectedEntry {
  readonly specEntryId: string;
  /** 变更时该条目在 entries 数组中的位置——回滚插入需要它 */
  readonly index: number;
  /** null 表示该时刻不存在：before 为 null 即新增，after 为 null 即删除 */
  readonly value: ContentSpecEntry | null;
}

interface SpecChangeRecord {
  readonly v: 1;
  readonly recordId: string;          // uuid，由写入方分配
  readonly at: string;                // ISO
  readonly origin: "manual" | "proposal" | "rollback";
  readonly summary: string;           // 一句话人可读描述
  /** style 每次都存前后全量（很小），未改动时前后相等 */
  readonly styleBefore: ContentSpecStyle;
  readonly styleAfter: ContentSpecStyle;
  readonly entriesBefore: readonly AffectedEntry[];
  readonly entriesAfter: readonly AffectedEntry[];
  /** 受影响条目的新旧指纹，供「哪几页因此过时」的回看 */
  readonly fingerprints: readonly {
    readonly specEntryId: string;
    readonly before: string | null;
    readonly after: string | null;
  }[];
  /** origin=proposal 时指向 session.jsonl 的消息；否则 null */
  readonly conversationRef: string | null;
  /** origin=rollback 时指向被回滚的 recordId；否则 null */
  readonly rollbackOf: string | null;
}
```

**只存受影响条目、但 style 每次全量**：`style` 改动波及全 deck，靠「受影响条目」表达不了；
而它本身只有一段文本，全量存的代价可以忽略。

### 3.3 回滚语义

回滚 = 把目标记录的 `styleBefore` 与 `entriesBefore` 重新写入当前规格（按 `specEntryId`
定位，`value === null` 的条目按 `index` 删除或插入），并**追加**一条
`origin: "rollback"`、`rollbackOf` 指向目标记录的新纪录。

**不抹历史**：日志是追加式的，回滚是一次新的前进。用户若期待「删掉那次改动」，
界面文案要说清楚这一点。

读取时坏行跳过，不因单行损坏丢掉整个文件（照搬 `activity-log.ts:list`）。

## 4. 模型提案契约

### 4.1 两个模型交互面，两套 schema

M6 有两处模型调用，形状不同，不共用 schema：

| 面 | 何时 | 输出 |
|---|---|---|
| 策划提问（D6） | 从构思到初稿的多轮收敛 | 回应 + 五维度收敛状态 + 下一个问题 / 可以出稿 |
| 改稿提案（D5） | 对已有规格用自然语言改 | 回应 + 替换后的完整条目 |

两者都沿用 `openai-spec-draft.ts` 的模式：Responses API + `zodTextFormat` 结构化输出，
`store: false`，外部响应先经 `safeParse` 运行时校验再使用（模型可能 refusal 或输出空解析，
那时**不得**把自由文本当作规格）。

### 4.2 约束自由 schema 与带约束 schema 必须分开

既有教训写在 `content-spec-contracts.ts:166`：Structured Outputs 的 JSON Schema
不接受 `minLength` 与自定义 `refine`，带约束的 schema 直接喂 `zodTextFormat` 会被 API 拒绝。
因此模型面 schema 一律无约束，落盘前再经 `ContentSpecSchema.parse` 补齐校验——
约束一条不少，只是校验位置从模型侧挪到写入侧。

### 4.3 提案形状

```ts
/** 模型面：无约束 */
const SpecProposalSchema = z.object({
  reply: z.string(),                       // 给用户看的自然语言回应
  styleProposal: z.string().nullable(),    // null = 本轮不改 style
  entryProposals: z.array(
    z.object({
      /** 空串表示新增条目；id 仍由写入方分配，模型不得编造 */
      specEntryId: z.string(),
      remove: z.boolean(),                 // true = 删除该条目，其余字段忽略
      pageType: z.string(),
      textGroups: z.array(
        z.object({ label: z.string(), items: z.array(z.string()) }),
      ),
      visualIntent: z.string(),
      revisionNotes: z.array(z.string()),
    }),
  ),
});
```

**模型给的是提案，不是变更**。提案到落盘之间必须经过：

1. 界面逐字段 diff 展示；
2. 用户显式确认；
3. 代码侧分配 / 保留 `specEntryId`、时间戳，再走 §2 的统一写入入口。

提案在确认前**不写 `content-spec.json`**，但**要写 `session.jsonl`**——对话记录是过程留痕，
含被否决的提案；规格文件只反映被接受的结果。

### 4.4 确认前必须预告过时范围

确认对话框要用 `specViewFingerprint` 预先算出提案落盘后的新指纹，与各页
`source.specEntrySha256` 比对，明确写出「确认后 N 页变为已过时」。
这是 D5 选择「全量条目」而非「patch」的直接收益，不得省略。

## 5. planning 会话文件布局

```ts
const PLANNING_MESSAGE_V = 1;

interface PlanningMessage {
  readonly v: 1;
  readonly messageId: string;        // uuid
  readonly at: string;               // ISO
  readonly role: "user" | "assistant";
  readonly text: string;
  /** 该轮若带提案，原样存下（含被否决的） */
  readonly proposal: unknown | null;
  /** 提案被接受时，指向 spec-history.jsonl 的 recordId */
  readonly acceptedAs: string | null;
  /** 模型调用可追溯；第三方网关不回传 x-request-id 时如实记 null，不伪造 */
  readonly requestId: string | null;
  readonly model: string | null;
}
```

一个 deck 一条会话流，追加写。切 deck 即切文件；**不跨 deck 复用会话**。

策划提问（D6）的维度状态同样落在 assistant 消息里，作为 `proposal` 之外的一个字段
由子任务③ 细化——父任务只约定「维度状态必须可从会话文件重建」，否则重开工作台后
进度条会归零，而对话内容还在，两者不一致。

## 6. D7 放宽的口径

M5 父任务 `prd.md:44` 的 D7 原文：「调整主路径是『重生成时附带一句说明』并回写规格条目，
**不引入模型改写**」。

M6 将其放宽为：**模型可提案，不可直接落盘**。

放宽后仍然成立的三条（D7 保护的实质）：

1. 规格不被静默改写——任何变更都由用户的确认动作触发；
2. `specEntryId` / `specId` / 时间戳始终由代码分配，模型不得编造；
3. 规格改动只产生**只读漂移标注**，不自动失效任何阶段（M5 A13 不变）。

不再成立的一条：「不引入模型改写」这句字面表述本身。

**父任务阶段一须把这条放宽回写 `.trellis/spec/` 与 ROADMAP**，否则后来者按 M5 原文
会判定本里程碑违规。这是父任务的直接工作，不下放给子任务。

## 7. 批量重生成必须复用既有换源语义

D9 的批量重生成**不得**另写一条写入路径。它必须逐页复用单页 `deck regenerate` 的语义，
关键是 `apps/cli/src/slide/replace-source.ts:70` 的 `referenceText` 通道：改了规格文字的页，
重生成时要写入**新的** `reference_text` 资产并把新 sha 计入指纹。绕过它的后果注释里
已经写明——那页会留着上一版 `reference_text`，OCR 复核拿旧文字当真值比对。

批量与单页的差别只在三处：一次确认覆盖 N 页、进度按页汇报、单页失败不终止其余页
（沿用 `deck generate` 的「一页都没成才算失败」口径）。

## 8. 不做与理由

- **不引入第二套存储**：草稿、会话、历史全在 deck 内（D4）。userData 下只放与 deck 无关的
  应用级状态，M4 的活动日志维持原位不动。
- **不给 `planning/` 加全仓版本轴**：见 §3.2。
- **不做规格的并发编辑保护**：单机单用户，多人协同是 ROADMAP 非目标。
  但工作台与 CLI 同时改同一份规格是可能的，靠 `writeJsonAtomic` 保证不写坏文件，
  「后写覆盖先写」为已接受行为。
- **不把 `planning/` 纳入导出物**：它不进 PPTX，也不进任何交付产物。

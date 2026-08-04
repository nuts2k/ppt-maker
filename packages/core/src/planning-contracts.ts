import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";
import {
  type ContentSpec,
  type ContentSpecDraft,
  type ContentSpecEntry,
  ContentSpecEntrySchema,
  ContentSpecSchema,
  type ContentSpecStyle,
  ContentSpecStyleSchema,
  specViewFingerprintValues,
} from "./content-spec-contracts.js";
import { FoundationError } from "./errors.js";

/**
 * 内容策划工作台的**旁路数据**契约（M6 子任务①）。
 *
 * 这里定义的一切都落在 `<deck>/planning/` 下，与 `content-spec.json` 的关系是单向的：
 * 变更日志由规格写入路径捎带产生，规格的正确性**不依赖**它。整个 `planning/` 目录可删，
 * 删后只失去回看与回滚能力，`deck run` / `generate` / `status` / `export` 照常工作。
 *
 * 放在 core 而不是 CLI：桌面端渲染进程要 import `diffContentSpec` 做逐字段 diff 展示，
 * 而渲染进程引不到 `@cli/*`。**因此本文件不得出现任何 `node:` 开头的 import**——
 * 与 `content-spec-contracts.ts` 同一条纪律：哈希、文件系统、uuid 全留在 CLI 侧，
 * core 只放类型与纯函数。
 */

/**
 * 变更记录的**局部**版本号。
 *
 * 刻意**不用** `SCHEMA_VERSION`：那是全仓共用常量，manifest / stage-graph / workspace /
 * pptx / clean / content-spec 全把它写死成 `z.literal(SCHEMA_VERSION)`，升到 2 就是一次
 * 全仓迁移。旁路文件挂上去等于把自己绑进那次迁移——而它的内容一个字节都没变。
 *
 * 反过来，旁路数据也不需要全局版本轴：坏行跳过即可（见 `listSpecChangeRecords` 的读取
 * 纪律），丢一行历史不影响任何正确性判断。
 */
export const SPEC_CHANGE_RECORD_V = 1 as const;

/** 策划会话旁路记录的局部版本号；不挂全仓 `SCHEMA_VERSION`。 */
export const PLANNING_SESSION_RECORD_V = 1 as const;

export const PLANNING_DIMENSION_NAMES = [
  "audience",
  "scenario",
  "length",
  "structure",
  "style",
] as const;
export const PlanningDimensionSchema = z.enum(PLANNING_DIMENSION_NAMES);
export const PlanningDimensionNameSchema = PlanningDimensionSchema;
export type PlanningDimension = z.infer<typeof PlanningDimensionSchema>;
export type PlanningDimensionName = PlanningDimension;

export const PlanningDimensionStatusSchema = z.enum([
  "open",
  "resolved",
  "not_applicable",
]);
export type PlanningDimensionStatus = z.infer<
  typeof PlanningDimensionStatusSchema
>;

/** 五个维度固定存在，避免消费端各自补默认值。 */
export const PlanningDimensionsSchema = z.object({
  audience: PlanningDimensionStatusSchema,
  scenario: PlanningDimensionStatusSchema,
  length: PlanningDimensionStatusSchema,
  structure: PlanningDimensionStatusSchema,
  style: PlanningDimensionStatusSchema,
});
export type PlanningDimensions = z.infer<typeof PlanningDimensionsSchema>;

/**
 * 策划提问的模型输出。模型面只使用 Structured Outputs 支持的基础约束；
 * 非空文字等持久化要求由 `PlanningMessageSchema` 在写会话前补齐。
 */
export const PlanningQuestionOutputSchema = z.object({
  reply: z.string(),
  dimensions: PlanningDimensionsSchema,
  nextQuestion: z.string().nullable(),
  canDraft: z.boolean(),
});
export type PlanningQuestionOutput = z.infer<
  typeof PlanningQuestionOutputSchema
>;

/** 改稿模型输出：完整条目提案，不是 patch；本 schema 刻意不带 min/refine。 */
export const SpecProposalSchema = z.object({
  reply: z.string(),
  styleProposal: z.string().nullable(),
  entryProposals: z.array(
    z.object({
      specEntryId: z.string(),
      remove: z.boolean(),
      pageType: z.string(),
      textGroups: z.array(
        z.object({ label: z.string(), items: z.array(z.string()) }),
      ),
      visualIntent: z.string(),
      revisionNotes: z.array(z.string()),
    }),
  ),
});
export type SpecProposal = z.infer<typeof SpecProposalSchema>;

export const PlanningProposalScopeSchema = z.enum(["initial", "entry", "deck"]);
export type PlanningProposalScope = z.infer<typeof PlanningProposalScopeSchema>;

/** 已有规格改稿请求的作用域；entry 分支必须携带目标条目身份。 */
export const PlanningChangeScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("entry"), targetSpecEntryId: z.string().min(1) }),
  z.object({ kind: z.literal("deck") }),
]);
export type PlanningChangeScope = z.infer<typeof PlanningChangeScopeSchema>;

export const StoredPlanningProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("initial-draft"),
    raw: z.unknown(),
    candidate: ContentSpecSchema,
    scope: z.literal("initial"),
  }),
  z.object({
    kind: z.literal("spec-change"),
    raw: z.unknown(),
    candidate: ContentSpecSchema,
    scope: z.enum(["entry", "deck"]),
  }),
]);
export type StoredPlanningProposal = z.infer<
  typeof StoredPlanningProposalSchema
>;

export const PlanningMessageRoleSchema = z.enum(["user", "assistant"]);
export type PlanningMessageRole = z.infer<typeof PlanningMessageRoleSchema>;

export interface PlanningMessage {
  readonly v: 1;
  readonly kind: "message";
  readonly messageId: string;
  readonly at: string;
  readonly role: PlanningMessageRole;
  readonly text: string;
  readonly proposal: StoredPlanningProposal | null;
  readonly dimensions: PlanningDimensions | null;
  readonly requestId: string | null;
  readonly model: string | null;
}

export const PlanningMessageSchema = z
  .object({
    v: z.literal(PLANNING_SESSION_RECORD_V),
    kind: z.literal("message"),
    messageId: z.string().min(1),
    at: z.string().datetime(),
    role: PlanningMessageRoleSchema,
    text: z.string().min(1),
    proposal: StoredPlanningProposalSchema.nullable(),
    dimensions: PlanningDimensionsSchema.nullable(),
    requestId: z.string().min(1).nullable(),
    model: z.string().min(1).nullable(),
  })
  .superRefine((message, context) => {
    if (
      message.role === "user" &&
      (message.proposal !== null ||
        message.dimensions !== null ||
        message.requestId !== null ||
        message.model !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "用户消息不得携带模型输出或模型追踪字段",
      });
    }
  }) satisfies z.ZodType<PlanningMessage>;

export const PlanningProposalOutcomeSchema = z.enum(["accepted", "rejected"]);
export type PlanningProposalOutcome = z.infer<
  typeof PlanningProposalOutcomeSchema
>;

export interface PlanningProposalDecision {
  readonly v: 1;
  readonly kind: "proposal-decision";
  readonly decisionId: string;
  readonly at: string;
  readonly proposalMessageId: string;
  readonly outcome: PlanningProposalOutcome;
  readonly acceptedAs: string | null;
}

export const PlanningProposalDecisionSchema = z
  .object({
    v: z.literal(PLANNING_SESSION_RECORD_V),
    kind: z.literal("proposal-decision"),
    decisionId: z.string().min(1),
    at: z.string().datetime(),
    proposalMessageId: z.string().min(1),
    outcome: PlanningProposalOutcomeSchema,
    acceptedAs: z.string().nullable(),
  })
  .superRefine((decision, context) => {
    const validAccepted =
      decision.outcome === "accepted" &&
      decision.acceptedAs !== null &&
      decision.acceptedAs.length > 0;
    const validRejected =
      decision.outcome === "rejected" && decision.acceptedAs === null;
    if (!validAccepted && !validRejected) {
      context.addIssue({
        code: "custom",
        message:
          "accepted 决策必须指向变更记录，rejected 决策不得携带 acceptedAs",
        path: ["acceptedAs"],
      });
    }
  }) satisfies z.ZodType<PlanningProposalDecision>;

export const PlanningSessionRecordSchema = z.discriminatedUnion("kind", [
  PlanningMessageSchema,
  PlanningProposalDecisionSchema,
]);
export type PlanningSessionRecord = z.infer<typeof PlanningSessionRecordSchema>;

/**
 * 这次规格变更是**谁**发起的。
 *
 * - `manual`：用户直接编辑规格（含 `deck generate --spec` 的首次导入、
 *   `deck regenerate` 追加调整说明）
 * - `proposal`：模型提案经用户确认后落盘（D5：模型可提案，不可直接落盘）
 * - `rollback`：回滚到某条历史记录之前的状态
 *
 * 首次导入不单独设一档：「首次写入」就是 before 为 null 的新增，`entriesBefore` 为空
 * 已经如实表达了它（子任务 C3）。
 */
export const SpecChangeOriginSchema = z.enum([
  "manual",
  "proposal",
  "rollback",
]);

export type SpecChangeOrigin = z.infer<typeof SpecChangeOriginSchema>;

/**
 * 一条受影响条目在**某一时刻**的样子。
 *
 * `value === null` 表示该时刻这个条目不存在：出现在 `entriesBefore` 即本次新增，
 * 出现在 `entriesAfter` 即本次删除。
 *
 * **必须带 `index`**：回滚要把条目插回原位，只有 id 和值恢复不出顺序。
 */
export interface AffectedEntry {
  readonly specEntryId: string;
  /** 变更时该条目在 `entries` 数组中的位置 */
  readonly index: number;
  /** `null` 表示该时刻不存在 */
  readonly value: ContentSpecEntry | null;
}

export const AffectedEntrySchema = z.object({
  specEntryId: z.string().min(1),
  index: z.number().int().min(0),
  value: ContentSpecEntrySchema.nullable(),
});

/** 受影响条目的新旧指纹，供「哪几页因此过时」的回看；条目不存在的一侧记 `null` */
export interface SpecChangeFingerprint {
  readonly specEntryId: string;
  readonly before: string | null;
  readonly after: string | null;
}

export const SpecChangeFingerprintSchema = z.object({
  specEntryId: z.string().min(1),
  before: z.string().nullable(),
  after: z.string().nullable(),
});

/**
 * `planning/spec-history.jsonl` 的一行。
 *
 * **只存受影响条目、但 style 每次前后全量**：style 改动波及全 deck（它进指纹投影），
 * 靠「受影响条目」表达不了；而它本身只有一段文本，全量存的代价可以忽略。
 *
 * `recordId` / `at` 由写入方分配，模型不得编造（D7 保护条 2）。
 */
export interface SpecChangeRecord {
  readonly v: 1;
  readonly recordId: string;
  readonly at: string;
  readonly origin: SpecChangeOrigin;
  /** 一句话人可读描述 */
  readonly summary: string;
  readonly styleBefore: ContentSpecStyle;
  readonly styleAfter: ContentSpecStyle;
  readonly entriesBefore: readonly AffectedEntry[];
  readonly entriesAfter: readonly AffectedEntry[];
  readonly fingerprints: readonly SpecChangeFingerprint[];
  /** `origin=proposal` 时指向 `session.jsonl` 的消息；否则 `null` */
  readonly conversationRef: string | null;
  /** `origin=rollback` 时指向被回滚的 `recordId`；否则 `null` */
  readonly rollbackOf: string | null;
}

export const SpecChangeRecordSchema = z.object({
  v: z.literal(SPEC_CHANGE_RECORD_V),
  recordId: z.string().min(1),
  at: z.string().datetime(),
  origin: SpecChangeOriginSchema,
  summary: z.string().min(1),
  styleBefore: ContentSpecStyleSchema,
  styleAfter: ContentSpecStyleSchema,
  entriesBefore: z.array(AffectedEntrySchema),
  entriesAfter: z.array(AffectedEntrySchema),
  fingerprints: z.array(SpecChangeFingerprintSchema),
  conversationRef: z.string().nullable(),
  rollbackOf: z.string().nullable(),
}) satisfies z.ZodType<SpecChangeRecord>;

/**
 * 两份规格之间的结构化差异——供界面逐字段 diff 展示，也供写入侧组装变更记录。
 *
 * `modified` 与 `reordered` 分开是**要害**：纯位置变化不改变条目指纹，因而不该让任何
 * 页面变为「已过时」。把它并进 `modified` 会让用户拖一下顺序就被告知 N 页要重出图。
 */
export interface ContentSpecDiff {
  readonly styleChanged: boolean;
  readonly entriesBefore: readonly AffectedEntry[];
  readonly entriesAfter: readonly AffectedEntry[];
  /** 以下三项均为 `specEntryId` */
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly modified: readonly string[];
  /** 存在「值未变但位置变了」的条目 */
  readonly reordered: boolean;
}

/** 一页因规格变更而改变过时状态；`before` / `after` 是两侧的规格视图指纹。 */
export interface DriftedPage {
  readonly slideId: string;
  readonly pageLabel: string;
  readonly specEntryId: string;
  readonly before: string | null;
  readonly after: string | null;
}

/** 规格写入与回滚共用的跨层结果。 */
export interface ApplySpecChangeResult {
  readonly spec: ContentSpec;
  readonly record: SpecChangeRecord;
  readonly historyWritten: boolean;
  /** 本次变更导致新增过时的页。 */
  readonly drifted: readonly DriftedPage[];
  /** 本次变更导致新增失联的页。 */
  readonly missing: readonly DriftedPage[];
}

export interface PreviewSpecChangeResult {
  readonly diff: ContentSpecDiff;
  readonly willDrift: readonly DriftedPage[];
  readonly willMiss: readonly DriftedPage[];
}

export const ContentSpecDiffSchema = z.object({
  styleChanged: z.boolean(),
  entriesBefore: z.array(AffectedEntrySchema),
  entriesAfter: z.array(AffectedEntrySchema),
  added: z.array(z.string().min(1)),
  removed: z.array(z.string().min(1)),
  modified: z.array(z.string().min(1)),
  reordered: z.boolean(),
}) satisfies z.ZodType<ContentSpecDiff>;

export const DriftedPageSchema = z.object({
  slideId: z.string().min(1),
  pageLabel: z.string().min(1),
  specEntryId: z.string().min(1),
  before: z.string().nullable(),
  after: z.string().nullable(),
}) satisfies z.ZodType<DriftedPage>;

export const ApplySpecChangeResultSchema = z.object({
  spec: ContentSpecSchema,
  record: SpecChangeRecordSchema,
  historyWritten: z.boolean(),
  drifted: z.array(DriftedPageSchema),
  missing: z.array(DriftedPageSchema),
}) satisfies z.ZodType<ApplySpecChangeResult>;

export const PreviewSpecChangeResultSchema = z.object({
  diff: ContentSpecDiffSchema,
  willDrift: z.array(DriftedPageSchema),
  willMiss: z.array(DriftedPageSchema),
}) satisfies z.ZodType<PreviewSpecChangeResult>;

export const PlanningProposalStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
]);
export type PlanningProposalStatus = z.infer<
  typeof PlanningProposalStatusSchema
>;

export interface PlanningProposalState {
  readonly message: PlanningMessage;
  readonly proposal: StoredPlanningProposal;
  readonly status: PlanningProposalStatus;
  readonly decision: PlanningProposalDecision | null;
}

export const PlanningProposalStateSchema = z.object({
  message: PlanningMessageSchema,
  proposal: StoredPlanningProposalSchema,
  status: PlanningProposalStatusSchema,
  decision: PlanningProposalDecisionSchema.nullable(),
}) satisfies z.ZodType<PlanningProposalState>;

export interface PlanningSessionSnapshot {
  readonly messages: readonly PlanningMessage[];
  readonly dimensions: PlanningDimensions | null;
  readonly proposals: readonly PlanningProposalState[];
  readonly pendingProposal: PlanningProposalState | null;
}

export const PlanningSessionSnapshotSchema = z.object({
  messages: z.array(PlanningMessageSchema),
  dimensions: PlanningDimensionsSchema.nullable(),
  proposals: z.array(PlanningProposalStateSchema),
  pendingProposal: PlanningProposalStateSchema.nullable(),
}) satisfies z.ZodType<PlanningSessionSnapshot>;

export interface PlanningMaterialEntry {
  readonly name: string;
  readonly sizeBytes: number;
}

export const PlanningMaterialEntrySchema = z.object({
  name: z.string().min(1),
  sizeBytes: z.number().int().min(0),
}) satisfies z.ZodType<PlanningMaterialEntry>;

export interface PlanningConversationSnapshot {
  readonly session: PlanningSessionSnapshot;
  readonly spec: ContentSpec | null;
  readonly materials: readonly PlanningMaterialEntry[];
}

export const PlanningConversationSnapshotSchema = z.object({
  session: PlanningSessionSnapshotSchema,
  spec: ContentSpecSchema.nullable(),
  materials: z.array(PlanningMaterialEntrySchema),
}) satisfies z.ZodType<PlanningConversationSnapshot>;

export const PlanningProposalSelectionSchema = z.object({
  includeStyle: z.boolean(),
  specEntryIds: z.array(z.string().min(1)),
});
export type PlanningProposalSelection = z.infer<
  typeof PlanningProposalSelectionSchema
>;
/** IPC/renderer 可使用的简名，保持同一个 schema 实例而非复制形状。 */
export const ProposalSelectionSchema = PlanningProposalSelectionSchema;
export type ProposalSelection = PlanningProposalSelection;

export interface PlanningProposalPreview {
  readonly proposalMessageId: string;
  readonly candidate: ContentSpec;
  readonly diff: ContentSpecDiff;
  readonly willDrift: readonly DriftedPage[];
  readonly willMiss: readonly DriftedPage[];
}

export const PlanningProposalPreviewSchema = z.object({
  proposalMessageId: z.string().min(1),
  candidate: ContentSpecSchema,
  diff: ContentSpecDiffSchema,
  willDrift: z.array(DriftedPageSchema),
  willMiss: z.array(DriftedPageSchema),
}) satisfies z.ZodType<PlanningProposalPreview>;

export interface PlanningProposalResult {
  readonly snapshot: PlanningConversationSnapshot;
  readonly preview: PlanningProposalPreview;
}

export const PlanningProposalResultSchema = z.object({
  snapshot: PlanningConversationSnapshotSchema,
  preview: PlanningProposalPreviewSchema,
}) satisfies z.ZodType<PlanningProposalResult>;

export interface PlanningAcceptProposalResult {
  readonly snapshot: PlanningConversationSnapshot;
  readonly applyResult: ApplySpecChangeResult;
  readonly decisionWritten: boolean;
}

export const PlanningAcceptProposalResultSchema = z.object({
  snapshot: PlanningConversationSnapshotSchema,
  applyResult: ApplySpecChangeResultSchema,
  decisionWritten: z.boolean(),
}) satisfies z.ZodType<PlanningAcceptProposalResult>;
/** 兼容 IPC 对动作在前命名的偏好。 */
export const PlanningProposalAcceptResultSchema =
  PlanningAcceptProposalResultSchema;
export type PlanningProposalAcceptResult = PlanningAcceptProposalResult;

export const PlanningRejectProposalResultSchema = z.object({
  snapshot: PlanningConversationSnapshotSchema,
});
export type PlanningRejectProposalResult = z.infer<
  typeof PlanningRejectProposalResultSchema
>;

export const PlanningMaterialsResultSchema = z.object({
  materials: z.array(PlanningMaterialEntrySchema),
});
export type PlanningMaterialsResult = z.infer<
  typeof PlanningMaterialsResultSchema
>;

const DeckPathRequestSchema = z.object({ deckPath: z.string().min(1) });
export const PlanningLoadRequestSchema = DeckPathRequestSchema;
export const PlanningSendMessageRequestSchema = DeckPathRequestSchema.extend({
  text: z.string().min(1),
});
export const PlanningDraftSpecRequestSchema = DeckPathRequestSchema;
export const PlanningProposeChangeRequestSchema = DeckPathRequestSchema.extend({
  text: z.string().min(1),
  scope: PlanningChangeScopeSchema,
});
export const PlanningPreviewProposalRequestSchema =
  DeckPathRequestSchema.extend({
    proposalMessageId: z.string().min(1),
    selection: PlanningProposalSelectionSchema,
  });
export const PlanningAcceptProposalRequestSchema =
  PlanningPreviewProposalRequestSchema;
export const PlanningRejectProposalRequestSchema = DeckPathRequestSchema.extend(
  { proposalMessageId: z.string().min(1) },
);
export const PlanningListMaterialsRequestSchema = DeckPathRequestSchema;
export const PlanningImportMaterialRequestSchema = DeckPathRequestSchema.extend(
  {
    sourcePath: z.string().min(1),
  },
);
export const PlanningRemoveMaterialRequestSchema = DeckPathRequestSchema.extend(
  {
    name: z.string().min(1),
  },
);

export type PlanningLoadRequest = z.infer<typeof PlanningLoadRequestSchema>;
export type PlanningSendMessageRequest = z.infer<
  typeof PlanningSendMessageRequestSchema
>;
export type PlanningDraftSpecRequest = z.infer<
  typeof PlanningDraftSpecRequestSchema
>;
export type PlanningProposeChangeRequest = z.infer<
  typeof PlanningProposeChangeRequestSchema
>;
export type PlanningPreviewProposalRequest = z.infer<
  typeof PlanningPreviewProposalRequestSchema
>;
export type PlanningAcceptProposalRequest = z.infer<
  typeof PlanningAcceptProposalRequestSchema
>;
export type PlanningRejectProposalRequest = z.infer<
  typeof PlanningRejectProposalRequestSchema
>;
export type PlanningListMaterialsRequest = z.infer<
  typeof PlanningListMaterialsRequestSchema
>;
export type PlanningImportMaterialRequest = z.infer<
  typeof PlanningImportMaterialRequestSchema
>;
export type PlanningRemoveMaterialRequest = z.infer<
  typeof PlanningRemoveMaterialRequestSchema
>;

export const PlanningLoadResultSchema = PlanningConversationSnapshotSchema;
export const PlanningSendMessageResultSchema =
  PlanningConversationSnapshotSchema;
export const PlanningDraftSpecResultSchema = PlanningProposalResultSchema;
export const PlanningProposeChangeResultSchema = PlanningProposalResultSchema;

/**
 * 判断两个条目的内容是否相同——口径**复用指纹投影**，不另写一份字段列表。
 *
 * 这不是图省事：`modified` 的意义就是「这一页会因此过时」，而过时判据是
 * `specViewFingerprint` 比对。两处各写一份字段列表必然漂移，且漂移是静默的——
 * 界面说「没改」而页面被标成过时（或反之），没有任何东西会报错。
 *
 * 两侧喂同一个 style，投影首位的 `style:` 因此互相抵消，只比较条目自身。
 */
const ENTRY_EQUALITY_STYLE: ContentSpecStyle = { description: "" };

function entryEquals(left: ContentSpecEntry, right: ContentSpecEntry): boolean {
  const a = specViewFingerprintValues(ENTRY_EQUALITY_STYLE, left);
  const b = specViewFingerprintValues(ENTRY_EQUALITY_STYLE, right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function indexById(
  entries: readonly ContentSpecEntry[],
): Map<string, { readonly index: number; readonly entry: ContentSpecEntry }> {
  const map = new Map<
    string,
    { readonly index: number; readonly entry: ContentSpecEntry }
  >();
  entries.forEach((entry, index) => {
    map.set(entry.specEntryId, { index, entry });
  });
  return map;
}

/**
 * 以 `specEntryId` 为主键做左右外连接。
 *
 * 输出顺序是**确定的**：先按 after 的 index 升序，再把被删条目按 before 的 index 升序
 * 追加。确定性排序是回滚可重放的前提——同一份输入必须每次算出同一条记录。
 *
 * `entriesBefore` 与 `entriesAfter` 逐位配对，同一位置说的是同一个条目。
 */
export function diffContentSpec(
  before: ContentSpec,
  after: ContentSpec,
): ContentSpecDiff {
  const beforeById = indexById(before.entries);
  const afterById = indexById(after.entries);

  const entriesBefore: AffectedEntry[] = [];
  const entriesAfter: AffectedEntry[] = [];
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  let reordered = false;

  after.entries.forEach((entry, index) => {
    const previous = beforeById.get(entry.specEntryId);
    if (previous === undefined) {
      added.push(entry.specEntryId);
      entriesBefore.push({
        specEntryId: entry.specEntryId,
        index,
        value: null,
      });
      entriesAfter.push({
        specEntryId: entry.specEntryId,
        index,
        value: entry,
      });
      return;
    }

    const changed = !entryEquals(previous.entry, entry);
    const moved = previous.index !== index;
    if (changed) {
      modified.push(entry.specEntryId);
    } else if (moved) {
      // 值没变、只是位置变了：不进 modified（指纹不变，页面不该因此过时），
      // 但必须进前后集合，否则回滚恢复不出原顺序。
      reordered = true;
    }
    if (!changed && !moved) {
      return;
    }
    entriesBefore.push({
      specEntryId: entry.specEntryId,
      index: previous.index,
      value: previous.entry,
    });
    entriesAfter.push({ specEntryId: entry.specEntryId, index, value: entry });
  });

  before.entries.forEach((entry, index) => {
    if (afterById.has(entry.specEntryId)) {
      return;
    }
    removed.push(entry.specEntryId);
    entriesBefore.push({ specEntryId: entry.specEntryId, index, value: entry });
    entriesAfter.push({ specEntryId: entry.specEntryId, index, value: null });
  });

  return {
    styleChanged: before.style.description !== after.style.description,
    entriesBefore,
    entriesAfter,
    added,
    removed,
    modified,
    reordered,
  };
}

/**
 * 把某条历史记录**之前**的状态重新写进当前规格——回滚的纯函数部分。
 *
 * 三步顺序固定，保证同一条记录任何时候重放都得到同一结果：
 *
 * 1. 删掉那次变更新增出来的条目（`entriesBefore` 里 `value === null` 的）；
 * 2. 对 `value !== null` 的项按 `index` **升序**处理：已存在同 id 则原地替换并移动到
 *    `index`，不存在则在 `index` 处插入（`index` 超出长度时追加）；
 * 3. 未被这条记录触及的条目**原样保留**。
 *
 * 第 3 步是「回滚是一次新的前进」的直接体现：只撤销那一次变更，不把它之后的无关变更
 * 一并抹掉。因此回滚本身也要经统一写入入口再记一条日志——历史只增不减。
 *
 * `specId` / `createdAt` 沿用 `current`（D7 保护条 2：id 与时间戳始终由代码分配）；
 * `updatedAt` 不在这里改，由写入入口统一盖。
 */
export function applyRollbackToSpec(
  current: ContentSpec,
  target: SpecChangeRecord,
): ContentSpec {
  const introduced = new Set(
    target.entriesBefore
      .filter((item) => item.value === null)
      .map((item) => item.specEntryId),
  );
  const entries = current.entries.filter(
    (entry) => !introduced.has(entry.specEntryId),
  );

  const restores = target.entriesBefore
    .filter(
      (item): item is AffectedEntry & { value: ContentSpecEntry } =>
        item.value !== null,
    )
    .slice()
    .sort((left, right) => left.index - right.index);

  for (const item of restores) {
    const existing = entries.findIndex(
      (entry) => entry.specEntryId === item.specEntryId,
    );
    if (existing >= 0) {
      entries.splice(existing, 1);
    }
    entries.splice(Math.min(item.index, entries.length), 0, item.value);
  }

  return { ...current, style: target.styleBefore, entries };
}

/**
 * 追加式会话的唯一折叠器。
 *
 * 先收集提案消息，再按文件顺序认第一条指向该提案的有效决策；后续重复决策忽略。
 * 即使损坏文件把决策行放到了消息行之前，也不会因此丢失第一条决策的语义。
 */
export function foldPlanningSession(
  records: readonly PlanningSessionRecord[],
): PlanningSessionSnapshot {
  const messages: PlanningMessage[] = [];
  const proposalMessages = new Map<string, PlanningMessage>();
  let dimensions: PlanningDimensions | null = null;

  for (const record of records) {
    if (record.kind !== "message") {
      continue;
    }
    messages.push(record);
    if (record.dimensions !== null) {
      dimensions = record.dimensions;
    }
    if (record.proposal !== null && !proposalMessages.has(record.messageId)) {
      proposalMessages.set(record.messageId, record);
    }
  }

  const decisions = new Map<string, PlanningProposalDecision>();
  for (const record of records) {
    if (
      record.kind === "proposal-decision" &&
      proposalMessages.has(record.proposalMessageId) &&
      !decisions.has(record.proposalMessageId)
    ) {
      decisions.set(record.proposalMessageId, record);
    }
  }

  const proposals: PlanningProposalState[] = [];
  for (const message of proposalMessages.values()) {
    const proposal = message.proposal;
    if (proposal === null) {
      continue;
    }
    const decision = decisions.get(message.messageId) ?? null;
    proposals.push({
      message,
      proposal,
      status: decision?.outcome ?? "pending",
      decision,
    });
  }

  return {
    messages,
    dimensions,
    proposals,
    pendingProposal:
      proposals.find((proposal) => proposal.status === "pending") ?? null,
  };
}

export interface PlanningCandidateOptions {
  readonly now: string;
  readonly createSpecEntryId: (index: number) => string;
}

export interface InitialPlanningCandidateOptions
  extends PlanningCandidateOptions {
  readonly specId: string;
}

function invalidProviderProposal(
  message: string,
  details?: Readonly<Record<string, unknown>>,
): never {
  throw new FoundationError("INVALID_PROVIDER_RESPONSE", message, details);
}

function parsePlanningCandidate(value: unknown): ContentSpec {
  const parsed = ContentSpecSchema.safeParse(value);
  if (!parsed.success) {
    return invalidProviderProposal("模型提案无法生成合法内容规格", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function materializeProposedEntry(
  proposed: SpecProposal["entryProposals"][number],
  specEntryId: string,
): ContentSpecEntry {
  return {
    specEntryId,
    pageType: proposed.pageType,
    textGroups: proposed.textGroups,
    visualIntent: proposed.visualIntent,
    revisionNotes: proposed.revisionNotes,
  };
}

/** 初稿在进入会话前一次性分配全部身份，重开后不会生成另一组 id。 */
export function materializeInitialPlanningCandidate(
  draft: ContentSpecDraft,
  options: InitialPlanningCandidateOptions,
): ContentSpec {
  return parsePlanningCandidate({
    schemaVersion: SCHEMA_VERSION,
    specId: options.specId,
    createdAt: options.now,
    updatedAt: options.now,
    style: draft.style,
    entries: draft.entries.map((entry, index) => ({
      specEntryId: options.createSpecEntryId(index),
      pageType: entry.pageType,
      textGroups: entry.textGroups,
      visualIntent: entry.visualIntent,
      revisionNotes: [],
    })),
  });
}

/** 单条目作用域只能替换或删除目标条目，不能偷偷改 style、增加条目或触及其它 id。 */
export function materializeEntryPlanningCandidate(
  current: ContentSpec,
  proposal: SpecProposal,
  options: { readonly targetSpecEntryId: string; readonly now: string },
): ContentSpec {
  const targetIndex = current.entries.findIndex(
    (entry) => entry.specEntryId === options.targetSpecEntryId,
  );
  if (targetIndex < 0) {
    return invalidProviderProposal("单条目提案指向当前规格中不存在的条目", {
      specEntryId: options.targetSpecEntryId,
    });
  }
  if (proposal.styleProposal !== null) {
    return invalidProviderProposal("单条目提案不得修改 deck 级 style");
  }
  if (proposal.entryProposals.length !== 1) {
    return invalidProviderProposal("单条目提案必须且只能返回一个完整条目", {
      count: proposal.entryProposals.length,
    });
  }
  const proposed = proposal.entryProposals[0];
  if (
    proposed === undefined ||
    proposed.specEntryId !== options.targetSpecEntryId
  ) {
    return invalidProviderProposal("单条目提案返回了未知或不匹配的条目 ID", {
      expected: options.targetSpecEntryId,
      received: proposed?.specEntryId ?? null,
    });
  }

  const entries = [...current.entries];
  if (proposed.remove) {
    entries.splice(targetIndex, 1);
  } else {
    entries[targetIndex] = materializeProposedEntry(
      proposed,
      options.targetSpecEntryId,
    );
  }
  return parsePlanningCandidate({
    ...current,
    updatedAt: options.now,
    entries,
  });
}

/**
 * 全 deck 提案按当前条目顺序替换/删除，新增条目追加在末尾。
 * 非空 id 必须属于当前规格；空串才表示新增，并立即由代码分配 id。
 */
export function materializeDeckPlanningCandidate(
  current: ContentSpec,
  proposal: SpecProposal,
  options: PlanningCandidateOptions,
): ContentSpec {
  const currentIds = new Set(current.entries.map((entry) => entry.specEntryId));
  const seen = new Set<string>();
  const existing = new Map<string, SpecProposal["entryProposals"][number]>();
  const additions: SpecProposal["entryProposals"] = [];

  for (const proposed of proposal.entryProposals) {
    if (proposed.specEntryId.length === 0) {
      if (proposed.remove) {
        return invalidProviderProposal("新增条目不能同时标记为删除");
      }
      additions.push(proposed);
      continue;
    }
    if (!currentIds.has(proposed.specEntryId)) {
      return invalidProviderProposal("模型返回了当前规格中不存在的条目 ID", {
        specEntryId: proposed.specEntryId,
      });
    }
    if (seen.has(proposed.specEntryId)) {
      return invalidProviderProposal("模型重复提案同一个条目", {
        specEntryId: proposed.specEntryId,
      });
    }
    seen.add(proposed.specEntryId);
    existing.set(proposed.specEntryId, proposed);
  }

  const entries: ContentSpecEntry[] = [];
  for (const currentEntry of current.entries) {
    const proposed = existing.get(currentEntry.specEntryId);
    if (proposed === undefined) {
      entries.push(currentEntry);
    } else if (!proposed.remove) {
      entries.push(
        materializeProposedEntry(proposed, currentEntry.specEntryId),
      );
    }
  }
  additions.forEach((proposed, index) => {
    entries.push(
      materializeProposedEntry(proposed, options.createSpecEntryId(index)),
    );
  });

  return parsePlanningCandidate({
    ...current,
    updatedAt: options.now,
    style:
      proposal.styleProposal === null
        ? current.style
        : { description: proposal.styleProposal },
    entries,
  });
}

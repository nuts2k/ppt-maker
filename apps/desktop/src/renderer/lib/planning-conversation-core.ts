/**
 * 策划对话在 renderer 内的纯展示与交互规则。
 *
 * 本文件不读取 `window`，也不持有 Zustand 状态。项目没有 DOM 测试库，因此 E1 / E5
 * 守卫、条目身份同步、提案选择和逐字段 diff 都在这里形成可直接变异验证的产物。
 */

import {
  type ContentSpec,
  type ContentSpecEntry,
  diffContentSpec,
  type PlanningDimensionStatus,
  type PlanningDimensions,
  type PlanningProposalScope,
  type PlanningProposalSelection,
  type PlanningProposalState,
  type PreviewSpecChangeResult,
} from "@ppt-maker/core";

export const PLANNING_DIMENSION_KEYS = [
  "audience",
  "scenario",
  "length",
  "structure",
  "style",
] as const;

export type PlanningDimensionKey = (typeof PLANNING_DIMENSION_KEYS)[number];
export interface PlanningDimensionView {
  readonly key: PlanningDimensionKey;
  readonly label: string;
  readonly status: PlanningDimensionStatus;
  readonly statusLabel: string;
}

const DIMENSION_LABELS: Readonly<Record<PlanningDimensionKey, string>> = {
  audience: "受众",
  scenario: "场景",
  length: "篇幅",
  structure: "结构",
  style: "风格",
};

const DIMENSION_STATUS_LABELS: Readonly<
  Record<PlanningDimensionStatus, string>
> = {
  open: "待补充",
  resolved: "已收敛",
  not_applicable: "不适用",
};

/** 五维度固定顺序与文案，计数由调用方用数组长度直接得出。 */
export function buildDimensionViews(
  dimensions: PlanningDimensions | null,
): readonly PlanningDimensionView[] {
  return PLANNING_DIMENSION_KEYS.map((key) => {
    const status = dimensions?.[key] ?? "open";
    return {
      key,
      label: DIMENSION_LABELS[key],
      status,
      statusLabel: DIMENSION_STATUS_LABELS[status],
    };
  });
}

export interface PlanningActionGuardInput {
  /** 已经存在磁盘权威规格时，未保存草稿才触发 E1。 */
  readonly hasSavedSpec: boolean;
  readonly dirty: boolean;
  readonly hasPendingProposal: boolean;
  readonly busy: boolean;
}

export interface PlanningActionGuard {
  readonly allowed: boolean;
  readonly reason: string | null;
}

export type PlanningPrimaryAction = "accept" | "save" | "send" | null;

export interface PlanningProposalMessageStatusView {
  readonly label: string;
  readonly pending: boolean;
}

/**
 * 消息本身只保存提案内容，接受 / 拒绝状态来自追加式 decision 折叠结果。
 * 已完成提案必须回到中性色，不能继续用 proof 冒充「等待决定」。
 */
export function resolveProposalMessageStatus(
  proposals: readonly PlanningProposalState[],
  messageId: string,
): PlanningProposalMessageStatusView | null {
  const proposal = proposals.find(
    (item) => item.message.messageId === messageId,
  );
  if (proposal === undefined) return null;
  switch (proposal.status) {
    case "pending":
      return { label: "提案已显示在右侧，等待你的决定。", pending: true };
    case "accepted":
      return { label: "提案已接受并写入规格。", pending: false };
    case "rejected":
      return { label: "提案已拒绝，规格未改动。", pending: false };
  }
}

/**
 * 一屏唯一主行动的优先级：pending 决策 > 未保存手工规格 > 当前可见的对话发送。
 */
export function resolvePlanningPrimaryAction(input: {
  readonly hasPendingProposal: boolean;
  readonly hasSavedSpec: boolean;
  readonly dirty: boolean;
  readonly sidebarView: "conversation" | "history";
}): PlanningPrimaryAction {
  if (input.hasPendingProposal) return "accept";
  if (input.dirty && (input.hasSavedSpec || input.sidebarView === "history")) {
    return "save";
  }
  if (input.sidebarView === "conversation") return "send";
  return null;
}

/**
 * 模型动作的 renderer 提前守卫。main / 领域服务仍会权威执行 E5 与互斥规则。
 * 无权威规格的从零策划明确不受 E1 限制。
 */
export function guardPlanningAction(
  input: PlanningActionGuardInput,
): PlanningActionGuard {
  if (input.busy) {
    return { allowed: false, reason: "请等待当前请求完成后再继续。" };
  }
  if (input.hasPendingProposal) {
    return {
      allowed: false,
      reason: "请先接受或拒绝右侧待确认提案，再继续对话。",
    };
  }
  if (input.hasSavedSpec && input.dirty) {
    return {
      allowed: false,
      reason: "请先保存或放弃右侧未保存的规格修改，再让模型改稿。",
    };
  }
  return { allowed: true, reason: null };
}

/** 当前条目消失时回落到第一条；空规格没有对话目标。 */
export function resolveSelectedEntryId(
  entries: readonly ContentSpecEntry[],
  selectedEntryId: string | null,
): string | null {
  if (
    selectedEntryId !== null &&
    entries.some((entry) => entry.specEntryId === selectedEntryId)
  ) {
    return selectedEntryId;
  }
  return entries[0]?.specEntryId ?? null;
}

/**
 * 初稿与单条目不能局部接受；全 deck 默认全选所有实际发生变化的部分。
 */
export function buildDefaultProposalSelection(
  before: ContentSpec | null,
  candidate: ContentSpec,
  scope: PlanningProposalScope,
): PlanningProposalSelection {
  if (scope === "initial") {
    return {
      includeStyle: true,
      specEntryIds: candidate.entries.map((entry) => entry.specEntryId),
    };
  }

  const changedEntryIds = collectChangedEntryIds(before, candidate);
  if (scope === "entry") {
    return { includeStyle: false, specEntryIds: changedEntryIds.slice(0, 1) };
  }
  return {
    includeStyle:
      before === null ||
      before.style.description !== candidate.style.description,
    specEntryIds: [...changedEntryIds],
  };
}

/** 只保留本份提案确实包含的条目，且保持 diff 的稳定顺序。 */
export function normalizeProposalSelection(
  before: ContentSpec | null,
  candidate: ContentSpec,
  scope: PlanningProposalScope,
  selection: PlanningProposalSelection,
): PlanningProposalSelection {
  const defaults = buildDefaultProposalSelection(before, candidate, scope);
  if (scope !== "deck") return defaults;

  const selected = new Set(selection.specEntryIds);
  return {
    includeStyle: defaults.includeStyle && selection.includeStyle,
    specEntryIds: defaults.specEntryIds.filter((id) => selected.has(id)),
  };
}

export type ProposalDiffKind = "style" | "entry";

export interface ProposalFieldDiff {
  readonly field:
    | "style"
    | "pageType"
    | "textGroups"
    | "visualIntent"
    | "revisionNotes";
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly changed: boolean;
}

export interface ProposalDiffSection {
  readonly kind: ProposalDiffKind;
  readonly id: string;
  readonly label: string;
  readonly selected: boolean;
  readonly fields: readonly ProposalFieldDiff[];
}

/**
 * 逐字段 diff：变化字段由组件用 proof 标记，未变化字段仍保留中性上下文。
 */
export function buildProposalDiffSections(
  before: ContentSpec | null,
  candidate: ContentSpec,
  selection: PlanningProposalSelection,
): readonly ProposalDiffSection[] {
  const selectedIds = new Set(selection.specEntryIds);
  const sections: ProposalDiffSection[] = [];
  const beforeStyle = before?.style.description ?? "";
  const styleChanged = beforeStyle !== candidate.style.description;
  if (styleChanged || before === null) {
    sections.push({
      kind: "style",
      id: "style",
      label: "Deck 风格",
      selected: selection.includeStyle,
      fields: [
        fieldDiff(
          "style",
          "风格描述",
          beforeStyle,
          candidate.style.description,
        ),
      ],
    });
  }

  const beforeById = new Map(
    (before?.entries ?? []).map((entry) => [entry.specEntryId, entry]),
  );
  const candidateById = new Map(
    candidate.entries.map((entry) => [entry.specEntryId, entry]),
  );
  const orderedIds = collectEntryIds(before, candidate);
  const changedIds = new Set(collectChangedEntryIds(before, candidate));

  for (const id of orderedIds) {
    const previous = beforeById.get(id) ?? null;
    const next = candidateById.get(id) ?? null;
    if (!changedIds.has(id)) continue;
    sections.push({
      kind: "entry",
      id,
      label: entryLabel(id, previous, next),
      selected: selectedIds.has(id),
      fields: buildEntryFields(previous, next),
    });
  }
  return sections;
}

/** 接受动作本身不生成图，因此文案只陈述精确漂移影响。 */
export function buildProposalConfirm(
  impact: Pick<PreviewSpecChangeResult, "willDrift" | "willMiss">,
): {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly confirmLabel: string;
} {
  const drifted = impact.willDrift.length;
  const missing = impact.willMiss.length;
  return {
    title: "接受规格提案",
    message: `确认后 ${drifted} 页变为已过时、${missing} 页失联`,
    detail:
      "本次只保存规格并记录提案来源，不会自动失效流水线阶段，也不会生成图像。",
    confirmLabel: "确认接受",
  };
}

function collectChangedEntryIds(
  before: ContentSpec | null,
  candidate: ContentSpec,
): readonly string[] {
  if (before === null) {
    return candidate.entries.map((entry) => entry.specEntryId);
  }
  const diff = diffContentSpec(before, candidate);
  const changed = new Set([...diff.added, ...diff.removed, ...diff.modified]);
  return collectEntryIds(before, candidate).filter((id) => changed.has(id));
}

function collectEntryIds(
  before: ContentSpec | null,
  candidate: ContentSpec,
): readonly string[] {
  const ids = candidate.entries.map((entry) => entry.specEntryId);
  const seen = new Set(ids);
  for (const entry of before?.entries ?? []) {
    if (!seen.has(entry.specEntryId)) ids.push(entry.specEntryId);
  }
  return ids;
}

function buildEntryFields(
  before: ContentSpecEntry | null,
  after: ContentSpecEntry | null,
): readonly ProposalFieldDiff[] {
  return [
    fieldDiff(
      "pageType",
      "页型",
      before?.pageType ?? "",
      after?.pageType ?? "",
    ),
    fieldDiff(
      "textGroups",
      "页面文字",
      formatTextGroups(before?.textGroups ?? []),
      formatTextGroups(after?.textGroups ?? []),
    ),
    fieldDiff(
      "visualIntent",
      "视觉意图",
      before?.visualIntent ?? "",
      after?.visualIntent ?? "",
    ),
    fieldDiff(
      "revisionNotes",
      "调整说明",
      (before?.revisionNotes ?? []).join("\n"),
      (after?.revisionNotes ?? []).join("\n"),
    ),
  ];
}

function fieldDiff(
  field: ProposalFieldDiff["field"],
  label: string,
  before: string,
  after: string,
): ProposalFieldDiff {
  return { field, label, before, after, changed: before !== after };
}

function formatTextGroups(groups: ContentSpecEntry["textGroups"]): string {
  return groups
    .map((group) => `${group.label}：${group.items.join(" / ")}`)
    .join("\n");
}

function entryLabel(
  id: string,
  before: ContentSpecEntry | null,
  after: ContentSpecEntry | null,
): string {
  if (before === null) return `新增条目 · ${after?.pageType || id}`;
  if (after === null) return `删除条目 · ${before.pageType || id}`;
  return `${after.pageType || before.pageType || "页面条目"} · ${id}`;
}

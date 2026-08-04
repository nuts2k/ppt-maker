import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  type ApplySpecChangeResult,
  type ContentSpec,
  type ContentSpecDraft,
  diffContentSpec,
  FoundationError,
  foldPlanningSession,
  materializeDeckPlanningCandidate,
  materializeEntryPlanningCandidate,
  materializeInitialPlanningCandidate,
  type PlanningAcceptProposalResult,
  type PlanningChangeScope,
  type PlanningConversationSnapshot,
  type PlanningMaterialEntry,
  type PlanningMessage,
  PlanningMessageSchema,
  type PlanningProposalDecision,
  PlanningProposalDecisionSchema,
  type PlanningProposalPreview,
  type PlanningProposalResult,
  type PlanningProposalSelection,
  type PlanningQuestionOutput,
  type PlanningSessionRecord,
  type PlanningSessionSnapshot,
  type PreviewSpecChangeResult,
  type SpecProposal,
  type StoredPlanningProposal,
} from "@ppt-maker/core";
import {
  askPlanningQuestion,
  draftPlanningSpec,
  type PlanningPromptMessage,
  proposeSpecChange,
} from "../providers/openai-planning.js";
import { loadDeckContentSpec } from "./content-spec.js";
import {
  appendPlanningSessionRecords,
  buildPlanningMaterialsContext,
  importPlanningMaterial,
  listPlanningMaterials,
  listPlanningSessionRecords,
  listSpecChangeRecords,
  removePlanningMaterial,
} from "./planning-store.js";
import { applySpecChange, previewSpecChange } from "./spec-edit.js";

interface ProviderResult<TResult> {
  readonly requestId: string | null;
  readonly model: string;
  readonly result: TResult;
}

interface PlanningConversationDependencies {
  readonly loadSpec: (deckPath: string) => Promise<ContentSpec | null>;
  readonly listRecords: (
    deckPath: string,
  ) => Promise<readonly PlanningSessionRecord[]>;
  readonly listSpecChanges: typeof listSpecChangeRecords;
  readonly appendRecords: (
    deckPath: string,
    records: readonly PlanningSessionRecord[],
  ) => Promise<void>;
  readonly listMaterials: (
    deckPath: string,
  ) => Promise<readonly PlanningMaterialEntry[]>;
  readonly importMaterial: (
    deckPath: string,
    sourcePath: string,
  ) => Promise<PlanningMaterialEntry>;
  readonly removeMaterial: (deckPath: string, name: string) => Promise<void>;
  readonly buildMaterialsContext: (deckPath: string) => Promise<string>;
  readonly askQuestion: (options: {
    readonly history: readonly PlanningPromptMessage[];
    readonly userText: string;
    readonly materialsContext: string;
  }) => Promise<ProviderResult<PlanningQuestionOutput>>;
  readonly draftSpec: (options: {
    readonly history: readonly PlanningPromptMessage[];
    readonly materialsContext: string;
  }) => Promise<ProviderResult<ContentSpecDraft>>;
  readonly proposeChange: (options: {
    readonly instruction: string;
    readonly currentSpec: ContentSpec;
    readonly scope: PlanningChangeScope;
    readonly materialsContext: string;
  }) => Promise<ProviderResult<SpecProposal>>;
  readonly previewChange: (
    deckPath: string,
    nextSpec: ContentSpec,
  ) => Promise<PreviewSpecChangeResult>;
  readonly applyChange: (options: {
    readonly deckPath: string;
    readonly nextSpec: ContentSpec;
    readonly origin: "proposal";
    readonly summary: string;
    readonly conversationRef: string;
  }) => Promise<ApplySpecChangeResult>;
  readonly now: () => string;
  readonly createId: () => string;
  readonly createSpecEntryId: (index: number) => string;
}

export type PlanningConversationDependencyOverrides =
  Partial<PlanningConversationDependencies>;

export interface PlanningConversationService {
  load(deckPath: string): Promise<PlanningConversationSnapshot>;
  sendMessage(
    deckPath: string,
    text: string,
  ): Promise<PlanningConversationSnapshot>;
  draftSpec(deckPath: string): Promise<PlanningProposalResult>;
  proposeChange(
    deckPath: string,
    instruction: string,
    scope: PlanningChangeScope,
  ): Promise<PlanningProposalResult>;
  previewProposal(
    deckPath: string,
    proposalMessageId: string,
    selection: PlanningProposalSelection,
  ): Promise<PlanningProposalPreview>;
  acceptProposal(
    deckPath: string,
    proposalMessageId: string,
    selection: PlanningProposalSelection,
  ): Promise<PlanningAcceptProposalResult>;
  rejectProposal(
    deckPath: string,
    proposalMessageId: string,
  ): Promise<PlanningConversationSnapshot>;
  listMaterials(deckPath: string): Promise<readonly PlanningMaterialEntry[]>;
  importMaterial(
    deckPath: string,
    sourcePath: string,
  ): Promise<PlanningMaterialEntry>;
  removeMaterial(deckPath: string, name: string): Promise<void>;
}

function invalidInput(
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new FoundationError("INVALID_INPUT", message, details);
}

function invalidState(
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new FoundationError("INVALID_STAGE_STATE", message, details);
}

function providerText(value: string, label: string): string {
  const text = value.trim();
  if (text.length === 0) {
    throw new FoundationError(
      "INVALID_PROVIDER_RESPONSE",
      `${label}返回了空文字`,
    );
  }
  return text;
}

function questionMessageText(output: PlanningQuestionOutput): string {
  return providerText(
    [output.reply.trim(), output.nextQuestion?.trim() ?? ""]
      .filter((part) => part.length > 0)
      .join("\n\n"),
    "策划提问",
  );
}

function promptHistory(
  session: PlanningSessionSnapshot,
): PlanningPromptMessage[] {
  return session.messages.map((message) => ({
    role: message.role,
    content: message.text,
  }));
}

function assertNoPending(session: PlanningSessionSnapshot): void {
  const pending = session.pendingProposal;
  if (pending !== null) {
    invalidState("已有待确认提案，请先接受或拒绝后再继续", {
      proposalMessageId: pending.message.messageId,
    });
  }
}

function pendingProposal(
  session: PlanningSessionSnapshot,
  proposalMessageId: string,
) {
  const pending = session.pendingProposal;
  if (pending === null || pending.message.messageId !== proposalMessageId) {
    invalidState("指定提案不是当前待确认提案", {
      proposalMessageId,
      pendingProposalMessageId: pending?.message.messageId ?? null,
    });
  }
  return pending;
}

function userMessage(
  dependencies: PlanningConversationDependencies,
  text: string,
  at: string,
): PlanningMessage {
  return PlanningMessageSchema.parse({
    v: 1,
    kind: "message",
    messageId: dependencies.createId(),
    at,
    role: "user",
    text,
    proposal: null,
    dimensions: null,
    requestId: null,
    model: null,
  });
}

function assistantMessage(
  dependencies: PlanningConversationDependencies,
  options: {
    readonly text: string;
    readonly at: string;
    readonly requestId: string | null;
    readonly model: string;
    readonly proposal?: StoredPlanningProposal | null;
    readonly dimensions?: PlanningQuestionOutput["dimensions"] | null;
  },
): PlanningMessage {
  return PlanningMessageSchema.parse({
    v: 1,
    kind: "message",
    messageId: dependencies.createId(),
    at: options.at,
    role: "assistant",
    text: options.text,
    proposal: options.proposal ?? null,
    dimensions: options.dimensions ?? null,
    requestId: options.requestId,
    model: options.model,
  });
}

function proposalDecision(
  dependencies: PlanningConversationDependencies,
  options: {
    readonly proposalMessageId: string;
    readonly outcome: "accepted" | "rejected";
    readonly acceptedAs: string | null;
  },
): PlanningProposalDecision {
  return PlanningProposalDecisionSchema.parse({
    v: 1,
    kind: "proposal-decision",
    decisionId: dependencies.createId(),
    at: dependencies.now(),
    proposalMessageId: options.proposalMessageId,
    outcome: options.outcome,
    acceptedAs: options.acceptedAs,
  });
}

function changedEntryIds(
  current: ContentSpec,
  candidate: ContentSpec,
): Set<string> {
  const diff = diffContentSpec(current, candidate);
  return new Set([...diff.added, ...diff.removed, ...diff.modified]);
}

function assertUniqueSelection(
  selection: PlanningProposalSelection,
): Set<string> {
  const selected = new Set(selection.specEntryIds);
  if (selected.size !== selection.specEntryIds.length) {
    invalidInput("提案选择中包含重复条目 ID");
  }
  return selected;
}

function selectCandidate(
  current: ContentSpec | null,
  proposal: StoredPlanningProposal,
  selection: PlanningProposalSelection,
): ContentSpec {
  const selected = assertUniqueSelection(selection);

  if (proposal.kind === "initial-draft") {
    if (current !== null) {
      invalidState("初稿提案待确认期间已有权威规格，不能覆盖");
    }
    const expected = new Set(
      proposal.candidate.entries.map((entry) => entry.specEntryId),
    );
    if (
      !selection.includeStyle ||
      selected.size !== expected.size ||
      [...selected].some((id) => !expected.has(id))
    ) {
      invalidInput("初稿必须连同 style 与全部条目整体接受");
    }
    return proposal.candidate;
  }

  if (current === null) {
    invalidState("当前规格已不存在，不能接受改稿提案");
  }
  const changed = changedEntryIds(current, proposal.candidate);
  if ([...selected].some((id) => !changed.has(id))) {
    invalidInput("提案选择包含本次没有改动的条目", {
      selected: [...selected],
      changed: [...changed],
    });
  }

  if (proposal.scope === "entry") {
    if (selection.includeStyle || selected.size !== 1 || changed.size !== 1) {
      invalidInput("单条目提案必须整条接受，且不能选择 deck style");
    }
    return proposal.candidate;
  }

  if (
    (!selection.includeStyle ||
      !diffContentSpec(current, proposal.candidate).styleChanged) &&
    selected.size === 0
  ) {
    invalidInput("至少选择 style 或一个条目后才能接受提案");
  }

  const candidateById = new Map(
    proposal.candidate.entries.map((entry) => [entry.specEntryId, entry]),
  );
  const entries = current.entries
    .filter(
      (entry) =>
        candidateById.has(entry.specEntryId) ||
        !selected.has(entry.specEntryId),
    )
    .map((entry) =>
      selected.has(entry.specEntryId)
        ? (candidateById.get(entry.specEntryId) ?? entry)
        : entry,
    );
  for (const entry of proposal.candidate.entries) {
    if (
      selected.has(entry.specEntryId) &&
      !current.entries.some(
        (currentEntry) => currentEntry.specEntryId === entry.specEntryId,
      )
    ) {
      entries.push(entry);
    }
  }
  return {
    ...current,
    updatedAt: proposal.candidate.updatedAt,
    style: selection.includeStyle ? proposal.candidate.style : current.style,
    entries,
  };
}

function toProposalPreview(
  proposalMessageId: string,
  candidate: ContentSpec,
  preview: PreviewSpecChangeResult,
): PlanningProposalPreview {
  return {
    proposalMessageId,
    candidate,
    diff: preview.diff,
    willDrift: preview.willDrift,
    willMiss: preview.willMiss,
  };
}

function summaryForProposal(message: PlanningMessage): string {
  const oneLine = message.text.replaceAll(/\s+/g, " ").trim();
  return `接受策划提案：${oneLine.slice(0, 120)}`;
}

export function createPlanningConversationService(
  overrides: PlanningConversationDependencyOverrides = {},
): PlanningConversationService {
  const dependencies: PlanningConversationDependencies = {
    loadSpec: loadDeckContentSpec,
    listRecords: listPlanningSessionRecords,
    listSpecChanges: listSpecChangeRecords,
    appendRecords: appendPlanningSessionRecords,
    listMaterials: listPlanningMaterials,
    importMaterial: importPlanningMaterial,
    removeMaterial: removePlanningMaterial,
    buildMaterialsContext: buildPlanningMaterialsContext,
    askQuestion: askPlanningQuestion,
    draftSpec: draftPlanningSpec,
    proposeChange: proposeSpecChange,
    previewChange: previewSpecChange,
    applyChange: applySpecChange,
    now: () => new Date().toISOString(),
    createId: randomUUID,
    createSpecEntryId: () => randomUUID(),
    ...overrides,
  };

  const tails = new Map<string, Promise<void>>();

  function enqueue<T>(deckPath: string, task: () => Promise<T>): Promise<T> {
    // 与持久化层使用同一 deck 身份口径，避免绝对/相对路径或尾随分隔符
    // 让同一个 deck 绕过唯一 pending 的串行化。
    const key = resolve(deckPath);
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(task);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) {
        tails.delete(key);
      }
    });
    return result;
  }

  async function loadInternal(
    deckPath: string,
  ): Promise<PlanningConversationSnapshot> {
    const [records, specChanges, spec, materials] = await Promise.all([
      dependencies.listRecords(deckPath),
      dependencies.listSpecChanges(deckPath),
      dependencies.loadSpec(deckPath),
      dependencies.listMaterials(deckPath),
    ]);
    let session = foldPlanningSession(records);
    const pending = session.pendingProposal;
    if (pending !== null) {
      const applied = specChanges.find(
        (record) =>
          record.origin === "proposal" &&
          record.conversationRef === pending.message.messageId,
      );
      if (applied !== undefined) {
        // 规格写入成功、accepted decision 追加失败时，以唯一写入入口留下的
        // conversationRef 为权威证据，在内存投影中补出 accepted。这里刻意不在
        // load 路径补写 session.jsonl：避免并发 load 追加重复决策，也保持读取零副作用。
        session = foldPlanningSession([
          ...records,
          PlanningProposalDecisionSchema.parse({
            v: 1,
            kind: "proposal-decision",
            decisionId: `recovered:${applied.recordId}`,
            at: applied.at,
            proposalMessageId: pending.message.messageId,
            outcome: "accepted",
            acceptedAs: applied.recordId,
          }),
        ]);
      }
      // 若规格历史与 decision 同时没写成，就没有可校验的接受证据，只能保留
      // pending。不要用“当前规格恰好等于 candidate”猜测用户是否确认过。
    }
    return { session, spec, materials };
  }

  async function previewInternal(
    deckPath: string,
    proposalMessageId: string,
    selection: PlanningProposalSelection,
  ): Promise<PlanningProposalPreview> {
    const snapshot = await loadInternal(deckPath);
    const pending = pendingProposal(snapshot.session, proposalMessageId);
    const candidate = selectCandidate(
      snapshot.spec,
      pending.proposal,
      selection,
    );
    const preview = await dependencies.previewChange(deckPath, candidate);
    return toProposalPreview(proposalMessageId, candidate, preview);
  }

  return {
    load: loadInternal,

    sendMessage(deckPath, text) {
      return enqueue(deckPath, async () => {
        const normalized = text.trim();
        if (normalized.length === 0) {
          invalidInput("策划消息不能为空");
        }
        const snapshot = await loadInternal(deckPath);
        assertNoPending(snapshot.session);
        const materialsContext =
          await dependencies.buildMaterialsContext(deckPath);
        const analysis = await dependencies.askQuestion({
          history: promptHistory(snapshot.session),
          userText: normalized,
          materialsContext,
        });
        const at = dependencies.now();
        const records = [
          userMessage(dependencies, normalized, at),
          assistantMessage(dependencies, {
            text: questionMessageText(analysis.result),
            at,
            requestId: analysis.requestId,
            model: analysis.model,
            dimensions: analysis.result.dimensions,
          }),
        ];
        await dependencies.appendRecords(deckPath, records);
        return loadInternal(deckPath);
      });
    },

    draftSpec(deckPath) {
      return enqueue(deckPath, async () => {
        const snapshot = await loadInternal(deckPath);
        assertNoPending(snapshot.session);
        if (snapshot.spec !== null) {
          invalidState("deck 已有权威规格，请使用改稿提案");
        }
        const materialsContext =
          await dependencies.buildMaterialsContext(deckPath);
        const analysis = await dependencies.draftSpec({
          history: promptHistory(snapshot.session),
          materialsContext,
        });
        const at = dependencies.now();
        const candidate = materializeInitialPlanningCandidate(analysis.result, {
          specId: dependencies.createId(),
          now: at,
          createSpecEntryId: dependencies.createSpecEntryId,
        });
        const preview = await dependencies.previewChange(deckPath, candidate);
        const message = assistantMessage(dependencies, {
          text: "已按现有信息生成完整规格初稿，请审阅后整体接受或拒绝。",
          at,
          requestId: analysis.requestId,
          model: analysis.model,
          proposal: {
            kind: "initial-draft",
            raw: analysis.result,
            candidate,
            scope: "initial",
          },
        });
        await dependencies.appendRecords(deckPath, [message]);
        return {
          snapshot: await loadInternal(deckPath),
          preview: toProposalPreview(message.messageId, candidate, preview),
        };
      });
    },

    proposeChange(deckPath, instruction, scope) {
      return enqueue(deckPath, async () => {
        const normalized = instruction.trim();
        if (normalized.length === 0) {
          invalidInput("改稿指令不能为空");
        }
        const snapshot = await loadInternal(deckPath);
        assertNoPending(snapshot.session);
        if (snapshot.spec === null) {
          invalidState("deck 尚无权威规格，请先生成初稿");
        }
        const materialsContext =
          await dependencies.buildMaterialsContext(deckPath);
        const analysis = await dependencies.proposeChange({
          instruction: normalized,
          currentSpec: snapshot.spec,
          scope,
          materialsContext,
        });
        const at = dependencies.now();
        const candidate =
          scope.kind === "entry"
            ? materializeEntryPlanningCandidate(
                snapshot.spec,
                analysis.result,
                { targetSpecEntryId: scope.targetSpecEntryId, now: at },
              )
            : materializeDeckPlanningCandidate(snapshot.spec, analysis.result, {
                now: at,
                createSpecEntryId: dependencies.createSpecEntryId,
              });
        const preview = await dependencies.previewChange(deckPath, candidate);
        const records = [
          userMessage(dependencies, normalized, at),
          assistantMessage(dependencies, {
            text: providerText(analysis.result.reply, "规格改稿"),
            at,
            requestId: analysis.requestId,
            model: analysis.model,
            proposal: {
              kind: "spec-change",
              raw: analysis.result,
              candidate,
              scope: scope.kind,
            },
          }),
        ];
        await dependencies.appendRecords(deckPath, records);
        const message = records[1];
        if (message === undefined) {
          throw new Error("规格提案消息构造失败");
        }
        return {
          snapshot: await loadInternal(deckPath),
          preview: toProposalPreview(message.messageId, candidate, preview),
        };
      });
    },

    previewProposal: previewInternal,

    acceptProposal(deckPath, proposalMessageId, selection) {
      return enqueue(deckPath, async () => {
        // 必须在接受动作内重新读取 pending、重组选择并重新预演，不能复用界面旧结果。
        const preview = await previewInternal(
          deckPath,
          proposalMessageId,
          selection,
        );
        const snapshot = await loadInternal(deckPath);
        const pending = pendingProposal(snapshot.session, proposalMessageId);
        const applyResult = await dependencies.applyChange({
          deckPath,
          nextSpec: preview.candidate,
          origin: "proposal",
          summary: summaryForProposal(pending.message),
          conversationRef: proposalMessageId,
        });
        const decision = proposalDecision(dependencies, {
          proposalMessageId,
          outcome: "accepted",
          acceptedAs: applyResult.record.recordId,
        });
        let decisionWritten = true;
        try {
          await dependencies.appendRecords(deckPath, [decision]);
        } catch (error) {
          decisionWritten = false;
          console.error(
            "[planning-conversation] 规格已保存，但 accepted 决策写入失败",
            error,
          );
        }
        return {
          snapshot: await loadInternal(deckPath),
          applyResult,
          decisionWritten,
        };
      });
    },

    rejectProposal(deckPath, proposalMessageId) {
      return enqueue(deckPath, async () => {
        const snapshot = await loadInternal(deckPath);
        pendingProposal(snapshot.session, proposalMessageId);
        await dependencies.appendRecords(deckPath, [
          proposalDecision(dependencies, {
            proposalMessageId,
            outcome: "rejected",
            acceptedAs: null,
          }),
        ]);
        return loadInternal(deckPath);
      });
    },

    listMaterials: dependencies.listMaterials,
    importMaterial(deckPath, sourcePath) {
      return enqueue(deckPath, () =>
        dependencies.importMaterial(deckPath, sourcePath),
      );
    },
    removeMaterial(deckPath, name) {
      return enqueue(deckPath, () =>
        dependencies.removeMaterial(deckPath, name),
      );
    },
  };
}

export const planningConversationService = createPlanningConversationService();

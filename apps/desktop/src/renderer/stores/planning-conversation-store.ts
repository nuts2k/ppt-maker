import type {
  ContentSpecEntry,
  PlanningAcceptProposalResult,
  PlanningChangeScope,
  PlanningConversationSnapshot,
  PlanningMaterialEntry,
  PlanningProposalPreview,
  PlanningProposalSelection,
} from "@ppt-maker/core";
import { create, type StoreApi } from "zustand";
import {
  buildDefaultProposalSelection,
  normalizeProposalSelection,
  resolveSelectedEntryId,
} from "../lib/planning-conversation-core.js";

export type PlanningConversationOperation =
  | "load"
  | "send"
  | "draft"
  | "propose"
  | "preview"
  | "accept"
  | "reject"
  | "material";

interface PlanningConversationState {
  deckPath: string | null;
  snapshot: PlanningConversationSnapshot | null;
  preview: PlanningProposalPreview | null;
  selection: PlanningProposalSelection;
  scope: "entry" | "deck";
  selectedEntryId: string | null;
  operation: PlanningConversationOperation | null;
  error: string | null;
  warning: string | null;
  lastAcceptResult: PlanningAcceptProposalResult | null;

  load(deckPath: string): Promise<void>;
  sendMessage(text: string): Promise<boolean>;
  draftSpec(): Promise<boolean>;
  proposeChange(text: string): Promise<boolean>;
  setScope(scope: "entry" | "deck"): void;
  selectEntry(specEntryId: string): void;
  syncSelectedEntry(entries: readonly ContentSpecEntry[]): void;
  setProposalSelection(selection: PlanningProposalSelection): Promise<void>;
  acceptProposal(): Promise<PlanningAcceptProposalResult | null>;
  rejectProposal(): Promise<boolean>;
  reloadMaterials(): Promise<void>;
  importMaterial(): Promise<void>;
  removeMaterial(name: string): Promise<void>;
  clearError(): void;
  reset(nextDeckPath?: string | null): void;
}

const EMPTY_SELECTION: PlanningProposalSelection = {
  includeStyle: false,
  specEntryIds: [],
};

const INITIAL_STATE = {
  deckPath: null,
  snapshot: null,
  preview: null,
  selection: EMPTY_SELECTION,
  scope: "entry",
  selectedEntryId: null,
  operation: null,
  error: null,
  warning: null,
  lastAcceptResult: null,
} as const;

let previewSequence = 0;
let loadSequence = 0;

export const usePlanningConversationStore = create<PlanningConversationState>(
  (set, get) => ({
    ...INITIAL_STATE,

    async load(deckPath) {
      const sequence = ++loadSequence;
      set({
        deckPath,
        operation: "load",
        error: null,
        warning: null,
        lastAcceptResult: null,
      });
      let snapshot: PlanningConversationSnapshot;
      try {
        snapshot = await window.api.planning.load(deckPath);
      } catch (error) {
        if (sequence === loadSequence && get().deckPath === deckPath) {
          set({ operation: null, error: messageOf(error) });
        }
        return;
      }
      if (sequence !== loadSequence || get().deckPath !== deckPath) return;

      const selectedEntryId = resolveSelectedEntryId(
        snapshot.spec?.entries ?? [],
        get().selectedEntryId,
      );
      const pending = snapshot.session.pendingProposal;
      const selection =
        pending === null
          ? EMPTY_SELECTION
          : buildDefaultProposalSelection(
              snapshot.spec,
              pending.proposal.candidate,
              pending.proposal.scope,
            );
      set({
        snapshot,
        selectedEntryId,
        selection,
        preview: null,
        operation: null,
      });
      if (pending !== null) await refreshPreview(set, get, deckPath, selection);
    },

    async sendMessage(text) {
      const deckPath = get().deckPath;
      const content = text.trim();
      if (
        deckPath === null ||
        content === "" ||
        !beginAction(set, get, "send")
      ) {
        return false;
      }
      try {
        const snapshot = await window.api.planning.sendMessage(
          deckPath,
          content,
        );
        if (get().deckPath !== deckPath) return false;
        set({ snapshot, operation: null });
        return true;
      } catch (error) {
        failAction(set, get, deckPath, error);
        return false;
      }
    },

    async draftSpec() {
      const deckPath = get().deckPath;
      if (deckPath === null || !beginAction(set, get, "draft")) return false;
      try {
        const result = await window.api.planning.draftSpec(deckPath);
        if (get().deckPath !== deckPath) return false;
        setProposalResult(set, result.snapshot, result.preview);
        return true;
      } catch (error) {
        failAction(set, get, deckPath, error);
        return false;
      }
    },

    async proposeChange(text) {
      const state = get();
      const deckPath = state.deckPath;
      const content = text.trim();
      if (deckPath === null || content === "") return false;
      let scope: PlanningChangeScope;
      if (state.scope === "deck") {
        scope = { kind: "deck" };
      } else if (state.selectedEntryId === null) {
        impossibleEntryScope(set);
        return false;
      } else {
        scope = { kind: "entry", targetSpecEntryId: state.selectedEntryId };
      }
      if (!beginAction(set, get, "propose")) return false;
      try {
        const result = await window.api.planning.proposeChange(
          deckPath,
          content,
          scope,
        );
        if (get().deckPath !== deckPath) return false;
        setProposalResult(set, result.snapshot, result.preview);
        return true;
      } catch (error) {
        failAction(set, get, deckPath, error);
        return false;
      }
    },

    setScope(scope) {
      set({ scope, error: null });
    },

    selectEntry(specEntryId) {
      set({ selectedEntryId: specEntryId });
    },

    syncSelectedEntry(entries) {
      const selectedEntryId = resolveSelectedEntryId(
        entries,
        get().selectedEntryId,
      );
      if (selectedEntryId !== get().selectedEntryId) set({ selectedEntryId });
    },

    async setProposalSelection(selection) {
      const state = get();
      const pending = state.snapshot?.session.pendingProposal ?? null;
      if (state.deckPath === null || pending === null) return;
      if (state.operation !== null && state.operation !== "preview") {
        set({ error: "请等待当前请求完成后再调整提案选择。" });
        return;
      }
      const normalized = normalizeProposalSelection(
        state.snapshot?.spec ?? null,
        pending.proposal.candidate,
        pending.proposal.scope,
        selection,
      );
      set({ selection: normalized, error: null });
      await refreshPreview(set, get, state.deckPath, normalized);
    },

    async acceptProposal() {
      const state = get();
      const deckPath = state.deckPath;
      const pending = state.snapshot?.session.pendingProposal ?? null;
      if (deckPath === null || pending === null) return null;
      if (
        !selectionHasContent(state.selection) ||
        !beginAction(set, get, "accept")
      ) {
        if (!selectionHasContent(state.selection)) {
          set({ error: "至少保留一项提案内容后才能接受。" });
        }
        return null;
      }
      try {
        const result = await window.api.planning.acceptProposal(
          deckPath,
          pending.message.messageId,
          state.selection,
        );
        if (get().deckPath !== deckPath) return null;
        set({
          snapshot: result.snapshot,
          preview: null,
          selection: EMPTY_SELECTION,
          operation: null,
          lastAcceptResult: result,
          warning: acceptWarning(result),
        });
        return result;
      } catch (error) {
        failAction(set, get, deckPath, error);
        return null;
      }
    },

    async rejectProposal() {
      const state = get();
      const deckPath = state.deckPath;
      const pending = state.snapshot?.session.pendingProposal ?? null;
      if (deckPath === null || pending === null) return false;
      if (!beginAction(set, get, "reject")) return false;
      try {
        const result = await window.api.planning.rejectProposal(
          deckPath,
          pending.message.messageId,
        );
        if (get().deckPath !== deckPath) return false;
        set({
          snapshot: result.snapshot,
          preview: null,
          selection: EMPTY_SELECTION,
          operation: null,
        });
        return true;
      } catch (error) {
        failAction(set, get, deckPath, error);
        return false;
      }
    },

    async reloadMaterials() {
      const deckPath = get().deckPath;
      if (deckPath === null || !beginAction(set, get, "material")) return;
      try {
        const result = await window.api.planning.listMaterials(deckPath);
        if (get().deckPath !== deckPath) return;
        set({
          snapshot: replaceMaterials(get().snapshot, result.materials),
          operation: null,
        });
      } catch (error) {
        failAction(set, get, deckPath, error);
      }
    },

    async importMaterial() {
      const deckPath = get().deckPath;
      if (deckPath === null || !beginAction(set, get, "material")) return;
      try {
        const material = await window.api.planning.importMaterial(deckPath);
        if (get().deckPath !== deckPath) return;
        const materials =
          material === null
            ? (get().snapshot?.materials ?? [])
            : sortMaterials([...(get().snapshot?.materials ?? []), material]);
        set({
          snapshot: replaceMaterials(get().snapshot, materials),
          operation: null,
        });
      } catch (error) {
        failAction(set, get, deckPath, error);
      }
    },

    async removeMaterial(name) {
      const deckPath = get().deckPath;
      if (deckPath === null || !beginAction(set, get, "material")) return;
      try {
        const result = await window.api.planning.removeMaterial(deckPath, name);
        if (get().deckPath !== deckPath) return;
        set({
          snapshot: replaceMaterials(get().snapshot, result.materials),
          operation: null,
        });
      } catch (error) {
        failAction(set, get, deckPath, error);
      }
    },

    clearError() {
      set({ error: null, warning: null });
    },

    reset(nextDeckPath = null) {
      // 不递增任何请求序号：已经属于 nextDeckPath 的请求仍应正常落地。
      set({ ...INITIAL_STATE, deckPath: nextDeckPath });
    },
  }),
);

type StoreSet = StoreApi<PlanningConversationState>["setState"];
type StoreGet = StoreApi<PlanningConversationState>["getState"];

function beginAction(
  set: StoreSet,
  get: StoreGet,
  operation: PlanningConversationOperation,
): boolean {
  if (get().operation !== null) {
    set({ error: "请等待当前请求完成后再继续。" });
    return false;
  }
  if (
    (get().snapshot?.session.pendingProposal ?? null) !== null &&
    !["preview", "accept", "reject", "material"].includes(operation)
  ) {
    set({ error: "请先接受或拒绝待确认提案，再继续对话。" });
    return false;
  }
  set({ operation, error: null, warning: null });
  return true;
}

function failAction(
  set: StoreSet,
  get: StoreGet,
  deckPath: string,
  error: unknown,
): void {
  if (get().deckPath === deckPath) {
    set({ operation: null, error: messageOf(error) });
  }
}

async function refreshPreview(
  set: StoreSet,
  get: StoreGet,
  deckPath: string,
  selection: PlanningProposalSelection,
): Promise<void> {
  const pending = get().snapshot?.session.pendingProposal ?? null;
  if (pending === null) return;
  const proposalMessageId = pending.message.messageId;
  const sequence = ++previewSequence;
  // 选择一旦变化，旧预览里的影响数量就不再对应即将接受的内容。
  // 新预览失败时必须保持为空，不能让界面拿旧计数继续确认。
  set({ operation: "preview", error: null, preview: null });
  try {
    const preview = await window.api.planning.previewProposal(
      deckPath,
      proposalMessageId,
      selection,
    );
    if (
      sequence !== previewSequence ||
      get().deckPath !== deckPath ||
      get().snapshot?.session.pendingProposal?.message.messageId !==
        proposalMessageId
    ) {
      return;
    }
    set({ preview, operation: null });
  } catch (error) {
    if (
      sequence === previewSequence &&
      get().deckPath === deckPath &&
      get().snapshot?.session.pendingProposal?.message.messageId ===
        proposalMessageId
    ) {
      set({ operation: null, error: `提案影响预览失败：${messageOf(error)}` });
    }
  }
}

function setProposalResult(
  set: StoreSet,
  snapshot: PlanningConversationSnapshot,
  preview: PlanningProposalPreview,
): void {
  const pending = snapshot.session.pendingProposal;
  const selection =
    pending === null
      ? EMPTY_SELECTION
      : buildDefaultProposalSelection(
          snapshot.spec,
          pending.proposal.candidate,
          pending.proposal.scope,
        );
  set({ snapshot, preview, selection, operation: null });
}

function replaceMaterials(
  snapshot: PlanningConversationSnapshot | null,
  materials: readonly PlanningMaterialEntry[],
): PlanningConversationSnapshot | null {
  return snapshot === null ? null : { ...snapshot, materials };
}

function sortMaterials(
  materials: readonly PlanningMaterialEntry[],
): readonly PlanningMaterialEntry[] {
  return [...materials].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function selectionHasContent(selection: PlanningProposalSelection): boolean {
  return selection.includeStyle || selection.specEntryIds.length > 0;
}

function acceptWarning(result: PlanningAcceptProposalResult): string | null {
  const warnings: string[] = [];
  if (!result.applyResult.historyWritten) {
    warnings.push("规格已保存，但本次变更历史未写成");
  }
  if (!result.decisionWritten) {
    warnings.push("规格已保存，但会话中的接受决策未写成");
  }
  return warnings.length === 0
    ? null
    : `${warnings.join("；")}。请勿重复接受。`;
}

function impossibleEntryScope(set: StoreSet): null {
  set({ error: "当前规格没有可作为单条目改稿目标的页面。" });
  return null;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { PlanningConversationState };

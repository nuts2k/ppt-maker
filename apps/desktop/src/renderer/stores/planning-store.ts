import type {
  ApplySpecChangeResult,
  ContentSpec,
  SpecChangeRecord,
} from "@ppt-maker/core";
import { create } from "zustand";
import { isDirty } from "../lib/planning-core.js";

interface PlanningState {
  loadedDeckPath: string | null;
  saved: ContentSpec | null;
  draft: ContentSpec | null;
  history: readonly SpecChangeRecord[];
  loading: boolean;
  saving: boolean;
  lastResult: ApplySpecChangeResult | null;
  justCreated: boolean;
  error: string | null;

  load(deckPath: string, justCreated?: boolean): Promise<void>;
  updateDraft(update: (draft: ContentSpec) => ContentSpec): void;
  save(summary: string): Promise<ApplySpecChangeResult | null>;
  rollback(recordId: string): Promise<ApplySpecChangeResult | null>;
  reloadHistory(): Promise<void>;
  prepareNewDeck(): void;
  reset(): void;
}

function blankDraft(): ContentSpec {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    specId: globalThis.crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    style: { description: "" },
    entries: [],
  };
}

const INITIAL_STATE = {
  loadedDeckPath: null,
  saved: null,
  draft: null,
  history: [],
  loading: false,
  saving: false,
  lastResult: null,
  justCreated: false,
  error: null,
} as const;

export const usePlanningStore = create<PlanningState>((set, get) => ({
  ...INITIAL_STATE,

  async load(deckPath, justCreated = false) {
    set({
      loadedDeckPath: deckPath,
      loading: true,
      justCreated,
      error: null,
      lastResult: null,
    });
    const [specResult, historyResult] = await Promise.allSettled([
      window.api.deck.readDeckSpec(deckPath),
      window.api.deck.listSpecHistory(deckPath),
    ]);
    if (get().loadedDeckPath !== deckPath) return;
    if (specResult.status === "rejected") {
      set({ loading: false, error: messageOf(specResult.reason) });
      return;
    }
    set({
      saved: specResult.value,
      draft: specResult.value === null && justCreated ? blankDraft() : null,
      history: historyResult.status === "fulfilled" ? historyResult.value : [],
      loading: false,
      error:
        historyResult.status === "rejected"
          ? `规格已读取，但变更历史读取失败：${messageOf(historyResult.reason)}`
          : null,
    });
  },

  updateDraft(update) {
    const state = get();
    const base = state.draft ?? state.saved ?? blankDraft();
    set({ draft: update(base), lastResult: null, error: null });
  },

  async save(summary) {
    const { loadedDeckPath, draft } = get();
    if (loadedDeckPath === null || draft === null) return null;
    set({ saving: true, error: null });
    let result: ApplySpecChangeResult;
    try {
      result = await window.api.deck.applySpecChange(
        loadedDeckPath,
        draft,
        summary.trim() || "手工编辑规格",
      );
    } catch (error) {
      if (get().loadedDeckPath === loadedDeckPath) {
        set({ saving: false, error: messageOf(error) });
      }
      return null;
    }
    if (get().loadedDeckPath !== loadedDeckPath) return null;
    set({
      saved: result.spec,
      draft: null,
      saving: false,
      lastResult: result,
      justCreated: false,
    });
    try {
      const history = await window.api.deck.listSpecHistory(loadedDeckPath);
      if (get().loadedDeckPath !== loadedDeckPath) return null;
      set({ history });
    } catch (error) {
      if (get().loadedDeckPath === loadedDeckPath) {
        set({
          error: `规格已保存，但变更历史读取失败：${messageOf(error)}`,
        });
      }
    }
    return result;
  },

  async rollback(recordId) {
    const { loadedDeckPath } = get();
    if (loadedDeckPath === null) return null;
    set({ saving: true, error: null });
    let result: ApplySpecChangeResult;
    try {
      result = await window.api.deck.rollbackSpecChange(
        loadedDeckPath,
        recordId,
      );
    } catch (error) {
      if (get().loadedDeckPath === loadedDeckPath) {
        set({ saving: false, error: messageOf(error) });
      }
      return null;
    }
    if (get().loadedDeckPath !== loadedDeckPath) return null;
    set({
      saved: result.spec,
      draft: null,
      saving: false,
      lastResult: result,
    });
    try {
      const history = await window.api.deck.listSpecHistory(loadedDeckPath);
      if (get().loadedDeckPath !== loadedDeckPath) return null;
      set({ history });
    } catch (error) {
      if (get().loadedDeckPath === loadedDeckPath) {
        set({
          error: `规格已回滚，但变更历史读取失败：${messageOf(error)}`,
        });
      }
    }
    return result;
  },

  async reloadHistory() {
    const { loadedDeckPath } = get();
    if (loadedDeckPath === null) return;
    const history = await window.api.deck.listSpecHistory(loadedDeckPath);
    if (get().loadedDeckPath === loadedDeckPath) set({ history });
  },

  prepareNewDeck() {
    set({ ...INITIAL_STATE, justCreated: true });
  },

  reset() {
    set({ ...INITIAL_STATE });
  },
}));

export function selectPlanningDirty(state: PlanningState): boolean {
  return isDirty(state.saved, state.draft);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type { PlanningState };

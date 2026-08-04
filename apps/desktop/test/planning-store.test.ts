/**
 * planning-store 的关键写盘路径。
 *
 * store 只依赖 `window.api.deck`，测试用 IPC 形状的最小替身驱动真实 store，
 * 锁住「保存成功清草稿、保存失败保留草稿、回滚刷新规格与历史」三条主路径。
 */

import type {
  ApplySpecChangeResult,
  ContentSpec,
  SpecChangeRecord,
} from "@ppt-maker/core";
import { beforeEach, describe, expect, it } from "vitest";
import type { IpcApi } from "../src/main/ipc/channels.js";
import { usePlanningStore } from "../src/renderer/stores/planning-store.js";

const OLD_TIME = "2026-08-04T00:00:00.000Z";
const NEW_TIME = "2026-08-04T00:05:00.000Z";

function makeSpec(style: string, updatedAt = OLD_TIME): ContentSpec {
  return {
    schemaVersion: 1,
    specId: "spec-1",
    createdAt: OLD_TIME,
    updatedAt,
    style: { description: style },
    entries: [
      {
        specEntryId: "entry-001",
        pageType: "cover",
        textGroups: [{ label: "标题", items: ["内容策划工作台"] }],
        visualIntent: "居中大标题",
        revisionNotes: [],
      },
    ],
  };
}

function makeRecord(
  overrides: Partial<SpecChangeRecord> = {},
): SpecChangeRecord {
  return {
    v: 1,
    recordId: "record-1",
    at: NEW_TIME,
    origin: "manual",
    summary: "更新规格",
    styleBefore: { description: "旧风格" },
    styleAfter: { description: "新风格" },
    entriesBefore: [],
    entriesAfter: [],
    fingerprints: [],
    conversationRef: null,
    rollbackOf: null,
    ...overrides,
  };
}

function makeResult(
  spec: ContentSpec,
  overrides: Partial<ApplySpecChangeResult> = {},
): ApplySpecChangeResult {
  return {
    spec,
    record: makeRecord(),
    historyWritten: true,
    drifted: [],
    missing: [],
    ...overrides,
  };
}

function stubApi(deck: Partial<IpcApi["deck"]>): void {
  globalThis.window = {
    api: { deck } as IpcApi,
  };
}

beforeEach(() => {
  usePlanningStore.getState().reset();
});

describe("usePlanningStore.load", () => {
  it("历史读取失败不阻断规格编辑", async () => {
    const saved = makeSpec("可编辑风格");
    stubApi({
      readDeckSpec: async () => saved,
      listSpecHistory: async () => {
        throw new Error("历史文件无权限读取");
      },
    });

    await usePlanningStore.getState().load("/decks/demo");
    const state = usePlanningStore.getState();

    expect(state.saved).toEqual(saved);
    expect(state.loading).toBe(false);
    expect(state.error).toContain("规格已读取，但变更历史读取失败");
  });
});

describe("usePlanningStore.save", () => {
  it("保存成功后写入新规格并清掉草稿，同时刷新历史", async () => {
    const saved = makeSpec("旧风格");
    const next = makeSpec("新风格", NEW_TIME);
    const record = makeRecord({ recordId: "record-save" });
    let historyCalls = 0;
    let applied: { path: string; spec: ContentSpec; summary: string } | null =
      null;

    stubApi({
      readDeckSpec: async () => saved,
      listSpecHistory: async () => {
        historyCalls += 1;
        return historyCalls === 1 ? [] : [record];
      },
      applySpecChange: async (path, spec, summary) => {
        applied = { path, spec, summary };
        return makeResult(next, { record });
      },
    });

    await usePlanningStore.getState().load("/decks/demo");
    usePlanningStore.getState().updateDraft((draft) => ({
      ...draft,
      ...next,
    }));

    const result = await usePlanningStore.getState().save("  更新风格  ");
    const state = usePlanningStore.getState();

    expect(result?.spec).toEqual(next);
    expect(applied).toEqual({
      path: "/decks/demo",
      spec: next,
      summary: "更新风格",
    });
    expect(state.saved).toEqual(next);
    expect(state.draft).toBeNull();
    expect(state.history).toEqual([record]);
    expect(state.saving).toBe(false);
    expect(state.error).toBeNull();
    expect(state.lastResult).toEqual(result);
  });

  it("保存失败时保留草稿并暴露错误，不覆盖已保存规格", async () => {
    const saved = makeSpec("旧风格");
    stubApi({
      readDeckSpec: async () => saved,
      listSpecHistory: async () => [],
      applySpecChange: async () => {
        throw new Error("规格校验失败");
      },
    });

    await usePlanningStore.getState().load("/decks/demo");
    usePlanningStore.getState().updateDraft((draft) => ({
      ...draft,
      style: { description: "待保存风格" },
    }));
    const draftBeforeSave = usePlanningStore.getState().draft;

    const result = await usePlanningStore.getState().save("保存失败用例");
    const state = usePlanningStore.getState();

    expect(result).toBeNull();
    expect(state.saved).toEqual(saved);
    expect(state.draft).toEqual(draftBeforeSave);
    expect(state.saving).toBe(false);
    expect(state.error).toBe("规格校验失败");
  });

  it("规格已落盘后即使历史刷新失败也清掉草稿", async () => {
    const saved = makeSpec("旧风格");
    const next = makeSpec("已保存风格", NEW_TIME);
    let historyCalls = 0;
    stubApi({
      readDeckSpec: async () => saved,
      listSpecHistory: async () => {
        historyCalls += 1;
        if (historyCalls > 1) throw new Error("历史刷新失败");
        return [];
      },
      applySpecChange: async () => makeResult(next),
    });

    await usePlanningStore.getState().load("/decks/demo");
    usePlanningStore.getState().updateDraft(() => next);
    const result = await usePlanningStore.getState().save("保存成功");
    const state = usePlanningStore.getState();

    expect(result?.spec).toEqual(next);
    expect(state.saved).toEqual(next);
    expect(state.draft).toBeNull();
    expect(state.saving).toBe(false);
    expect(state.error).toContain("规格已保存，但变更历史读取失败");
  });
});

describe("usePlanningStore.rollback", () => {
  it("回滚成功后刷新规格、历史与漂移状态", async () => {
    const current = makeSpec("当前风格");
    const rolledBack = makeSpec("回滚后的风格", NEW_TIME);
    const target = makeRecord({ recordId: "record-target" });
    const rollbackRecord = makeRecord({
      recordId: "record-rollback",
      origin: "rollback",
      rollbackOf: target.recordId,
    });
    const drifted = {
      slideId: "slide-1",
      pageLabel: "page-01",
      specEntryId: "entry-001",
      before: "old-fingerprint",
      after: "new-fingerprint",
    };
    const missing = {
      slideId: "slide-2",
      pageLabel: "page-02",
      specEntryId: "entry-002",
      before: "old-fingerprint-2",
      after: null,
    };
    const result = makeResult(rolledBack, {
      record: rollbackRecord,
      drifted: [drifted],
      missing: [missing],
    });
    let historyCalls = 0;
    let rollbackArgs: { path: string; recordId: string } | null = null;

    stubApi({
      readDeckSpec: async () => current,
      listSpecHistory: async () => {
        historyCalls += 1;
        return historyCalls === 1 ? [target] : [rollbackRecord, target];
      },
      rollbackSpecChange: async (path, recordId) => {
        rollbackArgs = { path, recordId };
        return result;
      },
    });

    await usePlanningStore.getState().load("/decks/demo");
    usePlanningStore.getState().updateDraft((draft) => ({
      ...draft,
      style: { description: "尚未保存的编辑" },
    }));

    const output = await usePlanningStore.getState().rollback(target.recordId);
    const state = usePlanningStore.getState();

    expect(output).toEqual(result);
    expect(rollbackArgs).toEqual({
      path: "/decks/demo",
      recordId: "record-target",
    });
    expect(state.saved).toEqual(rolledBack);
    expect(state.draft).toBeNull();
    expect(state.history).toEqual([rollbackRecord, target]);
    expect(state.lastResult?.drifted).toEqual([drifted]);
    expect(state.lastResult?.missing).toEqual([missing]);
    expect(state.saving).toBe(false);
    expect(state.error).toBeNull();
  });
});

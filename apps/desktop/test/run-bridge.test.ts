import { describe, expect, it } from "vitest";
import type { ActivityRecord, DeckRunEvent } from "../src/main/ipc/channels.js";
import {
  dispatchRunEvent,
  type RunBridgeDeps,
} from "../src/renderer/stores/run-bridge.js";

interface Recorder {
  readonly deps: RunBridgeDeps;
  readonly appended: ActivityRecord[];
  readonly refreshedSlides: string[];
  readonly deckRefreshes: number[];
  readonly activityReloads: number[];
}

function makeRecorder(
  overrides: Partial<RunBridgeDeps> = {},
  pageLabels: Record<string, string> = {},
): Recorder {
  const appended: ActivityRecord[] = [];
  const refreshedSlides: string[] = [];
  const deckRefreshes: number[] = [];
  const activityReloads: number[] = [];

  const deps: RunBridgeDeps = {
    pageLabelOf: (slideId) => pageLabels[slideId] ?? null,
    appendActivity: (record) => {
      appended.push(record);
    },
    refreshSlide: async (slideId) => {
      refreshedSlides.push(slideId);
    },
    refreshDeck: async () => {
      deckRefreshes.push(1);
    },
    reloadActivity: async () => {
      activityReloads.push(1);
    },
    ...overrides,
  };

  return { deps, appended, refreshedSlides, deckRefreshes, activityReloads };
}

const PAGE_DONE: DeckRunEvent = {
  kind: "page-done",
  slideId: "slide-1",
  gate: null,
  stoppedAt: null,
  message: "已完成",
  error: null,
};

describe("dispatchRunEvent", () => {
  it("page-done 触发该页耐久态增量刷新", async () => {
    const rec = makeRecorder({}, { "slide-1": "page-01" });

    dispatchRunEvent(PAGE_DONE, rec.deps);
    await Promise.resolve();

    expect(rec.refreshedSlides).toEqual(["slide-1"]);
    // 只刷新单页，不做 deck 全量刷新
    expect(rec.deckRefreshes).toHaveLength(0);
  });

  it("run-done 触发 deck 全量刷新与活动日志重载", async () => {
    const rec = makeRecorder();

    dispatchRunEvent(
      {
        kind: "run-done",
        summary: { total: 2, completed: 2, gated: 0, failed: 0 },
      },
      rec.deps,
    );
    await Promise.resolve();

    expect(rec.deckRefreshes).toHaveLength(1);
    expect(rec.activityReloads).toHaveLength(1);
    expect(rec.refreshedSlides).toHaveLength(0);
  });

  it("事件被转成活动记录并补上页名", () => {
    const rec = makeRecorder({}, { "slide-1": "page-01" });

    dispatchRunEvent(
      {
        kind: "stage-complete",
        slideId: "slide-1",
        stage: "ocr",
        at: "2026-07-24T10:00:00.000Z",
        durationMs: 1200,
      },
      rec.deps,
    );

    expect(rec.appended).toHaveLength(1);
    expect(rec.appended[0]?.detail).toContain("page-01");
    expect(rec.appended[0]?.durationMs).toBe(1200);
  });

  it("stage-start 不入流水（避免逐阶段刷屏）", () => {
    const rec = makeRecorder();

    dispatchRunEvent(
      {
        kind: "stage-start",
        slideId: "slide-1",
        stage: "ocr",
        at: "2026-07-24T10:00:00.000Z",
      },
      rec.deps,
    );

    expect(rec.appended).toHaveLength(0);
  });

  it("刷新失败不向上抛出，也不影响日志追加", async () => {
    const rec = makeRecorder({
      refreshSlide: async () => {
        throw new Error("IPC 断开");
      },
    });

    expect(() => dispatchRunEvent(PAGE_DONE, rec.deps)).not.toThrow();
    await Promise.resolve();
    expect(rec.appended).toHaveLength(1);
  });
});

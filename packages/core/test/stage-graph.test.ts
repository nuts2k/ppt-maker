import { describe, expect, it } from "vitest";
import {
  assertStageDependenciesCompleted,
  createInitialStageStates,
  getDownstreamStages,
  invalidateStageAndDownstream,
  isStageReusable,
} from "../src/index.js";

const HASH = "a".repeat(64);

describe("stage graph", () => {
  it("按依赖顺序返回全部下游阶段", () => {
    expect(getDownstreamStages("mask")).toEqual([
      "clean",
      "accept-clean",
      "pptx",
      "accept-pptx",
      "report",
    ]);
  });

  it("初始化时只完成 init", () => {
    const states = createInitialStageStates("init-001", HASH);
    expect(states).toHaveLength(10);
    expect(states.find((state) => state.stage === "init")).toMatchObject({
      status: "completed",
      latestAttemptId: "init-001",
      lastSuccessfulAttemptId: "init-001",
      completedInputFingerprint: HASH,
    });
    expect(states.find((state) => state.stage === "ocr")?.status).toBe(
      "pending",
    );
  });

  it("使指定阶段及已完成下游变为 stale", () => {
    const states = createInitialStageStates("init-001", HASH).map((state) =>
      state.stage === "ocr" || state.stage === "review"
        ? { ...state, status: "completed" as const }
        : state,
    );
    const invalidated = invalidateStageAndDownstream(
      states,
      "ocr",
      "源图变化",
      "2026-07-20T00:00:00.000Z",
    );

    expect(invalidated.find((state) => state.stage === "ocr")?.status).toBe(
      "stale",
    );
    expect(invalidated.find((state) => state.stage === "review")?.status).toBe(
      "stale",
    );
    expect(invalidated.find((state) => state.stage === "mask")?.status).toBe(
      "pending",
    );
  });

  it("前置阶段未完成时拒绝运行", () => {
    const states = createInitialStageStates("init-001", HASH);
    expect(() => assertStageDependenciesCompleted(states, "review")).toThrow(
      "ocr",
    );
  });

  it("仅在已完成且输入指纹一致时复用阶段", () => {
    const state = createInitialStageStates("init-001", HASH)[0];
    expect(state).toBeDefined();
    if (state === undefined) {
      return;
    }
    expect(isStageReusable(state, HASH)).toBe(true);
    expect(isStageReusable(state, "b".repeat(64))).toBe(false);
    expect(isStageReusable({ ...state, status: "stale" }, HASH)).toBe(false);
  });
});

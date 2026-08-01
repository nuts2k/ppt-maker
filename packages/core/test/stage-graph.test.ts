import { describe, expect, it } from "vitest";
import {
  assertStageDependenciesCompleted,
  createInitialStageStates,
  findBlockingStage,
  getDownstreamStages,
  invalidateStageAndDownstream,
  isStageReusable,
  type SlideStage,
  type WorkspaceStageState,
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
    expect(states).toHaveLength(11);
    expect(states.find((state) => state.stage === "init")).toMatchObject({
      status: "completed",
      latestAttemptId: "init-001",
      lastSuccessfulAttemptId: "init-001",
      completedInputFingerprint: HASH,
    });
    expect(states.find((state) => state.stage === "ocr")?.status).toBe(
      "pending",
    );
    // 不传 preCompleted 时源图确认闸门是待处理的：自动放行是来源规则的结论，
    // 由调用方传进来，阶段图自己不作此判断。
    expect(
      states.find((state) => state.stage === "accept-source")?.status,
    ).toBe("pending");
  });

  it("preCompleted 让指定阶段随 init 一并完成", () => {
    const states = createInitialStageStates("init-001", HASH, [
      {
        stage: "accept-source",
        attemptId: "accept-source-001",
        inputFingerprint: HASH,
      },
    ]);
    expect(
      states.find((state) => state.stage === "accept-source"),
    ).toMatchObject({
      status: "completed",
      latestAttemptId: "accept-source-001",
      lastSuccessfulAttemptId: "accept-source-001",
      completedInputFingerprint: HASH,
    });
    expect(states.find((state) => state.stage === "ocr")?.status).toBe(
      "pending",
    );
  });

  it("accept-source 挡在 init 与 ocr 之间", () => {
    expect(getDownstreamStages("init")).toContain("accept-source");
    const states = createInitialStageStates("init-001", HASH);
    // 未确认源图时 ocr 被依赖守卫拒绝——闸门由 core 兜底，消费方绕不过去
    expect(() => assertStageDependenciesCompleted(states, "ocr")).toThrow(
      "accept-source",
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

describe("findBlockingStage", () => {
  /** 按阶段名指定状态，其余阶段一律 completed */
  function statesWith(
    overrides: Partial<Record<SlideStage, WorkspaceStageState["status"]>>,
  ): WorkspaceStageState[] {
    return createInitialStageStates("init-001", HASH).map((state) => ({
      ...state,
      status: overrides[state.stage] ?? "completed",
    }));
  }

  it("全部完成时没有阻塞阶段", () => {
    expect(findBlockingStage(statesWith({}))).toBeNull();
  });

  it("换源后指名 ocr，而不是那个已完成的 accept-source", () => {
    // 换源的真实形态：init 与 accept-source 都 completed，ocr 及下游 stale。
    // 「最后一个已完成阶段」正好是 accept-source，错位口径会指着它报失败。
    const blocking = findBlockingStage(
      statesWith({
        ocr: "stale",
        review: "stale",
        "assist-review": "stale",
        mask: "stale",
        clean: "stale",
        "accept-clean": "stale",
        pptx: "stale",
        "accept-pptx": "stale",
        report: "stale",
      }),
    );
    expect(blocking?.stage).toBe("ocr");
    expect(blocking?.status).toBe("stale");
  });

  it("中段失效时指名失效的那个阶段", () => {
    const blocking = findBlockingStage(
      statesWith({ mask: "stale", clean: "stale" }),
    );
    expect(blocking?.stage).toBe("mask");
  });

  it("真失败优先于失效：失效只要重跑，失败得先修", () => {
    const blocking = findBlockingStage(
      statesWith({ mask: "stale", clean: "failed" }),
    );
    expect(blocking?.stage).toBe("clean");
    expect(blocking?.status).toBe("failed");
  });

  it("中断与失败同级", () => {
    expect(findBlockingStage(statesWith({ clean: "interrupted" }))?.stage).toBe(
      "clean",
    );
  });

  it("失败阶段与最后一个已完成阶段之间隔着 pending 时也能发现", () => {
    // 错位口径只看「最后一个已完成阶段的下一个」，这里看到的是 pending 的 ocr，
    // 于是整页被报成正常进行中，真正失败的 review 被漏掉。
    const blocking = findBlockingStage(
      statesWith({ ocr: "pending", review: "failed" }),
    );
    expect(blocking?.stage).toBe("review");
  });

  it("pending 与 running 不算阻塞", () => {
    expect(
      findBlockingStage(statesWith({ ocr: "running", review: "pending" })),
    ).toBeNull();
  });
});

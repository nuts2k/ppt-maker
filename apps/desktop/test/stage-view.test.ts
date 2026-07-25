import { describe, expect, it } from "vitest";
import type { SlideStageDetail } from "../src/main/ipc/channels.js";
import {
  completedStageCount,
  currentStageView,
  deriveStageViews,
  elapsedSince,
  formatElapsed,
  hasFailingStage,
  mergeStageStatuses,
} from "../src/renderer/lib/stage-view.js";
import type { LiveStageMap } from "../src/renderer/stores/run-types.js";
import { RUN_STAGE_SEQUENCE, type RunStage } from "../src/shared/stages.js";

/** 只给定若干阶段状态，其余按 pending 补齐（与 main 的 detailed 聚合口径一致） */
function makeStages(
  overrides: Partial<Record<RunStage, SlideStageDetail["status"]>>,
): { stages: readonly SlideStageDetail[] } {
  return {
    stages: RUN_STAGE_SEQUENCE.map((stage) => ({
      stage,
      status: overrides[stage] ?? "pending",
    })),
  };
}

describe("deriveStageViews", () => {
  it("输出执行序列全量 10 阶段且顺序固定", () => {
    const views = deriveStageViews(makeStages({}), undefined);
    expect(views.map((v) => v.stage)).toEqual([...RUN_STAGE_SEQUENCE]);
    expect(views.every((v) => v.status === "pending")).toBe(true);
  });

  it("会话层实时状态覆盖耐久层同名阶段", () => {
    const live: LiveStageMap = { ocr: "completed", review: "running" };
    const views = deriveStageViews(
      makeStages({ ocr: "pending", review: "pending" }),
      live,
    );
    expect(views[0]?.status).toBe("completed");
    expect(views[1]?.status).toBe("running");
  });

  it("未被会话层覆盖的阶段保留耐久层状态", () => {
    const views = deriveStageViews(makeStages({ mask: "failed" }), {
      ocr: "completed",
    });
    expect(views.find((v) => v.stage === "mask")?.status).toBe("failed");
  });

  it("耐久层出现未知状态时降级为 pending，避免样式表查不到键", () => {
    const stages = [
      { stage: "ocr", status: "weird" },
    ] as unknown as readonly SlideStageDetail[];
    const views = deriveStageViews({ stages }, undefined);
    expect(views[0]?.status).toBe("pending");
  });

  it("附带中文阶段名，卡片与轨道无需再查表", () => {
    const views = deriveStageViews(makeStages({}), undefined);
    expect(views[0]?.label).toBe("文字识别");
  });
});

describe("mergeStageStatuses", () => {
  it("产出扁平 map，键为阶段名", () => {
    const merged = mergeStageStatuses(makeStages({ ocr: "completed" }), {
      review: "running",
    });
    expect(merged.ocr).toBe("completed");
    expect(merged.review).toBe("running");
    expect(Object.keys(merged)).toHaveLength(RUN_STAGE_SEQUENCE.length);
  });
});

describe("currentStageView", () => {
  it("优先取正在执行的阶段", () => {
    const views = deriveStageViews(makeStages({ ocr: "completed" }), {
      review: "running",
    });
    expect(currentStageView(views)?.stage).toBe("review");
  });

  it("无执行中阶段时取第一个未完成阶段（断点续跑起点）", () => {
    const views = deriveStageViews(
      makeStages({ ocr: "completed", review: "completed" }),
      undefined,
    );
    expect(currentStageView(views)?.stage).toBe("assist-review");
  });

  it("失败阶段本身即第一个未完成阶段，故被选为当前阶段", () => {
    const views = deriveStageViews(
      makeStages({ ocr: "completed", review: "failed" }),
      undefined,
    );
    expect(currentStageView(views)?.stage).toBe("review");
  });

  it("全部完成时返回 null", () => {
    const all = Object.fromEntries(
      RUN_STAGE_SEQUENCE.map((stage) => [stage, "completed" as const]),
    ) as Partial<Record<RunStage, SlideStageDetail["status"]>>;
    expect(currentStageView(deriveStageViews(makeStages(all), undefined))).toBe(
      null,
    );
  });
});

describe("completedStageCount / hasFailingStage", () => {
  it("统计已完成阶段数", () => {
    const views = deriveStageViews(
      makeStages({ ocr: "completed", review: "completed", mask: "failed" }),
      undefined,
    );
    expect(completedStageCount(views)).toBe(2);
  });

  it("failed / interrupted / stale 均视为需处理的失败态", () => {
    for (const status of ["failed", "interrupted", "stale"] as const) {
      const views = deriveStageViews(makeStages({ mask: status }), undefined);
      expect(hasFailingStage(views)).toBe(true);
    }
  });

  it("仅 pending / running / completed 时不算失败", () => {
    const views = deriveStageViews(makeStages({ ocr: "completed" }), {
      review: "running",
    });
    expect(hasFailingStage(views)).toBe(false);
  });
});

describe("formatElapsed / elapsedSince", () => {
  it("不足一分钟只显示秒，且向下取整", () => {
    expect(formatElapsed(0)).toBe("0s");
    expect(formatElapsed(1999)).toBe("1s");
    expect(formatElapsed(59_999)).toBe("59s");
  });

  it("超过一分钟显示分秒", () => {
    expect(formatElapsed(60_000)).toBe("1m0s");
    expect(formatElapsed(80_000)).toBe("1m20s");
  });

  it("负值归零，避免时钟回拨时出现负计时", () => {
    expect(formatElapsed(-5000)).toBe("0s");
  });

  it("elapsedSince 在无进行中阶段时返回 null", () => {
    expect(elapsedSince(null, 1000)).toBe(null);
    expect(elapsedSince(1000, 43_000)).toBe("42s");
  });
});

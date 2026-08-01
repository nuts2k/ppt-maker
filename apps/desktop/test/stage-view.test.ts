import { describe, expect, it } from "vitest";
import type { SlideStageDetail } from "../src/main/ipc/channels.js";
import {
  blockingStageView,
  completedStageCount,
  currentStageView,
  deriveStageViews,
  elapsedSince,
  formatElapsed,
  hasFailingStage,
} from "../src/renderer/lib/stage-view.js";
import type { LiveStageMap } from "../src/renderer/stores/run-types.js";
import { RUN_STAGE_SEQUENCE, type RunStage } from "../src/shared/stages.js";

/**
 * 只给定若干阶段状态，其余按 pending 补齐（与 main 的 detailed 聚合口径一致）。
 *
 * `accept-source` 默认已完成：这些用例描述的是 imported 页，其源图确认在建立工作区时
 * 自动放行。generated 页由 overrides 显式置 pending。
 */
function makeStages(
  overrides: Partial<Record<RunStage, SlideStageDetail["status"]>>,
): { stages: readonly SlideStageDetail[] } {
  return {
    stages: RUN_STAGE_SEQUENCE.map((stage) => ({
      stage,
      status:
        overrides[stage] ??
        (stage === "accept-source" ? "completed" : "pending"),
    })),
  };
}

function viewOf<T extends { readonly stage: string }>(
  views: readonly T[],
  stage: RunStage,
): T | undefined {
  return views.find((view) => view.stage === stage);
}

describe("deriveStageViews", () => {
  it("输出执行序列全量 10 阶段且顺序固定", () => {
    const views = deriveStageViews(
      makeStages({ "accept-source": "pending" }),
      undefined,
    );
    expect(views.map((v) => v.stage)).toEqual([...RUN_STAGE_SEQUENCE]);
    expect(views.every((v) => v.status === "pending")).toBe(true);
  });

  it("会话层实时状态覆盖耐久层同名阶段", () => {
    const live: LiveStageMap = { ocr: "completed", review: "running" };
    const views = deriveStageViews(
      makeStages({ ocr: "pending", review: "pending" }),
      live,
    );
    expect(viewOf(views, "ocr")?.status).toBe("completed");
    expect(viewOf(views, "review")?.status).toBe("running");
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
    expect(viewOf(views, "ocr")?.label).toBe("文字识别");
    expect(viewOf(views, "accept-source")?.label).toBe("确认源图");
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

  it("生成图未确认源图时当前阶段是确认源图", () => {
    const views = deriveStageViews(
      makeStages({ "accept-source": "pending" }),
      undefined,
    );
    expect(currentStageView(views)?.stage).toBe("accept-source");
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
    // 3 = ocr + review + 自动放行的 accept-source
    expect(completedStageCount(views)).toBe(3);
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

  /*
   * 卡片错误条要指名出问题的那个阶段。用 currentStageView 会指到它前面的 pending 上，
   * 2026-07-29 阶段 E 走查实测：page-02 的 mask 及下游已失效，卡片却写「阶段
   * 「复核校验」执行失败」——阶段名与状态词双错。
   */
  it("blockingStageView 取失效的那个阶段，而不是它前面的 pending", () => {
    const views = deriveStageViews(
      makeStages({
        ocr: "completed",
        review: "completed",
        "assist-review": "completed",
        mask: "stale",
        clean: "stale",
      }),
      undefined,
    );
    expect(currentStageView(views)?.stage).toBe("validate-review");
    expect(blockingStageView(views)?.stage).toBe("mask");
    expect(blockingStageView(views)?.status).toBe("stale");
  });

  it("blockingStageView 让真失败排在失效前面", () => {
    const views = deriveStageViews(
      makeStages({ ocr: "stale", mask: "failed" }),
      undefined,
    );
    expect(blockingStageView(views)?.stage).toBe("mask");
  });

  it("blockingStageView 无失败无失效时返回 null", () => {
    const views = deriveStageViews(makeStages({ ocr: "completed" }), {
      review: "running",
    });
    expect(blockingStageView(views)).toBe(null);
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

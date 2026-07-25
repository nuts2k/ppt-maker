import { describe, expect, it } from "vitest";
import type {
  SlideDetail,
  SlideLastError,
  SlideStageDetail,
} from "../src/main/ipc/channels.js";
import type { SessionRunResult } from "../src/renderer/stores/run-types.js";
import { deriveTodoQueue } from "../src/renderer/stores/todo-queue.js";
import { RUN_STAGE_SEQUENCE, type RunStage } from "../src/shared/stages.js";

interface SlideFixture {
  readonly pageLabel: string;
  /** deckStatus 给出的当前阶段状态，默认 completed */
  readonly stageStatus?: string;
  readonly currentStage?: string;
  readonly removed?: boolean;
  /** 标记为 completed 的执行阶段，其余为 pending */
  readonly completed?: readonly RunStage[];
  readonly lastError?: SlideLastError;
}

function makeSlide(fixture: SlideFixture): SlideDetail {
  const completed = new Set<string>(fixture.completed ?? []);
  const stages: SlideStageDetail[] = RUN_STAGE_SEQUENCE.map((stage) => ({
    stage,
    status: completed.has(stage) ? "completed" : "pending",
  }));
  return {
    slideId: `slide-${fixture.pageLabel}`,
    workspacePath: `slides/${fixture.pageLabel}`,
    absWorkspacePath: `/decks/demo/slides/${fixture.pageLabel}`,
    pageLabel: fixture.pageLabel,
    sourceImageName: `${fixture.pageLabel}.png`,
    currentStage: fixture.currentStage ?? "report",
    stageStatus: fixture.stageStatus ?? "completed",
    removed: fixture.removed ?? false,
    stages,
    lastError: fixture.lastError ?? null,
    stageDurations: {},
  };
}

function sessionResult(slideId: string, gate: string | null): SessionRunResult {
  return {
    slideId,
    gate,
    stoppedAt: gate === "validation-failed" ? "validate-review" : null,
    message: "停在复核校验",
    error: null,
  };
}

/** 跑完全流程的页（所有执行阶段 completed） */
const ALL_DONE = RUN_STAGE_SEQUENCE;
/** 跑到 clean 完成、尚未验收底图 */
const THROUGH_CLEAN: RunStage[] = [
  "ocr",
  "review",
  "assist-review",
  "validate-review",
  "mask",
  "clean",
];
/** 跑到 pptx 完成、尚未验收 PPTX */
const THROUGH_PPTX: RunStage[] = [...THROUGH_CLEAN, "accept-clean", "pptx"];

describe("deriveTodoQueue 四组判定", () => {
  it("耐久层 failed 归入失败组，原因取 lastError 的 code + message", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "mask",
          stageStatus: "failed",
          completed: ["ocr", "review", "assist-review"],
          lastError: {
            stage: "mask",
            code: "MASK_FAILED",
            message: "遮罩生成失败",
            at: "2026-07-01T00:00:00.000Z",
          },
        }),
      ],
      {},
    );

    expect(queue.total).toBe(1);
    expect(queue.groups).toHaveLength(1);
    expect(queue.groups[0]?.group).toBe("failed");
    expect(queue.groups[0]?.label).toBe("失败/需重跑");
    expect(queue.groups[0]?.items[0]).toMatchObject({
      slideId: "slide-page-01",
      pageLabel: "page-01",
      group: "failed",
      reason: "MASK_FAILED: 遮罩生成失败",
      stage: "mask",
    });
  });

  it("interrupted 与 stale 同样归入失败组，无 lastError 时给通用文案", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "clean",
          stageStatus: "interrupted",
        }),
        makeSlide({
          pageLabel: "page-02",
          currentStage: "pptx",
          stageStatus: "stale",
        }),
      ],
      {},
    );

    expect(queue.total).toBe(2);
    expect(queue.groups[0]?.items.map((item) => item.reason)).toEqual([
      "阶段「生成干净底图」执行中断",
      "阶段「生成 PPTX」上游已变更，需重跑",
    ]);
  });

  it("会话层 validation-failed 归入需复核校验组", () => {
    const slide = makeSlide({
      pageLabel: "page-01",
      currentStage: "assist-review",
      completed: ["ocr", "review", "assist-review"],
    });
    const queue = deriveTodoQueue([slide], {
      [slide.slideId]: sessionResult(slide.slideId, "validation-failed"),
    });

    expect(queue.total).toBe(1);
    expect(queue.groups[0]?.group).toBe("revalidate");
    expect(queue.groups[0]?.label).toBe("需复核校验");
    expect(queue.groups[0]?.items[0]?.stage).toBe("validate-review");
  });

  it("其它 gate（如 manual）不进入需复核校验组", () => {
    const slide = makeSlide({
      pageLabel: "page-01",
      currentStage: "clean",
      completed: THROUGH_CLEAN,
    });
    const queue = deriveTodoQueue([slide], {
      [slide.slideId]: sessionResult(slide.slideId, "manual"),
    });

    expect(queue.groups[0]?.group).toBe("accept-clean");
  });

  it("clean 完成且 accept-clean 未完成 → 待验收底图组", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "clean",
          completed: THROUGH_CLEAN,
        }),
      ],
      {},
    );

    expect(queue.groups[0]?.group).toBe("accept-clean");
    expect(queue.groups[0]?.label).toBe("待验收底图");
    expect(queue.groups[0]?.items[0]?.stage).toBe("accept-clean");
  });

  it("pptx 完成且 accept-pptx 未完成 → 待验收 PPTX 组", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "pptx",
          completed: THROUGH_PPTX,
        }),
      ],
      {},
    );

    expect(queue.groups[0]?.group).toBe("accept-pptx");
    expect(queue.groups[0]?.label).toBe("待验收 PPTX");
    expect(queue.groups[0]?.items[0]?.stage).toBe("accept-pptx");
  });
});

describe("deriveTodoQueue 优先级与去重", () => {
  it("同时待验收 clean 与 pptx 时只产出 accept-pptx 一项", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "pptx",
          // accept-clean 未完成，但 pptx 已产出：取更接近终点的 accept-pptx
          completed: [...THROUGH_CLEAN, "pptx"],
        }),
      ],
      {},
    );

    expect(queue.total).toBe(1);
    expect(queue.groups).toHaveLength(1);
    expect(queue.groups[0]?.group).toBe("accept-pptx");
  });

  it("失败态优先于验收态与会话层 validation-failed", () => {
    const slide = makeSlide({
      pageLabel: "page-01",
      currentStage: "pptx",
      stageStatus: "failed",
      completed: THROUGH_PPTX,
    });
    const queue = deriveTodoQueue([slide], {
      [slide.slideId]: sessionResult(slide.slideId, "validation-failed"),
    });

    expect(queue.total).toBe(1);
    expect(queue.groups[0]?.group).toBe("failed");
  });

  it("validation-failed 优先于验收组", () => {
    const slide = makeSlide({
      pageLabel: "page-01",
      currentStage: "clean",
      completed: THROUGH_CLEAN,
    });
    const queue = deriveTodoQueue([slide], {
      [slide.slideId]: sessionResult(slide.slideId, "validation-failed"),
    });

    expect(queue.groups[0]?.group).toBe("revalidate");
  });

  it("组顺序固定为 failed → revalidate → accept-pptx → accept-clean", () => {
    const revalidating = makeSlide({
      pageLabel: "page-02",
      currentStage: "assist-review",
      completed: ["ocr", "review", "assist-review"],
    });
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-04",
          currentStage: "clean",
          completed: THROUGH_CLEAN,
        }),
        makeSlide({
          pageLabel: "page-03",
          currentStage: "pptx",
          completed: THROUGH_PPTX,
        }),
        revalidating,
        makeSlide({
          pageLabel: "page-01",
          currentStage: "ocr",
          stageStatus: "failed",
        }),
      ],
      {
        [revalidating.slideId]: sessionResult(
          revalidating.slideId,
          "validation-failed",
        ),
      },
    );

    expect(queue.groups.map((group) => group.group)).toEqual([
      "failed",
      "revalidate",
      "accept-pptx",
      "accept-clean",
    ]);
    expect(queue.total).toBe(4);
  });
});

describe("deriveTodoQueue 过滤与排序", () => {
  it("已移除的页不进入队列", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-01",
          currentStage: "mask",
          stageStatus: "failed",
          removed: true,
        }),
        makeSlide({
          pageLabel: "page-02",
          currentStage: "clean",
          completed: THROUGH_CLEAN,
          removed: true,
        }),
      ],
      {},
    );

    expect(queue.total).toBe(0);
    expect(queue.groups).toEqual([]);
  });

  it("全部完成时返回空队列", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({ pageLabel: "page-01", completed: ALL_DONE }),
        makeSlide({ pageLabel: "page-02", completed: ALL_DONE }),
      ],
      {},
    );

    expect(queue.total).toBe(0);
    expect(queue.groups).toHaveLength(0);
  });

  it("组内按 pageLabel 数字自然序排列（page-2 在 page-10 之前）", () => {
    const queue = deriveTodoQueue(
      [
        makeSlide({
          pageLabel: "page-10",
          currentStage: "clean",
          completed: THROUGH_CLEAN,
        }),
        makeSlide({
          pageLabel: "page-2",
          currentStage: "clean",
          completed: THROUGH_CLEAN,
        }),
        makeSlide({
          pageLabel: "page-1",
          currentStage: "clean",
          completed: THROUGH_CLEAN,
        }),
      ],
      {},
    );

    expect(queue.groups[0]?.items.map((item) => item.pageLabel)).toEqual([
      "page-1",
      "page-2",
      "page-10",
    ]);
  });
});

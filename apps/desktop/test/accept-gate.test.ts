import { describe, expect, it } from "vitest";
import type {
  SlideDetail,
  SlideStageDetail,
} from "../src/main/ipc/channels.js";
import {
  awaitingFinalConfirm,
  deriveFinalGate,
  stageStatusOf,
} from "../src/renderer/lib/accept-gate.js";
import type { SessionRunResult } from "../src/renderer/stores/run-types.js";
import { RUN_STAGE_SEQUENCE, type RunStage } from "../src/shared/stages.js";

/** 与 todo-queue 测试同一 fixture 口径：列出的阶段为 completed，其余 pending */
function makeSlide(
  completed: readonly RunStage[],
): Pick<SlideDetail, "stages"> {
  const done = new Set<string>(completed);
  const stages: SlideStageDetail[] = RUN_STAGE_SEQUENCE.map((stage) => ({
    stage,
    status: done.has(stage) ? "completed" : "pending",
  }));
  return { stages };
}

function session(
  gate: string | null,
  stoppedAt: string | null,
): SessionRunResult {
  return {
    slideId: "slide-1",
    gate,
    stoppedAt,
    message: "停在人工闸门",
    error: null,
  };
}

/** 收敛后的执行序列：accept-clean 不再单独停顿，clean 之后直通 pptx */
const THROUGH_CLEAN: RunStage[] = [
  "ocr",
  "review",
  "assist-review",
  "validate-review",
  "mask",
  "clean",
];
const THROUGH_PPTX: RunStage[] = [...THROUGH_CLEAN, "pptx"];

describe("stageStatusOf", () => {
  it("取出指定阶段的耐久状态，未列出的阶段为 pending", () => {
    const slide = makeSlide(THROUGH_CLEAN);
    expect(stageStatusOf(slide, "clean")).toBe("completed");
    expect(stageStatusOf(slide, "pptx")).toBe("pending");
  });
});

describe("awaitingFinalConfirm（耐久层判据）", () => {
  it("pptx 完成且 accept-pptx 未完成时成立", () => {
    expect(awaitingFinalConfirm(makeSlide(THROUGH_PPTX))).toBe(true);
  });

  it("最终确认已完成后不再成立", () => {
    expect(
      awaitingFinalConfirm(makeSlide([...THROUGH_PPTX, "accept-pptx"])),
    ).toBe(false);
  });

  it("pptx 未产出时不成立（clean 完成不再构成闸门）", () => {
    expect(awaitingFinalConfirm(makeSlide(THROUGH_CLEAN))).toBe(false);
    expect(awaitingFinalConfirm(makeSlide(["ocr", "review"]))).toBe(false);
  });
});

describe("deriveFinalGate 会话层优先", () => {
  it("manual 闸门即最终确认，无需等耐久层写入", () => {
    // pptx 阶段状态尚未刷新到 renderer，会话层仍应立刻给出闸门
    const gate = deriveFinalGate(
      makeSlide(THROUGH_CLEAN),
      session("manual", "accept-pptx"),
    );
    expect(gate).toEqual({ source: "session" });
  });

  it("其它 gate 不构成最终确认闸门", () => {
    expect(
      deriveFinalGate(
        makeSlide(["ocr", "review", "assist-review"]),
        session("validation-failed", "validate-review"),
      ),
    ).toBeNull();
    expect(
      deriveFinalGate(
        makeSlide(["ocr", "review"]),
        session("human-edit", "review"),
      ),
    ).toBeNull();
  });
});

describe("deriveFinalGate 耐久层（重启后仍可确认）", () => {
  it("无会话结果时由 manifest 推导", () => {
    expect(deriveFinalGate(makeSlide(THROUGH_PPTX), undefined)).toEqual({
      source: "durable",
    });
  });

  it("全部阶段完成后无闸门", () => {
    expect(
      deriveFinalGate(makeSlide(RUN_STAGE_SEQUENCE), undefined),
    ).toBeNull();
  });

  it("尚未产出 PPTX 时无闸门", () => {
    expect(deriveFinalGate(makeSlide(THROUGH_CLEAN), undefined)).toBeNull();
  });
});

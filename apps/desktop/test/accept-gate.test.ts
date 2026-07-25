import { describe, expect, it } from "vitest";
import type {
  SlideDetail,
  SlideStageDetail,
} from "../src/main/ipc/channels.js";
import {
  awaitingAcceptance,
  deriveAcceptGate,
  isAcceptStage,
  REJECT_RERUN_STAGES,
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

const THROUGH_CLEAN: RunStage[] = [
  "ocr",
  "review",
  "assist-review",
  "validate-review",
  "mask",
  "clean",
];
const THROUGH_PPTX: RunStage[] = [...THROUGH_CLEAN, "accept-clean", "pptx"];

describe("isAcceptStage", () => {
  it("只认两个人工验收阶段", () => {
    expect(isAcceptStage("accept-clean")).toBe(true);
    expect(isAcceptStage("accept-pptx")).toBe(true);
    expect(isAcceptStage("clean")).toBe(false);
    expect(isAcceptStage(null)).toBe(false);
    expect(isAcceptStage(undefined)).toBe(false);
  });
});

describe("awaitingAcceptance（耐久层判据）", () => {
  it("产出阶段完成且验收阶段未完成时成立", () => {
    const slide = makeSlide(THROUGH_CLEAN);
    expect(awaitingAcceptance(slide, "accept-clean")).toBe(true);
    expect(awaitingAcceptance(slide, "accept-pptx")).toBe(false);
  });

  it("验收阶段已完成后不再成立", () => {
    const slide = makeSlide([...THROUGH_CLEAN, "accept-clean"]);
    expect(awaitingAcceptance(slide, "accept-clean")).toBe(false);
  });

  it("产出阶段未完成时不成立", () => {
    const slide = makeSlide(["ocr", "review"]);
    expect(awaitingAcceptance(slide, "accept-clean")).toBe(false);
  });
});

describe("deriveAcceptGate 会话层优先", () => {
  it("manual 闸门直接采用 stoppedAt 指定的验收阶段", () => {
    const gate = deriveAcceptGate(
      makeSlide(THROUGH_CLEAN),
      session("manual", "accept-clean"),
    );
    expect(gate).toEqual({ stage: "accept-clean", source: "session" });
  });

  it("manual 但 stoppedAt 非验收阶段时回落到耐久层判定", () => {
    const gate = deriveAcceptGate(
      makeSlide(THROUGH_CLEAN),
      session("manual", "mask"),
    );
    expect(gate).toEqual({ stage: "accept-clean", source: "durable" });
  });

  it("validation-failed 等其它 gate 不构成验收闸门", () => {
    const gate = deriveAcceptGate(
      makeSlide(["ocr", "review", "assist-review"]),
      session("validation-failed", "validate-review"),
    );
    expect(gate).toBeNull();
  });
});

describe("deriveAcceptGate 耐久层（重启后仍可验收）", () => {
  it("无会话结果时由 manifest 推导出待验收底图", () => {
    const gate = deriveAcceptGate(makeSlide(THROUGH_CLEAN), undefined);
    expect(gate).toEqual({ stage: "accept-clean", source: "durable" });
  });

  it("pptx 优先于 clean（越接近终点越先推进）", () => {
    // accept-clean 未完成但 pptx 已产出：与 todo-queue 的组优先级一致
    const gate = deriveAcceptGate(
      makeSlide([...THROUGH_CLEAN, "pptx"]),
      undefined,
    );
    expect(gate).toEqual({ stage: "accept-pptx", source: "durable" });
  });

  it("待验收 PPTX", () => {
    const gate = deriveAcceptGate(makeSlide(THROUGH_PPTX), undefined);
    expect(gate).toEqual({ stage: "accept-pptx", source: "durable" });
  });

  it("全部阶段完成后无闸门", () => {
    expect(
      deriveAcceptGate(makeSlide(RUN_STAGE_SEQUENCE), undefined),
    ).toBeNull();
  });

  it("尚未产出任何可验收产物时无闸门", () => {
    expect(
      deriveAcceptGate(makeSlide(["ocr", "review"]), undefined),
    ).toBeNull();
  });
});

describe("REJECT_RERUN_STAGES", () => {
  it("拒绝底图可从 mask 或 clean 重跑，拒绝 PPTX 只重跑 pptx", () => {
    expect(REJECT_RERUN_STAGES["accept-clean"]).toEqual(["mask", "clean"]);
    expect(REJECT_RERUN_STAGES["accept-pptx"]).toEqual(["pptx"]);
  });
});

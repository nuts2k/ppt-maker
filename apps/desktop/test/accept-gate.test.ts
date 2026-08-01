import { describe, expect, it } from "vitest";
import type {
  SlideDetail,
  SlideStageDetail,
} from "../src/main/ipc/channels.js";
import {
  awaitingFinalConfirm,
  awaitingSourceConfirm,
  deriveFinalGate,
  finalAccepted,
  pptxReady,
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

/*
 * 源图确认（M5 D6）：链路最前的人工点，判据只看耐久层的 accept-source 阶段状态。
 * 单页工具栏的「确认源图」入口与待办队列的「待确认源图」组共用这一个函数——
 * 两处各写一份 filter 必然漂移，而这里漂移的后果是「界面说要确认、队列里没有」。
 */
describe("awaitingSourceConfirm（耐久层判据）", () => {
  it("accept-source 未完成时成立（生成图停在这里）", () => {
    expect(awaitingSourceConfirm(makeSlide([]))).toBe(true);
  });

  it("自动放行的导入页不成立", () => {
    expect(awaitingSourceConfirm(makeSlide(["accept-source"]))).toBe(false);
    expect(awaitingSourceConfirm(makeSlide(RUN_STAGE_SEQUENCE))).toBe(false);
  });

  /** 已移除 / manifest 读不出来的页在 deck.ts 里拿到的是 stages: []，状态未知 */
  it("阶段整个缺失时不成立（未知 ≠ 欠一次确认）", () => {
    expect(awaitingSourceConfirm({ stages: [] })).toBe(false);
  });

  it("被显式失效为 stale 时仍成立（不是只认 pending）", () => {
    const slide = {
      stages: RUN_STAGE_SEQUENCE.map((stage) => ({
        stage,
        status:
          stage === "accept-source"
            ? ("stale" as const)
            : ("completed" as const),
      })),
    };
    expect(awaitingSourceConfirm(slide)).toBe(true);
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

describe("pptxReady / finalAccepted（页面可达与已验收各自的原子判据）", () => {
  it("pptxReady 不看 accept 状态：已验收页仍然可达", () => {
    expect(pptxReady(makeSlide(THROUGH_PPTX))).toBe(true);
    expect(pptxReady(makeSlide([...THROUGH_PPTX, "accept-pptx"]))).toBe(true);
    expect(pptxReady(makeSlide(THROUGH_CLEAN))).toBe(false);
  });

  it("finalAccepted 只看 accept-pptx", () => {
    expect(finalAccepted(makeSlide(THROUGH_PPTX))).toBe(false);
    expect(finalAccepted(makeSlide([...THROUGH_PPTX, "accept-pptx"]))).toBe(
      true,
    );
  });

  it("待办口径恒等于「可达且未验收」，两处不得各写一份 filter", () => {
    for (const completed of [
      [],
      THROUGH_CLEAN,
      THROUGH_PPTX,
      [...THROUGH_PPTX, "accept-pptx"] as RunStage[],
      RUN_STAGE_SEQUENCE,
    ]) {
      const slide = makeSlide(completed as readonly RunStage[]);
      expect(awaitingFinalConfirm(slide)).toBe(
        pptxReady(slide) && !finalAccepted(slide),
      );
    }
  });
});

describe("deriveFinalGate 会话层优先", () => {
  it("manual 闸门即最终确认，无需等耐久层写入", () => {
    // pptx 阶段状态尚未刷新到 renderer，会话层仍应立刻给出闸门
    const gate = deriveFinalGate(
      makeSlide(THROUGH_CLEAN),
      session("manual", "accept-pptx"),
    );
    expect(gate).toEqual({ source: "session", accepted: false });
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
      accepted: false,
    });
  });

  it("尚未产出 PPTX 时无闸门", () => {
    expect(deriveFinalGate(makeSlide(THROUGH_CLEAN), undefined)).toBeNull();
  });
});

/*
 * 2026-07-30 R2：验收一写入，最终确认页连同页内的「重做底图」一起消失，此后界面上
 * 没有任何办法重做底图（改文字不触发 mask 失效，改了再改回去 decideInvalidation
 * 直接返回 null），只剩 CLI `slide run --from clean`。放宽为「PPTX 产出即可达」。
 */
describe("deriveFinalGate 对已验收页仍然可达（R2）", () => {
  it("accept-pptx 完成后闸门不消失，只是标记为已验收", () => {
    expect(
      deriveFinalGate(makeSlide([...THROUGH_PPTX, "accept-pptx"]), undefined),
    ).toEqual({ source: "durable", accepted: true });
  });

  it("全部阶段完成后仍可达（report 已跑完的页同样要能重做底图）", () => {
    expect(deriveFinalGate(makeSlide(RUN_STAGE_SEQUENCE), undefined)).toEqual({
      source: "durable",
      accepted: true,
    });
  });

  it("accepted 一律取耐久层，会话层不表达验收有没有落盘", () => {
    expect(
      deriveFinalGate(
        makeSlide([...THROUGH_PPTX, "accept-pptx"]),
        session("manual", "accept-pptx"),
      ),
    ).toEqual({ source: "session", accepted: true });
  });
});

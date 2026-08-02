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
  regenerableSource,
  sourceAccepted,
  sourceReviewReachable,
  sourceStageKnown,
  stageStatusOf,
} from "../src/renderer/lib/accept-gate.js";
import type { SessionRunResult } from "../src/renderer/stores/run-types.js";
import { RUN_STAGE_SEQUENCE, type RunStage } from "../src/shared/stages.js";

/**
 * 与 todo-queue 测试同一 fixture 口径：列出的阶段为 completed，其余 pending。
 *
 * `regenerableSpecEntryId` 默认按来源给（生成页必然有一条），但**可以显式覆盖**——
 * 「换源成 imported 之后仍能换回生成」正是这两者分离的那一格，不留这个口子就测不到。
 */
function makeSlide(
  completed: readonly RunStage[],
  sourceKind: SlideDetail["sourceKind"] = "imported",
  regenerableSpecEntryId: string | null = sourceKind === "generated"
    ? "spec-01"
    : null,
): Pick<SlideDetail, "stages" | "sourceKind" | "regenerableSpecEntryId"> {
  const done = new Set<string>(completed);
  const stages: SlideStageDetail[] = RUN_STAGE_SEQUENCE.map((stage) => ({
    stage,
    status: done.has(stage) ? "completed" : "pending",
  }));
  return { stages, sourceKind, regenerableSpecEntryId };
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

/*
 * 可达 ≠ 待办（RK-E）。沿用 `awaitingSourceConfirm` 当审片视图的入口判据，会让
 * 用户确认完这一页就再也进不去，而「重新生成」「换源」恰恰长在那个视图里——
 * 与 M4 那次「验收后最终确认页整个消失、重做底图入口随之没了」是同型错误。
 */
describe("sourceReviewReachable / sourceAccepted（审片可达与已确认）", () => {
  it("已确认的生成页仍然可达（U10）", () => {
    const slide = makeSlide(["accept-source"], "generated");
    expect(sourceAccepted(slide)).toBe(true);
    expect(awaitingSourceConfirm(slide)).toBe(false);
    expect(sourceReviewReachable(slide), "已确认页必须还进得去").toBe(true);
  });

  it("未确认的生成页可达", () => {
    expect(sourceReviewReachable(makeSlide([], "generated"))).toBe(true);
  });

  it("自动放行的导入 / 抽取页不可达（没有源图可审）", () => {
    expect(
      sourceReviewReachable(makeSlide(["accept-source"], "imported")),
    ).toBe(false);
    expect(
      sourceReviewReachable(makeSlide(RUN_STAGE_SEQUENCE, "extracted")),
    ).toBe(false);
  });

  /** 非生成页被人工失效掉 accept-source 后同样停在这道门，界面得给它去处 */
  it("非生成页正欠一次确认时可达", () => {
    expect(sourceReviewReachable(makeSlide([], "imported"))).toBe(true);
  });

  it("阶段状态未知（已移除 / 读不出的页）一律不可达", () => {
    const unknown = {
      stages: [],
      sourceKind: "generated",
      regenerableSpecEntryId: "spec-01",
    } as const;
    expect(sourceStageKnown(unknown)).toBe(false);
    expect(sourceReviewReachable(unknown)).toBe(false);
    expect(awaitingSourceConfirm(unknown)).toBe(false);
  });

  it("regenerableSource 只看有没有规格条目，不看当前来源", () => {
    expect(regenerableSource({ regenerableSpecEntryId: "spec-01" })).toBe(true);
    expect(regenerableSource({ regenerableSpecEntryId: null })).toBe(false);
  });

  /*
   * A11 正向的界面侧一半：一页从 `generated` 换成 `imported` 之后自动放行，
   * 若按当前来源判可达性，它就再也进不去审片视图——而「重新生成」正长在那里，
   * 于是这一页永远回不到生成来源。判据必须落在「有没有规格条目可用」上。
   */
  it("换源成 imported 但历史上生成过的页仍可达（能换回生成来源）", () => {
    const slide = makeSlide(["accept-source"], "imported", "spec-01");
    expect(sourceAccepted(slide), "换成导入后自动放行").toBe(true);
    expect(awaitingSourceConfirm(slide), "自动放行不该再列为待办").toBe(false);
    expect(sourceReviewReachable(slide), "但重出图的入口必须还在").toBe(true);
  });

  /**
   * 合成关系上锁：两个口径必须由同一组原子合成，任何一方不得就地再写一份 filter。
   * 遍历「阶段组合 × 三种来源」，恒等式一处不成立就红。
   */
  it("待办口径恒等于「可达且未确认」", () => {
    const combos: readonly (readonly RunStage[])[] = [
      [],
      ["accept-source"],
      ["accept-source", "ocr"],
      ["ocr", "review"],
      RUN_STAGE_SEQUENCE,
    ];
    for (const completed of combos) {
      for (const kind of ["imported", "extracted", "generated"] as const) {
        // 两档规格条目都要跑：换过源的页正是「来源不是 generated 但有条目」那一格
        for (const entry of [null, "spec-01"]) {
          const slide = makeSlide(completed, kind, entry);
          expect(
            awaitingSourceConfirm(slide),
            `${kind} / ${entry ?? "无条目"} / ${completed.join(",")}`,
          ).toBe(sourceReviewReachable(slide) && !sourceAccepted(slide));
        }
      }
    }
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

/**
 * 源图审片视图的序列与导航（R7 / U7–U10）。
 *
 * 本项目没有 DOM 测试库，所以这里测的是纯函数产物：序列取自哪、下一张是哪张、
 * 已确认几张。要守的是这些**规则**，不是某个像素长什么样。
 */

import { describe, expect, it } from "vitest";
import type {
  SlideDetail,
  SlideStageDetail,
} from "../src/main/ipc/channels.js";
import {
  firstPendingIndex,
  indexOfSlide,
  nextPendingIndex,
  resolveEntryIndex,
  type SourceReviewEntry,
  selectSourceReviewSlides,
  sourceReviewProgress,
  stepIndex,
} from "../src/renderer/lib/source-review-nav.js";
import { deriveTodoQueue } from "../src/renderer/stores/todo-queue.js";
import { RUN_STAGE_SEQUENCE, type RunStage } from "../src/shared/stages.js";

interface SlideFixture {
  readonly pageLabel: string;
  readonly sourceKind?: SlideDetail["sourceKind"];
  /** 标记为 completed 的阶段，其余 pending */
  readonly completed?: readonly RunStage[];
  readonly removed?: boolean;
  readonly stageStatus?: string;
}

function makeSlide(fixture: SlideFixture): SlideDetail {
  const done = new Set<string>(fixture.completed ?? []);
  const stages: SlideStageDetail[] = RUN_STAGE_SEQUENCE.map((stage) => ({
    stage,
    status: done.has(stage) ? "completed" : "pending",
  }));
  const sourceKind = fixture.sourceKind ?? "generated";
  return {
    slideId: `slide-${fixture.pageLabel}`,
    workspacePath: `slides/${fixture.pageLabel}`,
    absWorkspacePath: `/decks/demo/slides/${fixture.pageLabel}`,
    pageLabel: fixture.pageLabel,
    sourceImageName: `${fixture.pageLabel}.png`,
    currentStage: "init",
    stageStatus: fixture.stageStatus ?? "completed",
    removed: fixture.removed ?? false,
    sourceKind,
    specEntryId:
      sourceKind === "generated" ? `entry-${fixture.pageLabel}` : null,
    specDrift: null,
    stages,
    lastError: null,
    stageDurations: {},
    pendingTextReview: 0,
  };
}

/** 已确认（accept-source completed，其余仍 pending） */
const ACCEPTED: readonly RunStage[] = ["accept-source"];
/** 跑完全程的页 */
const ALL_DONE = RUN_STAGE_SEQUENCE;

function build(slides: readonly SlideDetail[]): readonly SourceReviewEntry[] {
  return selectSourceReviewSlides(slides, deriveTodoQueue(slides, {}));
}

describe("selectSourceReviewSlides", () => {
  it("未确认的生成页全部入列，顺序即 deck 顺序", () => {
    const entries = build([
      makeSlide({ pageLabel: "page-01" }),
      makeSlide({ pageLabel: "page-02" }),
      makeSlide({ pageLabel: "page-03" }),
    ]);
    expect(entries.map((entry) => entry.pageLabel)).toEqual([
      "page-01",
      "page-02",
      "page-03",
    ]);
    expect(entries.every((entry) => !entry.accepted)).toBe(true);
  });

  /**
   * U10：已确认页留在序列里。只取待办组的话，接受一张少一张——顶部
   * 「已确认 3/12」与缩略图带的勾都无从谈起，已确认页也再进不来。
   */
  it("已确认的生成页仍在序列中，且标为 accepted", () => {
    const entries = build([
      makeSlide({ pageLabel: "page-01", completed: ACCEPTED }),
      makeSlide({ pageLabel: "page-02" }),
      makeSlide({ pageLabel: "page-03", completed: ALL_DONE }),
    ]);
    expect(entries.map((entry) => entry.pageLabel)).toEqual([
      "page-01",
      "page-02",
      "page-03",
    ]);
    expect(entries.map((entry) => entry.accepted)).toEqual([true, false, true]);
  });

  it("同 deck 内的导入 / 抽取页不受影响（自动放行，不入审片序列）", () => {
    const entries = build([
      makeSlide({
        pageLabel: "page-01",
        sourceKind: "imported",
        completed: ALL_DONE,
      }),
      makeSlide({
        pageLabel: "page-02",
        sourceKind: "extracted",
        completed: ACCEPTED,
      }),
      makeSlide({ pageLabel: "page-03" }),
    ]);
    expect(entries.map((entry) => entry.pageLabel)).toEqual(["page-03"]);
  });

  it("已移除页一律排除（工作区压根不加载，没有源图可看）", () => {
    const entries = build([
      makeSlide({ pageLabel: "page-01", removed: true }),
      makeSlide({ pageLabel: "page-02" }),
    ]);
    expect(entries.map((entry) => entry.pageLabel)).toEqual(["page-02"]);
  });

  /**
   * 成员判定与待办队列同源的锁：队列「待确认源图」组必须恰好是序列里未确认的
   * 那部分。任何一方将来被就地改写一份 filter，这条就会红。
   */
  it("待办队列的 confirm-source 组恰好等于序列里未确认的部分", () => {
    const slides = [
      makeSlide({ pageLabel: "page-01", completed: ACCEPTED }),
      makeSlide({ pageLabel: "page-02" }),
      makeSlide({ pageLabel: "page-03", sourceKind: "imported" }),
      makeSlide({ pageLabel: "page-04" }),
      makeSlide({ pageLabel: "page-05", completed: ALL_DONE }),
    ];
    const queue = deriveTodoQueue(slides, {});
    const group = queue.groups.find(
      (entry) => entry.group === "confirm-source",
    );
    const entries = selectSourceReviewSlides(slides, queue);

    // 前置断言：这份 fixture 真的同时含已确认与未确认的页，否则下面测了个寂寞
    expect(entries.some((entry) => entry.accepted)).toBe(true);
    expect(entries.some((entry) => !entry.accepted)).toBe(true);

    expect(group?.items.map((item) => item.slideId).sort()).toEqual(
      entries
        .filter((entry) => !entry.accepted)
        .map((entry) => entry.slideId)
        .sort(),
    );
  });

  it("带上规格条目与工作区绝对路径（视图直接用，不再回查 slides）", () => {
    const entries = build([makeSlide({ pageLabel: "page-04" })]);
    expect(entries[0]).toMatchObject({
      slideId: "slide-page-04",
      pageLabel: "page-04",
      absWorkspacePath: "/decks/demo/slides/page-04",
      sourceKind: "generated",
      specEntryId: "entry-page-04",
      accepted: false,
    });
  });
});

describe("sourceReviewProgress", () => {
  it("已确认数与总数（顶部「已确认 3/12」的两个数字）", () => {
    const entries = build([
      makeSlide({ pageLabel: "page-01", completed: ACCEPTED }),
      makeSlide({ pageLabel: "page-02", completed: ACCEPTED }),
      makeSlide({ pageLabel: "page-03" }),
      makeSlide({ pageLabel: "page-04" }),
    ]);
    expect(sourceReviewProgress(entries)).toEqual({ accepted: 2, total: 4 });
  });

  it("空序列给 0/0，不抛错", () => {
    expect(sourceReviewProgress([])).toEqual({ accepted: 0, total: 0 });
  });
});

describe("firstPendingIndex / indexOfSlide", () => {
  const entries = build([
    makeSlide({ pageLabel: "page-01", completed: ACCEPTED }),
    makeSlide({ pageLabel: "page-02", completed: ACCEPTED }),
    makeSlide({ pageLabel: "page-03" }),
  ]);

  it("第一个未确认的位置", () => {
    expect(firstPendingIndex(entries)).toBe(2);
  });

  it("全部已确认时为 null", () => {
    const done = build([
      makeSlide({ pageLabel: "page-01", completed: ACCEPTED }),
      makeSlide({ pageLabel: "page-02", completed: ALL_DONE }),
    ]);
    expect(firstPendingIndex(done)).toBeNull();
  });

  it("按页 id 定位，不在序列中给 null", () => {
    expect(indexOfSlide(entries, "slide-page-02")).toBe(1);
    expect(indexOfSlide(entries, "slide-page-99")).toBeNull();
    expect(indexOfSlide(entries, null)).toBeNull();
  });
});

/**
 * 「接受后跳下一张」：从当前之后找第一个未确认的，走到末尾回绕。
 * 回绕是刻意的——用户可能从中间某页进来，不回绕会把前面没确认的页永远落下。
 */
describe("nextPendingIndex", () => {
  it("跳到后面第一个未确认的", () => {
    const entries = build([
      makeSlide({ pageLabel: "page-01", completed: ACCEPTED }),
      makeSlide({ pageLabel: "page-02" }),
      makeSlide({ pageLabel: "page-03", completed: ACCEPTED }),
      makeSlide({ pageLabel: "page-04" }),
    ]);
    expect(nextPendingIndex(entries, 1)).toBe(3);
  });

  it("走到末尾回绕到前面未确认的页", () => {
    const entries = build([
      makeSlide({ pageLabel: "page-01" }),
      makeSlide({ pageLabel: "page-02", completed: ACCEPTED }),
      makeSlide({ pageLabel: "page-03", completed: ACCEPTED }),
    ]);
    expect(nextPendingIndex(entries, 2)).toBe(0);
  });

  /** 最后一张接受完 → null，调用方据此回控制台（U8） */
  it("再无未确认的页时为 null", () => {
    const entries = build([
      makeSlide({ pageLabel: "page-01", completed: ACCEPTED }),
      makeSlide({ pageLabel: "page-02", completed: ACCEPTED }),
    ]);
    expect(nextPendingIndex(entries, 1)).toBeNull();
  });

  /** 只剩当前页自己未确认时也要给 null——否则接受后原地打转 */
  it("不把当前页算作下一张", () => {
    const entries = build([
      makeSlide({ pageLabel: "page-01", completed: ACCEPTED }),
      makeSlide({ pageLabel: "page-02" }),
    ]);
    expect(nextPendingIndex(entries, 1)).toBeNull();
  });

  it("空序列为 null", () => {
    expect(nextPendingIndex([], 0)).toBeNull();
  });
});

describe("resolveEntryIndex（进入视图停在哪一张）", () => {
  const entries = build([
    makeSlide({ pageLabel: "page-01", completed: ACCEPTED }),
    makeSlide({ pageLabel: "page-02" }),
    makeSlide({ pageLabel: "page-03" }),
  ]);

  it("指定页优先（卡片直达、完成面板「去确认」）", () => {
    expect(resolveEntryIndex(entries, "slide-page-01")).toBe(0);
  });

  it("不指定页时落到第一个未确认的（「逐张确认」）", () => {
    expect(resolveEntryIndex(entries, null)).toBe(1);
  });

  it("指定页不在序列中时同样回落第一个未确认的", () => {
    expect(resolveEntryIndex(entries, "slide-page-99")).toBe(1);
  });

  /** 全部已确认时不该给 null——那会让回看的用户看到空态（U10） */
  it("全部已确认时落到首项", () => {
    const done = build([
      makeSlide({ pageLabel: "page-01", completed: ACCEPTED }),
      makeSlide({ pageLabel: "page-02", completed: ALL_DONE }),
    ]);
    expect(resolveEntryIndex(done, null)).toBe(0);
  });

  it("空序列为 null（视图据此显示空态）", () => {
    expect(resolveEntryIndex([], "slide-page-01")).toBeNull();
  });
});

/**
 * ←/→ 逐张移动：边界钳制、**不回绕**。与「接受后跳下一张」不同，这里是用户自己
 * 在翻，回绕会让他分不清有没有翻到头。
 */
describe("stepIndex", () => {
  const entries = build([
    makeSlide({ pageLabel: "page-01" }),
    makeSlide({ pageLabel: "page-02" }),
    makeSlide({ pageLabel: "page-03" }),
  ]);

  it("逐张推进，中间每一步都真的动了", () => {
    expect(stepIndex(entries, 0, 1)).toBe(1);
    expect(stepIndex(entries, 1, 1)).toBe(2);
    expect(stepIndex(entries, 2, -1)).toBe(1);
  });

  it("两端钳制，不回绕", () => {
    expect(stepIndex(entries, 0, -1)).toBe(0);
    expect(stepIndex(entries, 2, 1)).toBe(2);
  });

  it("空序列为 null", () => {
    expect(stepIndex([], 0, 1)).toBeNull();
  });
});

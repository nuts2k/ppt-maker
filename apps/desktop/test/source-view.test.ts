/**
 * 来源徽标与规格漂移标注的回归锁（R6 / U1 / U11，父任务 A13）。
 *
 * A13 的核心是「**漂移不污染**」：改了规格文件里某一条条目，只有那一页多出一行
 * 标注，其余页零变化，**所有页的阶段状态都不变**。没有这条锁，将来任何人改待办
 * 判据都可能顺手把漂移塞进去——而那一刻界面会开始催用户重跑一堆根本没坏的页。
 */

import { describe, expect, it } from "vitest";
import type {
  SlideDetail,
  SlideStageDetail,
} from "../src/main/ipc/channels.js";
import {
  SOURCE_KIND_LABELS,
  sourceBadgeLabel,
  specDriftText,
} from "../src/renderer/lib/source-view.js";
import { deriveStageViews } from "../src/renderer/lib/stage-view.js";
import { deriveTodoQueue } from "../src/renderer/stores/todo-queue.js";
import { RUN_STAGE_SEQUENCE } from "../src/shared/stages.js";

function makeSlide(overrides: Partial<SlideDetail> = {}): SlideDetail {
  // 全阶段完成 = 这一页彻底没事，任何待办项都只可能来自被测的那个字段
  const stages: SlideStageDetail[] = RUN_STAGE_SEQUENCE.map((stage) => ({
    stage,
    status: "completed",
  }));
  return {
    slideId: "slide-page-01",
    workspacePath: "slides/page-01",
    absWorkspacePath: "/decks/demo/slides/page-01",
    pageLabel: "page-01",
    sourceImageName: "page-01.png",
    currentStage: "report",
    stageStatus: "completed",
    removed: false,
    sourceKind: "generated",
    sourceAcceptance: "manual",
    specEntryId: "entry-001",
    regenerableSpecEntryId: "entry-001",
    specDrift: null,
    stages,
    lastError: null,
    stageDurations: {},
    pendingTextReview: 0,
    ...overrides,
  };
}

describe("来源徽标", () => {
  it("三档来源各有中文短词", () => {
    expect(SOURCE_KIND_LABELS.imported).toBe("导入");
    expect(SOURCE_KIND_LABELS.extracted).toBe("抽取");
    expect(SOURCE_KIND_LABELS.generated).toBe("生成");
    expect(Object.keys(SOURCE_KIND_LABELS).sort()).toEqual([
      "extracted",
      "generated",
      "imported",
    ]);
  });

  /** 移除页的 `sourceKind` 是 null（CLI 不加载已移除页的工作区），角位归「已移除」 */
  it("来源未知时不给徽标", () => {
    expect(sourceBadgeLabel(null)).toBeNull();
  });
});

describe("规格漂移标注", () => {
  it("drifted / missing 各有文案，in-sync 与 null 不标注", () => {
    expect(specDriftText("drifted")).toBe("规格已更新");
    expect(specDriftText("missing")).toBe("规格条目已失联");
    expect(specDriftText("in-sync")).toBeNull();
    expect(specDriftText(null)).toBeNull();
  });

  /**
   * 措辞约定：漂移是「改了规格、图还没跟上」的常规状态，不是故障。
   * 写成「失败」会把一次正常的「改完了、要不要重出图」报成红色故障。
   */
  it("文案不得写成失败", () => {
    for (const drift of ["drifted", "missing"] as const) {
      expect(specDriftText(drift)).not.toMatch(/失败/);
    }
  });
});

describe("漂移不污染（A13 回归锁）", () => {
  const DRIFTS = ["drifted", "missing", "in-sync", null] as const;

  it("漂移页不进入待办队列", () => {
    for (const specDrift of DRIFTS) {
      const queue = deriveTodoQueue([makeSlide({ specDrift })], {});
      expect(queue.total, `specDrift=${specDrift} 不该产生待办项`).toBe(0);
      expect(queue.groups).toEqual([]);
    }
  });

  /**
   * 正对照：同一个夹具只要真有待办（这里让 accept-pptx 退回 pending），队列就必须
   * 命中。没有这条，上面那个 `total === 0` 换成任何写坏了的 `deriveTodoQueue`
   * 也一样绿。
   */
  it("正对照：真有待办时队列照常命中，与漂移无关", () => {
    for (const specDrift of DRIFTS) {
      const slide = makeSlide({
        specDrift,
        stages: RUN_STAGE_SEQUENCE.map((stage) => ({
          stage,
          status: stage === "accept-pptx" ? "pending" : "completed",
        })),
      });
      const queue = deriveTodoQueue([slide], {});
      expect(queue.total).toBe(1);
      expect(queue.groups[0]?.group).toBe("final-confirm");
    }
  });

  /** 阶段状态是纯耐久层派生，漂移一个字都不该改到它 */
  it("阶段视图逐阶段与无漂移时完全一致", () => {
    const baseline = deriveStageViews(
      makeSlide({ specDrift: null }),
      undefined,
    );
    for (const specDrift of DRIFTS) {
      const views = deriveStageViews(makeSlide({ specDrift }), undefined);
      expect(
        views.map((view) => [view.stage, view.status]),
        `specDrift=${specDrift} 改动了阶段状态`,
      ).toEqual(baseline.map((view) => [view.stage, view.status]));
    }
  });

  /** 混合 deck：只有漂移的那一页被标注，同 deck 的其余页零变化 */
  it("只有出现漂移的那一页被标注", () => {
    const slides = [
      makeSlide({
        slideId: "s1",
        pageLabel: "page-01",
        sourceKind: "imported",
        specEntryId: null,
      }),
      makeSlide({ slideId: "s2", pageLabel: "page-02", specDrift: "drifted" }),
      makeSlide({ slideId: "s3", pageLabel: "page-03", specDrift: "in-sync" }),
    ];
    expect(slides.map((slide) => specDriftText(slide.specDrift))).toEqual([
      null,
      "规格已更新",
      null,
    ]);
    expect(deriveTodoQueue(slides, {}).total).toBe(0);
  });
});

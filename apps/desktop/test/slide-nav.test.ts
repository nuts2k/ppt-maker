import { describe, expect, it } from "vitest";
import type {
  SlideDetail,
  SlideStageDetail,
} from "../src/main/ipc/channels.js";
import {
  adjacentSlides,
  orderedActiveSlides,
} from "../src/renderer/lib/slide-nav.js";
import { RUN_STAGE_SEQUENCE } from "../src/shared/stages.js";

function makeSlide(pageLabel: string, removed = false): SlideDetail {
  const stages: SlideStageDetail[] = RUN_STAGE_SEQUENCE.map((stage) => ({
    stage,
    status: "pending",
  }));
  return {
    slideId: `slide-${pageLabel}`,
    workspacePath: `slides/${pageLabel}`,
    absWorkspacePath: `/decks/demo/slides/${pageLabel}`,
    pageLabel,
    sourceImageName: `${pageLabel}.png`,
    currentStage: "ocr",
    stageStatus: "pending",
    removed,
    sourceKind: "imported",
    sourceAcceptance: "auto",
    specEntryId: null,
    regenerableSpecEntryId: null,
    specDrift: null,
    stages,
    lastError: null,
    stageDurations: {},
    pendingTextReview: 0,
  };
}

describe("orderedActiveSlides", () => {
  it("按 pageLabel 数字自然序排列（page-2 在 page-10 之前）", () => {
    const ordered = orderedActiveSlides([
      makeSlide("page-10"),
      makeSlide("page-2"),
      makeSlide("page-1"),
    ]);
    expect(ordered.map((slide) => slide.pageLabel)).toEqual([
      "page-1",
      "page-2",
      "page-10",
    ]);
  });

  it("过滤已移除的页", () => {
    const ordered = orderedActiveSlides([
      makeSlide("page-1"),
      makeSlide("page-2", true),
      makeSlide("page-3"),
    ]);
    expect(ordered.map((slide) => slide.pageLabel)).toEqual([
      "page-1",
      "page-3",
    ]);
  });

  it("不修改入参数组", () => {
    const input = [makeSlide("page-2"), makeSlide("page-1")];
    orderedActiveSlides(input);
    expect(input.map((slide) => slide.pageLabel)).toEqual(["page-2", "page-1"]);
  });
});

describe("adjacentSlides", () => {
  const slides = [
    makeSlide("page-10"),
    makeSlide("page-1"),
    makeSlide("page-2"),
  ];

  it("中间页给出前后邻页与 1-based 序号", () => {
    const nav = adjacentSlides(slides, "slide-page-2");
    expect(nav.prev?.pageLabel).toBe("page-1");
    expect(nav.next?.pageLabel).toBe("page-10");
    expect(nav.index).toBe(2);
    expect(nav.total).toBe(3);
  });

  it("首页无上一页，末页无下一页（不做环形导航）", () => {
    const first = adjacentSlides(slides, "slide-page-1");
    expect(first.prev).toBeNull();
    expect(first.next?.pageLabel).toBe("page-2");
    expect(first.index).toBe(1);

    const last = adjacentSlides(slides, "slide-page-10");
    expect(last.prev?.pageLabel).toBe("page-2");
    expect(last.next).toBeNull();
    expect(last.index).toBe(3);
  });

  it("已移除的页不参与导航，且自身不在序列中时序号为 0", () => {
    const withRemoved = [
      makeSlide("page-1"),
      makeSlide("page-2", true),
      makeSlide("page-3"),
    ];
    expect(adjacentSlides(withRemoved, "slide-page-1").next?.pageLabel).toBe(
      "page-3",
    );

    const removedCurrent = adjacentSlides(withRemoved, "slide-page-2");
    expect(removedCurrent).toEqual({
      prev: null,
      next: null,
      index: 0,
      total: 2,
    });
  });

  it("slideId 为 null 时返回空导航但保留总数", () => {
    expect(adjacentSlides(slides, null)).toEqual({
      prev: null,
      next: null,
      index: 0,
      total: 3,
    });
  });
});

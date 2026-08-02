import { describe, expect, it } from "vitest";
import type {
  DeckStatusDetailedResult,
  SlideDetail,
} from "../src/main/ipc/channels.js";
import {
  applyDetailedResult,
  filterActiveSlides,
  findSlideById,
  replaceSlide,
} from "../src/renderer/stores/deck-merge.js";

function slide(
  slideId: string,
  overrides: Partial<SlideDetail> = {},
): SlideDetail {
  return {
    slideId,
    workspacePath: `slides/${slideId}`,
    sourceImageName: `${slideId}.png`,
    currentStage: "ocr",
    stageStatus: "completed",
    removed: false,
    sourceKind: "imported",
    hasExtractableText: null,
    sourceAcceptance: "auto",
    specEntryId: null,
    regenerableSpecEntryId: null,
    specDrift: null,
    absWorkspacePath: `/decks/demo/slides/${slideId}`,
    pageLabel: slideId,
    stages: [{ stage: "ocr", status: "completed" }],
    lastError: null,
    stageDurations: { ocr: 1200 },
    pendingTextReview: 0,
    ...overrides,
  };
}

const SUMMARY: DeckStatusDetailedResult["summary"] = {
  total: 2,
  active: 2,
  removed: 0,
  completed: 0,
  inProgress: 2,
  notStarted: 0,
};

describe("applyDetailedResult", () => {
  it("拷贝 detailed 结果到 store 快照", () => {
    const result: DeckStatusDetailedResult = {
      deckPath: "/decks/demo",
      name: "demo",
      deckId: "deck-1",
      slides: [slide("page-01"), slide("page-02")],
      summary: SUMMARY,
    };

    const snapshot = applyDetailedResult(result);

    expect(snapshot.deckPath).toBe("/decks/demo");
    expect(snapshot.deckId).toBe("deck-1");
    expect(snapshot.slides).toHaveLength(2);
    expect(snapshot.summary).toBe(SUMMARY);
    // 必须是新数组，避免与 IPC 返回值共享引用
    expect(snapshot.slides).not.toBe(result.slides);
  });
});

describe("replaceSlide", () => {
  it("只替换目标页，其余元素保持原引用", () => {
    const first = slide("page-01");
    const second = slide("page-02");
    const next = slide("page-02", { currentStage: "mask" });

    const merged = replaceSlide([first, second], next);

    expect(merged).toHaveLength(2);
    expect(merged[0]).toBe(first);
    expect(merged[1]).toBe(next);
  });

  it("目标页不存在时返回原数组引用", () => {
    const slides = [slide("page-01")];
    expect(replaceSlide(slides, slide("page-09"))).toBe(slides);
  });
});

describe("findSlideById", () => {
  it("命中返回该页，未命中返回 undefined", () => {
    const slides = [slide("page-01"), slide("page-02")];
    expect(findSlideById(slides, "page-02")?.slideId).toBe("page-02");
    expect(findSlideById(slides, "page-03")).toBeUndefined();
  });
});

describe("filterActiveSlides", () => {
  it("排除已软删除的页", () => {
    const slides = [
      slide("page-01"),
      slide("page-02", { removed: true }),
      slide("page-03"),
    ];
    expect(filterActiveSlides(slides).map((item) => item.slideId)).toEqual([
      "page-01",
      "page-03",
    ]);
  });
});

/**
 * 筛选档与推进的判据。分区口径不在这里重测（见 review-partition.test.ts），
 * 这里只锁「筛选不重排、计数与条目同源、⌘↓ 推进会回绕」。
 */

import type { TextReviewBlock } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import {
  defaultFilter,
  filterCounts,
  matchesFilter,
  nextUnreviewedId,
  REVIEW_FILTER_ORDER,
} from "../src/renderer/lib/review-filter.js";

function block(
  id: string,
  options: {
    classification?: TextReviewBlock["classification"];
    reviewStatus?: TextReviewBlock["reviewStatus"];
    ocr?: string;
    assist?: string;
  } = {},
): TextReviewBlock {
  const classification = options.classification ?? "layout_text";
  const sources: TextReviewBlock["sources"] = [];
  if (options.ocr !== undefined) {
    sources.push({
      kind: "offline_ocr",
      provider: "apple-vision",
      text: options.ocr,
      confidence: 0.9,
    });
  }
  if (options.assist !== undefined) {
    sources.push({
      kind: "ai_text_assist",
      provider: "openai",
      text: options.assist,
      confidence: null,
    });
  }
  return {
    schemaVersion: 1,
    id,
    text: options.ocr ?? id,
    lines: [options.ocr ?? id],
    bboxPx: { x: 0, y: 0, width: 10, height: 10 },
    quadPx: null,
    rotationDeg: 0,
    zIndex: 0,
    classification,
    sources,
    includeInMask: classification === "layout_text",
    reviewStatus: options.reviewStatus ?? "unreviewed",
    riskAcceptance: null,
    style: {
      fontSizePx: null,
      fontWeight: null,
      colorHex: null,
      horizontalAlign: null,
      verticalAlign: null,
      lineHeight: null,
    },
    maskParams: {
      foregroundColors: [],
      colorTolerance: 0,
      edgeThreshold: 0,
      minComponentAreaPx: 0,
      dilationRadiusPx: 0,
      excludePolygons: [],
    },
    updatedAt: null,
  };
}

const AGREED = block("agreed-1", { ocr: "同一段", assist: "同一段" });
const DIVERGED = block("text-1", { ocr: "甲方", assist: "甲乙方" });
const SYMBOL = block("symbol-1", {
  classification: "object_integrated_symbol",
});
const AGREED_DONE = block("agreed-2", {
  ocr: "已看过",
  assist: "已看过",
  reviewStatus: "reviewed",
});

describe("matchesFilter", () => {
  it("全部档接纳任何块", () => {
    for (const b of [AGREED, DIVERGED, SYMBOL, AGREED_DONE]) {
      expect(matchesFilter(b, "all")).toBe(true);
    }
  });

  it("未复核档只看 reviewStatus，与分区无关", () => {
    expect(matchesFilter(DIVERGED, "unreviewed")).toBe(true);
    expect(matchesFilter(SYMBOL, "unreviewed")).toBe(true);
    expect(matchesFilter(AGREED_DONE, "unreviewed")).toBe(false);
  });

  it("三个分区档复用 partitionOf 的判据", () => {
    expect(matchesFilter(DIVERGED, "text-pending")).toBe(true);
    expect(matchesFilter(AGREED, "text-pending")).toBe(false);
    expect(matchesFilter(SYMBOL, "classification-pending")).toBe(true);
    expect(matchesFilter(AGREED, "agreed")).toBe(true);
    // 已复核不改变分区归属——分区是「这块是什么」，不是「做没做过」
    expect(matchesFilter(AGREED_DONE, "agreed")).toBe(true);
  });

  it("五档齐备且顺序固定", () => {
    expect(REVIEW_FILTER_ORDER).toEqual([
      "unreviewed",
      "text-pending",
      "classification-pending",
      "agreed",
      "all",
    ]);
  });
});

describe("filterCounts", () => {
  it("计数与各档实际接纳的条目数一致", () => {
    const blocks = [AGREED, DIVERGED, SYMBOL, AGREED_DONE];
    const counts = filterCounts(blocks);
    for (const filter of REVIEW_FILTER_ORDER) {
      expect(counts[filter]).toBe(
        blocks.filter((b) => matchesFilter(b, filter)).length,
      );
    }
  });

  it("空列表全为 0", () => {
    expect(filterCounts([])).toEqual({
      unreviewed: 0,
      "text-pending": 0,
      "classification-pending": 0,
      agreed: 0,
      all: 0,
    });
  });
});

describe("defaultFilter", () => {
  it("扫读且有未复核项时停在未复核", () => {
    expect(defaultFilter([AGREED, DIVERGED], "sweep")).toBe("unreviewed");
  });

  it("扫读但已全部复核时停在全部（否则打开就是空列表）", () => {
    expect(defaultFilter([AGREED_DONE], "sweep")).toBe("all");
  });

  it("定点回访一律停在全部——要找的那处很可能已标为已复核", () => {
    expect(defaultFilter([AGREED, DIVERGED], "targeted")).toBe("all");
  });
});

describe("nextUnreviewedId", () => {
  const visible = [AGREED_DONE, DIVERGED, AGREED, SYMBOL];

  it("从当前项之后找第一个未复核", () => {
    expect(nextUnreviewedId(visible, "agreed-2")).toBe("text-1");
  });

  it("走到末尾回绕到开头继续找", () => {
    expect(nextUnreviewedId(visible, "symbol-1")).toBe("text-1");
  });

  it("当前项不在可见集合内时从头找", () => {
    expect(nextUnreviewedId(visible, "不存在")).toBe("text-1");
    expect(nextUnreviewedId(visible, null)).toBe("text-1");
  });

  it("不会把当前项自己当作下一个", () => {
    expect(nextUnreviewedId([DIVERGED], "text-1")).toBeNull();
  });

  it("全部已复核时返回 null（调用方据此给出明确提示）", () => {
    expect(nextUnreviewedId([AGREED_DONE], "agreed-2")).toBeNull();
    expect(nextUnreviewedId([], null)).toBeNull();
  });
});

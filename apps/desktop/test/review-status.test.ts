import type { TextReviewBlock } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import {
  countUnreviewed,
  markAllBlocksReviewed,
} from "../src/renderer/lib/review-status.js";

function block(
  id: string,
  reviewStatus: TextReviewBlock["reviewStatus"],
  classification: TextReviewBlock["classification"] = "layout_text",
): TextReviewBlock {
  return {
    schemaVersion: 1,
    id,
    text: id,
    lines: [id],
    bboxPx: { x: 0, y: 0, width: 10, height: 10 },
    quadPx: null,
    rotationDeg: 0,
    zIndex: 0,
    classification,
    sources: [],
    includeInMask: classification === "layout_text",
    reviewStatus,
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

describe("countUnreviewed", () => {
  it("空文档为 0", () => {
    expect(countUnreviewed([])).toBe(0);
  });

  it("只数 unreviewed，已复核与风险接受都不计入", () => {
    const blocks = [
      block("a", "unreviewed"),
      block("b", "reviewed"),
      block("c", "accepted_with_risk"),
      block("d", "unreviewed"),
    ];
    expect(countUnreviewed(blocks)).toBe(2);
  });
});

describe("markAllBlocksReviewed", () => {
  it("无未复核块时原样返回，不制造新数组", () => {
    const blocks = [block("a", "reviewed"), block("b", "accepted_with_risk")];
    const result = markAllBlocksReviewed(blocks);
    expect(result.changed).toBe(0);
    // 同一引用：避免 zustand 收到新数组后触发整页无谓重渲染
    expect(result.blocks).toBe(blocks);
  });

  it("把所有 unreviewed 置为 reviewed 并返回改动数", () => {
    const blocks = [
      block("a", "unreviewed"),
      block("b", "reviewed"),
      block("c", "unreviewed"),
    ];
    const result = markAllBlocksReviewed(blocks);
    expect(result.changed).toBe(2);
    expect(result.blocks.map((b) => b.reviewStatus)).toEqual([
      "reviewed",
      "reviewed",
      "reviewed",
    ]);
  });

  it("不覆盖 accepted_with_risk（它带着 riskAcceptance 记录，语义不同）", () => {
    const blocks = [block("a", "accepted_with_risk"), block("b", "unreviewed")];
    const result = markAllBlocksReviewed(blocks);
    expect(result.changed).toBe(1);
    expect(result.blocks[0]?.reviewStatus).toBe("accepted_with_risk");
  });

  it("不改动原数组（调用方可能仍持有旧引用做对比）", () => {
    const blocks = [block("a", "unreviewed")];
    markAllBlocksReviewed(blocks);
    expect(blocks[0]?.reviewStatus).toBe("unreviewed");
  });

  it("覆盖真实场景：整页 40 个未复核一次放行", () => {
    const blocks = [
      ...Array.from({ length: 27 }, (_, i) =>
        block(`mask-${i}`, "unreviewed", "layout_text"),
      ),
      ...Array.from({ length: 13 }, (_, i) =>
        block(`sym-${i}`, "unreviewed", "object_integrated_symbol"),
      ),
      ...Array.from({ length: 20 }, (_, i) => block(`done-${i}`, "reviewed")),
    ];
    const result = markAllBlocksReviewed(blocks);
    expect(result.changed).toBe(40);
    expect(countUnreviewed(result.blocks)).toBe(0);
  });
});

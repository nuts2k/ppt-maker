import type { TextReviewBlock } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import { countUnreviewed } from "../src/renderer/lib/review-status.js";

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

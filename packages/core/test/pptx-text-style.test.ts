import { describe, expect, it } from "vitest";
import {
  fontSizePtFromPx,
  PPTX_WIDE_WIDTH_INCHES,
  resolveFontSizePt,
  SCHEMA_VERSION,
  type TextReviewBlock,
  toAlign,
  toBold,
  toValign,
} from "../src/index.js";

// 这些公式从 apps/cli/src/pptx/synthesize.ts 迁入 core，供 CLI 合成与桌面端合成预览共用。
// 迁移是纯搬迁：任何计算逻辑变动都会让 PPTX 输出漂移，故此处锚定迁移前的原始表达式。

const IMAGE_WIDTH = 1600;

type BlockOverrides = Partial<Omit<TextReviewBlock, "style">> & {
  readonly style?: Partial<TextReviewBlock["style"]>;
};

function block(overrides: BlockOverrides = {}): TextReviewBlock {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "block-001",
    text: "标题文字",
    lines: overrides.lines ?? ["标题文字"],
    bboxPx: overrides.bboxPx ?? { x: 0, y: 0, width: 400, height: 80 },
    quadPx: null,
    rotationDeg: 0,
    zIndex: 0,
    classification: "layout_text",
    sources: [],
    includeInMask: true,
    reviewStatus: "reviewed",
    riskAcceptance: null,
    style: {
      fontSizePx: null,
      fontWeight: null,
      colorHex: null,
      horizontalAlign: null,
      verticalAlign: null,
      lineHeight: null,
      ...overrides.style,
    },
    maskParams: {
      foregroundColors: [],
      colorTolerance: 32,
      edgeThreshold: 0.5,
      minComponentAreaPx: 4,
      dilationRadiusPx: 1,
      excludePolygons: [],
    },
    updatedAt: null,
  };
}

describe("resolveFontSizePt", () => {
  it("fontSizePx 非空时按像素直接换算，与迁移前公式一致", () => {
    const fontSizePx = 48;
    const actual = resolveFontSizePt(
      block({ style: { fontSizePx } }),
      IMAGE_WIDTH,
    );
    expect(actual).toBeCloseTo(
      (fontSizePx * 72 * PPTX_WIDE_WIDTH_INCHES) / IMAGE_WIDTH,
      12,
    );
  });

  it("fontSizePx 为空时按 bbox 高度与行数估算，与迁移前公式一致", () => {
    const height = 120;
    const lines = ["第一行", "第二行", "第三行"];
    const actual = resolveFontSizePt(
      block({ lines, bboxPx: { x: 0, y: 0, width: 400, height } }),
      IMAGE_WIDTH,
    );
    const estimatedPx = (height / lines.length) * 0.65;
    expect(actual).toBeCloseTo(
      (estimatedPx * 72 * PPTX_WIDE_WIDTH_INCHES) / IMAGE_WIDTH,
      12,
    );
  });

  it("lines 为空时按单行估算而非除以零", () => {
    const height = 80;
    const actual = resolveFontSizePt(
      block({ lines: [], bboxPx: { x: 0, y: 0, width: 400, height } }),
      IMAGE_WIDTH,
    );
    expect(actual).toBeCloseTo(
      fontSizePtFromPx(height * 0.65, IMAGE_WIDTH),
      12,
    );
  });
});

describe("样式映射", () => {
  it("semibold 与 bold 映射为加粗，其余不加粗", () => {
    expect(toBold("semibold")).toBe(true);
    expect(toBold("bold")).toBe(true);
    expect(toBold("medium")).toBe(false);
    expect(toBold("regular")).toBe(false);
    expect(toBold(null)).toBe(false);
  });

  it("水平对齐缺省为 left", () => {
    expect(toAlign("center")).toBe("center");
    expect(toAlign("right")).toBe("right");
    expect(toAlign("left")).toBe("left");
    expect(toAlign(null)).toBe("left");
  });

  it("垂直对齐只有 middle 保留，其余归为 top", () => {
    expect(toValign("middle")).toBe("middle");
    expect(toValign("top")).toBe("top");
    expect(toValign("bottom")).toBe("top");
    expect(toValign(null)).toBe("top");
  });
});

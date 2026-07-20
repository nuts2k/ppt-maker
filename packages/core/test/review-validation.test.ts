import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  type TextReviewBlock,
  type TextReviewDocument,
  validateTextReviewDocument,
} from "../src/index.js";

const IMAGE = { width: 1600, height: 900 };

function block(overrides: Partial<TextReviewBlock> = {}): TextReviewBlock {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: overrides.id ?? "block-001",
    text: overrides.text ?? "标题文字",
    lines: overrides.lines ?? ["标题文字"],
    bboxPx: overrides.bboxPx ?? { x: 100, y: 100, width: 400, height: 80 },
    quadPx: overrides.quadPx ?? null,
    rotationDeg: overrides.rotationDeg ?? 0,
    zIndex: overrides.zIndex ?? 0,
    classification: overrides.classification ?? "layout_text",
    sources: overrides.sources ?? [],
    includeInMask: overrides.includeInMask ?? false,
    reviewStatus: overrides.reviewStatus ?? "reviewed",
    riskAcceptance: overrides.riskAcceptance ?? null,
    style: overrides.style ?? {
      fontSizePx: null,
      fontWeight: null,
      colorHex: null,
      horizontalAlign: null,
      verticalAlign: null,
      lineHeight: null,
    },
    maskParams: overrides.maskParams ?? {
      foregroundColors: [],
      colorTolerance: 32,
      edgeThreshold: 0.5,
      minComponentAreaPx: 4,
      dilationRadiusPx: 1,
      excludePolygons: [],
    },
    updatedAt: overrides.updatedAt ?? null,
  };
}

function documentWith(blocks: TextReviewBlock[]): TextReviewDocument {
  return {
    schemaVersion: SCHEMA_VERSION,
    slideId: "slide-1",
    image: IMAGE,
    generatedAt: "2026-07-20T00:00:00.000Z",
    reviewStartedAt: "2026-07-20T00:00:00.000Z",
    blocks,
    unmatchedReferenceCandidates: [],
  };
}

function codes(document: TextReviewDocument): string[] {
  return validateTextReviewDocument(document, { image: IMAGE }).map(
    (violation) => violation.code,
  );
}

describe("validateTextReviewDocument", () => {
  it("合法文档无违规", () => {
    expect(codes(documentWith([block()]))).toEqual([]);
  });

  it("uncertain 或对象内符号参与 mask 属违规", () => {
    expect(
      codes(
        documentWith([
          block({ classification: "uncertain", includeInMask: true }),
        ]),
      ),
    ).toContain("MASK_REQUIRES_LAYOUT_TEXT");
    expect(
      codes(
        documentWith([
          block({
            classification: "object_integrated_symbol",
            includeInMask: true,
          }),
        ]),
      ),
    ).toContain("MASK_REQUIRES_LAYOUT_TEXT");
  });

  it("bbox 越界属违规", () => {
    expect(
      codes(
        documentWith([
          block({ bboxPx: { x: 1400, y: 100, width: 400, height: 80 } }),
        ]),
      ),
    ).toContain("BBOX_OUT_OF_BOUNDS");
  });

  it("退化或越界四边形属违规", () => {
    expect(
      codes(
        documentWith([
          block({
            quadPx: [
              { x: 100, y: 100 },
              { x: 100, y: 100 },
              { x: 100, y: 100 },
              { x: 100, y: 100 },
            ],
          }),
        ]),
      ),
    ).toContain("QUAD_DEGENERATE");
    expect(
      codes(
        documentWith([
          block({
            quadPx: [
              { x: 100, y: 100 },
              { x: 2000, y: 100 },
              { x: 2000, y: 180 },
              { x: 100, y: 180 },
            ],
          }),
        ]),
      ),
    ).toContain("QUAD_OUT_OF_BOUNDS");
  });

  it("旋转超范围属违规", () => {
    expect(codes(documentWith([block({ rotationDeg: 720 })]))).toContain(
      "ROTATION_OUT_OF_RANGE",
    );
  });

  it("字号超过页面高度属违规", () => {
    expect(
      codes(
        documentWith([
          block({
            style: {
              fontSizePx: 1200,
              fontWeight: null,
              colorHex: null,
              horizontalAlign: null,
              verticalAlign: null,
              lineHeight: null,
            },
          }),
        ]),
      ),
    ).toContain("FONT_SIZE_OUT_OF_RANGE");
  });

  it("风险接受记录缺失或与状态不一致属违规", () => {
    expect(
      codes(documentWith([block({ reviewStatus: "accepted_with_risk" })])),
    ).toContain("RISK_ACCEPTANCE_MISSING");
    expect(
      codes(
        documentWith([
          block({
            reviewStatus: "reviewed",
            riskAcceptance: {
              acceptedBy: "dev",
              acceptedAt: "2026-07-20T00:00:00.000Z",
              note: "",
            },
          }),
        ]),
      ),
    ).toContain("RISK_ACCEPTANCE_STATUS_MISMATCH");
  });

  it("图片尺寸不一致属违规", () => {
    const document = documentWith([block()]);
    const violations = validateTextReviewDocument(document, {
      image: { width: 1920, height: 1080 },
    });
    expect(violations.map((violation) => violation.code)).toContain(
      "IMAGE_DIMENSION_MISMATCH",
    );
  });

  it("空文本与重复 id 属违规", () => {
    const found = codes(
      documentWith([block({ id: "dup", text: "  " }), block({ id: "dup" })]),
    );
    expect(found).toContain("TEXT_EMPTY");
    expect(found).toContain("DUPLICATE_BLOCK_ID");
  });

  it("未复核的版式目标文字给出警告而非错误", () => {
    const violations = validateTextReviewDocument(
      documentWith([
        block({ classification: "layout_text", reviewStatus: "unreviewed" }),
      ]),
      { image: IMAGE },
    );
    const target = violations.find(
      (violation) => violation.code === "TARGET_TEXT_UNREVIEWED",
    );
    expect(target?.severity).toBe("warning");
  });
});

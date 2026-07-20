import { describe, expect, it } from "vitest";
import {
  mergeTextBlockCandidates,
  type OcrProbeResponse,
  SCHEMA_VERSION,
  type TextReviewBlock,
  type TextReviewDocument,
  TextReviewDocumentSchema,
  type VisionAnalysisResult,
  type VisionTextCandidate,
} from "../src/index.js";

const NOW = "2026-07-20T00:00:00.000Z";
const IMAGE = { width: 1600, height: 900 };

function ocrResponse(blocks: OcrProbeResponse["blocks"]): OcrProbeResponse {
  return {
    schemaVersion: SCHEMA_VERSION,
    provider: "apple-vision",
    image: IMAGE,
    blocks,
  };
}

function visionCandidate(
  overrides: Partial<VisionTextCandidate> & { id: string },
): VisionTextCandidate {
  return {
    id: overrides.id,
    text: overrides.text ?? "候选",
    bboxPx: overrides.bboxPx ?? { x: 100, y: 100, width: 200, height: 60 },
    quadPx: overrides.quadPx ?? null,
    rotationDeg: overrides.rotationDeg ?? null,
    isArtText: overrides.isArtText ?? false,
    classification: overrides.classification ?? "layout_text",
    style: overrides.style ?? {
      fontSizePx: null,
      fontWeight: null,
      colorHex: null,
      horizontalAlign: null,
      verticalAlign: null,
      lineBreaks: [],
    },
    foregroundColors: overrides.foregroundColors ?? [],
    risks: overrides.risks ?? [],
    rationale: overrides.rationale ?? "",
  };
}

function visionResult(candidates: VisionTextCandidate[]): VisionAnalysisResult {
  return {
    schemaVersion: SCHEMA_VERSION,
    image: IMAGE,
    candidates,
    missingTextHints: [],
    pageRisks: [],
  };
}

function mergeBase(
  overrides: Partial<Parameters<typeof mergeTextBlockCandidates>[0]> = {},
) {
  return mergeTextBlockCandidates({
    slideId: "slide-1",
    image: IMAGE,
    ocr: ocrResponse([]),
    analysis: null,
    referenceText: null,
    existing: null,
    now: NOW,
    ...overrides,
  });
}

describe("mergeTextBlockCandidates", () => {
  it("OCR-only 候选生成 uncertain 块且默认不进入 mask", () => {
    const document = mergeBase({
      ocr: ocrResponse([
        {
          id: "vision-0",
          text: "标题文字",
          bboxPx: { x: 100, y: 100, width: 400, height: 80 },
          confidence: 0.95,
          rotationDeg: null,
          glyphHints: [],
        },
      ]),
    });

    expect(TextReviewDocumentSchema.parse(document)).toBeTruthy();
    expect(document.blocks).toHaveLength(1);
    const block = document.blocks[0] as TextReviewBlock;
    expect(block.classification).toBe("uncertain");
    expect(block.includeInMask).toBe(false);
    expect(block.reviewStatus).toBe("unreviewed");
    expect(block.sources).toEqual([
      {
        kind: "offline_ocr",
        provider: "apple-vision",
        text: "标题文字",
        confidence: 0.95,
      },
    ]);
    expect(document.reviewStartedAt).toBe(NOW);
  });

  it("OCR 与视觉候选在同区域归并为单块并采用视觉分类与四边形", () => {
    const quad: VisionTextCandidate["quadPx"] = [
      { x: 100, y: 100 },
      { x: 500, y: 100 },
      { x: 500, y: 180 },
      { x: 100, y: 180 },
    ];
    const document = mergeBase({
      ocr: ocrResponse([
        {
          id: "vision-0",
          text: "标题文字",
          bboxPx: { x: 100, y: 100, width: 400, height: 80 },
          confidence: 0.9,
          rotationDeg: null,
          glyphHints: [],
        },
      ]),
      analysis: visionResult([
        visionCandidate({
          id: "cand-0",
          text: "标题文字",
          bboxPx: { x: 102, y: 101, width: 398, height: 79 },
          quadPx: quad,
          classification: "layout_text",
          foregroundColors: ["#ffffff"],
        }),
      ]),
    });

    expect(document.blocks).toHaveLength(1);
    const block = document.blocks[0] as TextReviewBlock;
    expect(block.classification).toBe("layout_text");
    expect(block.quadPx).toEqual(quad);
    expect(block.maskParams.foregroundColors).toEqual(["#ffffff"]);
    expect(block.sources.map((source) => source.kind)).toEqual([
      "cloud_vision",
      "offline_ocr",
    ]);
  });

  it("同区域文本冲突时保留全部来源候选文本", () => {
    const document = mergeBase({
      ocr: ocrResponse([
        {
          id: "vision-0",
          text: "EditabIe",
          bboxPx: { x: 100, y: 300, width: 300, height: 50 },
          confidence: 0.6,
          rotationDeg: null,
          glyphHints: [],
        },
      ]),
      analysis: visionResult([
        visionCandidate({
          id: "cand-0",
          text: "Editable",
          bboxPx: { x: 101, y: 301, width: 299, height: 49 },
        }),
      ]),
    });

    expect(document.blocks).toHaveLength(1);
    const texts = document.blocks[0]?.sources.map((source) => source.text);
    expect(texts).toContain("Editable");
    expect(texts).toContain("EditabIe");
  });

  it("多个 OCR 块并入同一视觉块，保留全部来源且文本取视觉值", () => {
    const document = mergeBase({
      ocr: ocrResponse([
        {
          id: "vision-0",
          text: "定价方素",
          bboxPx: { x: 100, y: 100, width: 400, height: 80 },
          confidence: 0.6,
          rotationDeg: null,
          glyphHints: [],
        },
        {
          id: "vision-1",
          text: "定价方案 ",
          bboxPx: { x: 110, y: 105, width: 390, height: 78 },
          confidence: 0.7,
          rotationDeg: null,
          glyphHints: [],
        },
      ]),
      analysis: visionResult([
        visionCandidate({
          id: "cand-0",
          text: "定价方案",
          bboxPx: { x: 100, y: 100, width: 400, height: 80 },
          classification: "layout_text",
        }),
      ]),
    });

    expect(document.blocks).toHaveLength(1);
    const block = document.blocks[0];
    // 块级取值优先级：文本与分类采用视觉候选。
    expect(block?.text).toBe("定价方案");
    expect(block?.classification).toBe("layout_text");
    // 三个来源（1 视觉 + 2 OCR）全部保留。
    expect(block?.sources.map((source) => source.kind)).toEqual([
      "cloud_vision",
      "offline_ocr",
      "offline_ocr",
    ]);
  });

  it("参考文案与合并块两来源都冲突时保留全部候选并进入 unmatched", () => {
    const document = mergeBase({
      ocr: ocrResponse([
        {
          id: "vision-0",
          text: "定价方素",
          bboxPx: { x: 100, y: 100, width: 400, height: 80 },
          confidence: 0.6,
          rotationDeg: null,
          glyphHints: [],
        },
      ]),
      analysis: visionResult([
        visionCandidate({
          id: "cand-0",
          text: "定价方案",
          bboxPx: { x: 100, y: 100, width: 400, height: 80 },
        }),
      ]),
      referenceText: "完全不同的市场文案",
    });

    const block = document.blocks[0];
    const texts = block?.sources.map((source) => source.text);
    expect(texts).toContain("定价方案");
    expect(texts).toContain("定价方素");
    expect(
      block?.sources.some((source) => source.kind === "reference_text"),
    ).toBe(false);
    expect(document.unmatchedReferenceCandidates).toEqual([
      { text: "完全不同的市场文案" },
    ]);
  });

  it("参考文案匹配追加来源，未匹配行进入 unmatched 候选", () => {
    const document = mergeBase({
      ocr: ocrResponse([
        {
          id: "vision-0",
          text: "标题文字",
          bboxPx: { x: 100, y: 100, width: 400, height: 80 },
          confidence: 0.9,
          rotationDeg: null,
          glyphHints: [],
        },
      ]),
      referenceText: "标题文字\n仅在文案中的段落",
    });

    const block = document.blocks[0] as TextReviewBlock;
    expect(
      block.sources.some((source) => source.kind === "reference_text"),
    ).toBe(true);
    expect(document.unmatchedReferenceCandidates).toEqual([
      { text: "仅在文案中的段落" },
    ]);
  });

  it("重跑保留人工确认块并刷新候选，新增区域作为新块加入", () => {
    const humanBlock: TextReviewBlock = {
      schemaVersion: SCHEMA_VERSION,
      id: "block-001",
      text: "人工订正标题",
      lines: ["人工订正标题"],
      bboxPx: { x: 100, y: 100, width: 400, height: 80 },
      quadPx: null,
      rotationDeg: 0,
      zIndex: 0,
      classification: "layout_text",
      sources: [
        {
          kind: "offline_ocr",
          provider: "apple-vision",
          text: "标题文字",
          confidence: 0.7,
        },
        {
          kind: "manual",
          provider: "manual",
          text: "人工订正标题",
          confidence: null,
        },
      ],
      includeInMask: true,
      reviewStatus: "reviewed",
      riskAcceptance: null,
      style: {
        fontSizePx: 48,
        fontWeight: "bold",
        colorHex: "#ffffff",
        horizontalAlign: "center",
        verticalAlign: "middle",
        lineHeight: null,
      },
      maskParams: {
        foregroundColors: ["#ffffff"],
        colorTolerance: 20,
        edgeThreshold: 0.4,
        minComponentAreaPx: 3,
        dilationRadiusPx: 2,
        excludePolygons: [],
      },
      updatedAt: "2026-07-20T01:00:00.000Z",
    };
    const existing: TextReviewDocument = {
      schemaVersion: SCHEMA_VERSION,
      slideId: "slide-1",
      image: IMAGE,
      generatedAt: "2026-07-20T00:30:00.000Z",
      reviewStartedAt: "2026-07-20T00:10:00.000Z",
      blocks: [humanBlock],
      unmatchedReferenceCandidates: [],
    };

    const document = mergeBase({
      existing,
      now: "2026-07-20T02:00:00.000Z",
      ocr: ocrResponse([
        {
          id: "vision-0",
          text: "标题文字修订",
          bboxPx: { x: 100, y: 100, width: 400, height: 80 },
          confidence: 0.92,
          rotationDeg: null,
          glyphHints: [],
        },
        {
          id: "vision-1",
          text: "新增副标题",
          bboxPx: { x: 100, y: 320, width: 500, height: 60 },
          confidence: 0.9,
          rotationDeg: null,
          glyphHints: [],
        },
      ]),
    });

    const preserved = document.blocks.find((block) => block.id === "block-001");
    expect(preserved).toBeDefined();
    // 人工订正的文本、分类、复核状态、mask 参与均未被覆盖。
    expect(preserved?.text).toBe("人工订正标题");
    expect(preserved?.classification).toBe("layout_text");
    expect(preserved?.reviewStatus).toBe("reviewed");
    expect(preserved?.includeInMask).toBe(true);
    // 候选来源已刷新到最新 OCR 文本，同时保留 manual 来源。
    const offlineSource = preserved?.sources.find(
      (source) => source.kind === "offline_ocr",
    );
    expect(offlineSource?.text).toBe("标题文字修订");
    expect(preserved?.sources.some((source) => source.kind === "manual")).toBe(
      true,
    );
    // 新区域作为全新未复核块加入，且不与既有 id 冲突。
    const added = document.blocks.find((block) => block.id !== "block-001");
    expect(added?.text).toBe("新增副标题");
    expect(added?.reviewStatus).toBe("unreviewed");
    // reviewStartedAt 保留首次候选时间。
    expect(document.reviewStartedAt).toBe("2026-07-20T00:10:00.000Z");
  });

  it("未被人工触碰的旧块在重跑时按候选重建", () => {
    const staleBlock: TextReviewBlock = {
      schemaVersion: SCHEMA_VERSION,
      id: "block-001",
      text: "旧候选",
      lines: ["旧候选"],
      bboxPx: { x: 100, y: 100, width: 400, height: 80 },
      quadPx: null,
      rotationDeg: 0,
      zIndex: 0,
      classification: "uncertain",
      sources: [
        {
          kind: "offline_ocr",
          provider: "apple-vision",
          text: "旧候选",
          confidence: 0.5,
        },
      ],
      includeInMask: false,
      reviewStatus: "unreviewed",
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
        colorTolerance: 32,
        edgeThreshold: 0.5,
        minComponentAreaPx: 4,
        dilationRadiusPx: 1,
        excludePolygons: [],
      },
      updatedAt: null,
    };
    const document = mergeBase({
      existing: {
        schemaVersion: SCHEMA_VERSION,
        slideId: "slide-1",
        image: IMAGE,
        generatedAt: NOW,
        reviewStartedAt: NOW,
        blocks: [staleBlock],
        unmatchedReferenceCandidates: [],
      },
      ocr: ocrResponse([
        {
          id: "vision-0",
          text: "新候选",
          bboxPx: { x: 100, y: 100, width: 400, height: 80 },
          confidence: 0.95,
          rotationDeg: null,
          glyphHints: [],
        },
      ]),
    });

    expect(document.blocks).toHaveLength(1);
    expect(document.blocks[0]?.text).toBe("新候选");
  });
});

import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  SlideManifestSchema,
  TextBlockSchema,
} from "../src/index.js";

describe("TextBlockSchema", () => {
  it("接受版本化文字块", () => {
    const result = TextBlockSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      id: "block-1",
      text: "你好 PPT Maker",
      bboxPx: { x: 100, y: 100, width: 500, height: 80 },
      rotationDeg: 0,
      confidence: 0.98,
      classification: "uncertain",
      sources: [
        {
          kind: "offline_ocr",
          provider: "apple-vision",
          text: "你好 PPT Maker",
          confidence: 0.98,
        },
      ],
      includeInMask: false,
      reviewStatus: "unreviewed",
      updatedAt: null,
    });

    expect(result.id).toBe("block-1");
  });

  it("拒绝未知 schema 版本", () => {
    expect(() =>
      TextBlockSchema.parse({
        schemaVersion: 2,
        id: "block-1",
        text: "text",
        bboxPx: { x: 0, y: 0, width: 10, height: 10 },
        rotationDeg: 0,
        confidence: null,
        classification: "uncertain",
        sources: [],
        includeInMask: false,
        reviewStatus: "unreviewed",
        updatedAt: null,
      }),
    ).toThrow();
  });
});

describe("SlideManifestSchema", () => {
  it("拒绝非 sha256 哈希", () => {
    const result = SlideManifestSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      slideId: "slide-1",
      sourceImage: {
        path: "source.png",
        sha256: "not-a-hash",
        width: 1920,
        height: 1080,
      },
      stages: [],
      textBlocksPath: null,
    });

    expect(result.success).toBe(false);
  });
});

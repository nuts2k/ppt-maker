import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../src/constants.js";
import {
  DeckExportRecordSchema,
  DeckManifestSchema,
  DeckSlideEntrySchema,
} from "../src/deck-contracts.js";

describe("DeckSlideEntrySchema", () => {
  const base = {
    slideId: "slide-1",
    workspacePath: "slides/slide-1",
    sourceImageName: "source.png",
    addedAt: "2026-07-20T00:00:00.000Z",
    removedAt: null,
  };

  it("接受 removedAt 为 null 的有效数据", () => {
    expect(DeckSlideEntrySchema.safeParse(base).success).toBe(true);
  });

  it("接受 removedAt 为 datetime 的有效数据", () => {
    expect(
      DeckSlideEntrySchema.safeParse({
        ...base,
        removedAt: "2026-07-21T12:30:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("拒绝空 slideId", () => {
    expect(
      DeckSlideEntrySchema.safeParse({ ...base, slideId: "" }).success,
    ).toBe(false);
  });

  it("拒绝空 workspacePath", () => {
    expect(
      DeckSlideEntrySchema.safeParse({ ...base, workspacePath: "" }).success,
    ).toBe(false);
  });
});

describe("DeckExportRecordSchema", () => {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    id: "11111111-1111-4111-8111-111111111111",
    exportedAt: "2026-07-20T00:00:00.000Z",
    outputPath: "exports/deck.pptx",
    outputSha256: "a".repeat(64),
    totalSlides: 3,
    nativeSlides: 2,
    placeholderSlides: 1,
    strict: true,
  };

  it("接受有效数据", () => {
    expect(DeckExportRecordSchema.safeParse(base).success).toBe(true);
  });

  it("拒绝无效 SHA256", () => {
    expect(
      DeckExportRecordSchema.safeParse({ ...base, outputSha256: "not-a-hash" })
        .success,
    ).toBe(false);
  });
});

describe("DeckManifestSchema", () => {
  const base = {
    schemaVersion: SCHEMA_VERSION,
    deckVersion: 1,
    deckId: "22222222-2222-4222-8222-222222222222",
    name: "示例演示",
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    aspectRatio: "16:9",
    fontFace: "Microsoft YaHei",
    cloudCalls: "explicit_only",
    slides: [
      {
        slideId: "slide-1",
        workspacePath: "slides/slide-1",
        sourceImageName: "source.png",
        addedAt: "2026-07-20T00:00:00.000Z",
        removedAt: null,
      },
    ],
    exports: [
      {
        schemaVersion: SCHEMA_VERSION,
        id: "33333333-3333-4333-8333-333333333333",
        exportedAt: "2026-07-20T00:00:00.000Z",
        outputPath: "exports/deck.pptx",
        outputSha256: "b".repeat(64),
        totalSlides: 1,
        nativeSlides: 1,
        placeholderSlides: 0,
        strict: false,
      },
    ],
  };

  it("接受有效的完整 manifest", () => {
    expect(DeckManifestSchema.safeParse(base).success).toBe(true);
  });

  it("拒绝错误的 schemaVersion", () => {
    expect(
      DeckManifestSchema.safeParse({
        ...base,
        schemaVersion: SCHEMA_VERSION + 1,
      }).success,
    ).toBe(false);
  });

  it("拒绝错误的 aspectRatio", () => {
    expect(
      DeckManifestSchema.safeParse({ ...base, aspectRatio: "4:3" }).success,
    ).toBe(false);
  });

  it("接受空 slides 数组", () => {
    expect(DeckManifestSchema.safeParse({ ...base, slides: [] }).success).toBe(
      true,
    );
  });

  it("接受空 exports 数组", () => {
    expect(DeckManifestSchema.safeParse({ ...base, exports: [] }).success).toBe(
      true,
    );
  });
});

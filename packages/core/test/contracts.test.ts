import { describe, expect, it } from "vitest";
import {
  ArtifactAcceptanceSchema,
  SCHEMA_VERSION,
  SlideManifestSchema,
  SlideWorkspaceManifestSchema,
  TextBlockSchema,
  WorkspaceRelativePathSchema,
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

describe("M1 workspace contracts", () => {
  it("拒绝离开工作区的持久化路径", () => {
    expect(WorkspaceRelativePathSchema.safeParse("../secret.txt").success).toBe(
      false,
    );
    expect(
      WorkspaceRelativePathSchema.safeParse("/tmp/secret.txt").success,
    ).toBe(false);
    expect(
      WorkspaceRelativePathSchema.safeParse("C:\\temp\\secret.txt").success,
    ).toBe(false);
    expect(
      WorkspaceRelativePathSchema.safeParse("stages/ocr/result.json").success,
    ).toBe(true);
  });

  it("拒绝缺少完整阶段集合的 manifest", () => {
    const result = SlideWorkspaceManifestSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      workspaceVersion: 1,
      slideId: "slide-1",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      configPath: "config.json",
      sourceImageAssetId: "source",
      referenceTextAssetId: null,
      assets: [],
      stages: [],
      attempts: [],
    });
    expect(result.success).toBe(false);
  });

  it("人工接受记录绑定产物哈希和上游指纹", () => {
    expect(
      ArtifactAcceptanceSchema.parse({
        schemaVersion: SCHEMA_VERSION,
        id: "accept-clean-001",
        stage: "accept-clean",
        artifactAssetId: "clean-001",
        artifactSha256: "a".repeat(64),
        upstreamFingerprint: "b".repeat(64),
        acceptedAt: "2026-07-20T00:00:00.000Z",
        acceptedBy: "developer",
        note: "容器和符号完整",
        checklist: { noTextResidue: true },
      }).artifactAssetId,
    ).toBe("clean-001");
  });
});

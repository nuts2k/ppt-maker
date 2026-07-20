import { describe, expect, it } from "vitest";
import {
  ArtifactAcceptanceSchema,
  createInitialStageStates,
  OcrProbeResponseSchema,
  ProviderCallRecordSchema,
  SCHEMA_VERSION,
  SlideManifestSchema,
  SlideWorkspaceConfigSchema,
  SlideWorkspaceManifestSchema,
  TextReviewValidationReportSchema,
  WorkspaceRelativePathSchema,
  WorkspaceStageAttemptSchema,
} from "../src/index.js";

describe("OcrProbeResponseSchema glyphHints", () => {
  function response(glyphHints: unknown) {
    return {
      schemaVersion: SCHEMA_VERSION,
      provider: "apple-vision",
      image: { width: 1600, height: 900 },
      blocks: [
        {
          id: "vision-0",
          text: "Hi",
          bboxPx: { x: 100, y: 100, width: 200, height: 60 },
          confidence: 0.97,
          rotationDeg: null,
          glyphHints,
        },
      ],
    };
  }

  it("解析字符级定位提示的四点四边形", () => {
    const parsed = OcrProbeResponseSchema.parse(
      response([
        {
          text: "H",
          quadPx: [
            { x: 100, y: 100 },
            { x: 130, y: 100 },
            { x: 130, y: 160 },
            { x: 100, y: 160 },
          ],
        },
      ]),
    );

    expect(parsed.blocks[0]?.glyphHints).toHaveLength(1);
    expect(parsed.blocks[0]?.glyphHints[0]?.quadPx[2]).toEqual({
      x: 130,
      y: 160,
    });
  });

  it("缺省 glyphHints 时回填空数组，保持向后兼容", () => {
    const parsed = OcrProbeResponseSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      provider: "apple-vision",
      image: { width: 1600, height: 900 },
      blocks: [
        {
          id: "vision-0",
          text: "Hi",
          bboxPx: { x: 100, y: 100, width: 200, height: 60 },
          confidence: 0.97,
          rotationDeg: null,
        },
      ],
    });

    expect(parsed.blocks[0]?.glyphHints).toEqual([]);
  });

  it("拒绝点数不足或负坐标的四边形", () => {
    expect(
      OcrProbeResponseSchema.safeParse(
        response([
          {
            text: "H",
            quadPx: [
              { x: 100, y: 100 },
              { x: 130, y: 100 },
              { x: 130, y: 160 },
            ],
          },
        ]),
      ).success,
    ).toBe(false);

    expect(
      OcrProbeResponseSchema.safeParse(
        response([
          {
            text: "H",
            quadPx: [
              { x: -1, y: 100 },
              { x: 130, y: 100 },
              { x: 130, y: 160 },
              { x: 100, y: 160 },
            ],
          },
        ]),
      ).success,
    ).toBe(false);
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

describe("核心 Schema 拒绝路径", () => {
  it("拒绝非法阶段尝试状态", () => {
    const result = WorkspaceStageAttemptSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      id: "ocr-001",
      stage: "ocr",
      number: 1,
      status: "cancelled",
      inputFingerprint: "a".repeat(64),
      startedAt: "2026-07-20T00:00:00.000Z",
      endedAt: null,
      provider: "apple-vision",
      providerVersion: "1",
      assetIds: [],
      error: null,
    });
    expect(result.success).toBe(false);
  });

  it("拒绝非 sha256 的阶段尝试输入指纹", () => {
    const result = WorkspaceStageAttemptSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      id: "ocr-001",
      stage: "ocr",
      number: 1,
      status: "running",
      inputFingerprint: "not-a-hash",
      startedAt: "2026-07-20T00:00:00.000Z",
      endedAt: null,
      provider: "apple-vision",
      providerVersion: "1",
      assetIds: [],
      error: null,
    });
    expect(result.success).toBe(false);
  });

  it("拒绝非 openai 的 Provider 调用记录与非法哈希", () => {
    const base = {
      schemaVersion: SCHEMA_VERSION,
      id: "provider-analyze-001",
      stage: "analyze" as const,
      endpoint: "/v1/responses",
      model: "gpt-5.6-sol",
      parameters: {},
      promptVersion: "m1-vision-analysis-v1",
      sentAssets: [{ path: "inputs/source.png", sha256: "a".repeat(64) }],
      requestId: "resp_1",
      startedAt: "2026-07-20T00:00:00.000Z",
      endedAt: "2026-07-20T00:00:01.000Z",
      durationMs: 1000,
      usage: null,
      error: null,
      rawResponsePath: "stages/analyze/analyze-001/raw-response.json",
      rawResponseSha256: "a".repeat(64),
      parsedResponsePath: "stages/analyze/analyze-001/result.json",
      parsedResponseSha256: "b".repeat(64),
    };
    expect(
      ProviderCallRecordSchema.safeParse({ ...base, provider: "anthropic" })
        .success,
    ).toBe(false);
    expect(
      ProviderCallRecordSchema.safeParse({
        ...base,
        provider: "openai",
        rawResponseSha256: "short",
      }).success,
    ).toBe(false);
    expect(
      ProviderCallRecordSchema.safeParse({ ...base, provider: "openai" })
        .success,
    ).toBe(true);
  });

  it("拒绝偏离固定档位的工作区配置", () => {
    const base = {
      schemaVersion: SCHEMA_VERSION,
      slideId: "slide-1",
      aspectRatio: "16:9" as const,
      fontFace: "Microsoft YaHei" as const,
      cloudCalls: "explicit_only" as const,
      sourceImagePath: "inputs/source.png",
      referenceTextPath: null,
    };
    expect(
      SlideWorkspaceConfigSchema.safeParse({ ...base, fontFace: "Arial" })
        .success,
    ).toBe(false);
    expect(
      SlideWorkspaceConfigSchema.safeParse({ ...base, cloudCalls: "always" })
        .success,
    ).toBe(false);
    expect(SlideWorkspaceConfigSchema.safeParse(base).success).toBe(true);
  });

  it("拒绝资产 id 重复的 manifest", () => {
    const asset = {
      schemaVersion: SCHEMA_VERSION,
      id: "dup",
      path: "inputs/source.png",
      role: "source_image" as const,
      sha256: "a".repeat(64),
      byteSize: 1,
      createdAt: "2026-07-20T00:00:00.000Z",
      producedBy: "init" as const,
      attemptId: "init-001",
      image: { width: 1600, height: 900, format: "png" as const },
    };
    const result = SlideWorkspaceManifestSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      workspaceVersion: 1,
      slideId: "slide-1",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
      configPath: "config.json",
      sourceImageAssetId: "dup",
      referenceTextAssetId: null,
      assets: [asset, { ...asset }],
      stages: createInitialStageStates("init-001", "a".repeat(64)),
      attempts: [],
    });
    expect(result.success).toBe(false);
  });

  it("拒绝哈希非法的复核校验报告", () => {
    const result = TextReviewValidationReportSchema.safeParse({
      schemaVersion: SCHEMA_VERSION,
      slideId: "slide-1",
      rulesVersion: "review-validation-v1",
      status: "passed",
      checkedAt: "2026-07-20T00:00:00.000Z",
      documentSha256: "not-a-hash",
      violations: [],
      summary: { errors: 0, warnings: 0 },
    });
    expect(result.success).toBe(false);
  });
});

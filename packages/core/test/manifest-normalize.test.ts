import { describe, expect, it } from "vitest";
import { normalizeSlideManifest } from "../src/index.js";

const HASH = "a".repeat(64);
const CONTEXT = { sourceImagePath: "inputs/source.png" };

function legacyManifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    workspaceVersion: 1,
    slideId: "slide-1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    configPath: "config.json",
    sourceImageAssetId: "asset-source-image",
    referenceTextAssetId: null,
    assets: [],
    stages: [
      {
        schemaVersion: 1,
        stage: "init",
        status: "completed",
        latestAttemptId: "init-001",
        lastSuccessfulAttemptId: "init-001",
        completedInputFingerprint: HASH,
        invalidatedAt: null,
        invalidationReason: null,
      },
    ],
    attempts: [],
  };
}

describe("旧 manifest 归一化", () => {
  it("补 imported 来源，溯源信息全部取自既有事实", () => {
    const result = normalizeSlideManifest(legacyManifest(), CONTEXT) as {
      source: Record<string, unknown>;
    };
    expect(result.source).toEqual({
      kind: "imported",
      originalFileName: "source.png",
      recordedAt: "2026-07-01T00:00:00.000Z",
      attemptId: "init-001",
    });
  });

  it("补 accept-source 状态并沿用 init 的指纹", () => {
    const result = normalizeSlideManifest(legacyManifest(), CONTEXT) as {
      stages: {
        stage: string;
        status: string;
        completedInputFingerprint: string;
      }[];
    };
    const gate = result.stages.find((state) => state.stage === "accept-source");
    expect(gate?.status).toBe("completed");
    expect(gate?.completedInputFingerprint).toBe(HASH);
  });

  it("已有来源与闸门状态时原样不动", () => {
    const raw = legacyManifest();
    raw.source = {
      kind: "generated",
      specEntryId: "entry-1",
      specEntrySha256: HASH,
      providerId: "openai",
      model: "gpt-image-2",
      promptVersion: "v1",
      promptSha256: HASH,
      parameters: {},
      recordedAt: "2026-07-02T00:00:00.000Z",
      attemptId: "init-002",
    };
    (raw.stages as unknown[]).push({
      schemaVersion: 1,
      stage: "accept-source",
      status: "pending",
      latestAttemptId: null,
      lastSuccessfulAttemptId: null,
      completedInputFingerprint: null,
      invalidatedAt: null,
      invalidationReason: null,
    });

    const result = normalizeSlideManifest(raw, CONTEXT) as {
      source: { kind: string };
      stages: { stage: string; status: string }[];
    };
    // 生成图的待确认状态不能被归一化悄悄改成已完成——那等于绕过源图确认闸门
    expect(result.source.kind).toBe("generated");
    expect(
      result.stages.filter((state) => state.stage === "accept-source"),
    ).toHaveLength(1);
    expect(
      result.stages.find((state) => state.stage === "accept-source")?.status,
    ).toBe("pending");
  });

  it("拿不到 init attempt 时原样返回，不掩盖真实损坏", () => {
    const raw = legacyManifest();
    raw.stages = [];
    expect(normalizeSlideManifest(raw, CONTEXT)).toBe(raw);
  });

  it("非对象输入原样返回", () => {
    expect(normalizeSlideManifest(null, CONTEXT)).toBeNull();
    expect(normalizeSlideManifest("x", CONTEXT)).toBe("x");
  });
});

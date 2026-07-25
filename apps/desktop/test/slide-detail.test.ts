import type {
  SlideStage,
  SlideWorkspaceManifest,
  WorkspaceStageAttempt,
  WorkspaceStageState,
} from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import {
  computeResumeStage,
  computeStageDurations,
  deriveStageDetails,
  extractLastError,
} from "../src/main/slide-detail.js";

const ALL_STAGES: SlideStage[] = [
  "init",
  "ocr",
  "review",
  "assist-review",
  "mask",
  "clean",
  "accept-clean",
  "pptx",
  "accept-pptx",
  "report",
];

function stageState(
  stage: SlideStage,
  status: WorkspaceStageState["status"],
): WorkspaceStageState {
  return {
    schemaVersion: 1,
    stage,
    status,
    latestAttemptId: null,
    lastSuccessfulAttemptId: null,
    completedInputFingerprint: null,
    invalidatedAt: null,
    invalidationReason: null,
  };
}

/** 按给定的已完成阶段构造 manifest，其余阶段为 pending */
function buildManifest(
  completed: SlideStage[],
  overrides: Partial<Record<SlideStage, WorkspaceStageState["status"]>> = {},
  attempts: WorkspaceStageAttempt[] = [],
): SlideWorkspaceManifest {
  const completedSet = new Set(completed);
  return {
    schemaVersion: 1,
    workspaceVersion: 1,
    slideId: "slide-1",
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    configPath: "config.json",
    sourceImageAssetId: "asset-1",
    referenceTextAssetId: null,
    assets: [],
    stages: ALL_STAGES.map((stage) =>
      stageState(
        stage,
        overrides[stage] ?? (completedSet.has(stage) ? "completed" : "pending"),
      ),
    ),
    attempts,
  };
}

function attempt(
  stage: SlideStage,
  status: WorkspaceStageAttempt["status"],
  startedAt: string,
  endedAt: string | null,
  error: WorkspaceStageAttempt["error"] = null,
): WorkspaceStageAttempt {
  return {
    schemaVersion: 1,
    id: `${stage}-${startedAt}`,
    stage,
    number: 1,
    status,
    inputFingerprint: "a".repeat(64),
    startedAt,
    endedAt,
    provider: null,
    providerVersion: null,
    assetIds: [],
    error,
  };
}

describe("computeResumeStage", () => {
  it("全新工作区从 ocr 开始", () => {
    expect(computeResumeStage(buildManifest(["init"]))).toBe("ocr");
  });

  it("跳过已完成阶段，返回第一个未完成阶段", () => {
    const manifest = buildManifest(["init", "ocr", "review", "assist-review"]);
    expect(computeResumeStage(manifest)).toBe("mask");
  });

  it("不把无持久化记录的 validate-review 当作断点判据", () => {
    // validate-review 在 manifest 中不存在，若被当作判据会导致每轮都从它重来
    const manifest = buildManifest(["init", "ocr", "review", "assist-review"]);
    expect(computeResumeStage(manifest)).not.toBe("validate-review");
  });

  it("全部完成时返回 null（批量执行据此跳过该页）", () => {
    expect(computeResumeStage(buildManifest(ALL_STAGES))).toBeNull();
  });

  it("失败阶段视为未完成，从该阶段续跑", () => {
    const manifest = buildManifest(["init", "ocr", "review", "assist-review"], {
      mask: "failed",
    });
    expect(computeResumeStage(manifest)).toBe("mask");
  });

  it("stale 阶段重新纳入执行范围", () => {
    const manifest = buildManifest(ALL_STAGES, { clean: "stale" });
    expect(computeResumeStage(manifest)).toBe("clean");
  });
});

describe("deriveStageDetails", () => {
  it("输出执行序列的 10 个阶段且不含 init", () => {
    const details = deriveStageDetails(buildManifest(["init"]));
    expect(details).toHaveLength(10);
    expect(details.map((d) => d.stage)).toEqual([
      "ocr",
      "review",
      "assist-review",
      "validate-review",
      "mask",
      "clean",
      "accept-clean",
      "pptx",
      "accept-pptx",
      "report",
    ]);
  });

  it("mask 未完成时 validate-review 为 pending", () => {
    const details = deriveStageDetails(
      buildManifest(["init", "ocr", "review", "assist-review"]),
    );
    expect(details.find((d) => d.stage === "validate-review")?.status).toBe(
      "pending",
    );
  });

  it("mask 已完成时反推 validate-review 必然通过过", () => {
    const details = deriveStageDetails(
      buildManifest(["init", "ocr", "review", "assist-review", "mask"]),
    );
    expect(details.find((d) => d.stage === "validate-review")?.status).toBe(
      "completed",
    );
  });

  it("透传 manifest 中的失败态", () => {
    const details = deriveStageDetails(
      buildManifest(["init", "ocr"], { review: "failed" }),
    );
    expect(details.find((d) => d.stage === "review")?.status).toBe("failed");
  });
});

describe("extractLastError", () => {
  it("无失败 attempt 时返回 null", () => {
    const manifest = buildManifest(["init", "ocr"], {}, [
      attempt(
        "ocr",
        "completed",
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:05.000Z",
      ),
    ]);
    expect(extractLastError(manifest)).toBeNull();
  });

  it("取结束时间最新的失败 attempt", () => {
    const manifest = buildManifest(["init"], {}, [
      attempt(
        "ocr",
        "failed",
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:01.000Z",
        { code: "OCR_FAILED", message: "旧错误" },
      ),
      attempt(
        "mask",
        "failed",
        "2026-07-01T00:10:00.000Z",
        "2026-07-01T00:10:02.000Z",
        { code: "MASK_FAILED", message: "新错误" },
      ),
    ]);
    expect(extractLastError(manifest)).toMatchObject({
      stage: "mask",
      code: "MASK_FAILED",
      message: "新错误",
    });
  });

  it("忽略没有 error 详情的失败 attempt", () => {
    const manifest = buildManifest(["init"], {}, [
      attempt(
        "ocr",
        "failed",
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:01.000Z",
        null,
      ),
    ]);
    expect(extractLastError(manifest)).toBeNull();
  });
});

describe("computeStageDurations", () => {
  it("只统计成功执行的耗时", () => {
    const manifest = buildManifest(["init", "ocr"], {}, [
      attempt(
        "ocr",
        "completed",
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:03.500Z",
      ),
      attempt(
        "mask",
        "failed",
        "2026-07-01T00:01:00.000Z",
        "2026-07-01T00:01:09.000Z",
        { code: "MASK_FAILED", message: "失败" },
      ),
    ]);
    expect(computeStageDurations(manifest)).toEqual({ ocr: 3500 });
  });

  it("同阶段多次成功时取最近一次", () => {
    const manifest = buildManifest(["init", "ocr"], {}, [
      attempt(
        "ocr",
        "completed",
        "2026-07-01T00:00:00.000Z",
        "2026-07-01T00:00:10.000Z",
      ),
      attempt(
        "ocr",
        "completed",
        "2026-07-01T01:00:00.000Z",
        "2026-07-01T01:00:02.000Z",
      ),
    ]);
    expect(computeStageDurations(manifest)).toEqual({ ocr: 2000 });
  });

  it("未结束的 attempt 不计入", () => {
    const manifest = buildManifest(["init"], {}, [
      attempt("ocr", "running", "2026-07-01T00:00:00.000Z", null),
    ]);
    expect(computeStageDurations(manifest)).toEqual({});
  });
});

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
  "accept-source",
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
    source: {
      kind: "imported",
      originalFileName: "source.png",
      recordedAt: "2026-07-01T00:00:00.000Z",
      attemptId: "init-001",
    },
    sourceImageAssetId: "asset-1",
    referenceTextAssetId: null,
    assets: [],
    stages: ALL_STAGES.map((stage) =>
      stageState(
        stage,
        overrides[stage] ??
          // 本 fixture 是 imported 页（见上面的 source），其源图确认在建立工作区时
          // 自动放行，故默认已完成。generated 页由 overrides 显式置 pending。
          (completedSet.has(stage) || stage === "accept-source"
            ? "completed"
            : "pending"),
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

  it("生成图未确认源图时起点是 accept-source（D6 第三个人工点）", () => {
    // imported / extracted 页不会走到这里——它们的源图确认在建立工作区时已自动放行。
    const manifest = buildManifest(["init"], { "accept-source": "pending" });
    expect(computeResumeStage(manifest)).toBe("accept-source");
  });

  it("跳过已完成阶段，回退到未完成阶段前的 validate-review", () => {
    const manifest = buildManifest(["init", "ocr", "review", "assist-review"]);
    expect(computeResumeStage(manifest)).toBe("validate-review");
  });

  it("validate-review 不作为判据：缺记录不会让起点停在更早的阶段", () => {
    // 它在 manifest 中永远没有记录，若拿它当「是否完成」的判据，
    // 每页每轮都会被判成从头开始——判据只看持久阶段，起点才回退到它。
    const manifest = buildManifest(["init", "ocr"]);
    expect(computeResumeStage(manifest)).toBe("review");
  });

  it("下游已完成则不再回退：mask 完成说明当时的校验已通过", () => {
    const manifest = buildManifest([
      "init",
      "ocr",
      "review",
      "assist-review",
      "mask",
    ]);
    expect(computeResumeStage(manifest)).toBe("clean");
  });

  it("全部完成时返回 null（批量执行据此跳过该页）", () => {
    expect(computeResumeStage(buildManifest(ALL_STAGES))).toBeNull();
  });

  it("失败阶段视为未完成，从其前置的 validate-review 续跑", () => {
    // 回归防线：曾经这里直接返回 mask，用户保存复核后 text-blocks.json 的 sha
    // 变化，mask 报「在校验后已改动，请重新运行 validate-review」，而起点恒为
    // mask、永不回头校验 —— 点多少次「运行此页」都不动。
    const manifest = buildManifest(["init", "ocr", "review", "assist-review"], {
      mask: "failed",
    });
    expect(computeResumeStage(manifest)).toBe("validate-review");
  });

  it("stale 阶段重新纳入执行范围", () => {
    const manifest = buildManifest(ALL_STAGES, { clean: "stale" });
    expect(computeResumeStage(manifest)).toBe("clean");
  });
});

describe("deriveStageDetails", () => {
  // report 不在此列：它是验收后静默补跑的本地汇总，不占可见轨道（shared/stages.ts）
  it("输出执行序列的 10 个阶段，不含 init 与 report", () => {
    const details = deriveStageDetails(buildManifest(["init"]));
    expect(details).toHaveLength(10);
    expect(details.map((d) => d.stage)).toEqual([
      "accept-source",
      "ocr",
      "review",
      "assist-review",
      "validate-review",
      "mask",
      "clean",
      "accept-clean",
      "pptx",
      "accept-pptx",
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

  it("阶段重试成功后不再报旧错误", () => {
    // 真实工作区的形态：assist-review 前三次缺 OPENAI_API_KEY 失败、第四次成功。
    // 按历史 attempt 取最新失败会让这条早已解决的错误永久挂在界面上。
    const failed = attempt(
      "assist-review",
      "failed",
      "2026-07-01T00:00:00.000Z",
      "2026-07-01T00:00:01.000Z",
      { code: "MISSING_DEPENDENCY", message: "缺少 OPENAI_API_KEY" },
    );
    const succeeded = attempt(
      "assist-review",
      "completed",
      "2026-07-01T00:05:00.000Z",
      "2026-07-01T00:05:30.000Z",
    );
    const manifest = buildManifest(
      ["init", "ocr", "review", "assist-review"],
      {},
      [failed, succeeded],
    );
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

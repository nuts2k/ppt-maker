/**
 * 单页产物读取（main 侧）：待复核块计数、最终确认页的检查记录、PPTX 产物定位。
 *
 * 断言都落在真实目录结构上——这些函数唯一的失败方式就是路径或 attempt 挑错，
 * 而那类错误在纯内存断言下永远发现不了（见静默失败诊断指南）。
 */

import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  SlideStage,
  SlideWorkspaceManifest,
  TextReviewDocument,
  WorkspaceAsset,
  WorkspaceStageState,
} from "@ppt-maker/core";
import { TextReviewDocumentSchema } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import {
  countPendingTextReview,
  loadTextReviewDocument,
  readFinalChecks,
  readPendingTextReview,
  resolvePptxArtifactPath,
} from "../src/main/slide-detail.js";

const fixtureDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/review-partition",
);

/** 真实工作区快照（page-02，95 块，全部已复核） */
function loadFixtureDocument(): TextReviewDocument {
  return TextReviewDocumentSchema.parse(
    JSON.parse(readFileSync(join(fixtureDir, "page-02.json"), "utf8")),
  );
}

async function createWorkspaceDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "slide-artifacts-"));
}

async function writeWorkspaceFile(
  workspacePath: string,
  relativePath: string,
  content: unknown,
): Promise<void> {
  const filePath = join(workspacePath, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(content), "utf-8");
}

const SHA = "a".repeat(64);

function asset(
  id: string,
  path: string,
  role: WorkspaceAsset["role"],
  producedBy: SlideStage,
  attemptId: string,
): WorkspaceAsset {
  return {
    schemaVersion: 1,
    id,
    path,
    role,
    sha256: SHA,
    byteSize: 1,
    createdAt: "2026-07-01T00:00:00.000Z",
    producedBy,
    attemptId,
    image: null,
  };
}

function stageState(
  stage: SlideStage,
  lastSuccessfulAttemptId: string | null,
): WorkspaceStageState {
  return {
    schemaVersion: 1,
    stage,
    status: lastSuccessfulAttemptId === null ? "pending" : "completed",
    latestAttemptId: lastSuccessfulAttemptId,
    lastSuccessfulAttemptId,
    completedInputFingerprint: lastSuccessfulAttemptId === null ? null : SHA,
    invalidatedAt: null,
    invalidationReason: null,
  };
}

function buildManifest(
  stages: WorkspaceStageState[],
  assets: WorkspaceAsset[],
): SlideWorkspaceManifest {
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
    sourceImageAssetId: "asset-source",
    referenceTextAssetId: null,
    assets,
    stages,
    attempts: [],
  };
}

function cleanRecord(attemptId: string, residualPixels: number): unknown {
  return {
    schemaVersion: 1,
    attemptId,
    model: "gpt-image-2",
    promptVersion: "clean-v1",
    size: "2048x1152",
    quality: "high",
    outputFormat: "png",
    sourceImageSha256: SHA,
    maskSha256: SHA,
    reviewDocumentSha256: SHA,
    resultSha256: SHA,
    requestId: "req-1",
    usage: null,
    durationMs: 1000,
    checks: {
      size: {
        width: 1672,
        height: 940,
        expectedWidth: 2048,
        expectedHeight: 1152,
        ok: false,
        aspectRatioOk: true,
      },
      textResidue: {
        maskedPixels: 1000,
        residualForegroundPixels: residualPixels,
        residualRatio: 0,
      },
      outsideMaskDiff: {
        comparedPixels: 100,
        changedPixels: 4,
        changedRatio: 0.041,
        meanDelta: 1,
        threshold: 12,
      },
      containerRingDiff: {
        ringPixels: 100,
        changedPixels: 2,
        changedRatio: 0.0184,
      },
    },
  };
}

function pptxCheck(status: "passed" | "failed"): unknown {
  return {
    schemaVersion: 1,
    status,
    checks: [{ id: "layout", status, message: "版面 16:9" }],
    layout: { widthEmu: 12192000, heightEmu: 6858000, aspectRatioOk: true },
    shapes: { images: 1, textBoxes: 44, expectedTextBoxes: 44 },
    fontFace: "Microsoft YaHei",
    fontDeclared: true,
    missingTexts: [],
  };
}

describe("countPendingTextReview", () => {
  it("真实快照全部已复核时为 0", () => {
    expect(countPendingTextReview(loadFixtureDocument())).toBe(0);
  });

  it("只数版式目标文字：对象符号未复核不计入", () => {
    const document = loadFixtureDocument();
    // 全部 object_symbol 与前 3 个 layout_text 置为未复核，只有后者该被计入
    let remaining = 3;
    const blocks = document.blocks.map((block) => {
      if (block.classification === "object_integrated_symbol") {
        return { ...block, reviewStatus: "unreviewed" as const };
      }
      if (remaining > 0) {
        remaining -= 1;
        return { ...block, reviewStatus: "unreviewed" as const };
      }
      return block;
    });
    expect(countPendingTextReview({ ...document, blocks })).toBe(3);
  });
});

describe("loadTextReviewDocument / readPendingTextReview", () => {
  it("按 stages/review/text-blocks.json 定位并解析", async () => {
    const workspacePath = await createWorkspaceDir();
    const document = loadFixtureDocument();
    await writeWorkspaceFile(
      workspacePath,
      "stages/review/text-blocks.json",
      document,
    );

    const loaded = await loadTextReviewDocument(workspacePath);
    expect(loaded?.blocks).toHaveLength(95);
    expect(await readPendingTextReview(workspacePath)).toBe(0);
  });

  it("复核文档缺失时为 null / 0，不抛错", async () => {
    const workspacePath = await createWorkspaceDir();
    expect(await loadTextReviewDocument(workspacePath)).toBeNull();
    expect(await readPendingTextReview(workspacePath)).toBe(0);
  });

  it("文档损坏时为 null（不把坏数据当成 0 待复核之外的任何东西）", async () => {
    const workspacePath = await createWorkspaceDir();
    const filePath = join(workspacePath, "stages/review/text-blocks.json");
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, "{ 坏 JSON", "utf-8");
    expect(await loadTextReviewDocument(workspacePath)).toBeNull();
  });
});

describe("readFinalChecks", () => {
  it("取当前成功尝试的记录，而不是同 role 的第一条", async () => {
    // 真实工作区里 clean 跑过两次，clean_record 有 001/002 两条；
    // 按 role 取第一条会展示早已被取代的 001 的指标。
    const workspacePath = await createWorkspaceDir();
    await writeWorkspaceFile(
      workspacePath,
      "stages/clean/clean-001/record.json",
      cleanRecord("clean-001", 999),
    );
    await writeWorkspaceFile(
      workspacePath,
      "stages/clean/clean-002/record.json",
      cleanRecord("clean-002", 0),
    );
    await writeWorkspaceFile(
      workspacePath,
      "stages/pptx/check.json",
      pptxCheck("passed"),
    );

    const manifest = buildManifest(
      [stageState("clean", "clean-002"), stageState("pptx", "pptx-001")],
      [
        asset(
          "a1",
          "stages/clean/clean-001/record.json",
          "clean_record",
          "clean",
          "clean-001",
        ),
        asset(
          "a2",
          "stages/clean/clean-002/record.json",
          "clean_record",
          "clean",
          "clean-002",
        ),
        asset("a3", "stages/pptx/check.json", "pptx_check", "pptx", "pptx-001"),
      ],
    );

    const checks = await readFinalChecks(workspacePath, manifest);
    expect(checks.clean?.textResidue.residualForegroundPixels).toBe(0);
    expect(checks.clean?.size.ok).toBe(false);
    expect(checks.pptx?.status).toBe("passed");
  });

  it("阶段未跑或文件缺失时为 null", async () => {
    const workspacePath = await createWorkspaceDir();
    const manifest = buildManifest(
      [stageState("clean", null), stageState("pptx", "pptx-001")],
      [asset("a1", "stages/pptx/check.json", "pptx_check", "pptx", "pptx-001")],
    );
    // 资产已登记但文件不在：也必须是 null，而不是抛错让整页打不开
    const checks = await readFinalChecks(workspacePath, manifest);
    expect(checks.clean).toBeNull();
    expect(checks.pptx).toBeNull();
  });
});

describe("resolvePptxArtifactPath", () => {
  it("返回当前成功尝试的 pptx 绝对路径", () => {
    const manifest = buildManifest(
      [stageState("pptx", "pptx-002")],
      [
        asset("a1", "stages/pptx/slide.pptx", "pptx", "pptx", "pptx-001"),
        asset("a2", "stages/pptx/slide.pptx", "pptx", "pptx", "pptx-002"),
      ],
    );
    expect(resolvePptxArtifactPath("/ws", manifest)).toBe(
      join("/ws", "stages/pptx/slide.pptx"),
    );
  });

  it("pptx 未生成时为 null（界面据此说明为何打不开）", () => {
    const manifest = buildManifest([stageState("pptx", null)], []);
    expect(resolvePptxArtifactPath("/ws", manifest)).toBeNull();
  });
});

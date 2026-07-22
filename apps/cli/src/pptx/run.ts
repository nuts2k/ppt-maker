import { readFile } from "node:fs/promises";
import {
  ArtifactAcceptanceSchema,
  assertStageDependenciesCompleted,
  DEFAULT_FONT_FACE,
  type DoctorReport,
  FoundationError,
  invalidateStageAndDownstream,
  isStageReusable,
  type PptxCheckReport,
  PptxCheckReportSchema,
  type PptxSynthesisRecord,
  PptxSynthesisRecordSchema,
  SCHEMA_VERSION,
  type SlideWorkspaceManifest,
  type TextReviewBlock,
  TextReviewDocumentSchema,
  type WorkspaceAsset,
  type WorkspaceStageAttempt,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import { assertPptxFontReady, collectSystemDoctorReport } from "../doctor.js";
import {
  assertWorkspaceAssetIntegrity,
  createWorkspaceAsset,
  loadSlideWorkspace,
  resolveWorkspacePath,
  sha256File,
  sha256Values,
  writeJsonAtomic,
  writeWorkspaceManifest,
} from "../slide/workspace.js";
import { checkPptx } from "./checks.js";
import { sampleBlockColors } from "./sample-color.js";
import { synthesizePptx } from "./synthesize.js";

const REVIEW_OUTPUT_PATH = "stages/review/text-blocks.json";
const PPTX_PATH = "stages/pptx/slide.pptx";
const CHECK_PATH = "stages/pptx/check.json";
const RECORD_PATH = "stages/pptx/record.json";
export const PPTX_SYNTHESIS_VERSION = "pptx-synthesis-v7";

export interface RunSlidePptxOptions {
  readonly workspacePath: string;
  readonly fontFace?: string;
  readonly doctorReport?: DoctorReport;
}

export interface RunSlidePptxResult {
  readonly pptxPath: string;
  readonly attemptId: string;
  readonly reused: boolean;
  readonly checkStatus: "passed" | "failed";
}

function replaceStageState(
  states: readonly WorkspaceStageState[],
  replacement: WorkspaceStageState,
): WorkspaceStageState[] {
  return states.map((state) =>
    state.stage === replacement.stage ? replacement : state,
  );
}

function replaceAttempt(
  attempts: readonly WorkspaceStageAttempt[],
  replacement: WorkspaceStageAttempt,
): WorkspaceStageAttempt[] {
  return attempts.map((attempt) =>
    attempt.id === replacement.id ? replacement : attempt,
  );
}

function findAssetById(
  manifest: SlideWorkspaceManifest,
  assetId: string,
): WorkspaceAsset {
  const asset = manifest.assets.find((candidate) => candidate.id === assetId);
  if (asset === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      `manifest 未引用有效资产：${assetId}`,
      { assetId },
    );
  }
  return asset;
}

function stageError(error: unknown): WorkspaceStageAttempt["error"] {
  if (error instanceof FoundationError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

// 门禁：所有 layout_text 块必须已复核；object_integrated_symbol/uncertain 不进文本框。
function selectTextBoxBlocks(
  blocks: readonly TextReviewBlock[],
): TextReviewBlock[] {
  const unreviewed = blocks.filter(
    (block) =>
      block.classification === "layout_text" &&
      block.reviewStatus === "unreviewed",
  );
  if (unreviewed.length > 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "存在未复核的版式目标文字，无法导出 PPTX",
      { blockIds: unreviewed.map((block) => block.id) },
    );
  }
  return blocks.filter((block) => block.classification === "layout_text");
}

// 门禁：clean plate 必须存在有效且非 stale 的人工接受记录，且接受哈希锚定当前产物。
async function assertAcceptedCleanPlate(
  workspacePath: string,
  manifest: SlideWorkspaceManifest,
): Promise<WorkspaceAsset> {
  const acceptState = manifest.stages.find(
    (state) => state.stage === "accept-clean",
  );
  if (acceptState?.status !== "completed") {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "clean plate 未接受或接受记录已 stale，无法导出 PPTX",
      { acceptCleanStatus: acceptState?.status ?? "missing" },
    );
  }
  const acceptanceAsset = manifest.assets.find(
    (asset) => asset.role === "clean_acceptance",
  );
  if (acceptanceAsset === undefined) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "缺少 clean plate 接受记录",
    );
  }
  await assertWorkspaceAssetIntegrity(workspacePath, acceptanceAsset);
  const acceptance = ArtifactAcceptanceSchema.parse(
    JSON.parse(
      await readFile(
        resolveWorkspacePath(workspacePath, acceptanceAsset.path),
        "utf8",
      ),
    ),
  );
  const cleanAsset = manifest.assets.find(
    (asset) => asset.id === acceptance.artifactAssetId,
  );
  if (cleanAsset === undefined) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "接受记录引用的 clean plate 产物不存在",
    );
  }
  await assertWorkspaceAssetIntegrity(workspacePath, cleanAsset);
  if (acceptance.artifactSha256 !== cleanAsset.sha256) {
    throw new FoundationError(
      "ASSET_INTEGRITY_MISMATCH",
      "clean plate 接受记录的哈希与当前产物不一致",
    );
  }
  return cleanAsset;
}

export async function runSlidePptx(
  options: RunSlidePptxOptions,
): Promise<RunSlidePptxResult> {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "pptx");

  const fontFace = options.fontFace ?? DEFAULT_FONT_FACE;
  const fontFallback = fontFace !== DEFAULT_FONT_FACE;
  const report = options.doctorReport ?? collectSystemDoctorReport();
  assertPptxFontReady(report, options.fontFace);

  const source = findAssetById(
    workspace.manifest,
    workspace.manifest.sourceImageAssetId,
  );
  await assertWorkspaceAssetIntegrity(workspace.path, source);
  if (source.image === null) {
    throw new FoundationError("INVALID_WORKSPACE", "源图资产缺少尺寸元数据");
  }
  const cleanAsset = await assertAcceptedCleanPlate(
    workspace.path,
    workspace.manifest,
  );

  const reviewPath = resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH);
  const reviewDocumentSha256 = await sha256File(reviewPath);
  const document = TextReviewDocumentSchema.parse(
    JSON.parse(await readFile(reviewPath, "utf8")),
  );
  const boxBlocks = selectTextBoxBlocks(document.blocks);

  const inputFingerprint = sha256Values([
    cleanAsset.sha256,
    reviewDocumentSha256,
    fontFace,
    PPTX_SYNTHESIS_VERSION,
  ]);
  const previousState = workspace.manifest.stages.find(
    (state) => state.stage === "pptx",
  );
  if (previousState === undefined) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 pptx 阶段状态");
  }
  if (
    isStageReusable(previousState, inputFingerprint) &&
    previousState.lastSuccessfulAttemptId !== null
  ) {
    const pptxAsset = workspace.manifest.assets.find(
      (asset) => asset.role === "pptx",
    );
    const checkAsset = workspace.manifest.assets.find(
      (asset) => asset.role === "pptx_check",
    );
    if (pptxAsset !== undefined && checkAsset !== undefined) {
      await assertWorkspaceAssetIntegrity(workspace.path, pptxAsset);
      const check = PptxCheckReportSchema.parse(
        JSON.parse(
          await readFile(
            resolveWorkspacePath(workspace.path, checkAsset.path),
            "utf8",
          ),
        ),
      );
      return {
        pptxPath: resolveWorkspacePath(workspace.path, pptxAsset.path),
        attemptId: previousState.lastSuccessfulAttemptId,
        reused: true,
        checkStatus: check.status,
      };
    }
  }

  const attemptNumber =
    workspace.manifest.attempts.filter((attempt) => attempt.stage === "pptx")
      .length + 1;
  const attemptId = `pptx-${String(attemptNumber).padStart(3, "0")}`;
  const startedAt = new Date().toISOString();
  const invalidatedStates =
    previousState.completedInputFingerprint !== null &&
    previousState.completedInputFingerprint !== inputFingerprint
      ? invalidateStageAndDownstream(
          workspace.manifest.stages,
          "pptx",
          "pptx 输入指纹变化",
          startedAt,
        )
      : workspace.manifest.stages;
  const invalidatedState = invalidatedStates.find(
    (state) => state.stage === "pptx",
  );
  if (invalidatedState === undefined) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 pptx 阶段状态");
  }
  const runningAttempt: WorkspaceStageAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "pptx",
    number: attemptNumber,
    status: "running",
    inputFingerprint,
    startedAt,
    endedAt: null,
    provider: "ppt-maker-cli",
    providerVersion: PPTX_SYNTHESIS_VERSION,
    assetIds: [],
    error: null,
  };
  const runningState: WorkspaceStageState = {
    ...invalidatedState,
    status: "running",
    latestAttemptId: attemptId,
    invalidatedAt: null,
    invalidationReason: null,
  };
  const runningManifest: SlideWorkspaceManifest = {
    ...workspace.manifest,
    updatedAt: startedAt,
    stages: replaceStageState(invalidatedStates, runningState),
    attempts: [...workspace.manifest.attempts, runningAttempt],
  };
  await writeWorkspaceManifest(workspace.path, runningManifest);

  try {
    const sourcePath = resolveWorkspacePath(workspace.path, source.path);
    const maskPath = resolveWorkspacePath(
      workspace.path,
      "stages/mask/mask.png",
    );
    const sampledColors = await sampleBlockColors({
      sourcePath,
      maskPath,
      blocks: boxBlocks,
      imageWidth: source.image.width,
      imageHeight: source.image.height,
    });
    const coloredBlocks = boxBlocks.map((block) => {
      const hex = sampledColors.get(block.id);
      if (hex === undefined || block.style.colorHex !== null) return block;
      return { ...block, style: { ...block.style, colorHex: hex } };
    });

    const pptxPath = resolveWorkspacePath(workspace.path, PPTX_PATH);
    const synthesis = await synthesizePptx({
      cleanPlatePath: resolveWorkspacePath(workspace.path, cleanAsset.path),
      outputPath: pptxPath,
      blocks: coloredBlocks,
      imageWidth: source.image.width,
      imageHeight: source.image.height,
      fontFace,
    });
    const pptxBuffer = await readFile(pptxPath);
    const check: PptxCheckReport = PptxCheckReportSchema.parse(
      await checkPptx({
        pptxBuffer,
        expectedTexts: synthesis.textContents,
        fontFace,
        expectedTextBoxes: synthesis.textBoxCount,
      }),
    );
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, CHECK_PATH),
      check,
    );

    const endedAt = new Date().toISOString();
    const pptxAsset = await createWorkspaceAsset(pptxPath, {
      schemaVersion: SCHEMA_VERSION,
      id: "asset-pptx",
      path: PPTX_PATH,
      role: "pptx",
      createdAt: endedAt,
      producedBy: "pptx",
      attemptId,
      image: null,
    });
    const checkAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, CHECK_PATH),
      {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-pptx-check",
        path: CHECK_PATH,
        role: "pptx_check",
        createdAt: endedAt,
        producedBy: "pptx",
        attemptId,
        image: null,
      },
    );

    const record: PptxSynthesisRecord = PptxSynthesisRecordSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      attemptId,
      cleanPlateSha256: cleanAsset.sha256,
      reviewDocumentSha256,
      fontFace,
      fontFallback,
      textBoxCount: synthesis.textBoxCount,
      resultSha256: pptxAsset.sha256,
      checkSha256: checkAsset.sha256,
      checkStatus: check.status,
    });
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, RECORD_PATH),
      record,
    );
    const recordAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, RECORD_PATH),
      {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-pptx-record",
        path: RECORD_PATH,
        role: "pptx_record",
        createdAt: endedAt,
        producedBy: "pptx",
        attemptId,
        image: null,
      },
    );

    const newAssets = [pptxAsset, checkAsset, recordAsset];
    const newAssetIds = new Set(newAssets.map((asset) => asset.id));
    const completedAttempt: WorkspaceStageAttempt = {
      ...runningAttempt,
      status: "completed",
      endedAt,
      assetIds: newAssets.map((asset) => asset.id),
    };
    const completedState: WorkspaceStageState = {
      ...runningState,
      status: "completed",
      lastSuccessfulAttemptId: attemptId,
      completedInputFingerprint: inputFingerprint,
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      assets: [
        ...runningManifest.assets.filter((asset) => !newAssetIds.has(asset.id)),
        ...newAssets,
      ],
      stages: replaceStageState(runningManifest.stages, completedState),
      attempts: replaceAttempt(runningManifest.attempts, completedAttempt),
    });
    return {
      pptxPath,
      attemptId,
      reused: false,
      checkStatus: check.status,
    };
  } catch (error) {
    const endedAt = new Date().toISOString();
    const failedAttempt: WorkspaceStageAttempt = {
      ...runningAttempt,
      status: "failed",
      endedAt,
      error: stageError(error),
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      stages: replaceStageState(runningManifest.stages, {
        ...runningState,
        status: "failed",
      }),
      attempts: replaceAttempt(runningManifest.attempts, failedAttempt),
    });
    throw error;
  }
}

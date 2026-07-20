import { readFile } from "node:fs/promises";
import {
  assertStageDependenciesCompleted,
  FoundationError,
  invalidateStageAndDownstream,
  isStageReusable,
  MASK_ALGORITHM_VERSION,
  type MaskBlockCoverage,
  type MaskRecord,
  MaskRecordSchema,
  SCHEMA_VERSION,
  type SlideWorkspaceManifest,
  type TextReviewBlock,
  TextReviewDocumentSchema,
  TextReviewValidationReportSchema,
  type WorkspaceAsset,
  type WorkspaceStageAttempt,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import sharp from "sharp";
import {
  type BlockSegmentationParams,
  countMasked,
  hexToRgb,
  type Point,
  type RgbaImage,
  segmentBlockGlyphs,
  unionInto,
} from "../mask/algorithms.js";
import {
  assertWorkspaceAssetIntegrity,
  createWorkspaceAsset,
  loadSlideWorkspace,
  resolveWorkspacePath,
  sha256File,
  sha256Values,
  writeBufferAtomic,
  writeJsonAtomic,
  writeWorkspaceManifest,
} from "../slide/workspace.js";

const REVIEW_OUTPUT_PATH = "stages/review/text-blocks.json";
const MASK_PATH = "stages/mask/mask.png";
const PREVIEW_PATH = "stages/mask/preview.png";
const OVERLAY_PATH = "stages/mask/overlay.png";
const RECORD_PATH = "stages/mask/record.json";

export interface RunSlideMaskOptions {
  readonly workspacePath: string;
}

export interface RunSlideMaskResult {
  readonly maskPath: string;
  readonly attemptId: string;
  readonly reused: boolean;
  readonly totalMaskedPixels: number;
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

// 门禁 a：mask 消费 review 前，必须存在通过的 validate-review 且其锚定哈希等于当前复核文件哈希。
async function assertReviewValidated(
  workspacePath: string,
  manifest: SlideWorkspaceManifest,
  reviewDocumentSha256: string,
): Promise<void> {
  const validationAsset = manifest.assets.find(
    (asset) => asset.role === "review_validation",
  );
  if (validationAsset === undefined) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 mask 前必须先通过 validate-review",
    );
  }
  await assertWorkspaceAssetIntegrity(workspacePath, validationAsset);
  const report = TextReviewValidationReportSchema.parse(
    JSON.parse(
      await readFile(
        resolveWorkspacePath(workspacePath, validationAsset.path),
        "utf8",
      ),
    ),
  );
  if (report.status !== "passed") {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "validate-review 未通过，无法运行 mask",
      { status: report.status },
    );
  }
  if (report.documentSha256 !== reviewDocumentSha256) {
    throw new FoundationError(
      "ASSET_INTEGRITY_MISMATCH",
      "text-blocks.json 在校验后已改动，请重新运行 validate-review",
      {
        validatedSha256: report.documentSha256,
        currentSha256: reviewDocumentSha256,
      },
    );
  }
}

// 门禁 b：includeInMask 块必须已确认（reviewed / accepted_with_risk）且为版式目标文字。
function assertMaskBlocksConfirmed(blocks: readonly TextReviewBlock[]): void {
  const unconfirmed = blocks.filter(
    (block) => block.reviewStatus === "unreviewed",
  );
  if (unconfirmed.length > 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "存在未复核却参与 mask 的文字块，mask 只覆盖已确认目标文字",
      { blockIds: unconfirmed.map((block) => block.id) },
    );
  }
  const nonLayout = blocks.filter(
    (block) => block.classification !== "layout_text",
  );
  if (nonLayout.length > 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "只有版式目标文字可参与 mask",
      { blockIds: nonLayout.map((block) => block.id) },
    );
  }
}

function toSegmentationParams(block: TextReviewBlock): BlockSegmentationParams {
  return {
    bbox: block.bboxPx,
    quad: block.quadPx as readonly Point[] | null,
    foregroundColors: block.maskParams.foregroundColors.map(hexToRgb),
    colorTolerance: block.maskParams.colorTolerance,
    edgeThreshold: block.maskParams.edgeThreshold,
    minComponentAreaPx: block.maskParams.minComponentAreaPx,
    dilationRadiusPx: block.maskParams.dilationRadiusPx,
    excludePolygons: block.maskParams
      .excludePolygons as readonly (readonly Point[])[],
  };
}

function encodeAlphaMask(mask: Uint8Array, width: number, height: number) {
  // gpt-image-2 mask 语义：完全透明(alpha=0)区域指示待编辑处，即字形像素。
  const buffer = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    buffer[i * 4 + 3] = mask[i] === 1 ? 0 : 255;
  }
  return sharp(buffer, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

function encodePreview(mask: Uint8Array, width: number, height: number) {
  const buffer = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i += 1) {
    buffer[i] = mask[i] === 1 ? 255 : 0;
  }
  return sharp(buffer, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

async function encodeOverlay(
  sourcePath: string,
  mask: Uint8Array,
  width: number,
  height: number,
) {
  const layer = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    if (mask[i] === 1) {
      layer[i * 4] = 255;
      layer[i * 4 + 3] = 150;
    }
  }
  const layerPng = await sharp(layer, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  return sharp(sourcePath)
    .ensureAlpha()
    .composite([{ input: layerPng, blend: "over" }])
    .png()
    .toBuffer();
}

export async function runSlideMask(
  options: RunSlideMaskOptions,
): Promise<RunSlideMaskResult> {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "mask");

  const source = findAssetById(
    workspace.manifest,
    workspace.manifest.sourceImageAssetId,
  );
  await assertWorkspaceAssetIntegrity(workspace.path, source);

  const reviewPath = resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH);
  const reviewDocumentSha256 = await sha256File(reviewPath);
  await assertReviewValidated(
    workspace.path,
    workspace.manifest,
    reviewDocumentSha256,
  );
  const validationAsset = findAssetById(
    workspace.manifest,
    workspace.manifest.assets.find(
      (asset) => asset.role === "review_validation",
    )?.id ?? "asset-review-validation",
  );

  const document = TextReviewDocumentSchema.parse(
    JSON.parse(await readFile(reviewPath, "utf8")),
  );
  const maskBlocks = document.blocks.filter((block) => block.includeInMask);
  assertMaskBlocksConfirmed(maskBlocks);

  const inputFingerprint = sha256Values([
    source.sha256,
    reviewDocumentSha256,
    MASK_ALGORITHM_VERSION,
  ]);
  const previousState = workspace.manifest.stages.find(
    (state) => state.stage === "mask",
  );
  if (previousState === undefined) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 mask 阶段状态");
  }
  if (
    isStageReusable(previousState, inputFingerprint) &&
    previousState.lastSuccessfulAttemptId !== null
  ) {
    const maskAsset = workspace.manifest.assets.find(
      (asset) => asset.role === "mask",
    );
    if (maskAsset !== undefined) {
      await assertWorkspaceAssetIntegrity(workspace.path, maskAsset);
      const record = workspace.manifest.assets.find(
        (asset) => asset.role === "mask_record",
      );
      const totalMaskedPixels =
        record === undefined
          ? 0
          : MaskRecordSchema.parse(
              JSON.parse(
                await readFile(
                  resolveWorkspacePath(workspace.path, record.path),
                  "utf8",
                ),
              ),
            ).totals.maskedPixels;
      return {
        maskPath: resolveWorkspacePath(workspace.path, maskAsset.path),
        attemptId: previousState.lastSuccessfulAttemptId,
        reused: true,
        totalMaskedPixels,
      };
    }
  }

  const attemptNumber =
    workspace.manifest.attempts.filter((attempt) => attempt.stage === "mask")
      .length + 1;
  const attemptId = `mask-${String(attemptNumber).padStart(3, "0")}`;
  const startedAt = new Date().toISOString();
  const invalidatedStates =
    previousState.completedInputFingerprint !== null &&
    previousState.completedInputFingerprint !== inputFingerprint
      ? invalidateStageAndDownstream(
          workspace.manifest.stages,
          "mask",
          "mask 输入指纹变化",
          startedAt,
        )
      : workspace.manifest.stages;
  const invalidatedMaskState = invalidatedStates.find(
    (state) => state.stage === "mask",
  );
  if (invalidatedMaskState === undefined) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 mask 阶段状态");
  }
  const runningAttempt: WorkspaceStageAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "mask",
    number: attemptNumber,
    status: "running",
    inputFingerprint,
    startedAt,
    endedAt: null,
    provider: "ppt-maker-cli",
    providerVersion: MASK_ALGORITHM_VERSION,
    assetIds: [],
    error: null,
  };
  const runningState: WorkspaceStageState = {
    ...invalidatedMaskState,
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
    const decoded = await sharp(sourcePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const width = decoded.info.width;
    const height = decoded.info.height;
    const image: RgbaImage = { data: decoded.data, width, height };

    const fullMask = new Uint8Array(width * height);
    const coverage: MaskBlockCoverage[] = [];
    for (const block of maskBlocks) {
      const blockMask = segmentBlockGlyphs(image, toSegmentationParams(block));
      const maskedPixels = countMasked(blockMask);
      unionInto(fullMask, blockMask);
      const bboxAreaPx = Math.round(block.bboxPx.width * block.bboxPx.height);
      coverage.push({
        blockId: block.id,
        maskedPixels,
        bboxAreaPx,
        coverageRatio: bboxAreaPx === 0 ? 0 : maskedPixels / bboxAreaPx,
      });
    }
    const totalMaskedPixels = countMasked(fullMask);

    const [maskPng, previewPng, overlayPng] = await Promise.all([
      encodeAlphaMask(fullMask, width, height),
      encodePreview(fullMask, width, height),
      encodeOverlay(sourcePath, fullMask, width, height),
    ]);
    await writeBufferAtomic(
      resolveWorkspacePath(workspace.path, MASK_PATH),
      maskPng,
    );
    await writeBufferAtomic(
      resolveWorkspacePath(workspace.path, PREVIEW_PATH),
      previewPng,
    );
    await writeBufferAtomic(
      resolveWorkspacePath(workspace.path, OVERLAY_PATH),
      overlayPng,
    );

    const [maskAsset, previewAsset, overlayAsset] = await Promise.all([
      createWorkspaceAsset(resolveWorkspacePath(workspace.path, MASK_PATH), {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-mask",
        path: MASK_PATH,
        role: "mask",
        createdAt: new Date().toISOString(),
        producedBy: "mask",
        attemptId,
        image: { width, height, format: "png" },
      }),
      createWorkspaceAsset(resolveWorkspacePath(workspace.path, PREVIEW_PATH), {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-mask-preview",
        path: PREVIEW_PATH,
        role: "mask_preview",
        createdAt: new Date().toISOString(),
        producedBy: "mask",
        attemptId,
        image: { width, height, format: "png" },
      }),
      createWorkspaceAsset(resolveWorkspacePath(workspace.path, OVERLAY_PATH), {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-mask-overlay",
        path: OVERLAY_PATH,
        role: "mask_overlay",
        createdAt: new Date().toISOString(),
        producedBy: "mask",
        attemptId,
        image: { width, height, format: "png" },
      }),
    ]);

    const record: MaskRecord = MaskRecordSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      algorithmVersion: MASK_ALGORITHM_VERSION,
      image: { width, height },
      sourceImageSha256: source.sha256,
      reviewDocumentSha256,
      reviewValidationSha256: validationAsset.sha256,
      maskedBlockIds: maskBlocks.map((block) => block.id),
      blocks: coverage,
      totals: {
        maskedPixels: totalMaskedPixels,
        maskedBlockCount: maskBlocks.length,
      },
      outputs: {
        maskSha256: maskAsset.sha256,
        previewSha256: previewAsset.sha256,
        overlaySha256: overlayAsset.sha256,
      },
    });
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, RECORD_PATH),
      record,
    );
    const recordAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, RECORD_PATH),
      {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-mask-record",
        path: RECORD_PATH,
        role: "mask_record",
        createdAt: new Date().toISOString(),
        producedBy: "mask",
        attemptId,
        image: null,
      },
    );

    const newAssets = [maskAsset, previewAsset, overlayAsset, recordAsset];
    const newAssetIds = new Set(newAssets.map((asset) => asset.id));
    const endedAt = new Date().toISOString();
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
      maskPath: resolveWorkspacePath(workspace.path, MASK_PATH),
      attemptId,
      reused: false,
      totalMaskedPixels,
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

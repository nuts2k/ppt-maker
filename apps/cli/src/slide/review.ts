import { readFile } from "node:fs/promises";
import {
  FoundationError,
  invalidateStageAndDownstream,
  isStageReusable,
  mergeTextBlockCandidates,
  OcrProbeResponseSchema,
  SCHEMA_VERSION,
  type SlideWorkspaceManifest,
  TEXT_MERGE_ALGORITHM_VERSION,
  type TextReviewDocument,
  TextReviewDocumentSchema,
  type VisionAnalysisResult,
  VisionAnalysisResultSchema,
  type WorkspaceAsset,
  type WorkspaceStageAttempt,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import {
  assertWorkspaceAssetIntegrity,
  createWorkspaceAsset,
  loadSlideWorkspace,
  resolveWorkspacePath,
  sha256Values,
  writeJsonAtomic,
  writeWorkspaceManifest,
} from "./workspace.js";

const REVIEW_OUTPUT_PATH = "stages/review/text-blocks.json";

// review 阶段输入指纹公式的唯一来源；run --from 的 review 新鲜度检查复用它，避免口径漂移。
export function computeReviewInputFingerprint(input: {
  readonly ocrSha256: string;
  readonly analysisSha256: string | null;
  readonly referenceSha256: string | null;
}): string {
  return sha256Values([
    input.ocrSha256,
    input.analysisSha256 ?? "no-analysis",
    input.referenceSha256 ?? "no-reference",
    TEXT_MERGE_ALGORITHM_VERSION,
  ]);
}

export interface RunSlideReviewOptions {
  readonly workspacePath: string;
}

export interface RunSlideReviewResult {
  readonly outputPath: string;
  readonly attemptId: string;
  readonly reused: boolean;
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

function findLastSuccessfulAsset(
  manifest: SlideWorkspaceManifest,
  stage: "ocr" | "analyze" | "review",
  role: "ocr_result" | "analysis_result" | "text_review",
): WorkspaceAsset | null {
  const state = manifest.stages.find((candidate) => candidate.stage === stage);
  if (state === undefined || state.lastSuccessfulAttemptId === null) {
    return null;
  }
  return (
    manifest.assets.find(
      (asset) =>
        asset.attemptId === state.lastSuccessfulAttemptId &&
        asset.role === role,
    ) ?? null
  );
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

async function readExistingReview(
  workspacePath: string,
): Promise<TextReviewDocument | null> {
  const path = resolveWorkspacePath(workspacePath, REVIEW_OUTPUT_PATH);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const parsed = TextReviewDocumentSchema.safeParse(JSON.parse(content));
  if (!parsed.success) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      `${REVIEW_OUTPUT_PATH} 校验失败，请先修复该文件再重跑 review`,
      { issues: parsed.error.issues },
    );
  }
  return parsed.data;
}

export async function runSlideReview(
  options: RunSlideReviewOptions,
): Promise<RunSlideReviewResult> {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  const ocrState = workspace.manifest.stages.find(
    (state) => state.stage === "ocr",
  );
  if (ocrState?.status !== "completed") {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 review 前必须先完成 ocr 阶段",
      { ocrStatus: ocrState?.status ?? "missing" },
    );
  }

  const ocrAsset = findLastSuccessfulAsset(
    workspace.manifest,
    "ocr",
    "ocr_result",
  );
  if (ocrAsset === null) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 review 前必须存在成功且有效的 OCR 产物",
    );
  }
  // 云端 analyze 是显式可选阶段；已成功产出时并入候选，否则仅用离线 OCR。
  const analyzeState = workspace.manifest.stages.find(
    (state) => state.stage === "analyze",
  );
  const analysisAsset =
    analyzeState?.status === "completed"
      ? findLastSuccessfulAsset(
          workspace.manifest,
          "analyze",
          "analysis_result",
        )
      : null;
  const referenceAsset =
    workspace.manifest.referenceTextAssetId === null
      ? null
      : findAssetById(
          workspace.manifest,
          workspace.manifest.referenceTextAssetId,
        );

  for (const asset of [ocrAsset, analysisAsset, referenceAsset]) {
    if (asset !== null) {
      await assertWorkspaceAssetIntegrity(workspace.path, asset);
    }
  }

  const inputFingerprint = computeReviewInputFingerprint({
    ocrSha256: ocrAsset.sha256,
    analysisSha256: analysisAsset?.sha256 ?? null,
    referenceSha256: referenceAsset?.sha256 ?? null,
  });
  const previousState = workspace.manifest.stages.find(
    (state) => state.stage === "review",
  );
  if (previousState === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 review 阶段状态",
    );
  }

  if (
    isStageReusable(previousState, inputFingerprint) &&
    previousState.lastSuccessfulAttemptId !== null
  ) {
    const existing = await readExistingReview(workspace.path).catch(() => null);
    if (existing !== null) {
      return {
        outputPath: resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH),
        attemptId: previousState.lastSuccessfulAttemptId,
        reused: true,
      };
    }
  }

  const ocr = OcrProbeResponseSchema.parse(
    JSON.parse(
      await readFile(
        resolveWorkspacePath(workspace.path, ocrAsset.path),
        "utf8",
      ),
    ),
  );
  let analysis: VisionAnalysisResult | null = null;
  if (analysisAsset !== null) {
    analysis = VisionAnalysisResultSchema.parse(
      JSON.parse(
        await readFile(
          resolveWorkspacePath(workspace.path, analysisAsset.path),
          "utf8",
        ),
      ),
    );
  }
  const referenceText =
    referenceAsset === null
      ? null
      : await readFile(
          resolveWorkspacePath(workspace.path, referenceAsset.path),
          "utf8",
        );
  // 保留既有人工确认值：重跑只刷新候选，不覆盖人工编辑的分类与复核状态。
  const existing = await readExistingReview(workspace.path);

  const attemptNumber =
    workspace.manifest.attempts.filter((attempt) => attempt.stage === "review")
      .length + 1;
  const attemptId = `review-${String(attemptNumber).padStart(3, "0")}`;
  const startedAt = new Date().toISOString();
  const invalidatedStates =
    previousState.completedInputFingerprint !== null &&
    previousState.completedInputFingerprint !== inputFingerprint
      ? invalidateStageAndDownstream(
          workspace.manifest.stages,
          "review",
          "review 输入指纹变化",
          startedAt,
        )
      : workspace.manifest.stages;
  const invalidatedReviewState = invalidatedStates.find(
    (state) => state.stage === "review",
  );
  if (invalidatedReviewState === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 review 阶段状态",
    );
  }
  const runningAttempt: WorkspaceStageAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "review",
    number: attemptNumber,
    status: "running",
    inputFingerprint,
    startedAt,
    endedAt: null,
    provider: "ppt-maker-cli",
    providerVersion: TEXT_MERGE_ALGORITHM_VERSION,
    assetIds: [],
    error: null,
  };
  const runningState: WorkspaceStageState = {
    ...invalidatedReviewState,
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
    const document = mergeTextBlockCandidates({
      slideId: workspace.manifest.slideId,
      image: {
        width: ocr.image.width,
        height: ocr.image.height,
      },
      ocr,
      analysis,
      referenceText,
      existing,
      now: startedAt,
    });
    const outputPath = resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH);
    await writeJsonAtomic(outputPath, TextReviewDocumentSchema.parse(document));
    const asset = await createWorkspaceAsset(outputPath, {
      schemaVersion: SCHEMA_VERSION,
      id: `asset-${attemptId}-text-review`,
      path: REVIEW_OUTPUT_PATH,
      role: "text_review",
      createdAt: new Date().toISOString(),
      producedBy: "review",
      attemptId,
      image: null,
    });
    const endedAt = new Date().toISOString();
    const completedAttempt: WorkspaceStageAttempt = {
      ...runningAttempt,
      status: "completed",
      endedAt,
      assetIds: [asset.id],
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
      assets: [...runningManifest.assets, asset],
      stages: replaceStageState(runningManifest.stages, completedState),
      attempts: replaceAttempt(runningManifest.attempts, completedAttempt),
    });
    return { outputPath, attemptId, reused: false };
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

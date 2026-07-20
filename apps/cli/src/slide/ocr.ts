import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  assertStageDependenciesCompleted,
  FoundationError,
  invalidateStageAndDownstream,
  isStageReusable,
  OcrProbeResponseSchema,
  SCHEMA_VERSION,
  type SlideWorkspaceManifest,
  type WorkspaceStageAttempt,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import { defaultVisionBinary, runVisionOcr } from "../ocr.js";
import {
  assertWorkspaceAssetIntegrity,
  createWorkspaceAsset,
  loadSlideWorkspace,
  resolveWorkspacePath,
  sha256File,
  sha256Values,
  writeJsonAtomic,
  writeWorkspaceManifest,
} from "./workspace.js";

export interface RunSlideOcrOptions {
  readonly workspacePath: string;
  readonly binaryPath?: string;
}

export interface RunSlideOcrResult {
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

function findSourceAsset(manifest: SlideWorkspaceManifest) {
  const source = manifest.assets.find(
    (asset) => asset.id === manifest.sourceImageAssetId,
  );
  if (source === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "manifest 未引用有效源图资产",
      { sourceImageAssetId: manifest.sourceImageAssetId },
    );
  }
  return source;
}

function findOcrOutput(manifest: SlideWorkspaceManifest, attemptId: string) {
  return manifest.assets.find(
    (asset) => asset.role === "ocr_result" && asset.attemptId === attemptId,
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

async function readReusableResult(
  workspacePath: string,
  manifest: SlideWorkspaceManifest,
  attemptId: string,
): Promise<RunSlideOcrResult | null> {
  const asset = findOcrOutput(manifest, attemptId);
  if (asset === undefined) {
    return null;
  }
  await assertWorkspaceAssetIntegrity(workspacePath, asset);
  const outputPath = resolveWorkspacePath(workspacePath, asset.path);
  OcrProbeResponseSchema.parse(JSON.parse(await readFile(outputPath, "utf8")));
  return { outputPath, attemptId, reused: true };
}

export async function runSlideOcr(
  options: RunSlideOcrOptions,
): Promise<RunSlideOcrResult> {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  const source = findSourceAsset(workspace.manifest);
  await assertWorkspaceAssetIntegrity(workspace.path, source);
  assertStageDependenciesCompleted(workspace.manifest.stages, "ocr");

  const binaryPath = resolve(
    options.binaryPath ?? defaultVisionBinary(process.cwd()),
  );
  const binaryFingerprint = await sha256File(binaryPath).catch(
    () => `unavailable:${binaryPath}`,
  );
  const inputFingerprint = sha256Values([
    source.sha256,
    binaryFingerprint,
    "apple-vision-ocr-schema:1",
  ]);
  const previousState = workspace.manifest.stages.find(
    (state) => state.stage === "ocr",
  );
  if (previousState === undefined) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 ocr 阶段状态");
  }
  if (
    isStageReusable(previousState, inputFingerprint) &&
    previousState.lastSuccessfulAttemptId !== null
  ) {
    const reusable = await readReusableResult(
      workspace.path,
      workspace.manifest,
      previousState.lastSuccessfulAttemptId,
    );
    if (reusable !== null) {
      return reusable;
    }
  }

  const attemptNumber =
    workspace.manifest.attempts.filter((attempt) => attempt.stage === "ocr")
      .length + 1;
  const attemptId = `ocr-${String(attemptNumber).padStart(3, "0")}`;
  const startedAt = new Date().toISOString();
  const invalidatedStates =
    previousState.completedInputFingerprint !== null &&
    previousState.completedInputFingerprint !== inputFingerprint
      ? invalidateStageAndDownstream(
          workspace.manifest.stages,
          "ocr",
          "OCR 输入指纹变化",
          startedAt,
        )
      : workspace.manifest.stages;
  const invalidatedOcrState = invalidatedStates.find(
    (state) => state.stage === "ocr",
  );
  if (invalidatedOcrState === undefined) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 ocr 阶段状态");
  }
  const runningAttempt: WorkspaceStageAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "ocr",
    number: attemptNumber,
    status: "running",
    inputFingerprint,
    startedAt,
    endedAt: null,
    provider: "apple-vision",
    providerVersion: binaryFingerprint,
    assetIds: [],
    error: null,
  };
  const runningState: WorkspaceStageState = {
    ...invalidatedOcrState,
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
    const result = await runVisionOcr(sourcePath, binaryPath);
    const outputRelativePath = `stages/ocr/${attemptId}/result.json`;
    const outputPath = resolveWorkspacePath(workspace.path, outputRelativePath);
    await writeJsonAtomic(outputPath, result);
    const asset = await createWorkspaceAsset(outputPath, {
      schemaVersion: SCHEMA_VERSION,
      id: `asset-${attemptId}-result`,
      path: outputRelativePath,
      role: "ocr_result",
      createdAt: new Date().toISOString(),
      producedBy: "ocr",
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
    const failedState: WorkspaceStageState = {
      ...runningState,
      status: "failed",
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      stages: replaceStageState(runningManifest.stages, failedState),
      attempts: replaceAttempt(runningManifest.attempts, failedAttempt),
    });
    throw error;
  }
}

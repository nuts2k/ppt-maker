import { readFile } from "node:fs/promises";
import {
  assertStageDependenciesCompleted,
  FoundationError,
  invalidateStageAndDownstream,
  isStageReusable,
  OcrProbeResponseSchema,
  type ProviderCallRecord,
  ProviderCallRecordSchema,
  SCHEMA_VERSION,
  type SlideWorkspaceManifest,
  VisionAnalysisResultSchema,
  type WorkspaceAsset,
  type WorkspaceStageAttempt,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import {
  analyzeSlideVision,
  OPENAI_VISION_MODEL,
  type OpenAiVisionResponseParser,
  VISION_ANALYSIS_PROMPT_VERSION,
} from "../providers/openai-vision.js";
import {
  assertWorkspaceAssetIntegrity,
  createWorkspaceAsset,
  loadSlideWorkspace,
  resolveWorkspacePath,
  sha256Values,
  writeJsonAtomic,
  writeWorkspaceManifest,
} from "./workspace.js";

export interface AnalyzeUploadNotice {
  readonly model: string;
  readonly sentAssets: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}

export interface RunSlideAnalyzeOptions {
  readonly workspacePath: string;
  readonly confirmUpload: boolean;
  readonly parseResponse?: OpenAiVisionResponseParser;
  readonly onBeforeUpload?: (notice: AnalyzeUploadNotice) => void;
}

export interface RunSlideAnalyzeResult {
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
  stage: "ocr" | "analyze",
  role: "ocr_result" | "analysis_result",
): WorkspaceAsset | null {
  const state = manifest.stages.find((candidate) => candidate.stage === stage);
  if (state?.lastSuccessfulAttemptId === null || state === undefined) {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}

// 落盘前从任意错误消息中抹去 API Key 字面量，兑现 spec §7.3「禁止写入错误 details」。
// 空 key 不做替换，避免空串 split/join 误伤。
function redactApiKey(message: string): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.length === 0) {
    return message;
  }
  return message.split(apiKey).join("[REDACTED]");
}

function errorRecord(error: unknown): { code: string; message: string } {
  if (error instanceof FoundationError) {
    return { code: error.code, message: redactApiKey(error.message) };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: redactApiKey(
      error instanceof Error ? error.message : String(error),
    ),
  };
}

async function readReusableResult(
  workspacePath: string,
  manifest: SlideWorkspaceManifest,
  attemptId: string,
): Promise<RunSlideAnalyzeResult | null> {
  const asset = manifest.assets.find(
    (candidate) =>
      candidate.role === "analysis_result" && candidate.attemptId === attemptId,
  );
  if (asset === undefined) {
    return null;
  }
  await assertWorkspaceAssetIntegrity(workspacePath, asset);
  const outputPath = resolveWorkspacePath(workspacePath, asset.path);
  VisionAnalysisResultSchema.parse(
    JSON.parse(await readFile(outputPath, "utf8")),
  );
  return { outputPath, attemptId, reused: true };
}

export async function runSlideAnalyze(
  options: RunSlideAnalyzeOptions,
): Promise<RunSlideAnalyzeResult> {
  if (!options.confirmUpload) {
    throw new FoundationError(
      "UPLOAD_CONFIRMATION_REQUIRED",
      "云端视觉分析必须显式传入 --confirm-upload",
    );
  }

  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "analyze");
  const source = findAssetById(
    workspace.manifest,
    workspace.manifest.sourceImageAssetId,
  );
  const ocrAsset = findLastSuccessfulAsset(
    workspace.manifest,
    "ocr",
    "ocr_result",
  );
  if (ocrAsset === null) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 analyze 前必须存在成功且有效的 OCR 产物",
    );
  }
  const referenceAsset =
    workspace.manifest.referenceTextAssetId === null
      ? null
      : findAssetById(
          workspace.manifest,
          workspace.manifest.referenceTextAssetId,
        );
  for (const asset of [source, ocrAsset, referenceAsset]) {
    if (asset !== null) {
      await assertWorkspaceAssetIntegrity(workspace.path, asset);
    }
  }

  const sentAssets = [source, ocrAsset, referenceAsset]
    .filter((asset): asset is WorkspaceAsset => asset !== null)
    .map((asset) => ({ path: asset.path, sha256: asset.sha256 }));
  const inputFingerprint = sha256Values([
    ...sentAssets.map((asset) => asset.sha256),
    OPENAI_VISION_MODEL,
    VISION_ANALYSIS_PROMPT_VERSION,
    "detail:original",
    "reasoning:high",
  ]);
  const previousState = workspace.manifest.stages.find(
    (state) => state.stage === "analyze",
  );
  if (previousState === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 analyze 阶段状态",
    );
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

  options.onBeforeUpload?.({ model: OPENAI_VISION_MODEL, sentAssets });
  const attemptNumber =
    workspace.manifest.attempts.filter((attempt) => attempt.stage === "analyze")
      .length + 1;
  const attemptId = `analyze-${String(attemptNumber).padStart(3, "0")}`;
  const startedAt = new Date().toISOString();
  const invalidatedStates =
    previousState.completedInputFingerprint !== null &&
    previousState.completedInputFingerprint !== inputFingerprint
      ? invalidateStageAndDownstream(
          workspace.manifest.stages,
          "analyze",
          "视觉分析输入指纹变化",
          startedAt,
        )
      : workspace.manifest.stages;
  const invalidatedState = invalidatedStates.find(
    (state) => state.stage === "analyze",
  );
  if (invalidatedState === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 analyze 阶段状态",
    );
  }
  const runningAttempt: WorkspaceStageAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "analyze",
    number: attemptNumber,
    status: "running",
    inputFingerprint,
    startedAt,
    endedAt: null,
    provider: "openai",
    providerVersion: "openai-node@6.48.0",
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

  const attemptDirectory = `stages/analyze/${attemptId}`;
  const providerRecordPath = `${attemptDirectory}/provider.json`;
  const parsedPath = `${attemptDirectory}/result.json`;
  const rawResponsePath = `${attemptDirectory}/raw-response.json`;
  const sourcePath = resolveWorkspacePath(workspace.path, source.path);
  const ocr = OcrProbeResponseSchema.parse(
    JSON.parse(
      await readFile(
        resolveWorkspacePath(workspace.path, ocrAsset.path),
        "utf8",
      ),
    ),
  );
  const referenceText =
    referenceAsset === null
      ? null
      : await readFile(
          resolveWorkspacePath(workspace.path, referenceAsset.path),
          "utf8",
        );

  try {
    const sourceFormat = source.image?.format;
    if (sourceFormat === undefined) {
      throw new FoundationError(
        "INVALID_WORKSPACE",
        "源图资产缺少图片格式元数据",
      );
    }
    const analysis = await analyzeSlideVision({
      imagePath: sourcePath,
      imageMimeType: sourceFormat === "png" ? "image/png" : "image/jpeg",
      ocr,
      referenceText,
      ...(options.parseResponse === undefined
        ? {}
        : { parseResponse: options.parseResponse }),
    });
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, parsedPath),
      analysis.result,
    );
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, rawResponsePath),
      analysis.rawResponse,
    );
    const endedAt = new Date().toISOString();
    const [resultAsset, rawResponseAsset] = await Promise.all([
      createWorkspaceAsset(resolveWorkspacePath(workspace.path, parsedPath), {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-result`,
        path: parsedPath,
        role: "analysis_result",
        createdAt: endedAt,
        producedBy: "analyze",
        attemptId,
        image: null,
      }),
      createWorkspaceAsset(
        resolveWorkspacePath(workspace.path, rawResponsePath),
        {
          schemaVersion: SCHEMA_VERSION,
          id: `asset-${attemptId}-raw-response`,
          path: rawResponsePath,
          role: "provider_response",
          createdAt: endedAt,
          producedBy: "analyze",
          attemptId,
          image: null,
        },
      ),
    ]);
    const providerRecord: ProviderCallRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: `provider-${attemptId}`,
      stage: "analyze",
      provider: "openai",
      endpoint: "/v1/responses",
      model: OPENAI_VISION_MODEL,
      parameters: {
        detail: "original",
        reasoningEffort: "high",
        store: false,
      },
      promptVersion: VISION_ANALYSIS_PROMPT_VERSION,
      sentAssets,
      requestId: analysis.requestId,
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      usage: asRecord(analysis.usage),
      error: null,
      rawResponsePath,
      rawResponseSha256: rawResponseAsset.sha256,
      parsedResponsePath: parsedPath,
      parsedResponseSha256: resultAsset.sha256,
    };
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, providerRecordPath),
      ProviderCallRecordSchema.parse(providerRecord),
    );
    const providerRecordAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, providerRecordPath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-provider-record`,
        path: providerRecordPath,
        role: "provider_record",
        createdAt: endedAt,
        producedBy: "analyze",
        attemptId,
        image: null,
      },
    );
    const assets = [resultAsset, rawResponseAsset, providerRecordAsset];
    const completedAttempt: WorkspaceStageAttempt = {
      ...runningAttempt,
      status: "completed",
      endedAt,
      assetIds: assets.map((asset) => asset.id),
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
      assets: [...runningManifest.assets, ...assets],
      stages: replaceStageState(runningManifest.stages, completedState),
      attempts: replaceAttempt(runningManifest.attempts, completedAttempt),
    });
    return {
      outputPath: resolveWorkspacePath(workspace.path, parsedPath),
      attemptId,
      reused: false,
    };
  } catch (error) {
    const endedAt = new Date().toISOString();
    const providerError = errorRecord(error);
    const providerRecord: ProviderCallRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: `provider-${attemptId}`,
      stage: "analyze",
      provider: "openai",
      endpoint: "/v1/responses",
      model: OPENAI_VISION_MODEL,
      parameters: {
        detail: "original",
        reasoningEffort: "high",
        store: false,
      },
      promptVersion: VISION_ANALYSIS_PROMPT_VERSION,
      sentAssets,
      requestId: null,
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      usage: null,
      error: providerError,
      rawResponsePath: null,
      rawResponseSha256: null,
      parsedResponsePath: null,
      parsedResponseSha256: null,
    };
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, providerRecordPath),
      ProviderCallRecordSchema.parse(providerRecord),
    );
    const providerAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, providerRecordPath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-provider-record`,
        path: providerRecordPath,
        role: "provider_record",
        createdAt: endedAt,
        producedBy: "analyze",
        attemptId,
        image: null,
      },
    );
    const failedAttempt: WorkspaceStageAttempt = {
      ...runningAttempt,
      status: "failed",
      endedAt,
      assetIds: [providerAsset.id],
      error: providerError,
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      assets: [...runningManifest.assets, providerAsset],
      stages: replaceStageState(runningManifest.stages, {
        ...runningState,
        status: "failed",
      }),
      attempts: replaceAttempt(runningManifest.attempts, failedAttempt),
    });
    throw error;
  }
}

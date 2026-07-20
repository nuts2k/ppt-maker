import { readFile } from "node:fs/promises";
import {
  assertStageDependenciesCompleted,
  type CleanAttemptRecord,
  CleanAttemptRecordSchema,
  FoundationError,
  invalidateStageAndDownstream,
  isStageReusable,
  type ProviderCallRecord,
  ProviderCallRecordSchema,
  SCHEMA_VERSION,
  type SlideWorkspaceManifest,
  type TextReviewBlock,
  TextReviewDocumentSchema,
  type WorkspaceAsset,
  type WorkspaceStageAttempt,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import {
  CLEAN_PLATE_HEIGHT,
  CLEAN_PLATE_OUTPUT_FORMAT,
  CLEAN_PLATE_PROMPT_VERSION,
  CLEAN_PLATE_QUALITY,
  CLEAN_PLATE_SIZE,
  CLEAN_PLATE_WIDTH,
  OPENAI_IMAGE_MODEL,
  type OpenAiImageEditor,
  runCleanPlateEdit,
} from "../providers/openai-image.js";
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
import { computeCleanPlateChecks } from "./checks.js";

const REVIEW_OUTPUT_PATH = "stages/review/text-blocks.json";

export interface CleanUploadNotice {
  readonly model: string;
  readonly sentAssets: readonly {
    readonly path: string;
    readonly sha256: string;
  }[];
}

export interface RunSlideCleanOptions {
  readonly workspacePath: string;
  readonly confirmUpload: boolean;
  readonly edit?: OpenAiImageEditor;
  readonly onBeforeUpload?: (notice: CleanUploadNotice) => void;
}

export interface RunSlideCleanResult {
  readonly cleanPath: string;
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

function findRoleAsset(
  manifest: SlideWorkspaceManifest,
  role: WorkspaceAsset["role"],
): WorkspaceAsset {
  const asset = manifest.assets.find((candidate) => candidate.role === role);
  if (asset === undefined) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      `运行 clean 前缺少必要产物：${role}`,
      { role },
    );
  }
  return asset;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}

// 落盘前从错误消息抹去 API Key 字面量（对齐 analyze，兑现 spec §7.3）。
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
): Promise<RunSlideCleanResult | null> {
  const asset = manifest.assets.find(
    (candidate) =>
      candidate.role === "clean_plate" && candidate.attemptId === attemptId,
  );
  if (asset === undefined) {
    return null;
  }
  await assertWorkspaceAssetIntegrity(workspacePath, asset);
  return {
    cleanPath: resolveWorkspacePath(workspacePath, asset.path),
    attemptId,
    reused: true,
  };
}

export async function runSlideClean(
  options: RunSlideCleanOptions,
): Promise<RunSlideCleanResult> {
  if (!options.confirmUpload) {
    throw new FoundationError(
      "UPLOAD_CONFIRMATION_REQUIRED",
      "clean plate 会上传源图与 mask，必须显式传入 --confirm-upload",
    );
  }

  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "clean");

  const source = findAssetById(
    workspace.manifest,
    workspace.manifest.sourceImageAssetId,
  );
  // 上游门禁：mask、mask_record 完整性（沿用第 4 节派生产物完整性机制）。
  const maskAsset = findRoleAsset(workspace.manifest, "mask");
  const maskRecordAsset = findRoleAsset(workspace.manifest, "mask_record");
  for (const asset of [source, maskAsset, maskRecordAsset]) {
    await assertWorkspaceAssetIntegrity(workspace.path, asset);
  }

  const reviewPath = resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH);
  const reviewDocumentSha256 = await sha256File(reviewPath);
  const document = TextReviewDocumentSchema.parse(
    JSON.parse(await readFile(reviewPath, "utf8")),
  );
  const maskBlocks = document.blocks.filter((block) => block.includeInMask);

  const sentAssets = [source, maskAsset].map((asset) => ({
    path: asset.path,
    sha256: asset.sha256,
  }));
  // clean plate 只依赖 mask 输出与固定档位；mask.sha 已投影几何/mask 参数变更，
  // 内容/样式变更（不改 mask）不重跑 clean（design §6）。reviewDocumentSha256 仅存证于记录。
  const inputFingerprint = sha256Values([
    source.sha256,
    maskAsset.sha256,
    OPENAI_IMAGE_MODEL,
    CLEAN_PLATE_PROMPT_VERSION,
    CLEAN_PLATE_SIZE,
    CLEAN_PLATE_QUALITY,
    CLEAN_PLATE_OUTPUT_FORMAT,
  ]);
  const previousState = workspace.manifest.stages.find(
    (state) => state.stage === "clean",
  );
  if (previousState === undefined) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 clean 阶段状态");
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

  options.onBeforeUpload?.({ model: OPENAI_IMAGE_MODEL, sentAssets });
  const attemptNumber =
    workspace.manifest.attempts.filter((attempt) => attempt.stage === "clean")
      .length + 1;
  const attemptId = `clean-${String(attemptNumber).padStart(3, "0")}`;
  const startedAt = new Date().toISOString();
  const invalidatedStates =
    previousState.completedInputFingerprint !== null &&
    previousState.completedInputFingerprint !== inputFingerprint
      ? invalidateStageAndDownstream(
          workspace.manifest.stages,
          "clean",
          "clean 输入指纹变化",
          startedAt,
        )
      : workspace.manifest.stages;
  const invalidatedState = invalidatedStates.find(
    (state) => state.stage === "clean",
  );
  if (invalidatedState === undefined) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 clean 阶段状态");
  }
  const runningAttempt: WorkspaceStageAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "clean",
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

  const directory = `stages/clean/${attemptId}`;
  const resultPath = `${directory}/result.png`;
  const diffPath = `${directory}/diff.png`;
  const providerRecordPath = `${directory}/provider.json`;
  const rawResponsePath = `${directory}/raw-response.json`;
  const recordPath = `${directory}/record.json`;
  const sourcePath = resolveWorkspacePath(workspace.path, source.path);
  const maskPath = resolveWorkspacePath(workspace.path, maskAsset.path);

  try {
    const outcome = await runCleanPlateEdit({
      imagePath: sourcePath,
      maskPath,
      ...(options.edit === undefined ? {} : { edit: options.edit }),
    });
    const endedAt = new Date().toISOString();
    const resultBuffer = Buffer.from(outcome.b64Png, "base64");
    await writeBufferAtomic(
      resolveWorkspacePath(workspace.path, resultPath),
      resultBuffer,
    );

    const { checks, diffPng } = await computeCleanPlateChecks({
      sourcePath,
      cleanBuffer: resultBuffer,
      maskPath,
      maskBlocks: maskBlocks as readonly TextReviewBlock[],
      expectedWidth: CLEAN_PLATE_WIDTH,
      expectedHeight: CLEAN_PLATE_HEIGHT,
    });
    await writeBufferAtomic(
      resolveWorkspacePath(workspace.path, diffPath),
      diffPng,
    );
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, rawResponsePath),
      outcome.rawResponse,
    );

    const resultAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, resultPath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-result`,
        path: resultPath,
        role: "clean_plate",
        createdAt: endedAt,
        producedBy: "clean",
        attemptId,
        image: {
          width: CLEAN_PLATE_WIDTH,
          height: CLEAN_PLATE_HEIGHT,
          format: "png",
        },
      },
    );
    const diffAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, diffPath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-diff`,
        path: diffPath,
        role: "clean_check",
        createdAt: endedAt,
        producedBy: "clean",
        attemptId,
        image: null,
      },
    );
    const rawResponseAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, rawResponsePath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-raw-response`,
        path: rawResponsePath,
        role: "provider_response",
        createdAt: endedAt,
        producedBy: "clean",
        attemptId,
        image: null,
      },
    );

    const providerRecord: ProviderCallRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: `provider-${attemptId}`,
      stage: "clean",
      provider: "openai",
      endpoint: "/v1/images/edits",
      model: OPENAI_IMAGE_MODEL,
      parameters: {
        size: CLEAN_PLATE_SIZE,
        quality: CLEAN_PLATE_QUALITY,
        output_format: CLEAN_PLATE_OUTPUT_FORMAT,
      },
      promptVersion: CLEAN_PLATE_PROMPT_VERSION,
      sentAssets,
      requestId: outcome.requestId,
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      usage: asRecord(outcome.usage),
      error: null,
      rawResponsePath,
      rawResponseSha256: rawResponseAsset.sha256,
      parsedResponsePath: resultPath,
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
        producedBy: "clean",
        attemptId,
        image: null,
      },
    );

    const attemptRecord: CleanAttemptRecord = {
      schemaVersion: SCHEMA_VERSION,
      attemptId,
      model: OPENAI_IMAGE_MODEL,
      promptVersion: CLEAN_PLATE_PROMPT_VERSION,
      size: CLEAN_PLATE_SIZE,
      quality: CLEAN_PLATE_QUALITY,
      outputFormat: CLEAN_PLATE_OUTPUT_FORMAT,
      sourceImageSha256: source.sha256,
      maskSha256: maskAsset.sha256,
      reviewDocumentSha256,
      resultSha256: resultAsset.sha256,
      requestId: outcome.requestId,
      usage: asRecord(outcome.usage),
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      checks,
    };
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, recordPath),
      CleanAttemptRecordSchema.parse(attemptRecord),
    );
    const recordAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, recordPath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-record`,
        path: recordPath,
        role: "clean_record",
        createdAt: endedAt,
        producedBy: "clean",
        attemptId,
        image: null,
      },
    );

    const assets = [
      resultAsset,
      diffAsset,
      rawResponseAsset,
      providerRecordAsset,
      recordAsset,
    ];
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
      cleanPath: resolveWorkspacePath(workspace.path, resultPath),
      attemptId,
      reused: false,
    };
  } catch (error) {
    const endedAt = new Date().toISOString();
    const providerError = errorRecord(error);
    const providerRecord: ProviderCallRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: `provider-${attemptId}`,
      stage: "clean",
      provider: "openai",
      endpoint: "/v1/images/edits",
      model: OPENAI_IMAGE_MODEL,
      parameters: {
        size: CLEAN_PLATE_SIZE,
        quality: CLEAN_PLATE_QUALITY,
        output_format: CLEAN_PLATE_OUTPUT_FORMAT,
      },
      promptVersion: CLEAN_PLATE_PROMPT_VERSION,
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
        producedBy: "clean",
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

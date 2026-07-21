import { readFile } from "node:fs/promises";
import {
  assertStageDependenciesCompleted,
  FoundationError,
  invalidateStageAndDownstream,
  isStageReusable,
  type ProviderCallRecord,
  ProviderCallRecordSchema,
  SCHEMA_VERSION,
  type SlideWorkspaceManifest,
  type TextAssistResult,
  TextReviewDocumentSchema,
  type WorkspaceStageAttempt,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import {
  assistReviewText,
  OPENAI_TEXT_ASSIST_MODEL,
  type OpenAiTextAssistResponseParser,
  TEXT_ASSIST_PROMPT_VERSION,
} from "../providers/openai-text-assist.js";
import {
  assertWorkspaceAssetIntegrity,
  createWorkspaceAsset,
  loadSlideWorkspace,
  resolveWorkspacePath,
  sha256Values,
  writeJsonAtomic,
  writeWorkspaceManifest,
} from "./workspace.js";

const REVIEW_PATH = "stages/review/text-blocks.json";

export interface RunAssistReviewOptions {
  readonly workspacePath: string;
  readonly confirmApi: boolean;
  readonly parseResponse?: OpenAiTextAssistResponseParser;
}

export interface RunAssistReviewResult {
  readonly outputPath: string;
  readonly attemptId: string;
  readonly reused: boolean;
  readonly autoReviewed: number;
  readonly remainingUnreviewed: number;
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}

function isHumanTouched(block: {
  readonly updatedAt: string | null;
  readonly sources: readonly { readonly kind: string }[];
}): boolean {
  return (
    block.updatedAt !== null ||
    block.sources.some((source) => source.kind === "manual")
  );
}

function applyAssistResult(
  documentJson: Record<string, unknown>,
  result: TextAssistResult,
): { autoReviewed: number; remainingUnreviewed: number } {
  const blocks = (documentJson as { blocks: Array<Record<string, unknown>> })
    .blocks;
  const resultMap = new Map(result.blocks.map((b) => [b.blockId, b]));
  let autoReviewed = 0;
  let remainingUnreviewed = 0;

  for (const block of blocks) {
    if (isHumanTouched(block as never)) {
      continue;
    }
    const assist = resultMap.get(block.id as string);
    if (assist === undefined) {
      remainingUnreviewed += 1;
      continue;
    }

    const hasRisk = assist.risks.length > 0;
    const isConfident = !hasRisk && assist.classification !== "uncertain";

    block.text = assist.correctedText;
    block.lines = [assist.correctedText];

    const existingSources = block.sources as Array<Record<string, unknown>>;
    const hasAssistSource = existingSources.some(
      (s) => s.kind === "ai_text_assist",
    );
    if (!hasAssistSource) {
      existingSources.push({
        kind: "ai_text_assist",
        provider: "openai-text-assist",
        text: assist.correctedText,
        confidence: null,
      });
    }

    if (isConfident) {
      block.classification = assist.classification;
      block.includeInMask = assist.classification === "layout_text";
      block.reviewStatus = "reviewed";
      autoReviewed += 1;
    } else {
      block.classification = assist.classification;
      block.includeInMask = false;
      remainingUnreviewed += 1;
    }
  }

  return { autoReviewed, remainingUnreviewed };
}

export async function runAssistReview(
  options: RunAssistReviewOptions,
): Promise<RunAssistReviewResult> {
  if (!options.confirmApi) {
    throw new FoundationError(
      "API_CONFIRMATION_REQUIRED",
      "AI 辅助复核必须显式传入 --confirm-api",
    );
  }

  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "assist-review");

  const reviewState = workspace.manifest.stages.find(
    (state) => state.stage === "review",
  );
  if (reviewState?.status !== "completed") {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 assist-review 前必须先完成 review 阶段",
    );
  }

  const reviewAsset = workspace.manifest.assets.find(
    (asset) =>
      asset.role === "text_review" &&
      asset.attemptId === reviewState.lastSuccessfulAttemptId,
  );
  if (reviewAsset === undefined) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 assist-review 前必须存在成功的 review 产物",
    );
  }
  await assertWorkspaceAssetIntegrity(workspace.path, reviewAsset);

  const referenceAsset =
    workspace.manifest.referenceTextAssetId === null
      ? null
      : (workspace.manifest.assets.find(
          (asset) => asset.id === workspace.manifest.referenceTextAssetId,
        ) ?? null);

  const inputFingerprint = sha256Values([
    reviewAsset.sha256,
    referenceAsset?.sha256 ?? "no-reference",
    OPENAI_TEXT_ASSIST_MODEL,
    TEXT_ASSIST_PROMPT_VERSION,
  ]);

  const previousState = workspace.manifest.stages.find(
    (state) => state.stage === "assist-review",
  );
  if (previousState === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 assist-review 阶段状态",
    );
  }

  if (
    isStageReusable(previousState, inputFingerprint) &&
    previousState.lastSuccessfulAttemptId !== null
  ) {
    const outputPath = resolveWorkspacePath(workspace.path, REVIEW_PATH);
    const doc = TextReviewDocumentSchema.parse(
      JSON.parse(await readFile(outputPath, "utf8")),
    );
    const autoReviewed = doc.blocks.filter(
      (b) =>
        b.reviewStatus === "reviewed" &&
        b.sources.some((s) => s.kind === "ai_text_assist"),
    ).length;
    const remainingUnreviewed = doc.blocks.filter(
      (b) => b.reviewStatus === "unreviewed",
    ).length;
    return {
      outputPath,
      attemptId: previousState.lastSuccessfulAttemptId,
      reused: true,
      autoReviewed,
      remainingUnreviewed,
    };
  }

  const reviewContent = await readFile(
    resolveWorkspacePath(workspace.path, REVIEW_PATH),
    "utf8",
  );
  const document = TextReviewDocumentSchema.parse(JSON.parse(reviewContent));
  const referenceText =
    referenceAsset === null
      ? null
      : await readFile(
          resolveWorkspacePath(workspace.path, referenceAsset.path),
          "utf8",
        );

  const attemptNumber =
    workspace.manifest.attempts.filter(
      (attempt) => attempt.stage === "assist-review",
    ).length + 1;
  const attemptId = `assist-review-${String(attemptNumber).padStart(3, "0")}`;
  const startedAt = new Date().toISOString();

  const invalidatedStates =
    previousState.completedInputFingerprint !== null &&
    previousState.completedInputFingerprint !== inputFingerprint
      ? invalidateStageAndDownstream(
          workspace.manifest.stages,
          "assist-review",
          "assist-review 输入指纹变化",
          startedAt,
        )
      : workspace.manifest.stages;
  const invalidatedState = invalidatedStates.find(
    (state) => state.stage === "assist-review",
  );
  if (invalidatedState === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 assist-review 阶段状态",
    );
  }

  const runningAttempt: WorkspaceStageAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "assist-review",
    number: attemptNumber,
    status: "running",
    inputFingerprint,
    startedAt,
    endedAt: null,
    provider: "openai",
    providerVersion: "openai-node@latest",
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

  const attemptDirectory = `stages/assist-review/${attemptId}`;
  const providerRecordPath = `${attemptDirectory}/provider.json`;
  const aiResultPath = `${attemptDirectory}/result.json`;
  const rawResponsePath = `${attemptDirectory}/raw-response.json`;

  try {
    const analysis = await assistReviewText({
      document,
      referenceText,
      ...(options.parseResponse === undefined
        ? {}
        : { parseResponse: options.parseResponse }),
    });

    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, aiResultPath),
      analysis.result,
    );
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, rawResponsePath),
      analysis.rawResponse,
    );

    const documentJson = JSON.parse(reviewContent);
    const { autoReviewed, remainingUnreviewed } = applyAssistResult(
      documentJson,
      analysis.result,
    );
    const updatedDocument = TextReviewDocumentSchema.parse(documentJson);
    const outputPath = resolveWorkspacePath(workspace.path, REVIEW_PATH);
    await writeJsonAtomic(outputPath, updatedDocument);

    const endedAt = new Date().toISOString();
    const [reviewAssetNew, aiResultAsset, rawResponseAsset] = await Promise.all(
      [
        createWorkspaceAsset(outputPath, {
          schemaVersion: SCHEMA_VERSION,
          id: `asset-${attemptId}-text-review`,
          path: REVIEW_PATH,
          role: "text_review",
          createdAt: endedAt,
          producedBy: "assist-review",
          attemptId,
          image: null,
        }),
        createWorkspaceAsset(
          resolveWorkspacePath(workspace.path, aiResultPath),
          {
            schemaVersion: SCHEMA_VERSION,
            id: `asset-${attemptId}-ai-result`,
            path: aiResultPath,
            role: "assist_review_result",
            createdAt: endedAt,
            producedBy: "assist-review",
            attemptId,
            image: null,
          },
        ),
        createWorkspaceAsset(
          resolveWorkspacePath(workspace.path, rawResponsePath),
          {
            schemaVersion: SCHEMA_VERSION,
            id: `asset-${attemptId}-raw-response`,
            path: rawResponsePath,
            role: "provider_response",
            createdAt: endedAt,
            producedBy: "assist-review",
            attemptId,
            image: null,
          },
        ),
      ],
    );

    const providerRecord: ProviderCallRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: `provider-${attemptId}`,
      stage: "assist-review",
      provider: "openai",
      endpoint: "/v1/responses",
      model: OPENAI_TEXT_ASSIST_MODEL,
      parameters: { store: false },
      promptVersion: TEXT_ASSIST_PROMPT_VERSION,
      sentAssets: [{ path: REVIEW_PATH, sha256: reviewAsset.sha256 }],
      requestId: analysis.requestId,
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      usage: asRecord(analysis.usage),
      error: null,
      rawResponsePath,
      rawResponseSha256: rawResponseAsset.sha256,
      parsedResponsePath: aiResultPath,
      parsedResponseSha256: aiResultAsset.sha256,
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
        producedBy: "assist-review",
        attemptId,
        image: null,
      },
    );

    const assets = [
      reviewAssetNew,
      aiResultAsset,
      rawResponseAsset,
      providerRecordAsset,
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
      outputPath,
      attemptId,
      reused: false,
      autoReviewed,
      remainingUnreviewed,
    };
  } catch (error) {
    const endedAt = new Date().toISOString();
    const providerError = errorRecord(error);
    const providerRecord: ProviderCallRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: `provider-${attemptId}`,
      stage: "assist-review",
      provider: "openai",
      endpoint: "/v1/responses",
      model: OPENAI_TEXT_ASSIST_MODEL,
      parameters: { store: false },
      promptVersion: TEXT_ASSIST_PROMPT_VERSION,
      sentAssets: [{ path: REVIEW_PATH, sha256: reviewAsset.sha256 }],
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
        producedBy: "assist-review",
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

import {
  type ArtifactAcceptance,
  ArtifactAcceptanceSchema,
  assertStageDependenciesCompleted,
  FoundationError,
  SCHEMA_VERSION,
  type SlideWorkspaceManifest,
  type WorkspaceAsset,
  type WorkspaceStageAttempt,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import {
  assertWorkspaceAssetIntegrity,
  createWorkspaceAsset,
  loadSlideWorkspace,
  resolveWorkspacePath,
  writeJsonAtomic,
  writeWorkspaceManifest,
} from "../slide/workspace.js";

const ACCEPTED_PATH = "stages/pptx/accepted.json";
const ACCEPTANCE_ASSET_ID = "asset-pptx-acceptance";

export interface RunAcceptPptxOptions {
  readonly workspacePath: string;
  readonly acceptedBy?: string;
  readonly note?: string;
  readonly checklist?: Record<string, boolean>;
}

export interface RunAcceptPptxResult {
  readonly acceptedPath: string;
  readonly acceptanceId: string;
  readonly artifactSha256: string;
}

// PowerPoint for Mac 人工检查清单（implement §8 验收条目）。
const DEFAULT_CHECKLIST: Record<string, boolean> = {
  opensInPowerPoint: true,
  aspect16by9: true,
  textEditable: true,
  fontMicrosoftYaHei: true,
  layoutFaithful: true,
};

function replaceStageState(
  states: readonly WorkspaceStageState[],
  replacement: WorkspaceStageState,
): WorkspaceStageState[] {
  return states.map((state) =>
    state.stage === replacement.stage ? replacement : state,
  );
}

export async function runAcceptPptx(
  options: RunAcceptPptxOptions,
): Promise<RunAcceptPptxResult> {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "accept-pptx");

  const pptxState = workspace.manifest.stages.find(
    (state) => state.stage === "pptx",
  );
  if (
    pptxState?.status !== "completed" ||
    pptxState.lastSuccessfulAttemptId === null ||
    pptxState.completedInputFingerprint === null
  ) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "接受 PPTX 前必须存在成功且未失效的 pptx 产物",
    );
  }
  const pptxAsset = workspace.manifest.assets.find(
    (asset): asset is WorkspaceAsset =>
      asset.role === "pptx" &&
      asset.attemptId === pptxState.lastSuccessfulAttemptId,
  );
  if (pptxAsset === undefined) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "未找到当前 pptx 尝试的产物资产",
    );
  }
  await assertWorkspaceAssetIntegrity(workspace.path, pptxAsset);

  const acceptanceNumber =
    workspace.manifest.attempts.filter(
      (attempt) => attempt.stage === "accept-pptx",
    ).length + 1;
  const acceptanceId = `accept-pptx-${String(acceptanceNumber).padStart(3, "0")}`;
  const acceptedAt = new Date().toISOString();
  const acceptance: ArtifactAcceptance = {
    schemaVersion: SCHEMA_VERSION,
    id: acceptanceId,
    stage: "accept-pptx",
    artifactAssetId: pptxAsset.id,
    artifactSha256: pptxAsset.sha256,
    upstreamFingerprint: pptxState.completedInputFingerprint,
    acceptedAt,
    acceptedBy: options.acceptedBy ?? "developer",
    note: options.note ?? "",
    checklist: options.checklist ?? DEFAULT_CHECKLIST,
  };
  const acceptedPath = resolveWorkspacePath(workspace.path, ACCEPTED_PATH);
  await writeJsonAtomic(
    acceptedPath,
    ArtifactAcceptanceSchema.parse(acceptance),
  );
  const acceptanceAsset = await createWorkspaceAsset(acceptedPath, {
    schemaVersion: SCHEMA_VERSION,
    id: ACCEPTANCE_ASSET_ID,
    path: ACCEPTED_PATH,
    role: "pptx_acceptance",
    createdAt: acceptedAt,
    producedBy: "accept-pptx",
    attemptId: acceptanceId,
    image: null,
  });

  const attempt: WorkspaceStageAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: acceptanceId,
    stage: "accept-pptx",
    number: acceptanceNumber,
    status: "completed",
    inputFingerprint: pptxState.completedInputFingerprint,
    startedAt: acceptedAt,
    endedAt: acceptedAt,
    provider: "developer",
    providerVersion: acceptance.acceptedBy,
    assetIds: [acceptanceAsset.id],
    error: null,
  };
  const acceptState = workspace.manifest.stages.find(
    (state) => state.stage === "accept-pptx",
  );
  if (acceptState === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 accept-pptx 阶段状态",
    );
  }
  const completedState: WorkspaceStageState = {
    ...acceptState,
    status: "completed",
    latestAttemptId: acceptanceId,
    lastSuccessfulAttemptId: acceptanceId,
    completedInputFingerprint: pptxState.completedInputFingerprint,
    invalidatedAt: null,
    invalidationReason: null,
  };
  const nextManifest: SlideWorkspaceManifest = {
    ...workspace.manifest,
    updatedAt: acceptedAt,
    assets: [
      ...workspace.manifest.assets.filter(
        (asset) => asset.id !== ACCEPTANCE_ASSET_ID,
      ),
      acceptanceAsset,
    ],
    stages: replaceStageState(workspace.manifest.stages, completedState),
    attempts: [...workspace.manifest.attempts, attempt],
  };
  await writeWorkspaceManifest(workspace.path, nextManifest);

  return {
    acceptedPath,
    acceptanceId,
    artifactSha256: pptxAsset.sha256,
  };
}

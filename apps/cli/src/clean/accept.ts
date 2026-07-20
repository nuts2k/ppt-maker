import { readFile } from "node:fs/promises";
import {
  type ArtifactAcceptance,
  ArtifactAcceptanceSchema,
  assertStageDependenciesCompleted,
  CleanAttemptRecordSchema,
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

const ACCEPTED_PATH = "stages/clean/accepted.json";
const ACCEPTANCE_ASSET_ID = "asset-clean-acceptance";

export interface RunAcceptCleanOptions {
  readonly workspacePath: string;
  readonly acceptedBy?: string;
  readonly note?: string;
  readonly checklist?: Record<string, boolean>;
}

export interface RunAcceptCleanResult {
  readonly acceptedPath: string;
  readonly acceptanceId: string;
  readonly artifactSha256: string;
  // 供 CLI 打印，让开发者接受前对照当前自动检查数值。
  readonly autoCheckSummary: string;
}

const DEFAULT_CHECKLIST: Record<string, boolean> = {
  noTextResidue: true,
  containersIntact: true,
  noOutsideEdits: true,
  sizeCorrect: true,
};

function replaceStageState(
  states: readonly WorkspaceStageState[],
  replacement: WorkspaceStageState,
): WorkspaceStageState[] {
  return states.map((state) =>
    state.stage === replacement.stage ? replacement : state,
  );
}

export async function runAcceptClean(
  options: RunAcceptCleanOptions,
): Promise<RunAcceptCleanResult> {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "accept-clean");

  const cleanState = workspace.manifest.stages.find(
    (state) => state.stage === "clean",
  );
  if (
    cleanState?.status !== "completed" ||
    cleanState.lastSuccessfulAttemptId === null ||
    cleanState.completedInputFingerprint === null
  ) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "接受 clean plate 前必须存在成功且未失效的 clean 产物",
    );
  }
  // 只有当前 clean 尝试的产物可被接受。
  const cleanAsset = workspace.manifest.assets.find(
    (asset): asset is WorkspaceAsset =>
      asset.role === "clean_plate" &&
      asset.attemptId === cleanState.lastSuccessfulAttemptId,
  );
  if (cleanAsset === undefined) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "未找到当前 clean 尝试的产物资产",
    );
  }
  await assertWorkspaceAssetIntegrity(workspace.path, cleanAsset);

  const recordAsset = workspace.manifest.assets.find(
    (asset): asset is WorkspaceAsset =>
      asset.role === "clean_record" &&
      asset.attemptId === cleanState.lastSuccessfulAttemptId,
  );
  let autoCheckSummary = "无自动检查记录";
  if (recordAsset !== undefined) {
    const record = CleanAttemptRecordSchema.parse(
      JSON.parse(
        await readFile(
          resolveWorkspacePath(workspace.path, recordAsset.path),
          "utf8",
        ),
      ),
    );
    autoCheckSummary = `尺寸${record.checks.size.ok ? "OK" : "异常"}，文字残留 ${record.checks.textResidue.residualForegroundPixels} 像素，mask 外改动率 ${record.checks.outsideMaskDiff.changedRatio.toFixed(4)}，容器环改动率 ${record.checks.containerRingDiff.changedRatio.toFixed(4)}`;
  }

  const acceptanceNumber =
    workspace.manifest.attempts.filter(
      (attempt) => attempt.stage === "accept-clean",
    ).length + 1;
  const acceptanceId = `accept-clean-${String(acceptanceNumber).padStart(3, "0")}`;
  const acceptedAt = new Date().toISOString();
  const acceptance: ArtifactAcceptance = {
    schemaVersion: SCHEMA_VERSION,
    id: acceptanceId,
    stage: "accept-clean",
    artifactAssetId: cleanAsset.id,
    artifactSha256: cleanAsset.sha256,
    // 绑定 clean 阶段输入指纹：mask/复核/源图变化会使 clean 重跑并让本接受记录随阶段 stale。
    upstreamFingerprint: cleanState.completedInputFingerprint,
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
    role: "clean_acceptance",
    createdAt: acceptedAt,
    producedBy: "accept-clean",
    attemptId: acceptanceId,
    image: null,
  });

  const attempt: WorkspaceStageAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: acceptanceId,
    stage: "accept-clean",
    number: acceptanceNumber,
    status: "completed",
    inputFingerprint: cleanState.completedInputFingerprint,
    startedAt: acceptedAt,
    endedAt: acceptedAt,
    provider: "developer",
    providerVersion: acceptance.acceptedBy,
    assetIds: [acceptanceAsset.id],
    error: null,
  };
  const acceptState = workspace.manifest.stages.find(
    (state) => state.stage === "accept-clean",
  );
  if (acceptState === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 accept-clean 阶段状态",
    );
  }
  const completedState: WorkspaceStageState = {
    ...acceptState,
    status: "completed",
    latestAttemptId: acceptanceId,
    lastSuccessfulAttemptId: acceptanceId,
    completedInputFingerprint: cleanState.completedInputFingerprint,
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
    artifactSha256: cleanAsset.sha256,
    autoCheckSummary,
  };
}

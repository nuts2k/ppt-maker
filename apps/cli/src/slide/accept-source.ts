import {
  type ArtifactAcceptance,
  ArtifactAcceptanceSchema,
  assertStageDependenciesCompleted,
  FoundationError,
  requiresSourceAcceptance,
  SCHEMA_VERSION,
  type SlideWorkspaceManifest,
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
} from "./workspace.js";

const ACCEPTED_PATH = "stages/source/accepted.json";
const ACCEPTANCE_ASSET_ID = "asset-source-acceptance";

export interface RunAcceptSourceOptions {
  readonly workspacePath: string;
  readonly acceptedBy?: string;
  readonly note?: string;
}

export interface RunAcceptSourceResult {
  readonly acceptedPath: string;
  readonly acceptanceId: string;
  readonly artifactSha256: string;
}

/**
 * 源图确认（D6）：`generated` 页在进入 ocr 前必须由人确认这张图能用。
 *
 * 与 `accept-clean` / `accept-pptx` 同构——都是 `ArtifactAcceptance` 的实例，
 * 结构照 `clean/accept.ts`。差别只在被验收的产物是源图、上游是 `init`。
 *
 * 本命令**只服务需要人工确认的来源**。`imported` / `extracted` 在建立工作区或换源时
 * 已自动放行（`workspace.ts` 的 buildSourceGate），对它们再走一次人工验收会凭空产生
 * 一条本不该存在的人工痕迹，因此直接拒绝。
 */
export async function runAcceptSource(
  options: RunAcceptSourceOptions,
): Promise<RunAcceptSourceResult> {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "accept-source");

  if (!requiresSourceAcceptance(workspace.manifest.source)) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      `来源 ${workspace.manifest.source.kind} 的源图无需人工确认，已在建立工作区时自动放行`,
      { sourceKind: workspace.manifest.source.kind },
    );
  }

  const initState = workspace.manifest.stages.find(
    (state) => state.stage === "init",
  );
  if (
    initState?.status !== "completed" ||
    initState.lastSuccessfulAttemptId === null ||
    initState.completedInputFingerprint === null
  ) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "确认源图前必须存在成功且未失效的 init 产物",
    );
  }

  const sourceAsset = workspace.manifest.assets.find(
    (asset) => asset.id === workspace.manifest.sourceImageAssetId,
  );
  if (sourceAsset === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "sourceImageAssetId 未指向任何资产",
    );
  }
  await assertWorkspaceAssetIntegrity(workspace.path, sourceAsset);

  const acceptanceNumber =
    workspace.manifest.attempts.filter(
      (attempt) => attempt.stage === "accept-source",
    ).length + 1;
  const acceptanceId = `accept-source-${String(acceptanceNumber).padStart(3, "0")}`;
  const acceptedAt = new Date().toISOString();
  const acceptance: ArtifactAcceptance = {
    schemaVersion: SCHEMA_VERSION,
    id: acceptanceId,
    stage: "accept-source",
    artifactAssetId: sourceAsset.id,
    artifactSha256: sourceAsset.sha256,
    // 绑定 init 输入指纹：换源会让 init 指纹变化并使本接受记录随阶段 stale。
    upstreamFingerprint: initState.completedInputFingerprint,
    acceptedAt,
    acceptedBy: options.acceptedBy ?? "developer",
    note: options.note ?? "",
    // 空清单：源图确认是「这张图能不能用」的整体判断，没有逐项勾选框。
    // 照抄一组恒 true 的默认值只会在 manifest 里留下假的人工痕迹（同 accept-final）。
    checklist: {},
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
    role: "source_acceptance",
    createdAt: acceptedAt,
    producedBy: "accept-source",
    attemptId: acceptanceId,
    image: null,
  });

  const attempt: WorkspaceStageAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: acceptanceId,
    stage: "accept-source",
    number: acceptanceNumber,
    status: "completed",
    inputFingerprint: initState.completedInputFingerprint,
    startedAt: acceptedAt,
    endedAt: acceptedAt,
    provider: "developer",
    providerVersion: acceptance.acceptedBy,
    assetIds: [acceptanceAsset.id],
    error: null,
  };
  const gateState = workspace.manifest.stages.find(
    (state) => state.stage === "accept-source",
  );
  if (gateState === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 accept-source 阶段状态",
    );
  }
  const completedState: WorkspaceStageState = {
    ...gateState,
    status: "completed",
    latestAttemptId: acceptanceId,
    lastSuccessfulAttemptId: acceptanceId,
    completedInputFingerprint: initState.completedInputFingerprint,
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
    stages: workspace.manifest.stages.map((state) =>
      state.stage === "accept-source" ? completedState : state,
    ),
    attempts: [...workspace.manifest.attempts, attempt],
  };
  await writeWorkspaceManifest(workspace.path, nextManifest);

  return {
    acceptedPath,
    acceptanceId,
    artifactSha256: sourceAsset.sha256,
  };
}

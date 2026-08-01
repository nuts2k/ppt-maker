import { copyFile, mkdir, rename } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  invalidateStageAndDownstream,
  materializeSource,
  requiresSourceAcceptance,
  SCHEMA_VERSION,
  type SlideSource,
  type SlideSourceDraft,
  type SlideStage,
  SlideWorkspaceConfigSchema,
  type WorkspaceAsset,
  type WorkspaceStageAttempt,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import { assertWideImage } from "../image.js";
import {
  buildSourceGate,
  createWorkspaceAsset,
  loadSlideWorkspace,
  resolveWorkspacePath,
  sha256Values,
  writeJsonAtomic,
  writeWorkspaceManifest,
} from "./workspace.js";

const REVIEW_OUTPUT_PATH = "stages/review/text-blocks.json";
const VALIDATION_OUTPUT_PATH = "stages/review/validation.json";

export interface ReplaceSlideSourceOptions {
  readonly workspacePath: string;
  readonly imagePath: string;
  /** 新图的来源。缺省视作导入 */
  readonly source?: SlideSourceDraft;
  /** 显式保留该页已确认的人工文字块（D4 的例外路径） */
  readonly keepReview?: boolean;
  readonly reason?: string;
}

export interface ReplaceSlideSourceResult {
  readonly attemptId: string;
  readonly sourceAssetId: string;
  readonly sourceImagePath: string;
  /** 由 completed 转为 stale 的阶段 */
  readonly invalidated: readonly SlideStage[];
  readonly archivedReview: boolean;
  /** 新来源是否需要人工确认源图 */
  readonly requiresAcceptance: boolean;
}

function nextIndex(assets: readonly WorkspaceAsset[], role: string): number {
  return assets.filter((asset) => asset.role === role).length + 1;
}

/**
 * 把该页旧的人工复核成果按 attempt 归档（D4 默认路径）。
 *
 * `readExistingReview` 读的是固定路径（review.ts），归档后该路径 ENOENT → 返回 null
 * → `mergeTextBlockCandidates` 的 `existing` 为 null → 旧图上的人工判断不被继承。
 * review.ts 一行都不用改。
 *
 * 选归档而非删除：资产记录始终指向真实存在的文件（删文件留记录会造成悬空引用），
 * 且人工复核是有成本的劳动，换错图想换回来时还有据可查。
 */
async function archiveReviewArtifacts(
  workspacePath: string,
  assets: readonly WorkspaceAsset[],
  initAttemptId: string,
): Promise<{ readonly assets: WorkspaceAsset[]; readonly archived: boolean }> {
  const archiveDir = `stages/review/archived/${initAttemptId}`;
  let archived = false;
  const next: WorkspaceAsset[] = [];

  for (const asset of assets) {
    const isReviewDocument =
      asset.role === "text_review" && asset.path === REVIEW_OUTPUT_PATH;
    const isValidation =
      asset.role === "review_validation" &&
      asset.path === VALIDATION_OUTPUT_PATH;
    if (!isReviewDocument && !isValidation) {
      next.push(asset);
      continue;
    }

    const archivedPath = `${archiveDir}/${basename(asset.path)}`;
    const from = resolveWorkspacePath(workspacePath, asset.path);
    const to = resolveWorkspacePath(workspacePath, archivedPath);
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    archived = true;
    next.push({
      ...asset,
      // text_review 的 id 已按 review attempt 唯一，可原样保留；
      // review_validation 用固定 id，沿用会被下一次 validate-review 覆盖，
      // 归档记录随即丢失，故换 id。
      id: isValidation ? `${asset.id}-archived-${initAttemptId}` : asset.id,
      path: archivedPath,
    });
  }

  return { assets: next, archived };
}

/**
 * 替换某页的源图（R3）。
 *
 * 与新图来自哪种来源**无关**——重新生成、换个文件、从 PDF 重抽走的是同一条路径。
 * 若只针对「重新生成」做失效处理，「换一张图进去」这个更常见的操作就失去了保护。
 *
 * 失效只作用于本页：deck 层不做任何跨页联动。
 */
export async function replaceSlideSource(
  options: ReplaceSlideSourceOptions,
): Promise<ReplaceSlideSourceResult> {
  const imagePath = resolve(options.imagePath);
  const metadata = await assertWideImage(imagePath);
  const format = metadata.type === "png" ? "png" : "jpg";
  const workspace = await loadSlideWorkspace(options.workspacePath);
  const now = new Date().toISOString();

  // 1) 新图作为新资产写入，旧资产记录与文件保留——换源历史因此天然可查
  const sourceIndex = nextIndex(workspace.manifest.assets, "source_image");
  const relativePath = `inputs/source-${sourceIndex}.${format}`;
  const target = resolveWorkspacePath(workspace.path, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(imagePath, target);

  const initNumber =
    workspace.manifest.attempts.filter((attempt) => attempt.stage === "init")
      .length + 1;
  const attemptId = `init-${String(initNumber).padStart(3, "0")}`;
  const sourceAsset = await createWorkspaceAsset(target, {
    schemaVersion: SCHEMA_VERSION,
    id: `asset-source-image-${sourceIndex}`,
    path: relativePath,
    role: "source_image",
    createdAt: now,
    producedBy: "init",
    attemptId,
    image: {
      width: metadata.width,
      height: metadata.height,
      format: metadata.type === "png" ? "png" : "jpg",
    },
  });

  // 2) 指纹按与 createSlideWorkspace 相同的公式重算，否则下游复用判定认的还是旧图
  const referenceAsset =
    workspace.manifest.referenceTextAssetId === null
      ? null
      : (workspace.manifest.assets.find(
          (asset) => asset.id === workspace.manifest.referenceTextAssetId,
        ) ?? null);
  const inputFingerprint = sha256Values([
    sourceAsset.sha256,
    referenceAsset?.sha256 ?? "no-reference",
    "workspace-version:1",
  ]);
  const initAttempt: WorkspaceStageAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "init",
    number: initNumber,
    status: "completed",
    inputFingerprint,
    startedAt: now,
    endedAt: now,
    provider: "ppt-maker-cli",
    providerVersion: "0.0.0",
    assetIds: [sourceAsset.id],
    error: null,
  };

  const source: SlideSource = materializeSource(
    options.source ?? {
      kind: "imported",
      originalFileName: basename(imagePath),
    },
    attemptId,
    now,
  );

  // 3) 人工复核成果：默认归档，显式保留时原样留在固定路径走既有 IoU 对齐
  const review =
    options.keepReview === true
      ? { assets: [...workspace.manifest.assets], archived: false }
      : await archiveReviewArtifacts(
          workspace.path,
          workspace.manifest.assets,
          attemptId,
        );

  // 4) 失效起点是 accept-source 而非 init：init 刚刚成功，标 stale 与事实相反
  const reason = options.reason ?? "换源：源图已替换";
  const beforeStatus = new Map(
    workspace.manifest.stages.map((state) => [state.stage, state.status]),
  );
  const invalidatedStates = invalidateStageAndDownstream(
    workspace.manifest.stages,
    "accept-source",
    reason,
    now,
  );

  // 5) 按**新来源**重新判定源图确认要求。必须排在失效之后——
  //    invalidateStageAndDownstream 会把 accept-source 一并转 stale，顺序颠倒会被覆盖。
  const gate = buildSourceGate(
    source,
    inputFingerprint,
    now,
    workspace.manifest.attempts.filter(
      (attempt) => attempt.stage === "accept-source",
    ).length + 1,
  );
  const gateState = gate.preCompleted[0];
  const stages: WorkspaceStageState[] = invalidatedStates.map((state) => {
    if (state.stage === "init") {
      return {
        ...state,
        status: "completed",
        latestAttemptId: attemptId,
        lastSuccessfulAttemptId: attemptId,
        completedInputFingerprint: inputFingerprint,
        invalidatedAt: null,
        invalidationReason: null,
      };
    }
    if (state.stage === "accept-source" && gateState !== undefined) {
      return {
        ...state,
        status: "completed",
        latestAttemptId: gateState.attemptId,
        lastSuccessfulAttemptId: gateState.attemptId,
        completedInputFingerprint: gateState.inputFingerprint,
        invalidatedAt: null,
        invalidationReason: null,
      };
    }
    return state;
  });

  const config = {
    ...workspace.config,
    sourceImagePath: sourceAsset.path,
  };
  await writeJsonAtomic(
    resolveWorkspacePath(workspace.path, workspace.manifest.configPath),
    SlideWorkspaceConfigSchema.parse(config),
  );
  await writeWorkspaceManifest(workspace.path, {
    ...workspace.manifest,
    updatedAt: now,
    source,
    sourceImageAssetId: sourceAsset.id,
    assets: [...review.assets, sourceAsset],
    stages,
    attempts: [...workspace.manifest.attempts, initAttempt, ...gate.attempts],
  });

  return {
    attemptId,
    sourceAssetId: sourceAsset.id,
    sourceImagePath: sourceAsset.path,
    invalidated: stages
      .filter(
        (state) =>
          state.status === "stale" && beforeStatus.get(state.stage) !== "stale",
      )
      .map((state) => state.stage),
    archivedReview: review.archived,
    requiresAcceptance: requiresSourceAcceptance(source),
  };
}

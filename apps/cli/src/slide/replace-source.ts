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
const SOURCE_ACCEPTED_PATH = "stages/source/accepted.json";

/**
 * 换源时要从「当前」位置移走的产物。
 *
 * `path` 是该产物的固定当前路径——判据必须是路径而不是裸 role：归档件的 role 不变，
 * 按 role 取首条会取到归档那条（`mask/run.ts` 的同类缺陷已实证）。
 *
 * `renameId` 针对固定 id 的资产：沿用原 id 会被下一轮写入按 id 过滤掉，归档记录随即丢失。
 * `text_review` 的 id 已按 review attempt 唯一，无须改。
 */
interface ArchiveTarget {
  readonly role: WorkspaceAsset["role"];
  readonly path: string;
  readonly renameId: boolean;
}

const REVIEW_TARGETS: readonly ArchiveTarget[] = [
  { role: "text_review", path: REVIEW_OUTPUT_PATH, renameId: false },
  { role: "review_validation", path: VALIDATION_OUTPUT_PATH, renameId: true },
];

/**
 * 源图验收记录**无条件**归档，不受 `--keep-review` 影响。
 *
 * `--keep-review` 保的是文字复核的人工劳动（那份判断对新图仍有参考价值，且走 IoU 对齐）；
 * 而这条记录说的是「上一张图我看过了，能用」——换图之后它对新图根本不成立。
 * 留着它会打穿本子任务自己立的判据：「自动放行不写 accepted.json，判据就是这个文件在不在」
 * （prd B5）。一个自动放行的页磁盘上躺着 accepted.json，或者一张没人看过的 generated 图
 * 被读成「已确认」，都是记录与事实相反（2026-08-01 桌面端走查实证）。
 */
const SOURCE_ACCEPTANCE_TARGET: ArchiveTarget = {
  role: "source_acceptance",
  path: SOURCE_ACCEPTED_PATH,
  renameId: true,
};

export interface ReplaceSlideSourceOptions {
  readonly workspacePath: string;
  readonly imagePath: string;
  /**
   * 新的原始文案参考。给了就写入新的 `reference_text` 资产并把**新** sha 计入指纹；
   * 不给则沿用旧的（`imported` 换源的既有行为）。
   *
   * 缺了这条通道，「改了规格文字再重生成」的页会留着上一版 `reference_text`：
   * 参考文案与图声称的规格不符，复核时按旧文字匹配候选——又一个「元数据说谎」。
   */
  readonly referencePath?: string;
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
  /** 旧图的人工源图验收记录是否被归档（该页此前自动放行时为 false——本来就没有） */
  readonly archivedSourceAcceptance: boolean;
  /** 新来源是否需要人工确认源图 */
  readonly requiresAcceptance: boolean;
}

function nextIndex(assets: readonly WorkspaceAsset[], role: string): number {
  return assets.filter((asset) => asset.role === role).length + 1;
}

interface ArchivedArtifacts {
  readonly assets: WorkspaceAsset[];
  /** 实际发生了归档的 role，用于回报调用方；产物本来就不存在时不计入 */
  readonly archivedRoles: ReadonlySet<WorkspaceAsset["role"]>;
  /**
   * 归档时被改名的资产：旧 id → 新 id。
   *
   * 既有 attempt 的 `assetIds` 必须跟着改指，否则那次 attempt 记的旧 id 会被**下一代**
   * 产物以同一个固定 id 重新占用（`accept-source` 固定写 `asset-source-acceptance`），
   * 于是「第一次确认」这次 attempt 顺着 assetIds 追到的是第二次确认的文件——
   * 一条与事实相反的落盘记录（2026-08-02 阶段三走查在 generated 页的
   * 「确认 → 重新生成 → 再确认」循环上实证）。
   */
  readonly renamedAssetIds: ReadonlyMap<string, string>;
  /** 把已搬走的文件搬回原处。后续步骤失败时调用，避免 manifest 与磁盘分叉 */
  readonly rollback: () => Promise<void>;
}

/** `stages/review/text-blocks.json` → `stages/review/archived/<attempt>/text-blocks.json` */
function archivedPathFor(path: string, initAttemptId: string): string {
  return `${dirname(path)}/archived/${initAttemptId}/${basename(path)}`;
}

/**
 * 把该页对**旧图**成立、对新图不成立的产物按 attempt 归档。
 *
 * 复核稿（D4 默认路径）：`readExistingReview` 读的是固定路径（review.ts），归档后该路径
 * ENOENT → 返回 null → `mergeTextBlockCandidates` 的 `existing` 为 null → 旧图上的人工判断
 * 不被继承。review.ts 一行都不用改。源图验收记录同理——判据是那个固定路径上有没有文件。
 *
 * 选归档而非删除：资产记录始终指向真实存在的文件（删文件留记录会造成悬空引用），
 * 且人工判断是有成本的劳动，换错图想换回来时还有据可查。
 *
 * **一个文件可能被多条资产记录引用**：`review` 与 `assist-review` 各往
 * `stages/review/text-blocks.json` 写过一次，manifest 里就有两条 `text_review` 指向同一路径。
 * 因此按路径搬一次、把所有引用它的记录一并改指归档后的新路径；逐条 rename 的话
 * 第二条必然 ENOENT，任何跑过 assist-review 的真实页都换不了源。
 */
async function archiveArtifacts(
  workspacePath: string,
  assets: readonly WorkspaceAsset[],
  initAttemptId: string,
  targets: readonly ArchiveTarget[],
): Promise<ArchivedArtifacts> {
  /** 原路径 → 归档路径，同时充当「这个文件已经搬过了」的判据 */
  const archivedPaths = new Map<string, string>();
  const archivedRoles = new Set<WorkspaceAsset["role"]>();
  const renamedAssetIds = new Map<string, string>();
  const moved: { readonly from: string; readonly to: string }[] = [];
  const next: WorkspaceAsset[] = [];

  const rollback = async (): Promise<void> => {
    for (const entry of [...moved].reverse()) {
      // 回滚本身再失败也不该盖掉真正的失败原因，故不向外抛
      await rename(entry.to, entry.from).catch(() => undefined);
    }
    moved.length = 0;
  };

  try {
    for (const asset of assets) {
      const target = targets.find(
        (candidate) =>
          candidate.role === asset.role && candidate.path === asset.path,
      );
      if (target === undefined) {
        next.push(asset);
        continue;
      }

      let archivedPath = archivedPaths.get(asset.path);
      if (archivedPath === undefined) {
        archivedPath = archivedPathFor(asset.path, initAttemptId);
        const from = resolveWorkspacePath(workspacePath, asset.path);
        const to = resolveWorkspacePath(workspacePath, archivedPath);
        await mkdir(dirname(to), { recursive: true });
        await rename(from, to);
        moved.push({ from, to });
        archivedPaths.set(asset.path, archivedPath);
      }
      archivedRoles.add(asset.role);

      const archivedId = target.renameId
        ? `${asset.id}-archived-${initAttemptId}`
        : asset.id;
      if (archivedId !== asset.id) {
        renamedAssetIds.set(asset.id, archivedId);
      }
      next.push({ ...asset, id: archivedId, path: archivedPath });
    }
  } catch (error) {
    await rollback();
    throw error;
  }

  return { assets: next, archivedRoles, renamedAssetIds, rollback };
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
  // 会失败的校验一律前移：图片不合格、工作区不合法时一个字节都还没写
  const metadata = await assertWideImage(imagePath);
  const format = metadata.type === "png" ? "png" : "jpg";
  const workspace = await loadSlideWorkspace(options.workspacePath);
  const now = new Date().toISOString();

  // 1) 新图作为新资产写入，旧资产记录与文件保留——换源历史因此天然可查
  //    此步失败只会留下一个未被 manifest 引用的孤儿文件，不构成资产悬空。
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

  // 2) 新参考文案（若有）与源图同一处理原则：旧资产保留供追溯，新的成为当前。
  //    因此 `reference_text` 也会多代，消费方必须按 `referenceTextAssetId` 这个
  //    显式指针取（与 `sourceImageAssetId` 同型），不得裸 role 查找。
  const previousReferenceAsset =
    workspace.manifest.referenceTextAssetId === null
      ? null
      : (workspace.manifest.assets.find(
          (asset) => asset.id === workspace.manifest.referenceTextAssetId,
        ) ?? null);
  let referenceAsset = previousReferenceAsset;
  if (options.referencePath !== undefined) {
    const referenceIndex = nextIndex(
      workspace.manifest.assets,
      "reference_text",
    );
    const referenceRelativePath = `inputs/reference-${referenceIndex}.txt`;
    const referenceTarget = resolveWorkspacePath(
      workspace.path,
      referenceRelativePath,
    );
    await mkdir(dirname(referenceTarget), { recursive: true });
    await copyFile(resolve(options.referencePath), referenceTarget);
    referenceAsset = await createWorkspaceAsset(referenceTarget, {
      schemaVersion: SCHEMA_VERSION,
      id: `asset-reference-text-${referenceIndex}`,
      path: referenceRelativePath,
      role: "reference_text",
      createdAt: now,
      producedBy: "init",
      attemptId,
      image: null,
    });
  }

  // 3) 指纹按与 createSlideWorkspace 相同的公式重算，否则下游复用判定认的还是旧图
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
    assetIds: [
      sourceAsset.id,
      ...(referenceAsset !== null && referenceAsset !== previousReferenceAsset
        ? [referenceAsset.id]
        : []),
    ],
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

  // 6) 落盘：搬文件与写 manifest 必须同进同退。搬完之后任何一步失败都把文件搬回原处，
  //    否则 manifest 里的资产会指向一个已经不在那儿的文件（资产悬空）。
  //    源图验收记录无条件归档；人工复核成果默认归档，显式保留时原样留在固定路径走 IoU 对齐。
  const archived = await archiveArtifacts(
    workspace.path,
    workspace.manifest.assets,
    attemptId,
    options.keepReview === true
      ? [SOURCE_ACCEPTANCE_TARGET]
      : [SOURCE_ACCEPTANCE_TARGET, ...REVIEW_TARGETS],
  );

  const configPath = resolveWorkspacePath(
    workspace.path,
    workspace.manifest.configPath,
  );
  try {
    await writeJsonAtomic(
      configPath,
      SlideWorkspaceConfigSchema.parse({
        ...workspace.config,
        sourceImagePath: sourceAsset.path,
        referenceTextPath: referenceAsset?.path ?? null,
      }),
    );
    await writeWorkspaceManifest(workspace.path, {
      ...workspace.manifest,
      updatedAt: now,
      source,
      sourceImageAssetId: sourceAsset.id,
      referenceTextAssetId: referenceAsset?.id ?? null,
      assets: [
        ...archived.assets,
        sourceAsset,
        ...(referenceAsset !== null && referenceAsset !== previousReferenceAsset
          ? [referenceAsset]
          : []),
      ],
      stages,
      // 归档改名后既有 attempt 的 assetIds 一并改指，见 `renamedAssetIds` 的说明
      attempts: [
        ...workspace.manifest.attempts.map((attempt) =>
          attempt.assetIds.some((id) => archived.renamedAssetIds.has(id))
            ? {
                ...attempt,
                assetIds: attempt.assetIds.map(
                  (id) => archived.renamedAssetIds.get(id) ?? id,
                ),
              }
            : attempt,
        ),
        initAttempt,
        ...gate.attempts,
      ],
    });
  } catch (error) {
    // config 先写、manifest 后写：manifest 失败时 config 已指向新图，这里一并写回旧值，
    // 免得两个文件各说一套源图
    await writeJsonAtomic(configPath, workspace.config).catch(() => undefined);
    await archived.rollback();
    throw error;
  }

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
    archivedReview: archived.archivedRoles.has("text_review"),
    archivedSourceAcceptance: archived.archivedRoles.has("source_acceptance"),
    requiresAcceptance: requiresSourceAcceptance(source),
  };
}

import { createHash, randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  AUTO_SOURCE_TRUST_PROVIDER,
  createInitialStageStates,
  FoundationError,
  materializeSource,
  normalizeSlideManifest,
  type PreCompletedStage,
  requiresSourceAcceptance,
  SCHEMA_VERSION,
  type SlideSource,
  type SlideSourceDraft,
  type SlideWorkspaceConfig,
  SlideWorkspaceConfigSchema,
  type SlideWorkspaceManifest,
  SlideWorkspaceManifestSchema,
  type WorkspaceAsset,
  type WorkspaceStageAttempt,
} from "@ppt-maker/core";
import { assertWideImage } from "../image.js";

export interface CreateSlideWorkspaceOptions {
  readonly imagePath: string;
  readonly workspacePath: string;
  readonly referencePath?: string;
  /**
   * 页面来源。缺省视作导入（`deck init --images` 与 `slide init` 的既有语义）。
   * PDF 抽取与图片生成由各自子任务传入对应分支。
   */
  readonly source?: SlideSourceDraft;
}

/**
 * 按来源决定源图确认闸门的初始状态（D6）。
 *
 * 自动放行时**只**追加一条 attempt 并把阶段置 completed，**不写** `accepted.json`、
 * 不建验收资产——`ArtifactAcceptance` 只在真有人确认时产生。写一条 acceptedBy 指向系统的
 * 记录，等于让报告声称「这页源图有人确认过」而事实没有，正是 M4 列为头号风险的
 * 「记录与事实相反」。状态可以是 completed，但不能伪造人工痕迹。
 *
 * 这条 attempt 上的 `AUTO_SOURCE_TRUST_PROVIDER` 是消费端区分「人工确认 / 自动放行」的
 * 正面标记，判据由 core 的 `resolveSourceAcceptanceMode` 单点给出。
 */
export function buildSourceGate(
  source: SlideSource,
  initFingerprint: string,
  at: string,
  /** accept-source 的第几次 attempt（换源时递增） */
  attemptNumber = 1,
): {
  readonly preCompleted: PreCompletedStage[];
  readonly attempts: WorkspaceStageAttempt[];
} {
  if (requiresSourceAcceptance(source)) {
    return { preCompleted: [], attempts: [] };
  }
  const attemptId = `accept-source-${String(attemptNumber).padStart(3, "0")}`;
  return {
    preCompleted: [
      {
        stage: "accept-source",
        attemptId,
        inputFingerprint: initFingerprint,
      },
    ],
    attempts: [
      {
        schemaVersion: SCHEMA_VERSION,
        id: attemptId,
        stage: "accept-source",
        number: attemptNumber,
        status: "completed",
        inputFingerprint: initFingerprint,
        startedAt: at,
        endedAt: at,
        provider: AUTO_SOURCE_TRUST_PROVIDER,
        providerVersion: null,
        assetIds: [],
        error: null,
      },
    ],
  };
}

export interface LoadedSlideWorkspace {
  readonly path: string;
  readonly manifest: SlideWorkspaceManifest;
  readonly config: SlideWorkspaceConfig;
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await readFile(path);
  hash.update(handle);
  return hash.digest("hex");
}

export function sha256Values(values: readonly string[]): string {
  const hash = createHash("sha256");
  for (const value of values) {
    hash.update(String(Buffer.byteLength(value)), "utf8");
    hash.update(":", "utf8");
    hash.update(value, "utf8");
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}

export async function writeJsonAtomic(
  path: string,
  value: unknown,
): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function writeBufferAtomic(
  path: string,
  buffer: Buffer,
): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, buffer, { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export function resolveWorkspacePath(
  workspacePath: string,
  relativePath: string,
): string {
  const workspace = resolve(workspacePath);
  const target = resolve(workspace, relativePath);
  const fromWorkspace = relative(workspace, target);
  if (
    fromWorkspace === "" ||
    fromWorkspace === ".." ||
    fromWorkspace.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new FoundationError(
      "PATH_OUTSIDE_WORKSPACE",
      `路径不在工作区内：${relativePath}`,
      { relativePath },
    );
  }
  return target;
}

function normalizeImageFormat(type: string): "png" | "jpg" | "jpeg" {
  if (type === "png" || type === "jpg" || type === "jpeg") {
    return type;
  }
  throw new FoundationError(
    "INVALID_WORKSPACE",
    `slide init 只支持 PNG/JPEG，收到：${type}`,
    { imageType: type },
  );
}

export async function createWorkspaceAsset(
  path: string,
  asset: Omit<WorkspaceAsset, "sha256" | "byteSize">,
): Promise<WorkspaceAsset> {
  const file = await stat(path);
  return {
    ...asset,
    sha256: await sha256File(path),
    byteSize: file.size,
  };
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EEXIST" || error.code === "ENOTEMPTY")
  );
}

function isMissingError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

async function assertWorkspaceDoesNotExist(path: string): Promise<void> {
  try {
    await stat(path);
  } catch (error) {
    if (isMissingError(error)) {
      return;
    }
    throw error;
  }
  throw new FoundationError(
    "WORKSPACE_ALREADY_EXISTS",
    `工作区已存在，拒绝覆盖：${path}`,
    { workspacePath: path },
  );
}

export async function createSlideWorkspace(
  options: CreateSlideWorkspaceOptions,
): Promise<LoadedSlideWorkspace> {
  const imagePath = resolve(options.imagePath);
  const workspacePath = resolve(options.workspacePath);
  const referencePath =
    options.referencePath === undefined
      ? undefined
      : resolve(options.referencePath);
  const metadata = await assertWideImage(imagePath);
  const imageFormat = normalizeImageFormat(metadata.type);

  const parent = dirname(workspacePath);
  await mkdir(parent, { recursive: true });
  await assertWorkspaceDoesNotExist(workspacePath);
  const temporaryWorkspace = await mkdtemp(
    join(parent, `.${basename(workspacePath)}.tmp-`),
  );

  try {
    const createdAt = new Date().toISOString();
    const slideId = randomUUID();
    const attemptId = "init-001";
    const sourceRelativePath = `inputs/source.${imageFormat}`;
    const sourceTarget = resolveWorkspacePath(
      temporaryWorkspace,
      sourceRelativePath,
    );
    await mkdir(dirname(sourceTarget), { recursive: true });
    await copyFile(imagePath, sourceTarget);

    const sourceAsset = await createWorkspaceAsset(sourceTarget, {
      schemaVersion: SCHEMA_VERSION,
      id: "asset-source-image",
      path: sourceRelativePath,
      role: "source_image",
      createdAt,
      producedBy: "init",
      attemptId,
      image: {
        width: metadata.width,
        height: metadata.height,
        format: imageFormat,
      },
    });

    let referenceAsset: WorkspaceAsset | null = null;
    if (referencePath !== undefined) {
      const referenceRelativePath = "inputs/reference.txt";
      const referenceTarget = resolveWorkspacePath(
        temporaryWorkspace,
        referenceRelativePath,
      );
      await copyFile(referencePath, referenceTarget);
      referenceAsset = await createWorkspaceAsset(referenceTarget, {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-reference-text",
        path: referenceRelativePath,
        role: "reference_text",
        createdAt,
        producedBy: "init",
        attemptId,
        image: null,
      });
    }

    const inputFingerprint = sha256Values([
      sourceAsset.sha256,
      referenceAsset?.sha256 ?? "no-reference",
      "workspace-version:1",
    ]);
    const initAttempt: WorkspaceStageAttempt = {
      schemaVersion: SCHEMA_VERSION,
      id: attemptId,
      stage: "init",
      number: 1,
      status: "completed",
      inputFingerprint,
      startedAt: createdAt,
      endedAt: createdAt,
      provider: "ppt-maker-cli",
      providerVersion: "0.0.0",
      assetIds: [
        sourceAsset.id,
        ...(referenceAsset === null ? [] : [referenceAsset.id]),
      ],
      error: null,
    };
    const source: SlideSource = materializeSource(
      options.source ?? {
        kind: "imported",
        originalFileName: basename(imagePath),
      },
      attemptId,
      createdAt,
    );
    const gate = buildSourceGate(source, inputFingerprint, createdAt);
    const config: SlideWorkspaceConfig = {
      schemaVersion: SCHEMA_VERSION,
      slideId,
      aspectRatio: "16:9",
      fontFace: "Microsoft YaHei",
      cloudCalls: "explicit_only",
      sourceImagePath: sourceAsset.path,
      referenceTextPath: referenceAsset?.path ?? null,
    };
    const manifest: SlideWorkspaceManifest = {
      schemaVersion: SCHEMA_VERSION,
      workspaceVersion: 1,
      slideId,
      createdAt,
      updatedAt: createdAt,
      configPath: "config.json",
      source,
      sourceImageAssetId: sourceAsset.id,
      referenceTextAssetId: referenceAsset?.id ?? null,
      assets: [
        sourceAsset,
        ...(referenceAsset === null ? [] : [referenceAsset]),
      ],
      stages: createInitialStageStates(
        attemptId,
        inputFingerprint,
        gate.preCompleted,
      ),
      attempts: [initAttempt, ...gate.attempts],
    };

    await writeJsonAtomic(
      resolveWorkspacePath(temporaryWorkspace, "config.json"),
      SlideWorkspaceConfigSchema.parse(config),
    );
    await writeJsonAtomic(
      resolveWorkspacePath(temporaryWorkspace, "manifest.json"),
      SlideWorkspaceManifestSchema.parse(manifest),
    );

    try {
      await assertWorkspaceDoesNotExist(workspacePath);
      await rename(temporaryWorkspace, workspacePath);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        throw new FoundationError(
          "WORKSPACE_ALREADY_EXISTS",
          `工作区已存在，拒绝覆盖：${workspacePath}`,
          { workspacePath },
        );
      }
      throw error;
    }

    return { path: workspacePath, manifest, config };
  } catch (error) {
    await rm(temporaryWorkspace, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
}

const DEFAULT_CONFIG_PATH = "config.json";

function readConfigPath(rawManifest: unknown): string {
  if (typeof rawManifest === "object" && rawManifest !== null) {
    const value = (rawManifest as Record<string, unknown>).configPath;
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return DEFAULT_CONFIG_PATH;
}

export async function loadSlideWorkspace(
  workspacePath: string,
): Promise<LoadedSlideWorkspace> {
  const path = resolve(workspacePath);
  const rawManifest: unknown = JSON.parse(
    await readFile(resolveWorkspacePath(path, "manifest.json"), "utf8"),
  );
  // config 先于 manifest 解析：归一化要用 config.sourceImagePath 给旧数据补来源。
  // 不能反过来先 parse manifest 再取 configPath——parse 正是会失败的那一步，
  // 所以 configPath 从未校验的原始对象里取，取不到才退回默认值。
  const config = SlideWorkspaceConfigSchema.parse(
    JSON.parse(
      await readFile(
        resolveWorkspacePath(path, readConfigPath(rawManifest)),
        "utf8",
      ),
    ),
  );
  // 归一化必须早于 parse：M3/M4 的 manifest 没有 source、没有 accept-source 状态，
  // 直接 parse 会撞上 superRefine 的阶段完整性校验而整份加载失败。
  // 这里只在内存中补齐，不写盘——只读命令不改动旧工作区的磁盘内容。
  const manifest = SlideWorkspaceManifestSchema.parse(
    normalizeSlideManifest(rawManifest, {
      sourceImagePath: config.sourceImagePath,
    }),
  );
  if (manifest.slideId !== config.slideId) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "manifest.json 与 config.json 的 slideId 不一致",
      { manifestSlideId: manifest.slideId, configSlideId: config.slideId },
    );
  }
  return { path, manifest, config };
}

export async function writeWorkspaceManifest(
  workspacePath: string,
  manifest: SlideWorkspaceManifest,
): Promise<void> {
  await writeJsonAtomic(
    resolveWorkspacePath(workspacePath, "manifest.json"),
    SlideWorkspaceManifestSchema.parse(manifest),
  );
}

export async function assertWorkspaceAssetIntegrity(
  workspacePath: string,
  asset: WorkspaceAsset,
): Promise<void> {
  const path = resolveWorkspacePath(workspacePath, asset.path);
  const file = await stat(path);
  const sha256 = await sha256File(path);
  if (file.size !== asset.byteSize || sha256 !== asset.sha256) {
    throw new FoundationError(
      "ASSET_INTEGRITY_MISMATCH",
      `工作区资产完整性校验失败：${asset.path}`,
      {
        assetId: asset.id,
        expectedSha256: asset.sha256,
        actualSha256: sha256,
        expectedByteSize: asset.byteSize,
        actualByteSize: file.size,
      },
    );
  }
}

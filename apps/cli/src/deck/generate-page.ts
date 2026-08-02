// 一页 generated 图的产出与溯源落库（M5 子任务③ design §3）。
//
// `deck generate`（建新页）与 `deck regenerate`（换源）共用本模块：两者的差别只在
// 「图产出之后交给谁」——前者交给 `createSlideWorkspace`，后者交给 `replaceSlideSource`。
// 图怎么生成、提示词怎么拼、溯源落哪三份资产，两条路径必须完全一致。
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ContentSpecEntry,
  type ContentSpecStyle,
  type ContentSpecView,
  ContentSpecViewSchema,
  flattenSpecEntryTexts,
  type ProviderCallRecord,
  ProviderCallRecordSchema,
  SCHEMA_VERSION,
  type SlideSourceDraft,
  type WorkspaceAsset,
} from "@ppt-maker/core";
import {
  CLEAN_PLATE_OUTPUT_FORMAT,
  CLEAN_PLATE_QUALITY,
  CLEAN_PLATE_SIZE,
  generatePageImage,
  OPENAI_IMAGE_MODEL,
  type OpenAiImageGenerator,
} from "../providers/openai-image.js";
import {
  buildPageGenerationPrompt,
  PAGE_GENERATION_PROMPT_VERSION,
  specViewFingerprint,
} from "../providers/page-generation.js";
import {
  createWorkspaceAsset,
  loadSlideWorkspace,
  resolveWorkspacePath,
  writeBufferAtomic,
  writeJsonAtomic,
  writeWorkspaceManifest,
} from "../slide/workspace.js";

export const IMAGE_GENERATION_ENDPOINT = "/v1/images/generations";

export interface GeneratedPageMaterial {
  /** 临时目录中的 PNG。**不读它的尺寸**——尺寸由下游的 sharp 实测落库 */
  readonly imagePath: string;
  /** `textGroups` 展平后的逐行文本；条目无文字时是空文件而非缺失 */
  readonly referencePath: string;
  readonly prompt: string;
  readonly promptSha256: string;
  readonly view: ContentSpecView;
  readonly specEntrySha256: string;
  readonly requestId: string | null;
  readonly usage: Record<string, unknown> | null;
  readonly startedAt: string;
  readonly endedAt: string;
  /** 建页/换源完成后删掉临时目录 */
  readonly cleanup: () => Promise<void>;
}

export interface UploadNotice {
  readonly specEntryId: string;
  readonly promptSha256: string;
  readonly promptBytes: number;
}

export interface GeneratePageMaterialOptions {
  readonly style: ContentSpecStyle;
  readonly entry: ContentSpecEntry;
  /** 测试注入的生成 seam；缺省走真实 OpenAI 客户端 */
  readonly generate?: OpenAiImageGenerator;
  readonly onBeforeUpload?: (notice: UploadNotice) => void;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}

/**
 * 生成一页图，落到临时目录。
 *
 * 生成在建立/替换工作区**之前**：图拿不到就没有半成品的页留在磁盘上。
 */
export async function generatePageMaterial(
  options: GeneratePageMaterialOptions,
): Promise<GeneratedPageMaterial> {
  const prompt = buildPageGenerationPrompt(options.style, options.entry);
  const promptBuffer = Buffer.from(prompt, "utf8");
  const promptSha256 = createHash("sha256").update(promptBuffer).digest("hex");

  options.onBeforeUpload?.({
    specEntryId: options.entry.specEntryId,
    promptSha256,
    promptBytes: promptBuffer.byteLength,
  });

  const startedAt = new Date().toISOString();
  const result = await generatePageImage({
    prompt,
    ...(options.generate === undefined ? {} : { generate: options.generate }),
  });
  const endedAt = new Date().toISOString();

  const directory = await mkdtemp(join(tmpdir(), "ppt-maker-generate-"));
  const imagePath = join(directory, `${options.entry.specEntryId}.png`);
  await writeFile(imagePath, Buffer.from(result.b64Png, "base64"));

  // 逐行写入：`attachReferenceCandidates` 按纯文本逐行消费，每条文字恰好一行。
  // 视觉意图绝不写进这里——它会整条落入 unmatchedReferenceCandidates，
  // 在复核界面表现为一堆假的「漏识别文字」。
  //
  // 条目一条文字都没有时**仍然写**（空文件）：`reference_text` 要与规格始终同步，
  // 「这页没有文字」和「上一版的文字还留着」是两回事。
  const texts = flattenSpecEntryTexts(options.entry);
  const referencePath = join(directory, `${options.entry.specEntryId}.txt`);
  await writeFile(
    referencePath,
    texts.map((text) => `${text}\n`).join(""),
    "utf8",
  );

  return {
    imagePath,
    referencePath,
    prompt,
    promptSha256,
    view: ContentSpecViewSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      style: options.style,
      entry: options.entry,
    }),
    specEntrySha256: specViewFingerprint(options.style, options.entry),
    requestId: result.requestId,
    usage: asRecord(result.usage),
    startedAt,
    endedAt,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

/** 该次生成对应的 `GeneratedSource` 草稿（`attemptId` / `recordedAt` 由建页或换源填） */
export function buildGeneratedSourceDraft(
  material: GeneratedPageMaterial,
): SlideSourceDraft {
  return {
    kind: "generated",
    specEntryId: material.view.entry.specEntryId,
    specEntrySha256: material.specEntrySha256,
    providerId: "openai-image",
    model: OPENAI_IMAGE_MODEL,
    promptVersion: PAGE_GENERATION_PROMPT_VERSION,
    promptSha256: material.promptSha256,
    parameters: {
      size: CLEAN_PLATE_SIZE,
      quality: CLEAN_PLATE_QUALITY,
      outputFormat: CLEAN_PLATE_OUTPUT_FORMAT,
      n: 1,
    },
  };
}

/**
 * 把三份溯源产物挂到**这一次** init attempt 上（父任务 A7）。
 *
 * 路径按 attempt 分目录：`content_spec` 与 `generation_prompt` 每次重生成各出一份，
 * **必然多代**，固定路径会让上一代被覆盖，追不回「上一版是照什么规格生成的」。
 * 消费方按 `attemptId === initStage.lastSuccessfulAttemptId` 取当前那份
 * （见 `currentGenerationAsset`），禁止裸 role 查找。
 *
 * 原始响应**不落盘**：gpt-image-2 的响应体内嵌数 MB base64 图片，图本身已是
 * `source_image` 资产，再存一份 base64 只是把同一张图写两遍。
 */
export async function attachGenerationAssets(options: {
  readonly workspacePath: string;
  readonly attemptId: string;
  readonly material: GeneratedPageMaterial;
}): Promise<readonly WorkspaceAsset[]> {
  const { workspacePath, attemptId, material } = options;
  const directory = `stages/init/${attemptId}`;
  const specPath = `${directory}/content-spec.json`;
  const promptPath = `${directory}/prompt.txt`;
  const providerPath = `${directory}/provider.json`;

  // 合并视图 `{style, entry}` 而非裸条目：让「资产内容」与「指纹覆盖范围」完全一致，
  // 两者因此不可能分叉。
  await writeJsonAtomic(
    resolveWorkspacePath(workspacePath, specPath),
    material.view,
  );
  await writeBufferAtomic(
    resolveWorkspacePath(workspacePath, promptPath),
    Buffer.from(material.prompt, "utf8"),
  );

  const providerRecord: ProviderCallRecord = {
    schemaVersion: SCHEMA_VERSION,
    id: `provider-${attemptId}`,
    stage: "init",
    provider: "openai",
    endpoint: IMAGE_GENERATION_ENDPOINT,
    model: OPENAI_IMAGE_MODEL,
    parameters: {
      size: CLEAN_PLATE_SIZE,
      quality: CLEAN_PLATE_QUALITY,
      output_format: CLEAN_PLATE_OUTPUT_FORMAT,
      n: 1,
    },
    promptVersion: PAGE_GENERATION_PROMPT_VERSION,
    // 文生图不上传任何文件，提示词全文另存为 generation_prompt 资产
    sentAssets: [],
    requestId: material.requestId,
    startedAt: material.startedAt,
    endedAt: material.endedAt,
    durationMs: Date.parse(material.endedAt) - Date.parse(material.startedAt),
    usage: material.usage,
    error: null,
    rawResponsePath: null,
    rawResponseSha256: null,
    parsedResponsePath: null,
    parsedResponseSha256: null,
  };
  await writeJsonAtomic(
    resolveWorkspacePath(workspacePath, providerPath),
    ProviderCallRecordSchema.parse(providerRecord),
  );

  const createdAt = new Date().toISOString();
  const assets = await Promise.all([
    createWorkspaceAsset(resolveWorkspacePath(workspacePath, specPath), {
      schemaVersion: SCHEMA_VERSION,
      id: `asset-${attemptId}-content-spec`,
      path: specPath,
      role: "content_spec",
      createdAt,
      producedBy: "init",
      attemptId,
      image: null,
    }),
    createWorkspaceAsset(resolveWorkspacePath(workspacePath, promptPath), {
      schemaVersion: SCHEMA_VERSION,
      id: `asset-${attemptId}-generation-prompt`,
      path: promptPath,
      role: "generation_prompt",
      createdAt,
      producedBy: "init",
      attemptId,
      image: null,
    }),
    createWorkspaceAsset(resolveWorkspacePath(workspacePath, providerPath), {
      schemaVersion: SCHEMA_VERSION,
      id: `asset-${attemptId}-provider-record`,
      path: providerPath,
      role: "provider_record",
      createdAt,
      producedBy: "init",
      attemptId,
      image: null,
    }),
  ]);

  // 重新加载而不是复用调用方手上的 manifest：建页/换源刚写过盘，
  // 拿旧对象拼接会把它们的写入覆盖掉。
  const workspace = await loadSlideWorkspace(workspacePath);
  await writeWorkspaceManifest(workspace.path, {
    ...workspace.manifest,
    updatedAt: createdAt,
    assets: [...workspace.manifest.assets, ...assets],
    attempts: workspace.manifest.attempts.map((attempt) =>
      attempt.id === attemptId
        ? {
            ...attempt,
            assetIds: [...attempt.assetIds, ...assets.map((a) => a.id)],
          }
        : attempt,
    ),
  });
  return assets;
}

/**
 * 某页**当前**的生成溯源资产。
 *
 * 判据是「init 阶段最后一次成功 attempt」——重生成过两次的页，`content_spec` 有三条，
 * 裸 `assets.find(a => a.role === "content_spec")` 拿到的是第一代：文件确实存在、
 * 哈希也对，错的是它描述的对象已经不是当前那张图，`assertWorkspaceAssetIntegrity`
 * 查不出这类错（《跨层契约》〈多代资产与「当前产物」选取契约〉）。
 */
export function currentGenerationAsset(
  manifest: {
    readonly assets: readonly WorkspaceAsset[];
    readonly stages: readonly {
      readonly stage: string;
      readonly lastSuccessfulAttemptId: string | null;
    }[];
  },
  role: "content_spec" | "generation_prompt" | "provider_record",
): WorkspaceAsset | undefined {
  const attemptId = manifest.stages.find(
    (state) => state.stage === "init",
  )?.lastSuccessfulAttemptId;
  if (attemptId === null || attemptId === undefined) {
    return undefined;
  }
  return manifest.assets.find(
    (asset) => asset.role === role && asset.attemptId === attemptId,
  );
}

/**
 * 这一页**能不能**按内容规格重新生成，以及要用哪个规格条目。
 *
 * 换源是「与新图来自哪种来源无关」的统一路径（design §4.2），但 `deck regenerate`
 * 曾把入口锁死在 `source.kind === "generated"` 上。后果是一页从 `generated` 换成
 * `imported` 之后**再也回不到 `generated`**，父任务 A11 的正向永远走不通
 * （2026-08-02 阶段三走查实证）。
 *
 * 判据顺序，**全部取磁盘事实，不猜**：
 *
 * 1. 当前来源就是 `generated` → 用它自己的 `specEntryId`。
 * 2. 否则回看历史：`stages/init/<attemptId>/content-spec.json` 是每次生成留下的
 *    **不可变快照**（design §6.1），从最近一次 init attempt 往回找第一份读得出来的，
 *    取其 `entry.specEntryId`。这不是推测——那份文件就是「这一页上次按哪条规格出的图」。
 * 3. 一份都没有（从来没生成过的纯导入页）→ `null`。此时要换成生成来源必须由用户
 *    显式指定条目（`deck regenerate --spec-entry <id>`），因为「这一页该对应哪条规格」
 *    是内容决策，工具无从推断。
 *
 * 按 `attempts` 数组倒序而非资产数组顺序：attempts 是追加写入的，顺序即时间序；
 * 资产数组经过换源归档的重排后不再保证时间序。
 */
export async function resolveRegenerableSpecEntryId(
  workspacePath: string,
  manifest: {
    readonly source: { readonly kind: string; readonly specEntryId?: string };
    readonly assets: readonly WorkspaceAsset[];
    readonly attempts: readonly {
      readonly id: string;
      readonly stage: string;
    }[];
  },
): Promise<string | null> {
  if (manifest.source.kind === "generated") {
    return manifest.source.specEntryId ?? null;
  }

  for (const attempt of [...manifest.attempts].reverse()) {
    if (attempt.stage !== "init") continue;
    const asset = manifest.assets.find(
      (candidate) =>
        candidate.role === "content_spec" && candidate.attemptId === attempt.id,
    );
    if (asset === undefined) continue;

    const filePath = resolveWorkspacePath(workspacePath, asset.path);
    try {
      const view = ContentSpecViewSchema.parse(
        JSON.parse(await readFile(filePath, "utf8")),
      );
      return view.entry.specEntryId;
    } catch (error) {
      // 快照读不出来不该让 `deck status` 整个失败，但也不静默吞掉——
      // 一份损坏的历史快照正是「这页为什么突然不能重新生成」的答案。
      process.stderr.write(
        `[warn] 无法读取生成快照 ${asset.path}：${error instanceof Error ? error.message : String(error)}\n`,
      );
    }
  }
  return null;
}

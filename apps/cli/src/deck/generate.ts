// `deck generate`：内容规格驱动逐页生成（M5 子任务③ design §3.1）。
import { rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ContentSpec,
  type ContentSpecEntry,
  type DeckSlideEntry,
  FoundationError,
} from "@ppt-maker/core";
import type { OpenAiImageGenerator } from "../providers/openai-image.js";
import { createSlideWorkspace } from "../slide/workspace.js";
import { nextPageLabel } from "./add-slide.js";
import {
  collectGeneratedPages,
  loadDeckContentSpec,
  readContentSpecFile,
  reconcileDeckSpec,
  type SpecReconciliation,
  writeDeckContentSpec,
} from "./content-spec.js";
import {
  attachGenerationAssets,
  buildGeneratedSourceDraft,
  generatePageMaterial,
  type UploadNotice,
} from "./generate-page.js";
import {
  createEmptyDeckWorkspace,
  type LoadedDeckWorkspace,
  loadDeckWorkspace,
  resolveDeckPath,
  writeDeckManifest,
} from "./workspace.js";

export interface DeckGenerateOptions {
  readonly deckPath: string;
  /** 外部规格文件；deck 内已有权威副本时可省略（等价于「只对账、补缺页」） */
  readonly specPath?: string;
  readonly name?: string;
  readonly confirmUpload: boolean;
  readonly generate?: OpenAiImageGenerator;
  readonly onBeforeUpload?: (notice: UploadNotice) => void;
  readonly onProgress?: (event: DeckGenerateProgress) => void;
}

export interface DeckGenerateProgress {
  readonly specEntryId: string;
  readonly index: number;
  readonly total: number;
  readonly phase: "start" | "done" | "failed";
  readonly pageLabel?: string;
  readonly message?: string;
}

export interface DeckGeneratePageResult {
  readonly specEntryId: string;
  readonly pageLabel: string;
  readonly slideId: string;
  readonly workspacePath: string;
}

export interface DeckGenerateFailure {
  readonly specEntryId: string;
  readonly code: string;
  readonly message: string;
}

export interface DeckGenerateResult {
  readonly deckPath: string;
  readonly created: DeckGeneratePageResult[];
  readonly failed: DeckGenerateFailure[];
  /** 已存在且 specEntryId 匹配的条目（断点续跑跳过的那些） */
  readonly skipped: string[];
  readonly reconciliation: SpecReconciliation;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function errorOf(error: unknown): { code: string; message: string } {
  if (error instanceof FoundationError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * 生成一页并登记进 deck。
 *
 * 顺序刻意如此：先出图（失败则磁盘上什么都没写）→ 建工作区（尺寸与 16:9 由
 * `createSlideWorkspace` 内的 sharp/`assertWideImage` 实测校验）→ 挂溯源资产 →
 * 登记进 deck manifest。**一行尺寸都不自己填**：网关不返回请求的尺寸
 * （请求 2048x1152 实得 1672×941，高度还在 940/941 间浮动过，见 RK1 结论）。
 */
async function generateOnePage(
  deck: LoadedDeckWorkspace,
  spec: ContentSpec,
  entry: ContentSpecEntry,
  options: DeckGenerateOptions,
): Promise<DeckGeneratePageResult> {
  const material = await generatePageMaterial({
    style: spec.style,
    entry,
    ...(options.generate === undefined ? {} : { generate: options.generate }),
    ...(options.onBeforeUpload === undefined
      ? {}
      : { onBeforeUpload: options.onBeforeUpload }),
  });

  try {
    // 每页都重新加载 deck manifest：上一页刚写过盘，用旧对象算页号会撞号
    const current = await loadDeckWorkspace(deck.path);
    const pageLabel = nextPageLabel(current.manifest.slides);
    const slideRelativePath = `slides/${pageLabel}`;
    const slideWorkspacePath = resolveDeckPath(current.path, slideRelativePath);

    const created = await createSlideWorkspace({
      imagePath: material.imagePath,
      workspacePath: slideWorkspacePath,
      source: buildGeneratedSourceDraft(material),
      referencePath: material.referencePath,
    });
    await attachGenerationAssets({
      workspacePath: slideWorkspacePath,
      attemptId: created.manifest.source.attemptId,
      material,
    });

    const addedAt = new Date().toISOString();
    const slideEntry: DeckSlideEntry = {
      slideId: created.manifest.slideId,
      workspacePath: slideRelativePath,
      sourceImageName: `${entry.specEntryId}.png`,
      addedAt,
      removedAt: null,
    };
    await writeDeckManifest(current.path, {
      ...current.manifest,
      slides: [...current.manifest.slides, slideEntry],
      updatedAt: addedAt,
    });

    return {
      specEntryId: entry.specEntryId,
      pageLabel,
      slideId: created.manifest.slideId,
      workspacePath: slideRelativePath,
    };
  } finally {
    await material.cleanup();
  }
}

export async function runDeckGenerate(
  options: DeckGenerateOptions,
): Promise<DeckGenerateResult> {
  if (!options.confirmUpload) {
    throw new FoundationError(
      "UPLOAD_CONFIRMATION_REQUIRED",
      "图片生成会把内容规格提示词发送到 OpenAI，必须显式传入 --confirm-upload",
    );
  }

  const deckPath = resolve(options.deckPath);
  // 会失败的校验一律前移：规格文件不合格时一个字节都还没写。
  // 读规格排在建 deck 之后的话，`--spec 坏文件 --deck 新路径` 会先建出一个空 deck 再抛错。
  const external =
    options.specPath === undefined
      ? null
      : await readContentSpecFile(options.specPath);

  // deck 不存在则创建、存在则按页序追加末尾（与子任务② 的 `deck extract` 同构）。
  // 混合来源的 deck（父任务 A2）正是靠按页序依次调用不同来源的命令实现，
  // 只支持「建新 deck」会让 A2 无法实现。
  const deckExisted = await pathExists(deckPath);
  const deck = deckExisted
    ? await loadDeckWorkspace(deckPath)
    : await createEmptyDeckWorkspace({
        workspacePath: deckPath,
        ...(options.name === undefined ? {} : { name: options.name }),
      });

  const existing = await loadDeckContentSpec(deck.path);
  const spec = external ?? existing;
  if (spec === null) {
    // 这一步只可能在既有 deck 上失败（新建的 deck 必然带着 --spec 的规格进来），
    // 因此不会留下半成品目录。
    throw new FoundationError(
      "INVALID_INPUT",
      "deck 内没有内容规格，必须用 --spec 指定规格文件",
      { deckPath },
    );
  }
  if (external !== null) {
    // 复制进 deck 成为权威副本；此后 deck 内那份才是漂移判定的基准
    await writeDeckContentSpec(deck.path, external);
  }

  const pages = await collectGeneratedPages(deck);
  const reconciliation = reconcileDeckSpec(spec, pages);
  const skipped = spec.entries
    .filter(
      (entry) =>
        !reconciliation.newEntries.some(
          (candidate) => candidate.specEntryId === entry.specEntryId,
        ),
    )
    .map((entry) => entry.specEntryId);

  const created: DeckGeneratePageResult[] = [];
  const failed: DeckGenerateFailure[] = [];
  const total = reconciliation.newEntries.length;

  // 串行：网关限流未知，串行最安全（`scripts/generate-m2-pages.ts` 已有先例）。
  // 单页失败不中断整批——一次批量里第 7 页出错不该让前 6 页白跑。
  for (const [index, entry] of reconciliation.newEntries.entries()) {
    options.onProgress?.({
      specEntryId: entry.specEntryId,
      index: index + 1,
      total,
      phase: "start",
    });
    try {
      const result = await generateOnePage(deck, spec, entry, options);
      created.push(result);
      options.onProgress?.({
        specEntryId: entry.specEntryId,
        index: index + 1,
        total,
        phase: "done",
        pageLabel: result.pageLabel,
      });
    } catch (error) {
      const detail = errorOf(error);
      failed.push({ specEntryId: entry.specEntryId, ...detail });
      options.onProgress?.({
        specEntryId: entry.specEntryId,
        index: index + 1,
        total,
        phase: "failed",
        message: `${detail.code}: ${detail.message}`,
      });
    }
  }

  // 本次新建的 deck 一页都没建成时把它删掉，不留半成品目录（与 `deck extract` 一致）。
  // 判据必须是「本次新建的」——往既有 deck 追加时全部失败，绝不能连既有页一起删。
  // 只补生成缺失页的场景下 `newEntries` 为空、`created` 也为空，那时同样什么都没发生，
  // 一个刚建出来的空 deck 留在磁盘上只是句多余的话。
  if (!deckExisted && created.length === 0) {
    await rm(deck.path, { recursive: true, force: true });
  }

  return { deckPath: deck.path, created, failed, skipped, reconciliation };
}

export function formatDeckGenerateResult(result: DeckGenerateResult): string {
  const lines: string[] = [];
  lines.push(
    `建立 ${result.created.length} 页，跳过 ${result.skipped.length} 页，失败 ${result.failed.length} 页`,
  );
  for (const page of result.created) {
    lines.push(`  + ${page.pageLabel} ← ${page.specEntryId}`);
  }
  for (const failure of result.failed) {
    lines.push(
      `  ! ${failure.specEntryId}：${failure.code} ${failure.message}`,
    );
  }
  lines.push(formatReconciliation(result.reconciliation));
  return lines.join("\n");
}

/**
 * 【新增 / 失联 / 漂移】三类差异（E3）。
 *
 * 失联页**只报告不动手**：删一行规格就静默销毁一页的完整工作量（含已验收产物）
 * 是不可接受的，要删须显式 `deck remove-slide`。
 */
export function formatReconciliation(
  reconciliation: SpecReconciliation,
): string {
  const lines: string[] = ["规格对账："];
  lines.push(
    reconciliation.newEntries.length === 0
      ? "  新增：无"
      : `  新增：${reconciliation.newEntries.map((entry) => entry.specEntryId).join(", ")}`,
  );
  lines.push(
    reconciliation.missingPages.length === 0
      ? "  失联：无"
      : `  失联：${reconciliation.missingPages
          .map((page) => `${page.pageLabel} (${page.specEntryId})`)
          .join(
            ", ",
          )}（规格里已无对应条目；如需删除请显式运行 deck remove-slide）`,
  );
  lines.push(
    reconciliation.drifted.length === 0
      ? "  漂移：无"
      : `  漂移：${reconciliation.drifted
          .map((item) => `${item.pageLabel} (${item.specEntryId})`)
          .join(", ")}（规格已改动，如需重出图请运行 deck regenerate）`,
  );
  return lines.join("\n");
}

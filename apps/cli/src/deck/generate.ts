// `deck generate`：内容规格驱动逐页生成（M5 子任务③ design §3.1）。
import { rm, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";
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
} from "./content-spec.js";
import {
  attachGenerationAssets,
  buildGeneratedSourceDraft,
  generatePageMaterial,
  type UploadNotice,
} from "./generate-page.js";
import { applySpecChange, warnSpecHistoryFailure } from "./spec-edit.js";
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
  /**
   * 只建这些规格条目；**省略＝建全部 `newEntries`**，与引入本参数之前逐字同义。
   *
   * 「未知」的判据是**规格里根本没有这个条目**——整体拒绝，一页都不建。已经建过页的
   * 条目（在规格里、但不在 `newEntries` 里）**不算未知**，它落进既有的 `skipped` 口径：
   * 调用方（界面勾选）的待建列表来自一份可能稍旧的页面快照，把「刚刚在别处被建掉的
   * 条目」判成错误会让一次正常的补页整批失败；而幂等跳过本来就是 `deck generate`
   * 的既定行为（prd F6），这里没有理由另立一套。
   */
  readonly entryIds?: readonly string[];
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
  /**
   * 本次没建的条目：已存在且 specEntryId 匹配的（断点续跑跳过的那些），
   * 以及给了 `entryIds` 时没被选中的那些。
   */
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

/**
 * `entryIds` 里出现规格中不存在的条目时**整体拒绝**，不部分执行。
 *
 * 沿用 `deck regenerate --pages` 的既有口径（`SPEC_PAGE_NOT_FOUND`，
 * `spec/backend/error-handling.md` 已登记「整体拒绝，不部分执行」），不新增错误码：
 * 确认框按 N 条给用户看，实跑 N-1 条属于静默不一致，而这里每一条都要花钱。
 */
function assertKnownEntryIds(
  spec: ContentSpec,
  entryIds: readonly string[] | undefined,
): void {
  if (entryIds === undefined) {
    return;
  }
  const known = spec.entries.map((entry) => entry.specEntryId);
  const knownSet = new Set(known);
  const unknown = entryIds.filter((entryId) => !knownSet.has(entryId));
  if (unknown.length > 0) {
    throw new FoundationError(
      "SPEC_PAGE_NOT_FOUND",
      `内容规格里找不到条目：${unknown.join(", ")}。当前可选条目：${
        known.join(", ") || "（空）"
      }`,
      { unknown, available: known },
    );
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

  // 空数组是「一条都没选」，不是「建全部」——后者要省略这个参数。
  // 静默什么都不做会让调用方以为建过了，而它按次计费，说清楚比省事重要。
  if (options.entryIds !== undefined && options.entryIds.length === 0) {
    throw new FoundationError(
      "SPEC_SELECTION_EMPTY",
      "entryIds 为空：没有指定任何要建的规格条目（省略该参数才表示建全部新增条目）",
    );
  }

  const deckPath = resolve(options.deckPath);
  // 会失败的校验一律前移：规格文件不合格时一个字节都还没写。
  // 读规格排在建 deck 之后的话，`--spec 坏文件 --deck 新路径` 会先建出一个空 deck 再抛错。
  const external =
    options.specPath === undefined
      ? null
      : {
          spec: await readContentSpecFile(options.specPath),
          // 变更记录的 summary 要能说清「这份规格从哪来」，只留文件名即可：
          // 绝对路径进日志既冗长，也把用户目录结构写进了 deck。
          fileName: basename(options.specPath),
        };
  // 同一条纪律：`entryIds` 的未知 id 也在建 deck 之前就判掉，不留半成品目录。
  // 外部规格与它落盘后的副本条目集合相同（`applySpecChange` 只强制沿用
  // specId/createdAt，不动 entries），因此在这里校验外部规格与校验副本等价。
  // 没有外部规格时规格来自 deck 内部，校验点在下面读到它之后——那条路径不新建 deck。
  if (external !== null) {
    assertKnownEntryIds(external.spec, options.entryIds);
  }

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
  let spec = external?.spec ?? existing;
  if (spec === null) {
    // 这一步只可能在既有 deck 上失败（新建的 deck 必然带着 --spec 的规格进来），
    // 因此不会留下半成品目录。
    throw new FoundationError(
      "INVALID_INPUT",
      "deck 内没有内容规格，必须用 --spec 指定规格文件",
      { deckPath },
    );
  }
  if (external === null) {
    // deck 内规格这条路径不会新建 deck（新建的 deck 必然带着 --spec 进来），
    // 因此这里抛错同样零副作用。外部规格那一支已在建 deck 之前校验过。
    assertKnownEntryIds(spec, options.entryIds);
  } else {
    // 复制进 deck 成为权威副本；此后 deck 内那份才是漂移判定的基准。
    //
    // 走统一写入入口而非直调 `writeDeckContentSpec`：变更日志靠写入路径捎带落盘，
    // 留第二条写入路径日志就会漏记（M6 子任务① design §4.1）。**首次导入也记一条**
    // ——deck 内此前没有规格时 `applySpecChange` 取到的 previous 为 null，走的正是
    // 「全部条目都是新增」那一支，不需要给 origin 枚举加值（prd C3）。
    //
    // 落盘后的规格以入口返回的为准：`specId` / `createdAt` 被强制沿用磁盘现值（C4），
    // 外部文件改不动它们。指纹口径不含这三个字段，因此对账结果与直写时一致。
    const applied = await applySpecChange({
      deckPath: deck.path,
      nextSpec: external.spec,
      origin: "manual",
      summary: `deck generate 导入外部规格：${external.fileName}`,
    });
    // 日志写失败不阻断导入（旁路纪律），但必须出声：不说的话这次导入就永远查不到、
    // 也回滚不了，而屏幕上一切正常。
    warnSpecHistoryFailure(applied);
    spec = applied.spec;
  }

  const pages = await collectGeneratedPages(deck);
  // `reconciliation` 始终是**全量**对账结果（不受 entryIds 影响），调用方靠它知道
  // 这一轮之后还剩哪些条目待建；本次实际要建的是下面过滤出的 `targets`。
  const reconciliation = reconcileDeckSpec(spec, pages);
  // 条目子集只在 `newEntries` 里挑：顺序仍按规格条目顺序（页号因此确定），
  // 重复 id 由 Set 成员判定天然只建一次。省略 entryIds 时 `targets` 就是 `newEntries`
  // 本身，下面的 `skipped` / `total` / 循环三处因此与引入本参数之前逐字同义。
  const selection =
    options.entryIds === undefined ? null : new Set(options.entryIds);
  const targets =
    selection === null
      ? reconciliation.newEntries
      : reconciliation.newEntries.filter((entry) =>
          selection.has(entry.specEntryId),
        );
  const skipped = spec.entries
    .filter(
      (entry) =>
        !targets.some(
          (candidate) => candidate.specEntryId === entry.specEntryId,
        ),
    )
    .map((entry) => entry.specEntryId);

  const created: DeckGeneratePageResult[] = [];
  const failed: DeckGenerateFailure[] = [];
  // 进度分母取过滤后的集合：给了 entryIds 还按 newEntries 报「第 1/6 页」，
  // 界面上的进度就与实际执行次数对不上。
  const total = targets.length;

  // 串行：网关限流未知，串行最安全（`scripts/generate-m2-pages.ts` 已有先例）。
  // 单页失败不中断整批——一次批量里第 7 页出错不该让前 6 页白跑。
  for (const [index, entry] of targets.entries()) {
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

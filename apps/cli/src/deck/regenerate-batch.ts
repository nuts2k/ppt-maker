// `deck regenerate --pages / --all-drifted`：批量重生成（M6 子任务① design §6）。
//
// 批量与单页的差别**只有三处**：一次确认覆盖 N 页、进度按页汇报、单页失败不终止其余页。
// 其余一律逐页复用 `regenerateOnePage`——尤其是 `referencePath` 通道：改了规格文字的页
// 必须写入**新的** `reference_text` 资产并把新 sha 计入指纹，绕过它那页会留着上一版
// 参考文案，OCR 复核拿旧文字当真值比对（`slide/replace-source.ts:73`）。
import { FoundationError } from "@ppt-maker/core";
import type { OpenAiImageGenerator } from "../providers/openai-image.js";
import {
  collectGeneratedPages,
  loadDeckContentSpec,
  reconcileDeckSpec,
} from "./content-spec.js";
import type { UploadNotice } from "./generate-page.js";
import { type DeckRegenerateResult, regenerateOnePage } from "./regenerate.js";
import { loadDeckWorkspace } from "./workspace.js";

/**
 * 选页方式。两支都必须**先把 N 定下来再开跑**：批量的确认对话框是按 N 页给用户看的，
 * 实际跑 N-1 页属于静默不一致。
 */
export type DeckRegenerateSelection =
  | { readonly kind: "labels"; readonly labels: readonly string[] }
  | { readonly kind: "all-drifted" };

export interface DeckRegenerateBatchOptions {
  readonly deckPath: string;
  readonly selection: DeckRegenerateSelection;
  /** 调整说明；批量时**逐页追加同一句**，与单页语义一致 */
  readonly note?: string;
  /** 一次确认覆盖 N 页 */
  readonly confirmUpload: boolean;
  readonly generate?: OpenAiImageGenerator;
  readonly onBeforeUpload?: (notice: UploadNotice) => void;
  readonly onProgress?: (event: DeckRegenerateBatchProgress) => void;
}

export interface DeckRegenerateBatchProgress {
  readonly pageLabel: string;
  readonly index: number;
  readonly total: number;
  readonly phase: "start" | "done" | "failed";
  readonly specEntryId?: string;
  readonly message?: string;
}

export interface DeckRegenerateBatchFailure {
  readonly pageLabel: string;
  readonly code: string;
  readonly message: string;
}

export interface DeckRegenerateBatchSkip {
  readonly pageLabel: string;
  readonly reason: string;
}

export interface DeckRegenerateBatchResult {
  readonly deckPath: string;
  readonly regenerated: readonly DeckRegenerateResult[];
  readonly failed: readonly DeckRegenerateBatchFailure[];
  readonly skipped: readonly DeckRegenerateBatchSkip[];
}

interface SelectedPage {
  readonly pageLabel: string;
  readonly slideId: string;
}

interface ResolvedSelection {
  readonly selected: readonly SelectedPage[];
  readonly skipped: readonly DeckRegenerateBatchSkip[];
}

/** 与 `deck generate` 的失败归类同一口径；两处各八行，还不到抽公共件的门槛 */
function errorOf(error: unknown): { code: string; message: string } {
  if (error instanceof FoundationError) {
    return { code: error.code, message: error.message };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : String(error),
  };
}

function pageLabelOf(workspacePath: string): string {
  return workspacePath.replace(/^slides\//u, "");
}

/**
 * 按标签选页。**任何一个标签定位不到就整体拒绝**，不做「部分匹配就开跑」。
 *
 * 匹配规则与单页 `regenerateOnePage` 完全一致（slideId / `slides/<label>` / 原样路径），
 * 否则会出现「批量选得中、单页选不中」这种同一个标识两套解释的情形。
 */
function selectByLabels(
  slides: readonly { slideId: string; workspacePath: string }[],
  labels: readonly string[],
): ResolvedSelection {
  if (labels.length === 0) {
    throw new FoundationError(
      "SPEC_SELECTION_EMPTY",
      "--pages 至少要给一个页面标识",
    );
  }

  const unknown: string[] = [];
  const matched: SelectedPage[] = [];
  for (const label of labels) {
    const slide = slides.find(
      (candidate) =>
        candidate.slideId === label ||
        candidate.workspacePath === `slides/${label}` ||
        candidate.workspacePath === label,
    );
    if (slide === undefined) {
      unknown.push(label);
      continue;
    }
    matched.push({
      pageLabel: pageLabelOf(slide.workspacePath),
      slideId: slide.slideId,
    });
  }

  if (unknown.length > 0) {
    throw new FoundationError(
      "SPEC_PAGE_NOT_FOUND",
      `deck 中找不到页面：${unknown.join(", ")}。当前可选页面：${
        slides.map((slide) => pageLabelOf(slide.workspacePath)).join(", ") ||
        "（空）"
      }`,
      {
        unknown,
        available: slides.map((slide) => pageLabelOf(slide.workspacePath)),
      },
    );
  }

  // 同一页被指定两次只重生成一次，并如实报为「跳过」——重复出图既费钱又会让
  // 「N 页」与实际调用次数对不上。顺序按 deck 页序，与进度编号一致。
  const seen = new Set<string>();
  const skipped: DeckRegenerateBatchSkip[] = [];
  for (const page of matched) {
    if (seen.has(page.slideId)) {
      skipped.push({
        pageLabel: page.pageLabel,
        reason: "重复指定，只重生成一次",
      });
      continue;
    }
    seen.add(page.slideId);
  }
  const selected = slides
    .filter((slide) => seen.has(slide.slideId))
    .map((slide) => ({
      pageLabel: pageLabelOf(slide.workspacePath),
      slideId: slide.slideId,
    }));

  return { selected, skipped };
}

/**
 * 选出当前**已过时**的页。
 *
 * 判据直取 `reconcileDeckSpec`——与 `deck status` / `deck generate` /
 * `previewSpecChange` 是同一个函数，**绝不在这里另写一份指纹比对**：两处各写一份
 * 必然静默漂移，界面说「没改」而批量却把它重出了一遍（或反之），没有任何东西会报错。
 */
async function selectDrifted(deckPath: string): Promise<ResolvedSelection> {
  const deck = await loadDeckWorkspace(deckPath);
  const spec = await loadDeckContentSpec(deck.path);
  if (spec === null) {
    throw new FoundationError(
      "INVALID_INPUT",
      "deck 内没有内容规格，无法按过时范围批量重生成；请先运行 deck generate --spec",
      { deckPath: deck.path },
    );
  }

  const pages = await collectGeneratedPages(deck);
  const bySpecEntryId = new Map(pages.map((page) => [page.specEntryId, page]));
  const selected: SelectedPage[] = [];
  for (const item of reconcileDeckSpec(spec, pages).drifted) {
    const page = bySpecEntryId.get(item.specEntryId);
    if (page === undefined) {
      continue;
    }
    selected.push({
      pageLabel: page.pageLabel,
      slideId: page.entry.slideId,
    });
  }

  if (selected.length === 0) {
    throw new FoundationError(
      "SPEC_SELECTION_EMPTY",
      "没有已过时的页面，无需重新生成",
      { deckPath: deck.path },
    );
  }
  return { selected, skipped: [] };
}

async function resolveSelection(
  deckPath: string,
  selection: DeckRegenerateSelection,
): Promise<ResolvedSelection> {
  if (selection.kind === "all-drifted") {
    return selectDrifted(deckPath);
  }
  const deck = await loadDeckWorkspace(deckPath);
  return selectByLabels(
    deck.manifest.slides.filter((slide) => slide.removedAt === null),
    selection.labels,
  );
}

/**
 * 批量重生成。选页确定后**串行**逐页调 `regenerateOnePage`：网关限流未知，串行最安全
 * （与 `deck generate` 同一理由），不引入并发。
 *
 * **未选中的页在整条路径上不被读写**——A①-2（未勾选的页字节不变）由这个结构保证，
 * 不靠事后检查。
 */
export async function runDeckRegenerateBatch(
  options: DeckRegenerateBatchOptions,
): Promise<DeckRegenerateBatchResult> {
  if (!options.confirmUpload) {
    throw new FoundationError(
      "UPLOAD_CONFIRMATION_REQUIRED",
      "批量重新生成会把内容规格提示词逐页发送到 OpenAI，必须显式传入 --confirm-upload",
    );
  }

  const { selected, skipped } = await resolveSelection(
    options.deckPath,
    options.selection,
  );

  const regenerated: DeckRegenerateResult[] = [];
  const failed: DeckRegenerateBatchFailure[] = [];
  const total = selected.length;

  for (const [index, page] of selected.entries()) {
    options.onProgress?.({
      pageLabel: page.pageLabel,
      index: index + 1,
      total,
      phase: "start",
    });
    try {
      const result = await regenerateOnePage({
        deckPath: options.deckPath,
        page: page.slideId,
        ...(options.note === undefined ? {} : { note: options.note }),
        ...(options.generate === undefined
          ? {}
          : { generate: options.generate }),
        ...(options.onBeforeUpload === undefined
          ? {}
          : { onBeforeUpload: options.onBeforeUpload }),
      });
      regenerated.push(result);
      options.onProgress?.({
        pageLabel: result.pageLabel,
        index: index + 1,
        total,
        phase: "done",
        specEntryId: result.specEntryId,
      });
    } catch (error) {
      // 单页失败不终止其余页：一次批量里第 7 页出错不该让前 6 页白跑
      const detail = errorOf(error);
      failed.push({ pageLabel: page.pageLabel, ...detail });
      options.onProgress?.({
        pageLabel: page.pageLabel,
        index: index + 1,
        total,
        phase: "failed",
        message: `${detail.code}: ${detail.message}`,
      });
    }
  }

  return { deckPath: options.deckPath, regenerated, failed, skipped };
}

export function formatDeckRegenerateBatchResult(
  result: DeckRegenerateBatchResult,
): string {
  const lines = [
    `重新生成 ${result.regenerated.length} 页，失败 ${result.failed.length} 页，跳过 ${result.skipped.length} 页`,
  ];
  for (const page of result.regenerated) {
    lines.push(
      `  + ${page.pageLabel} ← ${page.specEntryId}（${page.attemptId}）`,
    );
  }
  for (const failure of result.failed) {
    lines.push(`  ! ${failure.pageLabel}：${failure.code} ${failure.message}`);
  }
  for (const skip of result.skipped) {
    lines.push(`  - ${skip.pageLabel}：${skip.reason}`);
  }
  const pending = result.regenerated.filter((page) => page.requiresAcceptance);
  if (pending.length > 0) {
    lines.push(
      `${pending.length} 页新源图需人工确认后才会继续下游：ppt-maker slide accept-source`,
    );
  }
  return lines.join("\n");
}

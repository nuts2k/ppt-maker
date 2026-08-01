// `deck regenerate`：带调整说明重新生成某页（M5 子任务③ design §3.3）。
import {
  type ContentSpec,
  type ContentSpecEntry,
  FoundationError,
  type SlideStage,
} from "@ppt-maker/core";
import type { OpenAiImageGenerator } from "../providers/openai-image.js";
import { replaceSlideSource } from "../slide/replace-source.js";
import { loadSlideWorkspace } from "../slide/workspace.js";
import { loadDeckContentSpec, writeDeckContentSpec } from "./content-spec.js";
import {
  attachGenerationAssets,
  buildGeneratedSourceDraft,
  generatePageMaterial,
  type UploadNotice,
} from "./generate-page.js";
import {
  loadDeckWorkspace,
  resolveDeckPath,
  writeDeckManifest,
} from "./workspace.js";

export interface DeckRegenerateOptions {
  readonly deckPath: string;
  /** 页标签（page-04）或 slideId */
  readonly page: string;
  /** 调整说明，**机械追加**进该条目 `revisionNotes`；不给则按现有规格重出一次 */
  readonly note?: string;
  readonly confirmUpload: boolean;
  readonly generate?: OpenAiImageGenerator;
  readonly onBeforeUpload?: (notice: UploadNotice) => void;
}

export interface DeckRegenerateResult {
  readonly slideId: string;
  readonly workspacePath: string;
  readonly pageLabel: string;
  readonly specEntryId: string;
  readonly attemptId: string;
  readonly revisionNotes: readonly string[];
  readonly invalidated: readonly SlideStage[];
  readonly requiresAcceptance: boolean;
}

/**
 * 说明**机械追加**，不引入模型改写（D7 明令禁止）。
 *
 * 追加发生在生成**之前**并立刻写回规格文件：这样即使随后生成失败，用户写下的意图
 * 也没丢，且该页会如实显示为「已漂移」——规格改了、图没跟上，正是漂移的定义。
 * 重试时不必再带 `--note`，累积的说明照样生效。
 */
function appendRevisionNote(
  spec: ContentSpec,
  specEntryId: string,
  note: string | undefined,
  now: string,
): { spec: ContentSpec; entry: ContentSpecEntry } {
  const trimmed = note?.trim() ?? "";
  const entries = spec.entries.map((entry) =>
    entry.specEntryId === specEntryId && trimmed.length > 0
      ? { ...entry, revisionNotes: [...entry.revisionNotes, trimmed] }
      : entry,
  );
  const entry = entries.find(
    (candidate) => candidate.specEntryId === specEntryId,
  );
  if (entry === undefined) {
    throw new FoundationError(
      "INVALID_INPUT",
      `内容规格中找不到条目：${specEntryId}（该页已失联，请先在规格里补回该条目）`,
      { specEntryId },
    );
  }
  return {
    spec: {
      ...spec,
      entries,
      ...(trimmed.length > 0 ? { updatedAt: now } : {}),
    },
    entry,
  };
}

export async function runDeckRegenerate(
  options: DeckRegenerateOptions,
): Promise<DeckRegenerateResult> {
  if (!options.confirmUpload) {
    throw new FoundationError(
      "UPLOAD_CONFIRMATION_REQUIRED",
      "重新生成会把内容规格提示词发送到 OpenAI，必须显式传入 --confirm-upload",
    );
  }

  const deck = await loadDeckWorkspace(options.deckPath);
  const slideEntry = deck.manifest.slides.find(
    (slide) =>
      slide.removedAt === null &&
      (slide.slideId === options.page ||
        slide.workspacePath === `slides/${options.page}` ||
        slide.workspacePath === options.page),
  );
  if (slideEntry === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      `deck 中找不到页面：${options.page}`,
      { page: options.page },
    );
  }

  const slideWorkspacePath = resolveDeckPath(
    deck.path,
    slideEntry.workspacePath,
  );
  const workspace = await loadSlideWorkspace(slideWorkspacePath);
  if (workspace.manifest.source.kind !== "generated") {
    throw new FoundationError(
      "INVALID_INPUT",
      `只有生成来源的页可以重新生成，该页来源是：${workspace.manifest.source.kind}`,
      { page: options.page, kind: workspace.manifest.source.kind },
    );
  }
  const specEntryId = workspace.manifest.source.specEntryId;

  const spec = await loadDeckContentSpec(deck.path);
  if (spec === null) {
    throw new FoundationError(
      "INVALID_INPUT",
      "deck 内没有内容规格，无法重新生成；请先运行 deck generate --spec",
      { deckPath: deck.path },
    );
  }

  const now = new Date().toISOString();
  const updated = appendRevisionNote(spec, specEntryId, options.note, now);
  await writeDeckContentSpec(deck.path, updated.spec);

  const material = await generatePageMaterial({
    style: updated.spec.style,
    entry: updated.entry,
    ...(options.generate === undefined ? {} : { generate: options.generate }),
    ...(options.onBeforeUpload === undefined
      ? {}
      : { onBeforeUpload: options.onBeforeUpload }),
  });

  try {
    // 重生成 = 换源：失效级联、产物归档、`accept-source` 按新来源重判全部由 ① 的
    // `replaceSlideSource` 提供，这里一行都不重写。`specEntrySha256` 用**追加说明
    // 之后**的新指纹，否则刚生成完就立刻显示漂移。
    const replaced = await replaceSlideSource({
      workspacePath: slideWorkspacePath,
      imagePath: material.imagePath,
      referencePath: material.referencePath,
      source: buildGeneratedSourceDraft(material),
      reason: "重新生成：按内容规格重出该页",
    });
    await attachGenerationAssets({
      workspacePath: slideWorkspacePath,
      attemptId: replaced.attemptId,
      material,
    });

    const updatedAt = new Date().toISOString();
    await writeDeckManifest(deck.path, {
      ...deck.manifest,
      slides: deck.manifest.slides.map((slide) =>
        slide.slideId === slideEntry.slideId
          ? { ...slide, sourceImageName: `${specEntryId}.png` }
          : slide,
      ),
      updatedAt,
    });

    return {
      slideId: slideEntry.slideId,
      workspacePath: slideEntry.workspacePath,
      pageLabel: slideEntry.workspacePath.replace(/^slides\//u, ""),
      specEntryId,
      attemptId: replaced.attemptId,
      revisionNotes: updated.entry.revisionNotes,
      invalidated: replaced.invalidated,
      requiresAcceptance: replaced.requiresAcceptance,
    };
  } finally {
    await material.cleanup();
  }
}

export function formatDeckRegenerateResult(
  result: DeckRegenerateResult,
): string {
  const lines = [
    `已重新生成 ${result.pageLabel}（${result.specEntryId}，${result.attemptId}）`,
    `失效阶段：${result.invalidated.join(", ") || "无"}`,
    result.revisionNotes.length === 0
      ? "调整说明：无"
      : `调整说明（${result.revisionNotes.length} 条，后出现的优先）：${result.revisionNotes.join(" / ")}`,
  ];
  if (result.requiresAcceptance) {
    lines.push("新源图需人工确认后才会继续下游：ppt-maker slide accept-source");
  }
  return lines.join("\n");
}

// `deck regenerate`：带调整说明重新生成某页（M5 子任务③ design §3.3）。
import {
  type ContentSpec,
  type ContentSpecEntry,
  FoundationError,
  type SlideSourceKind,
  type SlideStage,
} from "@ppt-maker/core";
import type { OpenAiImageGenerator } from "../providers/openai-image.js";
import { replaceSlideSource } from "../slide/replace-source.js";
import { loadSlideWorkspace } from "../slide/workspace.js";
import { loadDeckContentSpec } from "./content-spec.js";
import {
  attachGenerationAssets,
  buildGeneratedSourceDraft,
  generatePageMaterial,
  resolveRegenerableSpecEntryId,
  type UploadNotice,
} from "./generate-page.js";
import { applySpecChange, warnSpecHistoryFailure } from "./spec-edit.js";
import {
  loadDeckWorkspace,
  resolveDeckPath,
  writeDeckManifest,
} from "./workspace.js";

/**
 * 单页重生成的执行入参——**不含 `confirmUpload`**。
 *
 * 上传确认是命令面的门禁，不是单页执行体的职责：批量路径一次确认覆盖 N 页
 * （父任务 design §7），确认留在这一层会变成「每页各问一次」。
 */
export interface RegenerateOnePageOptions {
  readonly deckPath: string;
  /** 页标签（page-04）或 slideId */
  readonly page: string;
  /** 调整说明，**机械追加**进该条目 `revisionNotes`；不给则按现有规格重出一次 */
  readonly note?: string;
  /**
   * 显式指定要用哪个规格条目。
   *
   * 只在**推断不出来**时才必须给（从来没生成过的纯导入页要换成生成来源）。给了就以它
   * 为准——「这一页该对应哪条规格」是内容决策，用户说了算，工具不得反过来覆盖。
   */
  readonly specEntryId?: string;
  readonly generate?: OpenAiImageGenerator;
  readonly onBeforeUpload?: (notice: UploadNotice) => void;
}

export interface DeckRegenerateOptions extends RegenerateOnePageOptions {
  readonly confirmUpload: boolean;
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
  /** 重生成**之前**该页的来源。不是 `generated` 即意味着这次顺带换回了生成来源 */
  readonly previousSourceKind: SlideSourceKind;
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
      `内容规格中找不到条目：${specEntryId}（该页已失联，请先在规格里补回该条目，` +
        `或用 --spec-entry 指定一个现有条目）。当前可用条目：${
          spec.entries.map((candidate) => candidate.specEntryId).join(", ") ||
          "（空）"
        }`,
      {
        specEntryId,
        available: spec.entries.map((candidate) => candidate.specEntryId),
      },
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

/**
 * 变更记录的一句话描述。
 *
 * 没给 `--note` 时**不谎称追加了说明**：那一轮规格内容一个字都没改，
 * 写成「追加说明：（空）」会在历史里留下与事实相反的记录。
 * 有说明时只取首行并截断——记录是给人扫一眼用的，全文在规格文件里。
 */
function describeRevision(note: string | undefined): string {
  const firstLine = note?.trim().split("\n")[0]?.trim() ?? "";
  if (firstLine.length === 0) {
    return "重生成：按现有规格重出该页";
  }
  return `重生成追加说明：${
    firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine
  }`;
}

/**
 * 单页重生成的完整执行体——**批量路径的唯一入口**（父任务 design §7）。
 *
 * 批量不得另拼 `replaceSlideSource` 调用：那样会绕开这里的 `referencePath` 通道，
 * 该页会留着上一版 `reference_text`，OCR 复核拿旧文字当真值比对
 * （`slide/replace-source.ts:73` 注释已写明后果）。逐页复用本函数，通道自然在。
 *
 * 每次调用都重新 `loadDeckWorkspace` / `loadDeckContentSpec`：上一页刚写过 deck
 * manifest 与规格文件，用旧对象接着算会把前一页的写入覆盖掉（与 `generateOnePage`
 * 每页重载同理）。
 */
export async function regenerateOnePage(
  options: RegenerateOnePageOptions,
): Promise<DeckRegenerateResult> {
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
  const previousSourceKind = workspace.manifest.source.kind;

  const spec = await loadDeckContentSpec(deck.path);
  if (spec === null) {
    throw new FoundationError(
      "INVALID_INPUT",
      "deck 内没有内容规格，无法重新生成；请先运行 deck generate --spec",
      { deckPath: deck.path },
    );
  }

  /*
   * 前置校验**不再要求当前来源是 `generated`**。
   *
   * 换源是与新图来源无关的统一路径（design §4.2〈换源后的重新判定〉：「换源统一走
   * 一条路径，而这条路径按新来源决定是否需要重新确认，不需要为『重新生成』单开分支」）。
   * 旧的 `kind === "generated"` 门禁与这句话相悖，实际后果是一页换成 `imported` 之后
   * 再也回不到 `generated`，A11 的正向永远走不通。
   *
   * 换掉门禁的不是「放宽」，而是换一个**真正的**前提：能不能无歧义地确定规格条目。
   */
  const specEntryId =
    options.specEntryId ??
    (await resolveRegenerableSpecEntryId(
      slideWorkspacePath,
      workspace.manifest,
    ));
  if (specEntryId === null) {
    throw new FoundationError(
      "INVALID_INPUT",
      `无法确定该页要用哪个规格条目（当前来源 ${previousSourceKind}，且没有任何一次生成快照）；` +
        `请用 --spec-entry 显式指定。当前规格可用条目：${
          spec.entries.map((entry) => entry.specEntryId).join(", ") || "（空）"
        }`,
      {
        page: options.page,
        kind: previousSourceKind,
        available: spec.entries.map((entry) => entry.specEntryId),
      },
    );
  }

  const now = new Date().toISOString();
  const updated = appendRevisionNote(spec, specEntryId, options.note, now);
  // **时序不变：先写规格、再出图**（理由见 `appendRevisionNote` 注释——即使随后
  // 生成失败，用户写下的意图也已落盘）。改的只是写入方式：走统一入口，这次追加
  // 因此同样进变更历史（M6 子任务① design §4.1）。
  const applied = await applySpecChange({
    deckPath: deck.path,
    nextSpec: updated.spec,
    origin: "manual",
    summary: describeRevision(options.note),
  });
  // 日志写失败不阻断重生成（旁路纪律），但必须出声——批量跑 N 页时尤其如此：
  // 悄悄丢掉的是「这 N 次改动分别改了什么」。
  warnSpecHistoryFailure(applied);

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
      previousSourceKind,
    };
  } finally {
    await material.cleanup();
  }
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
  return regenerateOnePage(options);
}

export function formatDeckRegenerateResult(
  result: DeckRegenerateResult,
): string {
  const lines = [
    `已重新生成 ${result.pageLabel}（${result.specEntryId}，${result.attemptId}）`,
    ...(result.previousSourceKind === "generated"
      ? []
      : [`来源已由 ${result.previousSourceKind} 换回 generated`]),
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

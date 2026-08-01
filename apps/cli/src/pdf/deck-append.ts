import type { DeckSlideEntry, SlideSourceDraft } from "@ppt-maker/core";
import { nextPageLabel } from "../deck/add-slide.js";
import {
  loadDeckWorkspace,
  resolveDeckPath,
  writeDeckManifest,
} from "../deck/workspace.js";
import { createSlideWorkspace } from "../slide/workspace.js";

/**
 * 带来源的追加。
 *
 * 只有「填 `source`」这一件事与 `addSlideToDeck` 不同（后者恒为导入），因此页号规则
 * 直接用 `deck/add-slide.ts` 导出的 `nextPageLabel`，不另抄一份——编号规则一旦有两份，
 * 同一个 deck 迟早出现两套页号，而混合来源的 deck（父任务 A2）正是三条命令交替追加。
 * 建空 deck 同理用 `createEmptyDeckWorkspace`（见 `extract.ts`）。
 */

export interface AppendSlideWithSourceOptions {
  readonly deckPath: string;
  readonly imagePath: string;
  readonly source: SlideSourceDraft;
  /** deck 条目的显示名。抽取页用「文档名#p页号」，它不是磁盘上的文件名 */
  readonly sourceImageName: string;
}

export interface AppendSlideWithSourceResult {
  readonly slideId: string;
  readonly pageLabel: string;
  /** deck 内相对路径，如 slides/page-03 */
  readonly workspacePath: string;
}

export async function appendSlideWithSource(
  options: AppendSlideWithSourceOptions,
): Promise<AppendSlideWithSourceResult> {
  const { path, manifest } = await loadDeckWorkspace(options.deckPath);

  const pageLabel = nextPageLabel(manifest.slides);
  const slideRelativePath = `slides/${pageLabel}`;

  const created = await createSlideWorkspace({
    imagePath: options.imagePath,
    workspacePath: resolveDeckPath(path, slideRelativePath),
    source: options.source,
  });

  const addedAt = new Date().toISOString();
  const entry: DeckSlideEntry = {
    slideId: created.manifest.slideId,
    workspacePath: slideRelativePath,
    sourceImageName: options.sourceImageName,
    addedAt,
    removedAt: null,
  };

  // 既有页零改动：只往末尾 push，不动其它条目、不重排 page-NN。
  await writeDeckManifest(path, {
    ...manifest,
    slides: [...manifest.slides, entry],
    updatedAt: addedAt,
  });

  return {
    slideId: created.manifest.slideId,
    pageLabel,
    workspacePath: slideRelativePath,
  };
}

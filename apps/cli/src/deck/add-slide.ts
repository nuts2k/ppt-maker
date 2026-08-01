import { basename } from "node:path";
import type { DeckSlideEntry } from "@ppt-maker/core";
import { createSlideWorkspace } from "../slide/workspace.js";
import {
  loadDeckWorkspace,
  resolveDeckPath,
  writeDeckManifest,
} from "./workspace.js";

export interface AddSlideOptions {
  readonly deckPath: string;
  readonly imagePath: string;
}

export interface AddSlideResult {
  readonly slideId: string;
  readonly workspacePath: string;
  readonly pageLabel: string;
}

const PAGE_PATTERN = /^slides\/page-(\d+)$/;

function nextPageNumber(slides: readonly DeckSlideEntry[]): number {
  let max = 0;
  for (const slide of slides) {
    const match = PAGE_PATTERN.exec(slide.workspacePath);
    if (match?.[1] === undefined) {
      continue;
    }
    const value = Number.parseInt(match[1], 10);
    if (value > max) {
      max = value;
    }
  }
  return max + 1;
}

function formatPageNumber(value: number): string {
  const width = value > 99 ? 3 : 2;
  return String(value).padStart(width, "0");
}

/**
 * 下一页的页标签（`page-03`）。
 *
 * 追加语义的单点定义：编号只增不重排，既有页目录名因此永不改变。混合来源的 deck
 * （父任务 A2：导入 / PDF 抽取 / 生成交错）靠**按页序依次调用不同来源的命令**实现，
 * 三条命令必须共用同一份编号规则，否则同一个 deck 会出现两套页号。
 */
export function nextPageLabel(slides: readonly DeckSlideEntry[]): string {
  return `page-${formatPageNumber(nextPageNumber(slides))}`;
}

export async function addSlideToDeck(
  options: AddSlideOptions,
): Promise<AddSlideResult> {
  const { path, manifest } = await loadDeckWorkspace(options.deckPath);

  const pageLabel = nextPageLabel(manifest.slides);
  const slideRelativePath = `slides/${pageLabel}`;

  const created = await createSlideWorkspace({
    imagePath: options.imagePath,
    workspacePath: resolveDeckPath(path, slideRelativePath),
  });

  const addedAt = new Date().toISOString();
  const entry: DeckSlideEntry = {
    slideId: created.manifest.slideId,
    workspacePath: slideRelativePath,
    sourceImageName: basename(options.imagePath),
    addedAt,
    removedAt: null,
  };

  await writeDeckManifest(path, {
    ...manifest,
    slides: [...manifest.slides, entry],
    updatedAt: addedAt,
  });

  return {
    slideId: created.manifest.slideId,
    workspacePath: slideRelativePath,
    pageLabel,
  };
}

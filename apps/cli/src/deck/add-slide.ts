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

export async function addSlideToDeck(
  options: AddSlideOptions,
): Promise<AddSlideResult> {
  const { path, manifest } = await loadDeckWorkspace(options.deckPath);

  const pageNumber = formatPageNumber(nextPageNumber(manifest.slides));
  const pageLabel = `page-${pageNumber}`;
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

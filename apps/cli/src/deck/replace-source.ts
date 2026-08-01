import { basename } from "node:path";
import { FoundationError, type SlideStage } from "@ppt-maker/core";
import { replaceSlideSource } from "../slide/replace-source.js";
import {
  loadDeckWorkspace,
  resolveDeckPath,
  writeDeckManifest,
} from "./workspace.js";

export interface DeckReplaceSourceOptions {
  readonly deckPath: string;
  /** 页标签（page-04）或 slideId，二选一即可定位 */
  readonly page: string;
  readonly imagePath: string;
  readonly keepReview?: boolean;
}

export interface DeckReplaceSourceResult {
  readonly slideId: string;
  readonly workspacePath: string;
  readonly invalidated: readonly SlideStage[];
  readonly archivedReview: boolean;
  readonly requiresAcceptance: boolean;
}

/**
 * deck 层的按页寻址包装（与 add-slide / remove-slide 同构）。
 *
 * 能力本身属于 slide——slide workspace 可脱离 deck 独立存在，把换源只挂在 deck 上，
 * 独立 slide 就换不了源。deck 这一层只负责「第 4 页是哪个工作区」。
 */
export async function replaceDeckSlideSource(
  options: DeckReplaceSourceOptions,
): Promise<DeckReplaceSourceResult> {
  const { path, manifest } = await loadDeckWorkspace(options.deckPath);
  const entry = manifest.slides.find(
    (slide) =>
      slide.removedAt === null &&
      (slide.slideId === options.page ||
        slide.workspacePath === `slides/${options.page}` ||
        slide.workspacePath === options.page),
  );
  if (entry === undefined) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      `deck 中找不到页面：${options.page}`,
      { page: options.page },
    );
  }

  const result = await replaceSlideSource({
    workspacePath: resolveDeckPath(path, entry.workspacePath),
    imagePath: options.imagePath,
    ...(options.keepReview === undefined
      ? {}
      : { keepReview: options.keepReview }),
  });

  const updatedAt = new Date().toISOString();
  await writeDeckManifest(path, {
    ...manifest,
    slides: manifest.slides.map((slide) =>
      slide.slideId === entry.slideId
        ? { ...slide, sourceImageName: basename(options.imagePath) }
        : slide,
    ),
    updatedAt,
  });

  return {
    slideId: entry.slideId,
    workspacePath: entry.workspacePath,
    invalidated: result.invalidated,
    archivedReview: result.archivedReview,
    requiresAcceptance: result.requiresAcceptance,
  };
}

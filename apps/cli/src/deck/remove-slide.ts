import { FoundationError } from "@ppt-maker/core";
import { loadDeckWorkspace, writeDeckManifest } from "./workspace.js";

export interface RemoveSlideOptions {
  readonly deckPath: string;
  readonly pageLabel: string;
}

export interface RemoveSlideResult {
  readonly slideId: string;
  readonly workspacePath: string;
  readonly removedAt: string;
}

function normalizePageLabel(pageLabel: string): string {
  return pageLabel.startsWith("slides/") ? pageLabel : `slides/${pageLabel}`;
}

export async function removeSlideFromDeck(
  options: RemoveSlideOptions,
): Promise<RemoveSlideResult> {
  const { path, manifest } = await loadDeckWorkspace(options.deckPath);
  const workspacePath = normalizePageLabel(options.pageLabel);

  const target = manifest.slides.find(
    (slide) => slide.workspacePath === workspacePath,
  );
  if (target === undefined) {
    throw new FoundationError("INVALID_INPUT", `未找到页面：${workspacePath}`, {
      workspacePath,
    });
  }
  if (target.removedAt !== null) {
    throw new FoundationError(
      "INVALID_INPUT",
      `页面已被移除：${workspacePath}`,
      { workspacePath, removedAt: target.removedAt },
    );
  }

  const removedAt = new Date().toISOString();
  await writeDeckManifest(path, {
    ...manifest,
    slides: manifest.slides.map((slide) =>
      slide.workspacePath === workspacePath ? { ...slide, removedAt } : slide,
    ),
    updatedAt: removedAt,
  });

  return {
    slideId: target.slideId,
    workspacePath,
    removedAt,
  };
}

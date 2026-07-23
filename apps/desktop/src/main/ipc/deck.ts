import { resolve } from "node:path";
import { addSlideToDeck } from "@cli/deck/add-slide.js";
import { exportDeckPptx } from "@cli/deck/export.js";
import { removeSlideFromDeck } from "@cli/deck/remove-slide.js";
import { deckStatus } from "@cli/deck/status.js";
import { createDeckWorkspace } from "@cli/deck/workspace.js";
import { type BrowserWindow, ipcMain } from "electron";
import type { DeckExportResult, DeckStatusResult } from "./channels.js";

async function buildDeckStatus(deckPath: string): Promise<DeckStatusResult> {
  const status = await deckStatus(resolve(deckPath));
  return {
    deckPath,
    name: status.name,
    deckId: status.deckId,
    slides: status.slides,
    summary: status.summary,
  };
}

export function registerDeckHandlers(_mainWindow: BrowserWindow): void {
  ipcMain.handle(
    "deck:open",
    async (_event, path: string): Promise<DeckStatusResult> => {
      return buildDeckStatus(path);
    },
  );

  ipcMain.handle(
    "deck:create",
    async (
      _event,
      imagesDir: string,
      workspacePath: string,
      name?: string,
    ): Promise<DeckStatusResult> => {
      const result = await createDeckWorkspace({
        imagesDir: resolve(imagesDir),
        workspacePath: resolve(workspacePath),
        ...(name ? { name } : {}),
      });
      return buildDeckStatus(result.path);
    },
  );

  ipcMain.handle(
    "deck:status",
    async (_event, path: string): Promise<DeckStatusResult> => {
      return buildDeckStatus(path);
    },
  );

  ipcMain.handle(
    "deck:export",
    async (
      _event,
      deckPath: string,
      outputPath: string,
      strict?: boolean,
    ): Promise<DeckExportResult> => {
      const result = await exportDeckPptx({
        deckPath: resolve(deckPath),
        outputPath,
        ...(strict === true ? { strict: true } : {}),
      });
      return {
        outputPath: result.outputPath,
        totalSlides: result.totalSlides,
        nativeSlides: result.nativeSlides,
        placeholderSlides: result.placeholderSlides,
      };
    },
  );

  ipcMain.handle(
    "deck:add-slide",
    async (
      _event,
      deckPath: string,
      imagePath: string,
    ): Promise<{ pageLabel: string; slideId: string }> => {
      const result = await addSlideToDeck({
        deckPath: resolve(deckPath),
        imagePath: resolve(imagePath),
      });
      return { pageLabel: result.pageLabel, slideId: result.slideId };
    },
  );

  ipcMain.handle(
    "deck:remove-slide",
    async (_event, deckPath: string, pageLabel: string): Promise<void> => {
      await removeSlideFromDeck({
        deckPath: resolve(deckPath),
        pageLabel,
      });
    },
  );
}

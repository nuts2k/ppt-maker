import { basename, resolve } from "node:path";
import { addSlideToDeck } from "@cli/deck/add-slide.js";
import { exportDeckPptx } from "@cli/deck/export.js";
import { removeSlideFromDeck } from "@cli/deck/remove-slide.js";
import { deckStatus } from "@cli/deck/status.js";
import {
  createDeckWorkspace,
  loadDeckWorkspace,
  resolveDeckPath,
} from "@cli/deck/workspace.js";
import { loadSlideWorkspace } from "@cli/slide/workspace.js";
import { ipcMain } from "electron";
import { type ActivityLog, buildActivityRecord } from "../activity-log.js";
import { resolveDeckId } from "../deck-context.js";
import type { DeckRunner } from "../runner/deck-runner.js";
import {
  computeStageDurations,
  deriveStageDetails,
  extractLastError,
} from "../slide-detail.js";
import type {
  ActivityResult,
  DeckExportResult,
  DeckRunStartOptions,
  DeckRunStartResult,
  DeckStatusDetailedResult,
  DeckStatusResult,
  SlideDetail,
} from "./channels.js";

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

/**
 * 在 CLI `deckStatus` 之上叠加逐页 manifest 聚合。
 *
 * 双次读盘（deckStatus 内已读一次 manifest）是刻意取舍：本地 JSON、页数量级为
 * 数十，代价可忽略，换取不改动 CLI 契约（PRD D3）。
 */
async function buildDeckStatusDetailed(
  deckPath: string,
): Promise<DeckStatusDetailedResult> {
  const abs = resolve(deckPath);
  const status = await deckStatus(abs);
  const deck = await loadDeckWorkspace(abs);

  const slides: SlideDetail[] = [];
  for (const slide of status.slides) {
    const absWorkspacePath = resolveDeckPath(deck.path, slide.workspacePath);
    const pageLabel = basename(slide.workspacePath);

    if (slide.removed) {
      slides.push({
        ...slide,
        absWorkspacePath,
        pageLabel,
        stages: [],
        lastError: null,
        stageDurations: {},
      });
      continue;
    }

    try {
      const workspace = await loadSlideWorkspace(absWorkspacePath);
      slides.push({
        ...slide,
        absWorkspacePath,
        pageLabel,
        stages: deriveStageDetails(workspace.manifest),
        lastError: extractLastError(workspace.manifest),
        stageDurations: computeStageDurations(workspace.manifest),
      });
    } catch (error) {
      // 单页 manifest 损坏不应让整个 deck 无法打开
      slides.push({
        ...slide,
        absWorkspacePath,
        pageLabel,
        stages: [],
        lastError: {
          stage: slide.currentStage,
          code: "WORKSPACE_LOAD_FAILED",
          message: error instanceof Error ? error.message : String(error),
          at: new Date().toISOString(),
        },
        stageDurations: {},
      });
    }
  }

  return {
    deckPath,
    name: status.name,
    deckId: status.deckId,
    slides,
    summary: status.summary,
  };
}

export function registerDeckHandlers(
  runner: DeckRunner,
  activityLog: ActivityLog,
): void {
  async function log(
    deckPath: string,
    kind: string,
    result: ActivityResult,
    detail: string,
    pageLabel: string | null = null,
  ): Promise<void> {
    try {
      const deckId = await resolveDeckId(deckPath);
      await activityLog.append(
        deckId,
        buildActivityRecord({
          kind,
          result,
          detail,
          slideId: null,
          pageLabel,
          stage: null,
          durationMs: null,
        }),
      );
    } catch {
      // 日志为旁路能力，失败不影响主流程
    }
  }

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
      await log(
        result.path,
        "deck-create",
        "info",
        `创建 deck：${result.path}`,
      );
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
    "deck:status-detailed",
    async (_event, path: string): Promise<DeckStatusDetailedResult> => {
      return buildDeckStatusDetailed(path);
    },
  );

  ipcMain.handle(
    "deck:run-start",
    async (
      _event,
      deckPath: string,
      opts?: DeckRunStartOptions,
    ): Promise<DeckRunStartResult> => {
      return runner.start(resolve(deckPath), opts ?? {});
    },
  );

  ipcMain.handle("deck:run-stop", async (): Promise<void> => {
    runner.stop();
  });

  ipcMain.handle(
    "deck:export",
    async (
      _event,
      deckPath: string,
      outputPath: string,
      strict?: boolean,
    ): Promise<DeckExportResult> => {
      try {
        const result = await exportDeckPptx({
          deckPath: resolve(deckPath),
          outputPath,
          ...(strict === true ? { strict: true } : {}),
        });
        await log(
          deckPath,
          "deck-export",
          "success",
          `导出 PPTX：${result.outputPath}（原生 ${result.nativeSlides} 页，占位 ${result.placeholderSlides} 页）`,
        );
        return {
          outputPath: result.outputPath,
          totalSlides: result.totalSlides,
          nativeSlides: result.nativeSlides,
          placeholderSlides: result.placeholderSlides,
        };
      } catch (error) {
        await log(
          deckPath,
          "deck-export",
          "failure",
          `导出失败：${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
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
      await log(
        deckPath,
        "deck-add-slide",
        "info",
        `添加页面：${result.pageLabel}`,
        result.pageLabel,
      );
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
      await log(
        deckPath,
        "deck-remove-slide",
        "info",
        `移除页面：${pageLabel}`,
        pageLabel,
      );
    },
  );
}

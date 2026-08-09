import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { addSlideToDeck } from "@cli/deck/add-slide.js";
import {
  loadDeckContentSpec,
  readContentSpecFile,
} from "@cli/deck/content-spec.js";
import { type ExportMode, exportDeckPptx } from "@cli/deck/export.js";
import { listSpecChangeRecords } from "@cli/deck/planning-store.js";
import { removeSlideFromDeck } from "@cli/deck/remove-slide.js";
import { runDeckSpecDraft } from "@cli/deck/spec-draft.js";
import { applySpecChange, rollbackSpecChange } from "@cli/deck/spec-edit.js";
import { deckStatus } from "@cli/deck/status.js";
import {
  createDeckWorkspace,
  createEmptyDeckWorkspace,
  loadDeckWorkspace,
  resolveDeckPath,
} from "@cli/deck/workspace.js";
import { loadSlideWorkspace } from "@cli/slide/workspace.js";
import type {
  ApplySpecChangeResult,
  ContentSpec,
  PdfExtractionReport,
  SpecChangeRecord,
} from "@ppt-maker/core";
import { PdfExtractionReportSchema } from "@ppt-maker/core";
import { ipcMain } from "electron";
import { type ActivityLog, buildActivityRecord } from "../activity-log.js";
import { resolveDeckId } from "../deck-context.js";
import type { DeckRunner } from "../runner/deck-runner.js";
import type { SourceTaskRunner } from "../runner/source-task-runner.js";
import {
  computeStageDurations,
  deriveStageDetails,
  extractLastError,
  readPendingTextReview,
} from "../slide-detail.js";
import type {
  ActivityResult,
  DeckExportResult,
  DeckRunStartOptions,
  DeckRunStartResult,
  DeckStatusDetailedResult,
  DeckStatusResult,
  SlideDetail,
  SourceTaskRequest,
  SourceTaskResult,
  SpecDraftResult,
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

  // 逐页读盘互不依赖，并发展开；结果顺序由 map 保证，与 status.slides 一致
  const slides: SlideDetail[] = await Promise.all(
    status.slides.map(async (slide): Promise<SlideDetail> => {
      const absWorkspacePath = resolveDeckPath(deck.path, slide.workspacePath);
      const pageLabel = basename(slide.workspacePath);

      if (slide.removed) {
        return {
          ...slide,
          absWorkspacePath,
          pageLabel,
          stages: [],
          lastError: null,
          stageDurations: {},
          pendingTextReview: 0,
        };
      }

      try {
        const workspace = await loadSlideWorkspace(absWorkspacePath);
        return {
          ...slide,
          absWorkspacePath,
          pageLabel,
          stages: deriveStageDetails(workspace.manifest),
          lastError: extractLastError(workspace.manifest),
          stageDurations: computeStageDurations(workspace.manifest),
          // 待办队列「需文本复核」的耐久层判据，manifest 里没有，必须读复核文档
          pendingTextReview: await readPendingTextReview(absWorkspacePath),
        };
      } catch (error) {
        // 单页 manifest 损坏不应让整个 deck 无法打开
        return {
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
          pendingTextReview: 0,
        };
      }
    }),
  );

  return {
    deckPath,
    name: status.name,
    deckId: status.deckId,
    slides,
    summary: status.summary,
  };
}

/**
 * `buildDeckStatusDetailed` 通常能给出坏页上下文；但它前置的 CLI `deckStatus` 本身也会
 * 在坏 manifest 处抛出。这里只在保存已经失败后做最小诊断，不进入正常保存路径。
 */
async function findUnreadableSlideLabels(deckPath: string): Promise<string[]> {
  const deck = await loadDeckWorkspace(resolve(deckPath));
  const labels = await Promise.all(
    deck.manifest.slides.map(async (slide): Promise<string | null> => {
      if (slide.removedAt !== null) return null;
      try {
        await loadSlideWorkspace(
          resolveDeckPath(deck.path, slide.workspacePath),
        );
        return null;
      } catch {
        return basename(slide.workspacePath);
      }
    }),
  );
  return labels.filter((label): label is string => label !== null);
}

export function registerDeckHandlers(
  runner: DeckRunner,
  sourceTasks: SourceTaskRunner,
  activityLog: ActivityLog,
): void {
  function assertSpecEditingAvailable(): void {
    if (runner.isRunning()) {
      throw new Error("流水线正在执行，请停止后再修改规格");
    }
    if (sourceTasks.isRunning()) {
      throw new Error("建页任务正在执行，请等它结束后再修改规格");
    }
  }

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
    "deck:create-empty",
    async (
      _event,
      parentDir: string,
      name: string,
    ): Promise<DeckStatusResult> => {
      if (runner.isRunning() || sourceTasks.isRunning()) {
        throw new Error("执行任务正在进行，结束后才能新建空 Deck");
      }
      const normalizedName = name.trim();
      if (
        normalizedName === "" ||
        normalizedName === "." ||
        normalizedName === ".." ||
        basename(normalizedName) !== normalizedName
      ) {
        throw new Error("Deck 名称不能为空，也不能包含路径分隔符");
      }
      const result = await createEmptyDeckWorkspace({
        workspacePath: join(resolve(parentDir), normalizedName),
        name: normalizedName,
      });
      await log(
        result.path,
        "deck-create-empty",
        "info",
        `创建空 deck：${result.path}`,
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
      mode?: ExportMode,
    ): Promise<DeckExportResult> => {
      if (sourceTasks.isRunning()) {
        throw new Error("建页任务正在执行，请等它结束后再导出");
      }
      try {
        const result = await exportDeckPptx({
          deckPath: resolve(deckPath),
          outputPath,
          ...(strict === true ? { strict: true } : {}),
          ...(mode !== undefined ? { mode } : {}),
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
    "deck:source-task-start",
    async (
      _event,
      deckPath: string,
      request: SourceTaskRequest,
    ): Promise<SourceTaskResult> => {
      // 活动日志由 SourceTaskRunner 自己写（它才知道最终落点与报告路径）
      return sourceTasks.start(resolve(deckPath), request);
    },
  );

  /**
   * 规格初稿：一次调用、无对话。
   *
   * 构思文本从 renderer 来的是一段字符串，而 CLI `runDeckSpecDraft` 收的是文件路径。
   * 在这里落成临时文件而不是给 CLI 加一个「也可以传字符串」的重载——那会让同一件事
   * 有两个入口，而临时文件本来就是 main 该管的边界事务。
   *
   * 初稿输出同样落在临时目录，**不进 deck**：用户还没决定要不要出图，
   * 此时覆盖既有 deck 的 `content-spec.json` 等于替他做了决定。
   */
  ipcMain.handle(
    "deck:spec-draft",
    async (_event, text: string): Promise<SpecDraftResult> => {
      const dir = await mkdtemp(join(tmpdir(), "ppt-maker-spec-"));
      const fromPath = join(dir, "brief.txt");
      await writeFile(fromPath, text, "utf8");
      const result = await runDeckSpecDraft({
        fromPath,
        outputPath: join(dir, `content-spec-${randomUUID().slice(0, 8)}.json`),
        // 付费门槛在界面侧（按钮明示「将调用模型生成初稿」），到这一步已确认
        confirmApi: true,
      });
      return { specPath: result.outputPath, spec: result.spec };
    },
  );

  /**
   * 读一份外部内容规格文件，供付费确认框给出条目数（U13）。
   *
   * 复用 CLI 的 `readContentSpecFile`（内含 `ContentSpecSchema` 校验），不在 main
   * 侧另写一遍读取与校验——同一个文件两处各读一份，迟早对同一份坏文件给出两种说法。
   */
  ipcMain.handle(
    "deck:read-content-spec",
    async (_event, specPath: string): Promise<ContentSpec> => {
      return readContentSpecFile(resolve(specPath));
    },
  );

  ipcMain.handle(
    "deck:read-deck-spec",
    async (_event, deckPath: string): Promise<ContentSpec | null> => {
      return loadDeckContentSpec(resolve(deckPath));
    },
  );

  ipcMain.handle(
    "deck:apply-spec-change",
    async (
      _event,
      deckPath: string,
      nextSpec: ContentSpec,
      summary: string,
    ): Promise<ApplySpecChangeResult> => {
      assertSpecEditingAvailable();
      const normalizedSummary = summary.trim();
      if (normalizedSummary === "") {
        throw new Error("规格变更摘要不能为空");
      }
      try {
        return await applySpecChange({
          deckPath: resolve(deckPath),
          nextSpec,
          origin: "manual",
          summary: normalizedSummary,
        });
      } catch (error) {
        let broken: string[] = [];
        try {
          const detailed = await buildDeckStatusDetailed(deckPath);
          broken = detailed.slides
            .filter(
              (slide) => slide.lastError?.code === "WORKSPACE_LOAD_FAILED",
            )
            .map((slide) => slide.pageLabel);
        } catch {
          try {
            broken = await findUnreadableSlideLabels(deckPath);
          } catch {
            // 诊断失败时保留最初的领域错误，不用次级错误遮住根因
          }
        }
        if (broken.length > 0) {
          throw new Error(
            `保存失败：${broken.join("、")} 的页面数据损坏，修好后才能改规格`,
          );
        }
        throw error;
      }
    },
  );

  ipcMain.handle(
    "deck:list-spec-history",
    async (_event, deckPath: string): Promise<SpecChangeRecord[]> => {
      return listSpecChangeRecords(resolve(deckPath));
    },
  );

  ipcMain.handle(
    "deck:rollback-spec-change",
    async (
      _event,
      deckPath: string,
      recordId: string,
    ): Promise<ApplySpecChangeResult> => {
      assertSpecEditingAvailable();
      return rollbackSpecChange({ deckPath: resolve(deckPath), recordId });
    },
  );

  /**
   * 读回一份已落盘的抽取报告。
   *
   * 过 schema 而不是裸 `JSON.parse as T`：这份文件在磁盘上，用户可以改、可以是
   * 上一个版本写的。不校验就等于让一个坏文件在渲染时才炸，而且炸在离原因很远的地方。
   */
  ipcMain.handle(
    "deck:read-extraction-report",
    async (_event, reportPath: string): Promise<PdfExtractionReport> => {
      const raw = await readFile(resolve(reportPath), "utf8");
      return PdfExtractionReportSchema.parse(JSON.parse(raw));
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

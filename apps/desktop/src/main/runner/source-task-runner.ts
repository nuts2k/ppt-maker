import { basename } from "node:path";
import { addSlideToDeck } from "@cli/deck/add-slide.js";
import { runDeckGenerate } from "@cli/deck/generate.js";
import { runDeckRegenerate } from "@cli/deck/regenerate.js";
import { runDeckRegenerateBatch } from "@cli/deck/regenerate-batch.js";
import {
  extractionFailureDetails,
  extractPdfToDeck,
} from "@cli/pdf/extract.js";
import type { OpenAiImageGenerator } from "@cli/providers/openai-image.js";
import type { BrowserWindow } from "electron";
import { type ActivityLog, buildActivityRecord } from "../activity-log.js";
import { resolveDeckId } from "../deck-context.js";
import type {
  SourceTaskKind,
  SourceTaskProgress,
  SourceTaskRequest,
  SourceTaskResult,
} from "../ipc/channels.js";

export interface SourceTaskRunnerOptions {
  /** 测试注入；生产环境省略时使用真实 OpenAI 生成器。 */
  readonly regenerateBatchGenerate?: OpenAiImageGenerator;
}

/**
 * 建页任务执行器 —— 把新页面加进 deck 的长任务的唯一入口。
 *
 * 与 `DeckRunner` 的关系是**双向互斥**（design §4.2）：两者都写 deck manifest 与
 * slide manifest，并发写必然损坏数据。规则：
 *
 * - 本执行器启动前检查 `isPipelineRunning()`，为真则**拒绝并说明原因**——不静默
 *   失败，否则用户点了没反应，而磁盘上什么都没发生（见静默失败诊断指南）。
 * - 自身是**串行单例**：同时只允许一个建页任务。
 * - 反向的一半在 `DeckRunner.start()`：建页任务在跑时它同样拒绝。界面侧的禁用只是
 *   提示，真正的防线在这两处。
 *
 * 进度归一在这里做：三种 CLI 命令的 `onProgress` 形状各不相同，renderer 只认
 * `SourceTaskProgress` 一种形状。
 */
export class SourceTaskRunner {
  private readonly getWindow: () => BrowserWindow | null;
  private readonly activityLog: ActivityLog;
  /** 流水线是否在跑。注入而非持有 DeckRunner：两者互相引用会绕成一个环 */
  private readonly isPipelineRunning: () => boolean;
  private readonly options: SourceTaskRunnerOptions;

  private running = false;
  private taskSeq = 0;

  constructor(
    getWindow: () => BrowserWindow | null,
    activityLog: ActivityLog,
    isPipelineRunning: () => boolean,
    options: SourceTaskRunnerOptions = {},
  ) {
    this.getWindow = getWindow;
    this.activityLog = activityLog;
    this.isPipelineRunning = isPipelineRunning;
    this.options = options;
  }

  isRunning(): boolean {
    return this.running;
  }

  async start(
    deckPath: string,
    request: SourceTaskRequest,
  ): Promise<SourceTaskResult> {
    if (this.isPipelineRunning()) {
      return reject(
        "流水线正在执行，请先停止后再新建页面（两者会同时写 deck）",
      );
    }
    if (this.running) {
      return reject("已有建页任务正在执行，请等它结束");
    }

    this.running = true;
    this.taskSeq += 1;
    const taskId = `source-task-${this.taskSeq}`;
    const emit = (
      phase: SourceTaskProgress["phase"],
      message: string,
      index = 0,
      total = 0,
    ): void => {
      this.emit({ taskId, kind: request.kind, index, total, phase, message });
    };

    emit("start", describeStart(request));
    try {
      const result = await this.execute(deckPath, request, emit);
      emit("done", result.message);
      await this.record(result.deckPath ?? deckPath, request.kind, result);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emit("failed", message);
      // 抽取一页都没建成时报告仍然落了盘（追加路径），带上路径活动日志那行才有
      // 「查看报告」可点——否则磁盘上那份逐页写着原因的报告在界面里完全不可达。
      await this.recordFailure(
        deckPath,
        request.kind,
        message,
        extractionFailureDetails(error)?.reportPath ?? null,
      );
      // 抛出而不是包成 `accepted: false`：`accepted: false` 的语义是「被互斥挡下」，
      // 真失败要让界面看见原因，两者混在一起就分不出「没跑」和「跑砸了」。
      throw error;
    } finally {
      this.running = false;
    }
  }

  private async execute(
    deckPath: string,
    request: SourceTaskRequest,
    emit: (
      phase: SourceTaskProgress["phase"],
      message: string,
      index?: number,
      total?: number,
    ) => void,
  ): Promise<SourceTaskResult> {
    switch (request.kind) {
      case "import": {
        const total = request.imagePaths.length;
        let created = 0;
        for (const [index, imagePath] of request.imagePaths.entries()) {
          const added = await addSlideToDeck({ deckPath, imagePath });
          created += 1;
          emit(
            "item",
            `${basename(imagePath)} → ${added.pageLabel}`,
            index + 1,
            total,
          );
        }
        return {
          ...EMPTY_RESULT,
          accepted: true,
          message: `已追加 ${created} 页`,
          deckPath,
          created,
        };
      }

      case "extract": {
        let seen = 0;
        const result = await extractPdfToDeck({
          pdfPath: request.pdfPath,
          deckPath,
          // 页码范围原样下传：解析器在 CLI 侧，桌面端写第二份就是同一个语法两套实现
          ...(request.pages === undefined ? {} : { pages: request.pages }),
          ...(request.deckName === undefined
            ? {}
            : { deckName: request.deckName }),
          onProgress: (message) => {
            seen += 1;
            emit("item", message, seen, 0);
          },
        });
        return {
          ...EMPTY_RESULT,
          accepted: true,
          message: `建立 ${result.report.created.length} 页，跳过 ${result.report.skipped.length} 页`,
          deckPath: result.deckPath,
          deckCreated: result.deckCreated,
          created: result.report.created.length,
          skipped: result.report.skipped.length,
          report: result.report,
          reportPath: result.reportPath,
        };
      }

      case "generate": {
        const result = await runDeckGenerate({
          deckPath,
          // 不传 specPath 即让 CLI 读 deck 内的权威规格（策划工作台「按规格建页」）。
          // 传 `specPath: undefined` 与省略在 TS 上等价，但这里显式条件展开，
          // 与同文件其它可选参数的写法保持一致，读起来就是「没有就不传」。
          ...(request.specPath === undefined
            ? {}
            : { specPath: request.specPath }),
          // 条目子集原样下传：勾了哪几条就建哪几条，桌面端不在这里替 CLI 做筛选
          ...(request.entryIds === undefined
            ? {}
            : { entryIds: request.entryIds }),
          ...(request.deckName === undefined ? {} : { name: request.deckName }),
          // 付费门槛在界面侧（原生确认框），到这一步用户已经明确同意
          confirmUpload: true,
          onProgress: (event) => {
            emit(
              "item",
              event.phase === "failed"
                ? `${event.specEntryId} 生成失败：${event.message ?? ""}`
                : event.phase === "done"
                  ? `${event.specEntryId} → ${event.pageLabel ?? ""}`
                  : `正在生成 ${event.specEntryId}`,
              event.index,
              event.total,
            );
          },
        });
        return {
          ...EMPTY_RESULT,
          accepted: true,
          message: `建立 ${result.created.length} 页，失败 ${result.failed.length} 页，跳过 ${result.skipped.length} 页`,
          deckPath: result.deckPath,
          created: result.created.length,
          failed: result.failed.length,
          skipped: result.skipped.length,
        };
      }

      case "regenerate": {
        const result = await runDeckRegenerate({
          deckPath,
          page: request.page,
          ...(request.note === undefined ? {} : { note: request.note }),
          confirmUpload: true,
        });
        return {
          ...EMPTY_RESULT,
          accepted: true,
          message: `已重新生成 ${result.pageLabel}`,
          deckPath,
          created: 1,
          regenerated: {
            slideId: result.slideId,
            pageLabel: result.pageLabel,
            specEntryId: result.specEntryId,
            revisionNotes: result.revisionNotes,
            requiresAcceptance: result.requiresAcceptance,
          },
        };
      }

      case "regenerate-batch": {
        const result = await runDeckRegenerateBatch({
          deckPath,
          selection: { kind: "labels", labels: request.pageLabels },
          ...(request.note === undefined ? {} : { note: request.note }),
          confirmUpload: true,
          ...(this.options.regenerateBatchGenerate === undefined
            ? {}
            : { generate: this.options.regenerateBatchGenerate }),
          onProgress: (event) => {
            emit(
              "item",
              event.phase === "failed"
                ? `${event.pageLabel} 生成失败：${event.message ?? ""}`
                : event.phase === "done"
                  ? `${event.pageLabel} 已重新生成`
                  : `正在重新生成 ${event.pageLabel}`,
              event.index,
              event.total,
            );
          },
        });
        return {
          ...EMPTY_RESULT,
          accepted: true,
          message: `重新生成 ${result.regenerated.length} 页，失败 ${result.failed.length} 页，跳过 ${result.skipped.length} 页`,
          deckPath,
          created: result.regenerated.length,
          failed: result.failed.length,
          skipped: result.skipped.length,
        };
      }
    }
  }

  private emit(event: SourceTaskProgress): void {
    const window = this.getWindow();
    if (window === null || window.isDestroyed()) return;
    window.webContents.send("deck:source-task-progress", event);
  }

  private async record(
    deckPath: string,
    kind: SourceTaskKind,
    result: SourceTaskResult,
  ): Promise<void> {
    await this.append(deckPath, {
      kind: ACTIVITY_KINDS[kind],
      result: result.failed > 0 ? "failure" : "success",
      detail: result.message,
      // 抽取报告的路径进日志，用户关掉完成面板后仍能找回同一份（E4）
      ...(result.reportPath === null ? {} : { reportPath: result.reportPath }),
    });
  }

  private async recordFailure(
    deckPath: string,
    kind: SourceTaskKind,
    message: string,
    reportPath: string | null,
  ): Promise<void> {
    await this.append(deckPath, {
      kind: ACTIVITY_KINDS[kind],
      result: "failure",
      detail: message,
      ...(reportPath === null ? {} : { reportPath }),
    });
  }

  private async append(
    deckPath: string,
    entry: {
      kind: string;
      result: "success" | "failure";
      detail: string;
      reportPath?: string;
    },
  ): Promise<void> {
    try {
      const deckId = await resolveDeckId(deckPath);
      await this.activityLog.append(
        deckId,
        buildActivityRecord({
          kind: entry.kind,
          result: entry.result,
          detail: entry.detail,
          slideId: null,
          pageLabel: null,
          stage: null,
          durationMs: null,
          ...(entry.reportPath === undefined
            ? {}
            : { reportPath: entry.reportPath }),
        }),
      );
    } catch {
      // 日志为旁路能力，失败不影响主流程
    }
  }
}

const ACTIVITY_KINDS: Readonly<Record<SourceTaskKind, string>> = {
  import: "deck-add-slide",
  extract: "deck-extract",
  generate: "deck-generate",
  regenerate: "deck-regenerate",
  "regenerate-batch": "deck-regenerate-batch",
};

const EMPTY_RESULT = {
  accepted: false,
  message: "",
  deckPath: null,
  deckCreated: false,
  created: 0,
  failed: 0,
  skipped: 0,
  report: null,
  reportPath: null,
  regenerated: null,
} as const satisfies SourceTaskResult;

function reject(message: string): SourceTaskResult {
  return { ...EMPTY_RESULT, message };
}

function describeStart(request: SourceTaskRequest): string {
  switch (request.kind) {
    case "import":
      return `准备追加 ${request.imagePaths.length} 张图片`;
    case "extract":
      return `开始抽取 ${basename(request.pdfPath)}${
        request.pages === undefined ? "" : `（第 ${request.pages} 页）`
      }`;
    case "generate":
      return "开始按内容规格生成页面";
    case "regenerate":
      return `开始重新生成 ${request.page}`;
    case "regenerate-batch":
      return `准备重新生成 ${request.pageLabels.length} 页`;
  }
}

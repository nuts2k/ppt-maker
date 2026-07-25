import { basename } from "node:path";
import { loadDeckWorkspace, resolveDeckPath } from "@cli/deck/workspace.js";
import { runSlideRunFrom } from "@cli/slide/run-from.js";
import { loadSlideWorkspace } from "@cli/slide/workspace.js";
import type { BrowserWindow } from "electron";
import { type RunStage, stageLabel } from "../../shared/stages.js";
import { type ActivityLog, buildActivityRecord } from "../activity-log.js";
import type {
  DeckRunEvent,
  DeckRunStartOptions,
  DeckRunStartResult,
  DeckRunSummary,
} from "../ipc/channels.js";
import { computeResumeStage } from "../slide-detail.js";

interface QueueItem {
  readonly slideId: string;
  readonly pageLabel: string;
  readonly absWorkspacePath: string;
  /** 显式指定的起始阶段；null 表示执行时按 manifest 断点计算 */
  readonly from: RunStage | null;
}

type RunnerStatus = "idle" | "running" | "stopping";

/**
 * 应用内唯一的 pipeline 执行入口。
 *
 * 批量与单页共用同一条串行队列，杜绝并发写同一 deck 工作区。
 * 停止语义为协作式：`stop()` 后当前页跑完即止，不强杀底层阶段
 * （`runSlideRunFrom` 无中断能力，强杀会留下 running 态的脏 manifest）。
 */
export class DeckRunner {
  /** 惰性取窗口：macOS 下窗口可被关闭后重建，不能持有固定引用 */
  private readonly getWindow: () => BrowserWindow | null;
  private readonly activityLog: ActivityLog;

  private status: RunnerStatus = "idle";
  private queue: QueueItem[] = [];
  private deckPath: string | null = null;
  private deckId: string | null = null;
  private confirmApi = false;
  private confirmUpload = false;
  private summary: DeckRunSummary = {
    total: 0,
    completed: 0,
    gated: 0,
    failed: 0,
  };
  private processedCount = 0;

  constructor(getWindow: () => BrowserWindow | null, activityLog: ActivityLog) {
    this.getWindow = getWindow;
    this.activityLog = activityLog;
  }

  isRunning(): boolean {
    return this.status !== "idle";
  }

  async start(
    deckPath: string,
    options: DeckRunStartOptions = {},
  ): Promise<DeckRunStartResult> {
    const deck = await loadDeckWorkspace(deckPath);

    if (this.status !== "idle" && this.deckPath !== deck.path) {
      return {
        accepted: false,
        queued: 0,
        message: "已有其他 deck 正在执行，请先停止",
      };
    }

    const requested =
      options.slideIds === undefined ? null : new Set(options.slideIds);
    const items: QueueItem[] = [];

    for (const entry of deck.manifest.slides) {
      if (entry.removedAt !== null) continue;
      if (requested !== null && !requested.has(entry.slideId)) continue;
      if (this.queue.some((queued) => queued.slideId === entry.slideId)) {
        continue;
      }

      const absWorkspacePath = resolveDeckPath(deck.path, entry.workspacePath);
      let from: RunStage | null = options.from ?? null;

      if (from === null) {
        const workspace = await loadSlideWorkspace(absWorkspacePath);
        const resume = computeResumeStage(workspace.manifest);
        // 批量模式跳过已全部完成的页；显式点名的单页允许重跑收尾阶段
        if (resume === null) {
          if (requested === null) continue;
          from = "report";
        } else {
          from = resume;
        }
      }

      items.push({
        slideId: entry.slideId,
        pageLabel: basename(entry.workspacePath),
        absWorkspacePath,
        from,
      });
    }

    if (items.length === 0) {
      return {
        accepted: false,
        queued: 0,
        message:
          this.status === "idle"
            ? "没有需要执行的页面"
            : "目标页面已在执行队列中",
      };
    }

    this.queue.push(...items);
    this.confirmApi = options.confirmApi === true || this.confirmApi;
    this.confirmUpload = options.confirmUpload === true || this.confirmUpload;

    if (this.status === "idle") {
      this.deckPath = deck.path;
      this.deckId = deck.manifest.deckId;
      this.status = "running";
      this.processedCount = 0;
      this.summary = {
        total: items.length,
        completed: 0,
        gated: 0,
        failed: 0,
      };
      this.emit({
        kind: "run-start",
        total: items.length,
        slideIds: items.map((item) => item.slideId),
      });
      this.record("run-start", "info", `开始执行 ${items.length} 页`, {});
      // 后台串行消费队列；调用方通过 deck:run-progress 事件观察进度，不阻塞 IPC 返回
      void this.drain();
    } else {
      this.summary = {
        ...this.summary,
        total: this.summary.total + items.length,
      };
    }

    return {
      accepted: true,
      queued: items.length,
      message: `已排队 ${items.length} 页`,
    };
  }

  /** 协作式停止：当前页执行完即停，剩余队列丢弃 */
  stop(): void {
    if (this.status !== "running") return;
    this.status = "stopping";
    this.queue = [];
    this.emit({ kind: "run-stopping" });
    this.record("run-stop", "info", "已请求停止，当前页完成后结束", {});
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      if (this.status === "stopping") break;
      const item = this.queue.shift();
      if (item === undefined) break;
      this.processedCount += 1;
      await this.runItem(item, this.processedCount);
    }

    const summary = this.summary;
    this.status = "idle";
    this.queue = [];
    this.confirmApi = false;
    this.confirmUpload = false;
    this.emit({ kind: "run-done", summary });
    this.record(
      "run-done",
      summary.failed > 0 ? "failure" : "info",
      `执行结束：完成 ${summary.completed}，待人工 ${summary.gated}，失败 ${summary.failed}`,
      {},
    );
  }

  private async runItem(item: QueueItem, index: number): Promise<void> {
    this.emit({
      kind: "page-start",
      slideId: item.slideId,
      pageLabel: item.pageLabel,
      index,
      total: this.summary.total,
    });
    this.record("page-start", "info", `开始处理 ${item.pageLabel}`, {
      slideId: item.slideId,
      pageLabel: item.pageLabel,
    });

    const stageStartedAt = new Map<string, number>();

    try {
      const result = await runSlideRunFrom(item.from ?? "ocr", {
        workspacePath: item.absWorkspacePath,
        ...(this.confirmApi ? { confirmApi: true } : {}),
        ...(this.confirmUpload ? { confirmUpload: true } : {}),
        onStageStart: (stage) => {
          stageStartedAt.set(stage, Date.now());
          this.emit({
            kind: "stage-start",
            slideId: item.slideId,
            stage: stage as RunStage,
            at: new Date().toISOString(),
          });
        },
        onStageComplete: (stage) => {
          const startedAt = stageStartedAt.get(stage);
          const durationMs =
            startedAt === undefined ? 0 : Math.max(0, Date.now() - startedAt);
          this.emit({
            kind: "stage-complete",
            slideId: item.slideId,
            stage: stage as RunStage,
            at: new Date().toISOString(),
            durationMs,
          });
          this.record(
            "stage-complete",
            "success",
            `${item.pageLabel} · ${stageLabel(stage)} 完成`,
            {
              slideId: item.slideId,
              pageLabel: item.pageLabel,
              stage,
              durationMs,
            },
          );
        },
      });

      const failed = result.gate === "error";
      const gated = !failed && result.gate !== null;

      if (failed) {
        this.summary = { ...this.summary, failed: this.summary.failed + 1 };
      } else if (gated) {
        this.summary = { ...this.summary, gated: this.summary.gated + 1 };
      } else {
        this.summary = {
          ...this.summary,
          completed: this.summary.completed + 1,
        };
      }

      this.emit({
        kind: "page-done",
        slideId: item.slideId,
        gate: result.gate,
        stoppedAt: result.stoppedAt,
        message: result.message,
        error: failed
          ? { code: "PIPELINE_STAGE_FAILED", message: result.message }
          : null,
      });
      this.record(
        "page-done",
        failed ? "failure" : gated ? "gate" : "success",
        `${item.pageLabel} · ${result.message}`,
        {
          slideId: item.slideId,
          pageLabel: item.pageLabel,
          stage: result.stoppedAt,
        },
      );
    } catch (error) {
      // runSlideRunFrom 已把阶段内异常转成 gate: "error"，走到这里说明是
      // 工作区加载等前置失败，同样按单页失败处理，不中断整个队列。
      const message = error instanceof Error ? error.message : String(error);
      this.summary = { ...this.summary, failed: this.summary.failed + 1 };
      this.emit({
        kind: "page-done",
        slideId: item.slideId,
        gate: "error",
        stoppedAt: item.from,
        message,
        error: { code: "PIPELINE_RUN_FAILED", message },
      });
      this.record("page-done", "failure", `${item.pageLabel} · ${message}`, {
        slideId: item.slideId,
        pageLabel: item.pageLabel,
        stage: item.from,
      });
    }
  }

  private emit(event: DeckRunEvent): void {
    const window = this.getWindow();
    if (window === null || window.isDestroyed()) return;
    window.webContents.send("deck:run-progress", event);
  }

  private record(
    kind: string,
    result: "info" | "success" | "failure" | "gate",
    detail: string,
    extra: {
      slideId?: string;
      pageLabel?: string;
      stage?: string | null;
      durationMs?: number;
    },
  ): void {
    if (this.deckId === null) return;
    void this.activityLog.append(
      this.deckId,
      buildActivityRecord({
        kind,
        result,
        detail,
        slideId: extra.slideId ?? null,
        pageLabel: extra.pageLabel ?? null,
        stage: extra.stage ?? null,
        durationMs: extra.durationMs ?? null,
      }),
    );
  }
}

import { basename } from "node:path";
import { runSlideRunFrom } from "../slide/run-from.js";
import { loadDeckWorkspace, resolveDeckPath } from "./workspace.js";

export interface RunDeckOptions {
  readonly deckPath: string;
  readonly confirmApi?: boolean;
  readonly confirmUpload?: boolean;
}

export interface SlideRunResult {
  readonly slideId: string;
  readonly workspacePath: string;
  readonly sourceImageName: string;
  readonly executed: string[];
  readonly stoppedAt: string | null;
  readonly gate: string | null;
  readonly message: string;
  readonly error: string | null;
}

export interface RunDeckResult {
  readonly results: SlideRunResult[];
  readonly summary: {
    readonly total: number;
    readonly completed: number;
    readonly stopped: number;
    readonly failed: number;
  };
}

export async function runDeckPipeline(
  options: RunDeckOptions,
): Promise<RunDeckResult> {
  const deck = await loadDeckWorkspace(options.deckPath);
  const activeSlides = deck.manifest.slides.filter(
    (slide) => slide.removedAt === null,
  );

  const results: SlideRunResult[] = [];
  for (const slide of activeSlides) {
    const workspacePath = resolveDeckPath(deck.path, slide.workspacePath);
    try {
      const outcome = await runSlideRunFrom("ocr", {
        workspacePath,
        ...(options.confirmApi === undefined
          ? {}
          : { confirmApi: options.confirmApi }),
        ...(options.confirmUpload === undefined
          ? {}
          : { confirmUpload: options.confirmUpload }),
      });
      results.push({
        slideId: slide.slideId,
        workspacePath,
        sourceImageName: slide.sourceImageName,
        executed: outcome.executed,
        stoppedAt: outcome.stoppedAt,
        gate: outcome.gate,
        message: outcome.message,
        error: outcome.gate === "error" ? outcome.message : null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({
        slideId: slide.slideId,
        workspacePath,
        sourceImageName: slide.sourceImageName,
        executed: [],
        stoppedAt: null,
        gate: "error",
        message,
        error: message,
      });
    }
  }

  const completed = results.filter((result) => result.gate === null).length;
  const failed = results.filter((result) => result.error !== null).length;
  const stopped = results.filter(
    (result) => result.gate !== null && result.error === null,
  ).length;

  return {
    results,
    summary: {
      total: results.length,
      completed,
      stopped,
      failed,
    },
  };
}

export function formatDeckRunResult(result: RunDeckResult): string {
  const lines = result.results.map((slide) => {
    const pageName = basename(slide.workspacePath);
    const stagesText =
      slide.executed.length > 0 ? slide.executed.join(" → ") : "（未执行）";
    let suffix: string;
    if (slide.error !== null) {
      suffix = ` — 失败：${slide.error}`;
    } else if (slide.gate !== null) {
      suffix = ` — 停在 ${slide.stoppedAt} (${slide.gate})`;
    } else {
      suffix = " — 完成";
    }
    return `${pageName} (${slide.slideId}): ${stagesText}${suffix}`;
  });

  lines.push(
    `汇总：${result.summary.total} 页，完成 ${result.summary.completed}，停止 ${result.summary.stopped}，失败 ${result.summary.failed}`,
  );

  return lines.join("\n");
}

import { basename } from "node:path";
import {
  SLIDE_STAGE_ORDER,
  type SlideStage,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import { loadSlideWorkspace } from "../slide/workspace.js";
import { loadDeckWorkspace, resolveDeckPath } from "./workspace.js";

const FAILURE_STATUSES = new Set<string>(["failed", "interrupted", "stale"]);
const ACCEPT_PPTX_INDEX = SLIDE_STAGE_ORDER.indexOf("accept-pptx");

export interface DeckSlideStatus {
  readonly slideId: string;
  readonly workspacePath: string;
  readonly sourceImageName: string;
  readonly currentStage: string;
  readonly stageStatus: string;
  readonly removed: boolean;
}

export interface DeckStatusResult {
  readonly name: string;
  readonly deckId: string;
  readonly slides: DeckSlideStatus[];
  readonly summary: {
    readonly total: number;
    readonly active: number;
    readonly removed: number;
    readonly completed: number;
    readonly inProgress: number;
    readonly notStarted: number;
  };
}

function computeProgress(stages: readonly WorkspaceStageState[]): {
  currentStage: SlideStage;
  stageStatus: string;
  acceptPptxCompleted: boolean;
} {
  const byStage = new Map(stages.map((state) => [state.stage, state]));
  let currentStage: SlideStage = "init";
  for (const stage of SLIDE_STAGE_ORDER) {
    if (byStage.get(stage)?.status === "completed") {
      currentStage = stage;
    }
  }

  const currentIndex = SLIDE_STAGE_ORDER.indexOf(currentStage);
  const nextStage = SLIDE_STAGE_ORDER[currentIndex + 1];
  const nextStatus =
    nextStage === undefined ? undefined : byStage.get(nextStage)?.status;
  const stageStatus =
    nextStatus !== undefined && FAILURE_STATUSES.has(nextStatus)
      ? nextStatus
      : (byStage.get(currentStage)?.status ?? "completed");

  return {
    currentStage,
    stageStatus,
    acceptPptxCompleted: byStage.get("accept-pptx")?.status === "completed",
  };
}

export async function deckStatus(deckPath: string): Promise<DeckStatusResult> {
  const deck = await loadDeckWorkspace(deckPath);

  const slides: DeckSlideStatus[] = [];
  let completed = 0;
  let notStarted = 0;
  let inProgress = 0;
  let removed = 0;

  for (const entry of deck.manifest.slides) {
    if (entry.removedAt !== null) {
      removed += 1;
      slides.push({
        slideId: entry.slideId,
        workspacePath: entry.workspacePath,
        sourceImageName: entry.sourceImageName,
        currentStage: "init",
        stageStatus: "removed",
        removed: true,
      });
      continue;
    }

    const workspace = await loadSlideWorkspace(
      resolveDeckPath(deck.path, entry.workspacePath),
    );
    const progress = computeProgress(workspace.manifest.stages);
    slides.push({
      slideId: entry.slideId,
      workspacePath: entry.workspacePath,
      sourceImageName: entry.sourceImageName,
      currentStage: progress.currentStage,
      stageStatus: progress.stageStatus,
      removed: false,
    });

    if (progress.acceptPptxCompleted) {
      completed += 1;
    } else if (progress.currentStage === "init") {
      notStarted += 1;
    } else {
      inProgress += 1;
    }
  }

  const total = deck.manifest.slides.length;
  const active = total - removed;

  return {
    name: deck.manifest.name,
    deckId: deck.manifest.deckId,
    slides,
    summary: {
      total,
      active,
      removed,
      completed,
      inProgress,
      notStarted,
    },
  };
}

export function formatDeckStatus(result: DeckStatusResult): string {
  const header =
    result.summary.removed > 0
      ? `${result.name} (${result.summary.total} 页，${result.summary.removed} 已移除)`
      : `${result.name} (${result.summary.total} 页)`;

  const lines = [header];
  lines.push(`  完成: ${result.summary.completed}/${result.summary.active}`);

  const inProgress: string[] = [];
  const failed: string[] = [];
  for (const slide of result.slides) {
    if (slide.removed) {
      continue;
    }
    const label = `${basename(slide.workspacePath)} (${slide.currentStage})`;
    const currentIndex = SLIDE_STAGE_ORDER.indexOf(
      slide.currentStage as SlideStage,
    );
    if (currentIndex >= ACCEPT_PPTX_INDEX) {
      continue;
    }
    if (FAILURE_STATUSES.has(slide.stageStatus)) {
      failed.push(label);
    } else if (slide.currentStage !== "init") {
      inProgress.push(label);
    }
  }

  if (inProgress.length > 0) {
    lines.push(`  进行中: ${inProgress.join(", ")}`);
  }
  if (failed.length > 0) {
    lines.push(`  失败: ${failed.join(", ")}`);
  }

  return lines.join("\n");
}

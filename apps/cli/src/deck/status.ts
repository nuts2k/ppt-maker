import { basename } from "node:path";
import {
  findBlockingStage,
  SLIDE_STAGE_ORDER,
  type SlideStage,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import { loadSlideWorkspace } from "../slide/workspace.js";
import { loadDeckWorkspace, resolveDeckPath } from "./workspace.js";

const ACCEPT_PPTX_INDEX = SLIDE_STAGE_ORDER.indexOf("accept-pptx");
const SOURCE_GATE_INDEX = SLIDE_STAGE_ORDER.indexOf("accept-source");

/**
 * 这一页动没动过。
 *
 * 判据取「源图确认闸门之后有没有阶段真的产出过」，两个更省事的写法都不成立：
 *
 * - `currentStage !== "init"`：`imported` / `extracted` 的 `accept-source` 在建立
 *   工作区时就自动放行，最后一个已完成阶段随即是 `accept-source`，于是一个刚建好、
 *   一步没跑的 deck 会把每页都报成「进行中」，`未开始` 计数恒为 0。
 * - 按 `currentStage` 的位置比较：换源会让闸门之后的阶段全部转 `stale`，最后一个
 *   已完成阶段退回 `accept-source`，一个跑过 OCR 的页就被报成「未开始」。
 *
 * 取「状态不是 `pending`」而不是「有成功 attempt」：正在跑第一轮 OCR 的页
 * （`running`，还没有成功记录）显然动过了。而 `pending` 之外的每一种状态都蕴含
 * 「跑过一次」——`invalidateStageAndDownstream` 跳过 `pending`，`failed` /
 * `interrupted` 都以一次 attempt 为前提。**失效不等于没跑过**，这正是「当前无可用
 * 产出」与「从没动过」的分界；前者归入「进行中」，并由 `blockingStage` 在失败列表
 * 里单独指名。
 */
function computeStarted(stages: readonly WorkspaceStageState[]): boolean {
  return stages.some(
    (state) =>
      SLIDE_STAGE_ORDER.indexOf(state.stage) > SOURCE_GATE_INDEX &&
      state.status !== "pending",
  );
}

export interface DeckSlideStatus {
  readonly slideId: string;
  readonly workspacePath: string;
  readonly sourceImageName: string;
  /** 进度：最后一个已完成的阶段。用于「未开始 / 进行中」这类进度判断 */
  readonly currentStage: string;
  /** 故障：`blockingStage` 的状态；无阻塞阶段时为 `currentStage` 的状态 */
  readonly stageStatus: string;
  /**
   * 真正卡住这一页的阶段，无则 `null`。
   *
   * 与 `currentStage` 分开两个字段，是因为它们回答的是**两个不同的问题**：
   * 「跑到哪了」与「哪里出了问题」。合成一个必然要为另一个的语义买单——
   * 旧实现把「最后一个已完成阶段」配上「它下一个阶段的失败态」当作一对来用，
   * 于是换源后报出 `失败: page-01 (accept-source)`，而 accept-source 是 completed。
   */
  readonly blockingStage: string | null;
  /** 这一页动没动过（源图确认闸门之后有阶段产出过）。见 `computeStarted` */
  readonly started: boolean;
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
  blockingStage: SlideStage | null;
  started: boolean;
  acceptPptxCompleted: boolean;
} {
  const byStage = new Map(stages.map((state) => [state.stage, state]));
  let currentStage: SlideStage = "init";
  for (const stage of SLIDE_STAGE_ORDER) {
    if (byStage.get(stage)?.status === "completed") {
      currentStage = stage;
    }
  }

  // 故障与进度分开算：卡住的阶段由 core 的 findBlockingStage 单点判定，
  // 与桌面端 blockingStageView 同一口径，两侧不会各说一套。
  const blocking = findBlockingStage(stages);

  return {
    currentStage,
    stageStatus:
      blocking?.status ?? byStage.get(currentStage)?.status ?? "completed",
    blockingStage: blocking?.stage ?? null,
    started: computeStarted(stages),
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
        blockingStage: null,
        started: false,
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
      blockingStage: progress.blockingStage,
      started: progress.started,
      removed: false,
    });

    if (progress.acceptPptxCompleted) {
      completed += 1;
    } else if (progress.started) {
      inProgress += 1;
    } else {
      notStarted += 1;
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
    const page = basename(slide.workspacePath);
    // 出问题时指名**卡住的那个阶段**，不是进度走到的那个。
    // 这一条也先于「已跑完就不再列」的判断：产物验收过之后被上游改动作废，
    // 同样需要重跑，按进度跳过等于把它藏起来。
    if (slide.blockingStage !== null) {
      failed.push(`${page} (${slide.blockingStage})`);
      continue;
    }
    const currentIndex = SLIDE_STAGE_ORDER.indexOf(
      slide.currentStage as SlideStage,
    );
    if (currentIndex >= ACCEPT_PPTX_INDEX) {
      continue;
    }
    if (slide.started) {
      inProgress.push(`${page} (${slide.currentStage})`);
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

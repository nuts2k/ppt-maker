import { basename } from "node:path";
import {
  findBlockingStage,
  SLIDE_STAGE_ORDER,
  type SlideSourceKind,
  type SlideStage,
  type SpecDriftStatus,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import { specViewFingerprint } from "../providers/page-generation.js";
import { loadSlideWorkspace } from "../slide/workspace.js";
import { loadDeckContentSpec } from "./content-spec.js";
import { currentGenerationAsset } from "./generate-page.js";
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
  /** 页面来源。移除的页不加载工作区，故为 null */
  readonly sourceKind: SlideSourceKind | null;
  /** 生成页对应的规格条目；非生成页为 null */
  readonly specEntryId: string | null;
  /**
   * 规格漂移状态（R6，只读派生）。
   *
   * - `null`：不适用（非生成页，或 deck 里根本没有规格文件）
   * - `"in-sync"`：当前规格视图指纹与生成时快照一致
   * - `"drifted"`：规格改过、图没跟上
   * - `"missing"`：规格里已无对应条目（失联）
   *
   * **纯派生、不落盘、不改变任何阶段状态**：改回原样自动消失，不需要状态复位逻辑。
   */
  readonly specDrift: SpecDriftStatus | null;
  /**
   * **当前**这一代生成产物的溯源指针（父任务 A7）；非生成页为 null。
   *
   * 三份资产每次重生成各出一份、必然多代，因此按「init 阶段最后一次成功 attempt」
   * 选取，**不按裸 role 查找**——归档件文件在、哈希也对，错的是它描述的对象已经
   * 不是当前那张图。
   */
  readonly generation: {
    readonly attemptId: string;
    readonly contentSpecPath: string | null;
    readonly promptPath: string | null;
    readonly providerRecordPath: string | null;
  } | null;
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
  const spec = await loadDeckContentSpec(deck.path);
  const specEntries = new Map(
    (spec?.entries ?? []).map((entry) => [entry.specEntryId, entry]),
  );

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
        sourceKind: null,
        specEntryId: null,
        specDrift: null,
        generation: null,
      });
      continue;
    }

    const workspace = await loadSlideWorkspace(
      resolveDeckPath(deck.path, entry.workspacePath),
    );
    const progress = computeProgress(workspace.manifest.stages);
    const source = workspace.manifest.source;
    // 只对 generated 页判漂移：imported / extracted 页没有 specEntryId，
    // 把它们卷进来会让混合 deck 的每一页都被报成失联。
    const specEntryId = source.kind === "generated" ? source.specEntryId : null;
    let specDrift: DeckSlideStatus["specDrift"] = null;
    if (source.kind === "generated" && spec !== null) {
      const specEntry = specEntries.get(source.specEntryId);
      specDrift =
        specEntry === undefined
          ? "missing"
          : specViewFingerprint(spec.style, specEntry) ===
              source.specEntrySha256
            ? "in-sync"
            : "drifted";
    }
    slides.push({
      slideId: entry.slideId,
      workspacePath: entry.workspacePath,
      sourceImageName: entry.sourceImageName,
      currentStage: progress.currentStage,
      stageStatus: progress.stageStatus,
      blockingStage: progress.blockingStage,
      started: progress.started,
      removed: false,
      sourceKind: source.kind,
      specEntryId,
      specDrift,
      generation:
        source.kind === "generated"
          ? {
              attemptId: source.attemptId,
              contentSpecPath:
                currentGenerationAsset(workspace.manifest, "content_spec")
                  ?.path ?? null,
              promptPath:
                currentGenerationAsset(workspace.manifest, "generation_prompt")
                  ?.path ?? null,
              providerRecordPath:
                currentGenerationAsset(workspace.manifest, "provider_record")
                  ?.path ?? null,
            }
          : null,
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

  // 规格漂移是**只读提示**，不是故障：阶段状态一个都没变，产物也还在。
  // 与「失败」分开列，免得被当成需要重跑的阻塞项。
  const drifted = result.slides
    .filter((slide) => slide.specDrift === "drifted")
    .map((slide) => `${basename(slide.workspacePath)} (${slide.specEntryId})`);
  const missing = result.slides
    .filter((slide) => slide.specDrift === "missing")
    .map((slide) => `${basename(slide.workspacePath)} (${slide.specEntryId})`);
  if (drifted.length > 0) {
    lines.push(`  规格漂移: ${drifted.join(", ")}（deck regenerate 可重出图）`);
  }
  if (missing.length > 0) {
    lines.push(`  规格失联: ${missing.join(", ")}（规格里已无对应条目）`);
  }

  return lines.join("\n");
}

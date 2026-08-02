import { basename } from "node:path";
import {
  extractableTextLabel,
  findBlockingStage,
  resolveSourceAcceptanceMode,
  SLIDE_STAGE_ORDER,
  type SlideSourceKind,
  SlideSourceKindSchema,
  type SlideStage,
  SOURCE_ACCEPTANCE_TEXT,
  SOURCE_KIND_LABELS,
  type SourceAcceptanceMode,
  type SpecDriftStatus,
  type WorkspaceStageState,
} from "@ppt-maker/core";
import { specViewFingerprint } from "../providers/page-generation.js";
import { loadSlideWorkspace } from "../slide/workspace.js";
import { loadDeckContentSpec } from "./content-spec.js";
import {
  currentGenerationAsset,
  resolveRegenerableSpecEntryId,
} from "./generate-page.js";
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
  /**
   * 该页 PDF 原页是否含可提取文本层（D1）；非 `extracted` 页与移除页为 null。
   *
   * 页级权威来源就是这里读的 `manifest.source`——抽取报告只是抽取当时的观测值，
   * 且它是「看完就关」的会话级产物（桌面端一度只能从它看到这句话，CLI 建的 deck
   * 在界面上则完全无从看起）。A5 要求的是每页可见，故随 deck 总览一路带到两端。
   */
  readonly hasExtractableText: boolean | null;
  /**
   * 源图确认**是怎么通过的**（父任务 A10）。移除的页不加载工作区，故为 null。
   *
   * 判据由 core 的 `resolveSourceAcceptanceMode` 单点给出，取磁盘事实
   * （attempt 的 provider + 有无 `ArtifactAcceptance`），**不按 `sourceKind` 反推**——
   * 生成页在确认之前同样是 `generated`，反推会把「一眼没看过」报成「人工确认」。
   *
   * 这一条正是 A10 后半「报告能区分人工确认与按来源自动放行」的落点：此前磁盘层
   * 区分得很干净，但没有任何消费端把它读出来，报告里看不出差别。
   */
  readonly sourceAcceptance: SourceAcceptanceMode | null;
  /** 生成页对应的规格条目；非生成页为 null */
  readonly specEntryId: string | null;
  /**
   * 这一页可用于「按内容规格重新生成」的规格条目；不可重新生成时为 null。
   *
   * 与 `specEntryId` 是**两件事**：后者回答「当前这张图是按哪条规格出的」（非生成页
   * 必然为 null），前者回答「这一页能不能重新出图、用哪条规格」——一页从 `generated`
   * 换源成 `imported` 之后 `specEntryId` 为 null，但它的历史快照还在，仍然回得去。
   * 合成一个字段会让「换回生成来源」这条路重新消失（A11 正向）。
   */
  readonly regenerableSpecEntryId: string | null;
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
        hasExtractableText: null,
        sourceAcceptance: null,
        specEntryId: null,
        regenerableSpecEntryId: null,
        specDrift: null,
        generation: null,
      });
      continue;
    }

    const slideWorkspacePath = resolveDeckPath(deck.path, entry.workspacePath);
    const workspace = await loadSlideWorkspace(slideWorkspacePath);
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
      hasExtractableText:
        source.kind === "extracted" ? source.hasExtractableText : null,
      sourceAcceptance: resolveSourceAcceptanceMode(workspace.manifest),
      specEntryId,
      regenerableSpecEntryId: await resolveRegenerableSpecEntryId(
        slideWorkspacePath,
        workspace.manifest,
      ),
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

export interface FormatDeckStatusOptions {
  /** 逐页列出来源与阶段（默认只给分布汇总，见 `formatSourceDistribution`） */
  readonly verbose?: boolean;
}

export function formatDeckStatus(
  result: DeckStatusResult,
  options: FormatDeckStatusOptions = {},
): string {
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

  lines.push(...formatSourceDistribution(result.slides));
  lines.push(...formatSourceAcceptance(result.slides));
  if (options.verbose === true) {
    lines.push(...formatSlideRows(result.slides));
  }

  return lines.join("\n");
}

/**
 * 来源分布一行 —— 父任务 A2「`deck status` 能看出来源」在人读输出上的落点。
 *
 * 为什么是**汇总**而不是默认逐页：`deck status` 现有风格是「只列需要你管的」
 * （完成计数 + 进行中 / 失败 / 漂移的点名）。来源是常态信息，每一页都有一个，把 N 行
 * 常态信息塞进默认输出会把真正的异常项淹掉——与桌面端「来源不上色」是同一条判断
 * （`renderer/lib/source-view.ts` 的规则 1）。逐页明细走 `--verbose`、`--json`
 * 与桌面端总览。
 *
 * 文案取 core 的 `SOURCE_KIND_LABELS`，与桌面端同一张表；顺序取 schema 的枚举顺序，
 * 不按计数排序——同一个 deck 两次运行的输出不该因为一次换源就换行序。
 * 计数为 0 的档不列：混合来源是少数，多数 deck 只有一档，`抽取 0 / 生成 0` 是噪声。
 */
function formatSourceDistribution(
  slides: readonly DeckSlideStatus[],
): readonly string[] {
  const counts = new Map<SlideSourceKind, number>();
  for (const slide of slides) {
    if (slide.removed || slide.sourceKind === null) continue;
    counts.set(slide.sourceKind, (counts.get(slide.sourceKind) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return [];
  }
  const parts = SlideSourceKindSchema.options
    .filter((kind) => counts.has(kind))
    .map((kind) => `${SOURCE_KIND_LABELS[kind]} ${counts.get(kind) ?? 0}`);
  return [`  来源: ${parts.join(" / ")}`];
}

/**
 * `--verbose` 的逐页明细：页名、来源（抽取页附带文本层探测结果）、当前阶段与状态。
 *
 * 已移除页不加载工作区（没有来源可报），只写「已移除」，不编一个来源出来。
 * 文本层那句话取 core 的 `extractableTextLabel`，与抽取报告、桌面端页面详情同一措辞。
 */
function formatSlideRows(
  slides: readonly DeckSlideStatus[],
): readonly string[] {
  if (slides.length === 0) {
    return [];
  }
  const rows = slides.map((slide) => {
    const page = basename(slide.workspacePath);
    if (slide.removed) {
      return `  ${page}  已移除`;
    }
    const kind =
      slide.sourceKind === null
        ? "来源未知"
        : SOURCE_KIND_LABELS[slide.sourceKind];
    const text =
      slide.hasExtractableText === null
        ? ""
        : `（${extractableTextLabel(slide.hasExtractableText)}）`;
    return `  ${page}  ${kind}${text}  ${slide.currentStage} (${slide.stageStatus})`;
  });
  return ["  逐页:", ...rows];
}

/**
 * 源图确认一行 —— A10 后半要求「报告能区分人工确认与按来源自动放行」的人读落点。
 *
 * 计数与待确认页分两行：前者是这一叠的构成（扫一眼就知道有几页真的有人签过字），
 * 后者是**要你管**的那部分，必须逐页点名，否则用户只知道「有 3 页待确认」却不知道
 * 是哪三页。已移除页不计入——它们的工作区压根不加载。
 */
function formatSourceAcceptance(
  slides: readonly DeckSlideStatus[],
): readonly string[] {
  const counts: Record<SourceAcceptanceMode, number> = {
    manual: 0,
    auto: 0,
    pending: 0,
  };
  const pendingPages: string[] = [];
  for (const slide of slides) {
    if (slide.removed || slide.sourceAcceptance === null) continue;
    counts[slide.sourceAcceptance] += 1;
    if (slide.sourceAcceptance === "pending") {
      pendingPages.push(basename(slide.workspacePath));
    }
  }
  if (counts.manual + counts.auto + counts.pending === 0) {
    return [];
  }

  const lines = [
    `  源图确认: ${SOURCE_ACCEPTANCE_TEXT.manual} ${counts.manual}，${SOURCE_ACCEPTANCE_TEXT.auto} ${counts.auto}，${SOURCE_ACCEPTANCE_TEXT.pending} ${counts.pending}`,
  ];
  if (pendingPages.length > 0) {
    lines.push(
      `  待确认源图: ${pendingPages.join(", ")}（ppt-maker slide accept-source <workspace>）`,
    );
  }
  return lines;
}

/**
 * renderer 与 main 的类型交界。
 *
 * **不得出现任何 `@cli/*` 导入**：`tsconfig.web.json` 的 `paths` 只有 `@/*` 与
 * `@shared/*`，而 renderer 多处 `import type { … } from "../../main/ipc/channels.js"`
 * 会把本文件拉进 web 项目一起类型检查，一个 `@cli` 导入就会让
 * `pnpm -r typecheck` 在 renderer 项目下失败。跨层共享的类型一律走
 * `@ppt-maker/core`。该约束由 `test/channels-imports.test.ts` 静态锁住。
 */
import type {
  CleanPlateChecks,
  ContentSpec,
  PdfExtractionReport,
  PptxCheckReport,
  SlideSourceKind,
  SpecDriftStatus,
  TextReviewDocument,
} from "@ppt-maker/core";
import type { RunStage } from "../../shared/stages.js";

export interface DeckStatusSlide {
  readonly slideId: string;
  readonly workspacePath: string;
  readonly sourceImageName: string;
  readonly currentStage: string;
  readonly stageStatus: string;
  readonly removed: boolean;
  /**
   * 页面来源。移除页不加载工作区，故为 null（卡片据此不显示来源徽标）。
   *
   * CLI `deckStatus` 早已返回这三个字段，此前被本层的类型截断丢掉了。
   * **不接** `blockingStage` / `started`：桌面端已有合并会话层的
   * `blockingStageView`，接进来会变成同一件事的第二个判据来源。
   */
  readonly sourceKind: SlideSourceKind | null;
  /** 生成页对应的规格条目；非生成页为 null */
  readonly specEntryId: string | null;
  /** 规格漂移（只读派生）：只标注，不进待办队列、不影响任何阶段状态 */
  readonly specDrift: SpecDriftStatus | null;
}

export interface DeckStatusResult {
  readonly deckPath: string;
  readonly name: string;
  readonly deckId: string;
  readonly slides: readonly DeckStatusSlide[];
  readonly summary: {
    readonly total: number;
    readonly active: number;
    readonly removed: number;
    readonly completed: number;
    readonly inProgress: number;
    readonly notStarted: number;
  };
}

/** 单个阶段的耐久状态（来自 manifest.stages，validate-review 由下游推断） */
export interface SlideStageDetail {
  readonly stage: RunStage;
  readonly status:
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "interrupted"
    | "stale";
}

export interface SlideLastError {
  readonly stage: string;
  readonly code: string;
  readonly message: string;
  readonly at: string;
}

/**
 * 单页详情：在 CLI `deckStatus` 之上叠加 manifest attempts 聚合而来的
 * 阶段全量状态、最近失败与阶段耗时。全部为只读聚合，不绕过任何业务契约。
 */
export interface SlideDetail extends DeckStatusSlide {
  /** 绝对路径，renderer 无需再与 deckPath 拼接 */
  readonly absWorkspacePath: string;
  /** 工作区目录名，用作页面显示名 */
  readonly pageLabel: string;
  readonly stages: readonly SlideStageDetail[];
  readonly lastError: SlideLastError | null;
  /** stage -> 最近一次成功执行的耗时（毫秒） */
  readonly stageDurations: Readonly<Record<string, number>>;
  /**
   * 该页仍待人工复核的版式文字块数（`layout_text` 且 `reviewStatus === "unreviewed"`）。
   *
   * 待办队列「需文本复核」分组的耐久层判据——manifest 里没有这个信息，必须由
   * main 侧读 `stages/review/text-blocks.json` 聚合。读不到（review 未跑完或文件
   * 缺失）时为 0，此时该页本就不该出现在该分组里。
   */
  readonly pendingTextReview: number;
}

export interface DeckStatusDetailedResult {
  readonly deckPath: string;
  readonly name: string;
  readonly deckId: string;
  readonly slides: readonly SlideDetail[];
  readonly summary: DeckStatusResult["summary"];
}

export interface DeckExportResult {
  readonly outputPath: string;
  readonly totalSlides: number;
  readonly nativeSlides: number;
  readonly placeholderSlides: number;
}

export interface AcceptOptions {
  readonly acceptedBy?: string;
  readonly note?: string;
}

/**
 * 保存文本复核的结果。
 *
 * `invalidated` 是本次保存连带作废的阶段 id（含下游），空数组表示内容无变化、
 * 无需重跑任何阶段。界面据此提示用户「下一步要重新生成」。
 */
export interface SaveReviewResult {
  readonly valid: boolean;
  readonly errors: number;
  readonly warnings: number;
  readonly invalidated: readonly string[];
}

/**
 * 换源结果。
 *
 * `replaced: false` 表示用户在选图或二次确认处取消——不是失败。真正的失败会抛错，
 * 让界面看见原因，而不是退化成一个「没换成但也没说为什么」的成功壳。
 */
export interface ReplaceSourceResult {
  readonly replaced: boolean;
  /** 由 completed 转为 stale 的阶段 */
  readonly invalidated?: readonly string[];
  readonly archivedReview?: boolean;
  /** 新来源是否需要人工确认源图（换成生成图时为 true） */
  readonly requiresAcceptance?: boolean;
}

/**
 * 源图确认结果（M5 D6）。
 *
 * 只有 `generated` 页会走到这里，`imported` / `extracted` 在建立工作区或换源时
 * 已自动放行；对它们调用会被 CLI 侧拒绝并抛错，界面照常显示原因。
 */
export interface AcceptSourceResult {
  readonly acceptedPath: string;
  readonly acceptanceId: string;
}

/** 最终确认一次写入 accept-clean + accept-pptx 两条验收记录的结果 */
export interface AcceptFinalResult {
  readonly cleanAcceptanceId: string;
  readonly pptxAcceptanceId: string;
  readonly autoCheckSummary: string;
}

/**
 * 最终确认页展示的自动检查结果。
 *
 * 两份都是产物目录里的既有记录，main 侧只读不算：pptx 取 `stages/pptx/check.json`，
 * clean 取当前 attempt 的 `stages/clean/clean-00N/record.json` 的 `checks`。
 * 阶段未跑或文件缺失时为 null，界面按「暂无」呈现而非报错。
 */
export interface FinalChecks {
  readonly pptx: PptxCheckReport | null;
  readonly clean: CleanPlateChecks | null;
}

/** 批量/单页执行的启动参数；省略 slideIds 表示全部未完成的活动页 */
export interface DeckRunStartOptions {
  readonly slideIds?: readonly string[];
  /** 强制起始阶段（单页"从阶段重跑"）；省略时按 manifest 断点续跑 */
  readonly from?: RunStage;
  readonly confirmApi?: boolean;
  readonly confirmUpload?: boolean;
}

export interface DeckRunStartResult {
  readonly accepted: boolean;
  readonly queued: number;
  readonly message: string;
}

export interface DeckRunSummary {
  readonly total: number;
  readonly completed: number;
  readonly gated: number;
  readonly failed: number;
}

export type DeckRunEvent =
  | {
      readonly kind: "run-start";
      readonly total: number;
      readonly slideIds: readonly string[];
    }
  | {
      readonly kind: "page-start";
      readonly slideId: string;
      readonly pageLabel: string;
      readonly index: number;
      readonly total: number;
    }
  | {
      readonly kind: "stage-start";
      readonly slideId: string;
      readonly stage: RunStage;
      readonly at: string;
    }
  | {
      readonly kind: "stage-complete";
      readonly slideId: string;
      readonly stage: RunStage;
      readonly at: string;
      readonly durationMs: number;
    }
  | {
      readonly kind: "page-done";
      readonly slideId: string;
      readonly gate: string | null;
      readonly stoppedAt: string | null;
      readonly message: string;
      readonly error: {
        readonly code: string;
        readonly message: string;
      } | null;
    }
  | { readonly kind: "run-stopping" }
  | { readonly kind: "run-done"; readonly summary: DeckRunSummary };

/**
 * 建页任务：把新页面加进 deck 的长任务（R5）。
 *
 * **不复用 `DeckRunner`**：runner 的队列单元是 slide，而建页任务执行时 slide 还不
 * 存在。硬塞进去要给它加一类没有 slideId 的队列项，污染现有的 `page-done` /
 * `stage-start` 事件语义。两者共写 deck manifest 与 slide manifest，因此改为
 * **双向互斥**（见 `SourceTaskResult.accepted`）。
 *
 * 三种建页命令在 CLI 侧形态同构（deck 不存在则创建、存在则追加末尾），这里保持
 * 同一形状：调用方只给目标 deck 路径，不区分「新建」与「追加」。
 */
export type SourceTaskKind = "import" | "extract" | "generate" | "regenerate";

export type SourceTaskRequest =
  | {
      readonly kind: "import";
      /** 逐张追加；顺序即入册顺序 */
      readonly imagePaths: readonly string[];
    }
  | {
      readonly kind: "extract";
      readonly pdfPath: string;
      /** `--pages` 原样（如 `3-8,12`）。**桌面端不解析不校验**，非法输入由 CLI 报错 */
      readonly pages?: string;
      readonly deckName?: string;
    }
  | {
      readonly kind: "generate";
      readonly specPath: string;
      readonly deckName?: string;
    }
  | {
      readonly kind: "regenerate";
      /** 页标签或 slideId，与 CLI `deck regenerate --page` 同参 */
      readonly page: string;
      readonly note?: string;
    };

/**
 * 归一后的进度事件。
 *
 * `extractPdfToDeck` 的 `onProgress(message: string)` 与 `runDeckGenerate` 的
 * `onProgress(DeckGenerateProgress)` 形状不同，在 main 侧归一为这一种再送 renderer，
 * renderer 只认归一后的形状——两侧不会各自解释一遍两种原始形状。
 */
export interface SourceTaskProgress {
  readonly taskId: string;
  readonly kind: SourceTaskKind;
  /** 第几条；总数未知或尚无逐条目进度时为 0 */
  readonly index: number;
  /** 总条数；未知时为 0（抽取在渲染前不知道有多少页能过 16:9） */
  readonly total: number;
  readonly phase: "start" | "item" | "done" | "failed";
  readonly message: string;
}

export interface SourceTaskResult {
  /**
   * 是否受理。`false` 表示被互斥规则挡下（流水线在跑 / 已有建页任务在跑），
   * **不是失败**——真正的失败会抛错，让界面看见原因，而不是退化成一个
   * 「没做成但也没说为什么」的成功壳。
   */
  readonly accepted: boolean;
  readonly message: string;
  /** 实际落点。新建时即新 deck 路径，调用方据此切换工作区 */
  readonly deckPath: string | null;
  readonly deckCreated: boolean;
  readonly created: number;
  readonly failed: number;
  readonly skipped: number;
  /** 抽取专属：报告内容与落盘路径，供完成面板与活动日志回溯（E4） */
  readonly report: PdfExtractionReport | null;
  readonly reportPath: string | null;
  /** 重新生成专属 */
  readonly regenerated: {
    readonly slideId: string;
    readonly pageLabel: string;
    readonly specEntryId: string;
    readonly revisionNotes: readonly string[];
    /** 新源图是否需要人工确认（重生成后恒为 true） */
    readonly requiresAcceptance: boolean;
  } | null;
}

/**
 * 规格初稿结果（E1 的第二条路）。
 *
 * 初稿落在 main 管理的临时文件而不是 `<deck>/content-spec.json`：用户还没确认要不要
 * 出图，此时就覆盖既有 deck 的权威规格等于替他做了决定；新建场景下 deck 更是压根
 * 还不存在。确认之后由 `runDeckGenerate --spec` 复制进 deck 成为权威副本。
 */
export interface SpecDraftResult {
  readonly specPath: string;
  readonly spec: ContentSpec;
}

export type ActivityResult = "info" | "success" | "failure" | "gate";

export interface ActivityRecord {
  readonly at: string;
  readonly kind: string;
  readonly slideId: string | null;
  readonly pageLabel: string | null;
  readonly stage: string | null;
  readonly result: ActivityResult;
  readonly durationMs: number | null;
  readonly detail: string;
  /**
   * 抽取报告的绝对路径（E4）。带此字段的记录在活动日志里给一个「查看报告」，
   * 关掉完成面板之后仍能找回同一份报告。
   *
   * 可选字段对既有 jsonl 天然兼容：旧记录读出来是 `undefined`，不需要迁移。
   */
  readonly reportPath?: string;
}

export interface DoctorCheckItem {
  readonly id: string;
  readonly label: string;
  readonly status: "pass" | "fail" | "warn";
  readonly message: string;
}

export interface DoctorReport {
  readonly checks: readonly DoctorCheckItem[];
  readonly summary: {
    readonly pass: number;
    readonly fail: number;
    readonly warn: number;
  };
}

export interface IpcApi {
  deck: {
    open(path: string): Promise<DeckStatusResult>;
    create(
      imagesDir: string,
      workspacePath: string,
      name?: string,
    ): Promise<DeckStatusResult>;
    status(path: string): Promise<DeckStatusResult>;
    statusDetailed(path: string): Promise<DeckStatusDetailedResult>;
    runStart(
      deckPath: string,
      opts?: DeckRunStartOptions,
    ): Promise<DeckRunStartResult>;
    runStop(): Promise<void>;
    export(
      deckPath: string,
      outputPath: string,
      strict?: boolean,
    ): Promise<DeckExportResult>;
    addSlide(
      deckPath: string,
      imagePath: string,
    ): Promise<{ pageLabel: string; slideId: string }>;
    removeSlide(deckPath: string, pageLabel: string): Promise<void>;
    /**
     * 启动一个建页任务。`deckPath` 是**目标** deck 目录：已存在则追加到末尾，
     * 不存在则由 CLI 侧的建页命令自行创建（三种来源在 CLI 侧形态同构）。
     *
     * 返回只表示「是否受理与最终结果」，逐条目进度走 `onSourceTaskProgress`。
     */
    sourceTaskStart(
      deckPath: string,
      request: SourceTaskRequest,
    ): Promise<SourceTaskResult>;
    /** 由一段构思文本产出规格初稿（一次调用、无对话）。落在临时文件，不进 deck */
    specDraft(text: string): Promise<SpecDraftResult>;
    /**
     * 读一份**外部**内容规格文件（选已有规格文件那条路）。
     *
     * 存在的唯一理由是 U13：付费确认框必须写明将调用多少次图像生成，而条目数只在
     * 那个文件里。没有它，确认框只能说一句「将逐页调用」——用户无从判断这次要花多少钱，
     * 而「不可撤销」的门槛正是靠这个数字才立得住。
     *
     * 给出的是**上限**：`runDeckGenerate` 会先与 deck 现有页对账，已生成且条目匹配的
     * 会被跳过。往已有 deck 追加时实际次数可能更少，文案须如实写成「最多 N 次」。
     */
    readContentSpec(specPath: string): Promise<ContentSpec>;
    /** 读回一份已落盘的抽取报告（活动日志的「查看报告」） */
    readExtractionReport(reportPath: string): Promise<PdfExtractionReport>;
  };
  slide: {
    loadReview(workspacePath: string): Promise<TextReviewDocument | null>;
    saveReview(
      workspacePath: string,
      document: TextReviewDocument,
    ): Promise<SaveReviewResult>;
    /** 源图确认：链路最前的人工点，只对需要确认的来源（生成图）开放 */
    acceptSource(
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<AcceptSourceResult>;
    acceptClean(
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<{ acceptedPath: string; autoCheckSummary: string }>;
    acceptPptx(
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<{ acceptedPath: string; autoCheckSummary: string }>;
    /** 最终确认：一次写入 accept-clean 与 accept-pptx 两条验收记录 */
    acceptFinal(
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<AcceptFinalResult>;
    /** 用系统默认程序打开该页 PPTX 产物（PowerPoint for Mac 做最终把关） */
    openPptx(
      workspacePath: string,
    ): Promise<{ opened: boolean; message: string }>;
    /** 读取最终确认页要展示的 pptx 六项检查与 clean 裸指标 */
    loadFinalChecks(workspacePath: string): Promise<FinalChecks>;
    loadImage(workspacePath: string, role: string): Promise<string | null>;
    /**
     * 换源：main 侧串起「选图 → 二次确认 → 执行」。
     * 用户在任一步取消时返回 `{ replaced: false }`，renderer 据此不刷新也不报成功。
     */
    replaceSource(workspacePath: string): Promise<ReplaceSourceResult>;
    /** 拒绝验收：把该阶段及下游标为 stale，让随后的 run 强制重做 */
    invalidateStage(
      workspacePath: string,
      stage: RunStage,
      reason: string,
    ): Promise<{ invalidated: string[] }>;
  };
  activity: {
    list(deckPath: string, limit?: number): Promise<ActivityRecord[]>;
  };
  system: {
    doctor(): Promise<DoctorReport>;
    selectDirectory(): Promise<string | null>;
    selectFile(
      filters?: Array<{ name: string; extensions: string[] }>,
    ): Promise<string | null>;
    /** 多选文件（追加图片时一次挑多张）；取消返回空数组 */
    selectFiles(
      filters?: Array<{ name: string; extensions: string[] }>,
    ): Promise<readonly string[]>;
    saveFileDialog(defaultName: string): Promise<string | null>;
    /**
     * 原生确认框（E3 的批量档）。付费且不可撤销的批量动作用它，
     * 而不是页面内的一个可以被顺手点掉的按钮。
     */
    confirm(options: {
      readonly title: string;
      readonly message: string;
      readonly detail?: string;
      readonly confirmLabel: string;
    }): Promise<boolean>;
  };
  onDeckRunProgress(callback: (event: DeckRunEvent) => void): () => void;
  onSourceTaskProgress(
    callback: (event: SourceTaskProgress) => void,
  ): () => void;
}

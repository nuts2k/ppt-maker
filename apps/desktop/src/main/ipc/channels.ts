import type {
  CleanPlateChecks,
  PptxCheckReport,
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
    saveFileDialog(defaultName: string): Promise<string | null>;
  };
  onDeckRunProgress(callback: (event: DeckRunEvent) => void): () => void;
}

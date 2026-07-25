import type { TextReviewDocument } from "@ppt-maker/core";
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
    ): Promise<{ valid: boolean; errors: number; warnings: number }>;
    acceptClean(
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<{ acceptedPath: string; autoCheckSummary: string }>;
    acceptPptx(
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<{ acceptedPath: string; autoCheckSummary: string }>;
    loadImage(workspacePath: string, role: string): Promise<string | null>;
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

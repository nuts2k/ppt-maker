import type { SlideStage, TextReviewDocument } from "@ppt-maker/core";

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

export interface DeckExportResult {
  readonly outputPath: string;
  readonly totalSlides: number;
  readonly nativeSlides: number;
  readonly placeholderSlides: number;
}

export interface SlideRunOptions {
  readonly confirmApi?: boolean;
  readonly confirmUpload?: boolean;
}

export interface AcceptOptions {
  readonly acceptedBy?: string;
  readonly note?: string;
}

export interface PipelineProgressEvent {
  readonly slideId: string;
  readonly stage: SlideStage;
  readonly status: "running" | "completed" | "failed";
  readonly gate?: "accept-clean" | "accept-pptx";
  readonly error?: { readonly code: string; readonly message: string };
}

export interface SlideRunResult {
  readonly executed: readonly string[];
  readonly stoppedAt: string | null;
  readonly gate: string | null;
  readonly message: string;
  readonly nextCommand: string | null;
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
    run(
      workspacePath: string,
      from: string,
      opts?: SlideRunOptions,
    ): Promise<SlideRunResult>;
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
  system: {
    doctor(): Promise<DoctorReport>;
    selectDirectory(): Promise<string | null>;
    selectFile(
      filters?: Array<{ name: string; extensions: string[] }>,
    ): Promise<string | null>;
    saveFileDialog(defaultName: string): Promise<string | null>;
  };
  onPipelineProgress(
    callback: (event: PipelineProgressEvent) => void,
  ): () => void;
}

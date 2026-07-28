import type { TextReviewDocument } from "@ppt-maker/core";
import { contextBridge, ipcRenderer } from "electron";
import type {
  AcceptFinalResult,
  AcceptOptions,
  ActivityRecord,
  DeckExportResult,
  DeckRunEvent,
  DeckRunStartOptions,
  DeckRunStartResult,
  DeckStatusDetailedResult,
  DeckStatusResult,
  DoctorReport,
  FinalChecks,
  IpcApi,
} from "../main/ipc/channels.js";
import type { RunStage } from "../shared/stages.js";

const api: IpcApi = {
  deck: {
    open: (path: string): Promise<DeckStatusResult> =>
      ipcRenderer.invoke("deck:open", path),
    create: (
      imagesDir: string,
      workspacePath: string,
      name?: string,
    ): Promise<DeckStatusResult> =>
      ipcRenderer.invoke("deck:create", imagesDir, workspacePath, name),
    status: (path: string): Promise<DeckStatusResult> =>
      ipcRenderer.invoke("deck:status", path),
    statusDetailed: (path: string): Promise<DeckStatusDetailedResult> =>
      ipcRenderer.invoke("deck:status-detailed", path),
    runStart: (
      deckPath: string,
      opts?: DeckRunStartOptions,
    ): Promise<DeckRunStartResult> =>
      ipcRenderer.invoke("deck:run-start", deckPath, opts),
    runStop: (): Promise<void> => ipcRenderer.invoke("deck:run-stop"),
    export: (
      deckPath: string,
      outputPath: string,
      strict?: boolean,
    ): Promise<DeckExportResult> =>
      ipcRenderer.invoke("deck:export", deckPath, outputPath, strict),
    addSlide: (
      deckPath: string,
      imagePath: string,
    ): Promise<{ pageLabel: string; slideId: string }> =>
      ipcRenderer.invoke("deck:add-slide", deckPath, imagePath),
    removeSlide: (deckPath: string, pageLabel: string): Promise<void> =>
      ipcRenderer.invoke("deck:remove-slide", deckPath, pageLabel),
  },
  slide: {
    loadReview: (workspacePath: string): Promise<TextReviewDocument | null> =>
      ipcRenderer.invoke("slide:load-review", workspacePath),
    saveReview: (
      workspacePath: string,
      document: TextReviewDocument,
    ): Promise<{ valid: boolean; errors: number; warnings: number }> =>
      ipcRenderer.invoke("slide:save-review", workspacePath, document),
    acceptClean: (
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<{ acceptedPath: string; autoCheckSummary: string }> =>
      ipcRenderer.invoke("slide:accept-clean", workspacePath, opts),
    acceptPptx: (
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<{ acceptedPath: string; autoCheckSummary: string }> =>
      ipcRenderer.invoke("slide:accept-pptx", workspacePath, opts),
    acceptFinal: (
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<AcceptFinalResult> =>
      ipcRenderer.invoke("slide:accept-final", workspacePath, opts),
    openPptx: (
      workspacePath: string,
    ): Promise<{ opened: boolean; message: string }> =>
      ipcRenderer.invoke("slide:open-pptx", workspacePath),
    loadFinalChecks: (workspacePath: string): Promise<FinalChecks> =>
      ipcRenderer.invoke("slide:load-final-checks", workspacePath),
    loadImage: (workspacePath: string, role: string): Promise<string | null> =>
      ipcRenderer.invoke("slide:load-image", workspacePath, role),
    invalidateStage: (
      workspacePath: string,
      stage: RunStage,
      reason: string,
    ): Promise<{ invalidated: string[] }> =>
      ipcRenderer.invoke(
        "slide:invalidate-stage",
        workspacePath,
        stage,
        reason,
      ),
  },
  activity: {
    list: (deckPath: string, limit?: number): Promise<ActivityRecord[]> =>
      ipcRenderer.invoke("activity:list", deckPath, limit),
  },
  system: {
    doctor: (): Promise<DoctorReport> => ipcRenderer.invoke("system:doctor"),
    selectDirectory: (): Promise<string | null> =>
      ipcRenderer.invoke("system:select-directory"),
    selectFile: (
      filters?: Array<{ name: string; extensions: string[] }>,
    ): Promise<string | null> =>
      ipcRenderer.invoke("system:select-file", filters),
    saveFileDialog: (defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke("system:save-file-dialog", defaultName),
  },
  onDeckRunProgress: (
    callback: (event: DeckRunEvent) => void,
  ): (() => void) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      event: DeckRunEvent,
    ): void => {
      callback(event);
    };
    ipcRenderer.on("deck:run-progress", handler);
    return () => {
      ipcRenderer.removeListener("deck:run-progress", handler);
    };
  },
};

contextBridge.exposeInMainWorld("api", api);

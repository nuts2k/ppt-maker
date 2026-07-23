import type { TextReviewDocument } from "@ppt-maker/core";
import { contextBridge, ipcRenderer } from "electron";
import type {
  AcceptOptions,
  DeckExportResult,
  DeckStatusResult,
  DoctorReport,
  IpcApi,
  PipelineProgressEvent,
  SlideRunOptions,
  SlideRunResult,
} from "../main/ipc/channels.js";

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
    run: (
      workspacePath: string,
      from: string,
      opts?: SlideRunOptions,
    ): Promise<SlideRunResult> =>
      ipcRenderer.invoke("slide:run", workspacePath, from, opts),
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
    loadImage: (workspacePath: string, role: string): Promise<string | null> =>
      ipcRenderer.invoke("slide:load-image", workspacePath, role),
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
  onPipelineProgress: (
    callback: (event: PipelineProgressEvent) => void,
  ): (() => void) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      event: PipelineProgressEvent,
    ): void => {
      callback(event);
    };
    ipcRenderer.on("pipeline:progress", handler);
    return () => {
      ipcRenderer.removeListener("pipeline:progress", handler);
    };
  },
};

contextBridge.exposeInMainWorld("api", api);

import type {
  ApplySpecChangeResult,
  ContentSpec,
  PdfExtractionReport,
  PlanningAcceptProposalResult,
  PlanningChangeScope,
  PlanningConversationSnapshot,
  PlanningMaterialEntry,
  PlanningMaterialsResult,
  PlanningProposalPreview,
  PlanningProposalResult,
  PlanningProposalSelection,
  PlanningRejectProposalResult,
  SpecChangeRecord,
  TextReviewDocument,
} from "@ppt-maker/core";
import { contextBridge, ipcRenderer } from "electron";
import type {
  AcceptFinalResult,
  AcceptOptions,
  AcceptSourceResult,
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
  ReplaceSourceResult,
  SaveReviewResult,
  SourceTaskProgress,
  SourceTaskRequest,
  SourceTaskResult,
  SpecDraftResult,
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
    createEmpty: (parentDir: string, name: string): Promise<DeckStatusResult> =>
      ipcRenderer.invoke("deck:create-empty", parentDir, name),
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
    sourceTaskStart: (
      deckPath: string,
      request: SourceTaskRequest,
    ): Promise<SourceTaskResult> =>
      ipcRenderer.invoke("deck:source-task-start", deckPath, request),
    specDraft: (text: string): Promise<SpecDraftResult> =>
      ipcRenderer.invoke("deck:spec-draft", text),
    readContentSpec: (specPath: string): Promise<ContentSpec> =>
      ipcRenderer.invoke("deck:read-content-spec", specPath),
    readDeckSpec: (deckPath: string): Promise<ContentSpec | null> =>
      ipcRenderer.invoke("deck:read-deck-spec", deckPath),
    applySpecChange: (
      deckPath: string,
      nextSpec: ContentSpec,
      summary: string,
    ): Promise<ApplySpecChangeResult> =>
      ipcRenderer.invoke("deck:apply-spec-change", deckPath, nextSpec, summary),
    listSpecHistory: (deckPath: string): Promise<readonly SpecChangeRecord[]> =>
      ipcRenderer.invoke("deck:list-spec-history", deckPath),
    rollbackSpecChange: (
      deckPath: string,
      recordId: string,
    ): Promise<ApplySpecChangeResult> =>
      ipcRenderer.invoke("deck:rollback-spec-change", deckPath, recordId),
    readExtractionReport: (reportPath: string): Promise<PdfExtractionReport> =>
      ipcRenderer.invoke("deck:read-extraction-report", reportPath),
  },
  planning: {
    load: (deckPath: string): Promise<PlanningConversationSnapshot> =>
      ipcRenderer.invoke("planning:load", deckPath),
    sendMessage: (
      deckPath: string,
      text: string,
    ): Promise<PlanningConversationSnapshot> =>
      ipcRenderer.invoke("planning:send-message", deckPath, text),
    draftSpec: (deckPath: string): Promise<PlanningProposalResult> =>
      ipcRenderer.invoke("planning:draft-spec", deckPath),
    proposeChange: (
      deckPath: string,
      text: string,
      scope: PlanningChangeScope,
    ): Promise<PlanningProposalResult> =>
      ipcRenderer.invoke("planning:propose-change", deckPath, text, scope),
    previewProposal: (
      deckPath: string,
      proposalMessageId: string,
      selection: PlanningProposalSelection,
    ): Promise<PlanningProposalPreview> =>
      ipcRenderer.invoke(
        "planning:preview-proposal",
        deckPath,
        proposalMessageId,
        selection,
      ),
    acceptProposal: (
      deckPath: string,
      proposalMessageId: string,
      selection: PlanningProposalSelection,
    ): Promise<PlanningAcceptProposalResult> =>
      ipcRenderer.invoke(
        "planning:accept-proposal",
        deckPath,
        proposalMessageId,
        selection,
      ),
    rejectProposal: (
      deckPath: string,
      proposalMessageId: string,
    ): Promise<PlanningRejectProposalResult> =>
      ipcRenderer.invoke(
        "planning:reject-proposal",
        deckPath,
        proposalMessageId,
      ),
    listMaterials: (deckPath: string): Promise<PlanningMaterialsResult> =>
      ipcRenderer.invoke("planning:list-materials", deckPath),
    importMaterial: (deckPath: string): Promise<PlanningMaterialEntry | null> =>
      ipcRenderer.invoke("planning:import-material", deckPath),
    removeMaterial: (
      deckPath: string,
      name: string,
    ): Promise<PlanningMaterialsResult> =>
      ipcRenderer.invoke("planning:remove-material", deckPath, name),
  },
  slide: {
    loadReview: (workspacePath: string): Promise<TextReviewDocument | null> =>
      ipcRenderer.invoke("slide:load-review", workspacePath),
    saveReview: (
      workspacePath: string,
      document: TextReviewDocument,
    ): Promise<SaveReviewResult> =>
      ipcRenderer.invoke("slide:save-review", workspacePath, document),
    acceptSource: (
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<AcceptSourceResult> =>
      ipcRenderer.invoke("slide:accept-source", workspacePath, opts),
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
    replaceSource: (workspacePath: string): Promise<ReplaceSourceResult> =>
      ipcRenderer.invoke("slide:replace-source", workspacePath),
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
    selectFiles: (
      filters?: Array<{ name: string; extensions: string[] }>,
    ): Promise<readonly string[]> =>
      ipcRenderer.invoke("system:select-files", filters),
    saveFileDialog: (defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke("system:save-file-dialog", defaultName),
    confirm: (options: {
      title: string;
      message: string;
      detail?: string;
      confirmLabel: string;
    }): Promise<boolean> => ipcRenderer.invoke("system:confirm", options),
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
  onSourceTaskProgress: (
    callback: (event: SourceTaskProgress) => void,
  ): (() => void) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      event: SourceTaskProgress,
    ): void => {
      callback(event);
    };
    ipcRenderer.on("deck:source-task-progress", handler);
    return () => {
      ipcRenderer.removeListener("deck:source-task-progress", handler);
    };
  },
};

contextBridge.exposeInMainWorld("api", api);

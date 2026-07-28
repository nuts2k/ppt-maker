import { contextBridge, ipcRenderer } from "electron";
const api = {
  deck: {
    open: (path) => ipcRenderer.invoke("deck:open", path),
    create: (imagesDir, workspacePath, name) => ipcRenderer.invoke("deck:create", imagesDir, workspacePath, name),
    status: (path) => ipcRenderer.invoke("deck:status", path),
    statusDetailed: (path) => ipcRenderer.invoke("deck:status-detailed", path),
    runStart: (deckPath, opts) => ipcRenderer.invoke("deck:run-start", deckPath, opts),
    runStop: () => ipcRenderer.invoke("deck:run-stop"),
    export: (deckPath, outputPath, strict) => ipcRenderer.invoke("deck:export", deckPath, outputPath, strict),
    addSlide: (deckPath, imagePath) => ipcRenderer.invoke("deck:add-slide", deckPath, imagePath),
    removeSlide: (deckPath, pageLabel) => ipcRenderer.invoke("deck:remove-slide", deckPath, pageLabel)
  },
  slide: {
    loadReview: (workspacePath) => ipcRenderer.invoke("slide:load-review", workspacePath),
    saveReview: (workspacePath, document) => ipcRenderer.invoke("slide:save-review", workspacePath, document),
    acceptClean: (workspacePath, opts) => ipcRenderer.invoke("slide:accept-clean", workspacePath, opts),
    acceptPptx: (workspacePath, opts) => ipcRenderer.invoke("slide:accept-pptx", workspacePath, opts),
    acceptFinal: (workspacePath, opts) => ipcRenderer.invoke("slide:accept-final", workspacePath, opts),
    openPptx: (workspacePath) => ipcRenderer.invoke("slide:open-pptx", workspacePath),
    loadFinalChecks: (workspacePath) => ipcRenderer.invoke("slide:load-final-checks", workspacePath),
    loadImage: (workspacePath, role) => ipcRenderer.invoke("slide:load-image", workspacePath, role),
    invalidateStage: (workspacePath, stage, reason) => ipcRenderer.invoke(
      "slide:invalidate-stage",
      workspacePath,
      stage,
      reason
    )
  },
  activity: {
    list: (deckPath, limit) => ipcRenderer.invoke("activity:list", deckPath, limit)
  },
  system: {
    doctor: () => ipcRenderer.invoke("system:doctor"),
    selectDirectory: () => ipcRenderer.invoke("system:select-directory"),
    selectFile: (filters) => ipcRenderer.invoke("system:select-file", filters),
    saveFileDialog: (defaultName) => ipcRenderer.invoke("system:save-file-dialog", defaultName)
  },
  onDeckRunProgress: (callback) => {
    const handler = (_e, event) => {
      callback(event);
    };
    ipcRenderer.on("deck:run-progress", handler);
    return () => {
      ipcRenderer.removeListener("deck:run-progress", handler);
    };
  }
};
contextBridge.exposeInMainWorld("api", api);

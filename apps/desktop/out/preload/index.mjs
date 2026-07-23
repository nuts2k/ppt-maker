import { contextBridge, ipcRenderer } from "electron";
const api = {
  deck: {
    open: (path) => ipcRenderer.invoke("deck:open", path),
    create: (imagesDir, workspacePath, name) => ipcRenderer.invoke("deck:create", imagesDir, workspacePath, name),
    status: (path) => ipcRenderer.invoke("deck:status", path),
    export: (deckPath, outputPath, strict) => ipcRenderer.invoke("deck:export", deckPath, outputPath, strict),
    addSlide: (deckPath, imagePath) => ipcRenderer.invoke("deck:add-slide", deckPath, imagePath),
    removeSlide: (deckPath, pageLabel) => ipcRenderer.invoke("deck:remove-slide", deckPath, pageLabel)
  },
  slide: {
    loadReview: (workspacePath) => ipcRenderer.invoke("slide:load-review", workspacePath),
    saveReview: (workspacePath, document) => ipcRenderer.invoke("slide:save-review", workspacePath, document),
    run: (workspacePath, from, opts) => ipcRenderer.invoke("slide:run", workspacePath, from, opts),
    acceptClean: (workspacePath, opts) => ipcRenderer.invoke("slide:accept-clean", workspacePath, opts),
    acceptPptx: (workspacePath, opts) => ipcRenderer.invoke("slide:accept-pptx", workspacePath, opts),
    loadImage: (workspacePath, role) => ipcRenderer.invoke("slide:load-image", workspacePath, role)
  },
  system: {
    doctor: () => ipcRenderer.invoke("system:doctor"),
    selectDirectory: () => ipcRenderer.invoke("system:select-directory"),
    selectFile: (filters) => ipcRenderer.invoke("system:select-file", filters),
    saveFileDialog: (defaultName) => ipcRenderer.invoke("system:save-file-dialog", defaultName)
  },
  onPipelineProgress: (callback) => {
    const handler = (_e, event) => {
      callback(event);
    };
    ipcRenderer.on("pipeline:progress", handler);
    return () => {
      ipcRenderer.removeListener("pipeline:progress", handler);
    };
  }
};
contextBridge.exposeInMainWorld("api", api);

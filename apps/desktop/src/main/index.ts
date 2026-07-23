import { join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { app, BrowserWindow } from "electron";
import { registerDeckHandlers } from "./ipc/deck.js";
import { registerSlideHandlers } from "./ipc/slide.js";
import { registerSystemHandlers } from "./ipc/system.js";

// Electron cwd 是 apps/desktop/，CLI 函数需要项目根目录
const projectRoot = resolve(app.getAppPath(), "../..");
process.chdir(projectRoot);
loadDotenv({ path: resolve(projectRoot, ".env") });

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  registerSystemHandlers(mainWindow);
  registerDeckHandlers(mainWindow);
  registerSlideHandlers(mainWindow);

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

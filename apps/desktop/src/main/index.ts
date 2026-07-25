import { join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { app, BrowserWindow } from "electron";
import { ActivityLog } from "./activity-log.js";
import { registerActivityHandlers } from "./ipc/activity.js";
import { registerDeckHandlers } from "./ipc/deck.js";
import { registerSlideHandlers } from "./ipc/slide.js";
import { registerSystemHandlers } from "./ipc/system.js";
import { DeckRunner } from "./runner/deck-runner.js";

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

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  return mainWindow;
}

app.whenReady().then(() => {
  const activityLog = new ActivityLog(
    join(app.getPath("userData"), "activity"),
  );
  // IPC 与 runner 只注册一次：macOS 下窗口关闭后 activate 会重建窗口，
  // 若在 createWindow 内注册会触发 ipcMain.handle 重复注册报错。
  const runner = new DeckRunner(
    () => BrowserWindow.getAllWindows()[0] ?? null,
    activityLog,
  );

  registerSystemHandlers();
  registerDeckHandlers(runner, activityLog);
  registerSlideHandlers(activityLog);
  registerActivityHandlers(activityLog);

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

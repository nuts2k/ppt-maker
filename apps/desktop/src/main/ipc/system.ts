import { collectSystemDoctorReport } from "@cli/doctor.js";
import { type BrowserWindow, dialog, ipcMain } from "electron";
import type { DoctorReport } from "./channels.js";

export function registerSystemHandlers(_mainWindow: BrowserWindow): void {
  ipcMain.handle("system:doctor", (): DoctorReport => {
    const report = collectSystemDoctorReport();
    return {
      checks: report.checks.map((c) => ({
        id: c.id,
        label: c.label,
        status: c.status,
        message: c.message,
      })),
      summary: report.summary,
    };
  });

  ipcMain.handle(
    "system:select-directory",
    async (): Promise<string | null> => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0] ?? null;
    },
  );

  ipcMain.handle(
    "system:select-file",
    async (_event, filters?: Electron.FileFilter[]): Promise<string | null> => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: filters ?? [
          { name: "图片", extensions: ["png", "jpg", "jpeg"] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0] ?? null;
    },
  );

  ipcMain.handle(
    "system:save-file-dialog",
    async (_event, defaultName: string): Promise<string | null> => {
      const result = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: "PowerPoint", extensions: ["pptx"] }],
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      return result.filePath;
    },
  );
}

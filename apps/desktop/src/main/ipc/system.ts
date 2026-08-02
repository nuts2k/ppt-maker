import { collectSystemDoctorReport } from "@cli/doctor.js";
import { dialog, ipcMain } from "electron";
import type { DoctorReport } from "./channels.js";

export function registerSystemHandlers(): void {
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
    "system:select-files",
    async (
      _event,
      filters?: Electron.FileFilter[],
    ): Promise<readonly string[]> => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile", "multiSelections"],
        filters: filters ?? [
          { name: "图片", extensions: ["png", "jpg", "jpeg"] },
        ],
      });
      // 取消返回空数组，与「一张都没选」在调用方看来是同一件事：都不该建页
      return result.canceled ? [] : result.filePaths;
    },
  );

  /**
   * 原生确认框（E3）。
   *
   * 付费且不可撤销的批量动作用它，而不是页面内一个可以被顺手点掉的按钮：
   * 原生框会夺走窗口焦点，误触的代价与「点错一个按钮」不在一个量级。
   * `cancelId` 指向取消项，Esc 与关闭窗口都归为取消。
   */
  ipcMain.handle(
    "system:confirm",
    async (
      _event,
      options: {
        title: string;
        message: string;
        detail?: string;
        confirmLabel: string;
      },
    ): Promise<boolean> => {
      const result = await dialog.showMessageBox({
        type: "warning",
        title: options.title,
        message: options.message,
        ...(options.detail === undefined ? {} : { detail: options.detail }),
        buttons: [options.confirmLabel, "取消"],
        defaultId: 1,
        cancelId: 1,
      });
      return result.response === 0;
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

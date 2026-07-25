import { ipcMain } from "electron";
import type { ActivityLog } from "../activity-log.js";
import { resolveDeckId } from "../deck-context.js";
import type { ActivityRecord } from "./channels.js";

export function registerActivityHandlers(activityLog: ActivityLog): void {
  ipcMain.handle(
    "activity:list",
    async (
      _event,
      deckPath: string,
      limit?: number,
    ): Promise<ActivityRecord[]> => {
      try {
        const deckId = await resolveDeckId(deckPath);
        return await activityLog.list(deckId, limit ?? 200);
      } catch {
        return [];
      }
    },
  );
}

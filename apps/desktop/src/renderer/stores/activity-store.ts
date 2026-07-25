import { create } from "zustand";
import type { ActivityRecord } from "../../main/ipc/channels.js";

/**
 * 活动日志 store：持有倒序记录列表（最新在前）。
 *
 * 权威来源约定：**日志以 main 落盘的 jsonl 为准**。main 在广播
 * `deck:run-progress` 的同时已把同一条事件写入 userData jsonl，
 * 因此 `append` 只是执行过程中的即时反馈（乐观追加）。
 * 调用方（run-store 的 run-done 处理）应在一轮执行结束后重新 `load()`，
 * 用落盘结果整体覆盖本地追加的记录，避免时序/文案漂移。
 *
 * 本 store **不订阅任何 IPC**：`onDeckRunProgress` 的订阅统一由 run-store 持有，
 * 再调用本 store 的 `append`，避免同一通道被双重订阅。
 */
interface ActivityState {
  /** 倒序（最新在前），与 `activity:list` 的返回顺序一致 */
  records: ActivityRecord[];
  loading: boolean;
  error: string | null;

  load(deckPath: string, limit?: number): Promise<void>;
  append(record: ActivityRecord): void;
  reset(): void;
}

export const useActivityStore = create<ActivityState>((set) => ({
  records: [],
  loading: false,
  error: null,

  async load(deckPath, limit) {
    set({ loading: true, error: null });
    try {
      const records = await window.api.activity.list(deckPath, limit);
      set({ records, loading: false });
    } catch (err) {
      set({ loading: false, error: toMessage(err) });
      throw err;
    }
  },

  append(record) {
    set((state) => ({ records: [record, ...state.records] }));
  },

  reset() {
    set({ records: [], loading: false, error: null });
  },
}));

export type { ActivityState };

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

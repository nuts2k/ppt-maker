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

/**
 * 请求序号：本 store 不持有 deckPath，无从比对身份，改用「最后一次请求 wins」。
 * 切换工作区后旧 deck 的列表请求会带着过期序号返回，直接丢弃——否则迟到的响应
 * 会把上一个 deck 的日志贴到新 deck 的抽屉里，且毫无提示。
 * 不 import deck-store 取 deckPath 比对，是不想为一句守卫把日志层耦合到 deck 层。
 */
let listSeq = 0;

export const useActivityStore = create<ActivityState>((set) => ({
  records: [],
  loading: false,
  error: null,

  async load(deckPath, limit) {
    const seq = ++listSeq;
    set({ loading: true, error: null });
    try {
      const records = await window.api.activity.list(deckPath, limit);
      if (seq !== listSeq) return;
      set({ records, loading: false });
    } catch (err) {
      // 迟到的失败同样不写：错误属于用户已经离开的那个 deck
      if (seq === listSeq) set({ loading: false, error: toMessage(err) });
      throw err;
    }
  },

  append(record) {
    set((state) => ({ records: [record, ...state.records] }));
  },

  reset() {
    // 一并作废在途请求：切换工作区后新 deck 的 load 由 ConsolePage 的 effect 发出，
    // 中间这段空档里旧 deck 的响应若落地，日志抽屉会闪一下上一个 deck 的记录
    listSeq += 1;
    set({ records: [], loading: false, error: null });
  },
}));

export type { ActivityState };

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

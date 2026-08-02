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
  /**
   * 清空日志。
   *
   * `nextDeckPath` 是「清完之后当前是哪个 deck」：为它发出的在途请求**不作废**，
   * 其余一律作废。切换工作区时调用方必须把新 deck 的路径传进来（见下方注释），
   * 离开 deck 回空态时传 null（默认）。
   */
  reset(nextDeckPath?: string | null): void;
}

/**
 * 在途请求的身份：**序号管顺序，路径管归属**，两者缺一不可。
 *
 * 只有序号时，`reset()` 想作废「上一个 deck 的在途请求」就只能整体 +1，于是会连坐
 * 掉已经为**新** deck 发出的那一个——切换工作区的真实时序正是
 * `openDeck 落 deckPath → ConsolePage effect 发 load(新) → resetOtherStores()`，
 * 顺序无法靠调用方摆平（effect 什么时候被 React 冲刷不由切换代码决定）。
 * 表现是切完 deck 日志抽屉恒为「暂无记录」，而磁盘上记录好好的，且没有任何报错。
 *
 * 因此改为：响应落地前既要是最后一次请求，也要属于当前这个 deck。
 */
let listSeq = 0;
let currentPath: string | null = null;

export const useActivityStore = create<ActivityState>((set) => ({
  records: [],
  loading: false,
  error: null,

  async load(deckPath, limit) {
    const seq = ++listSeq;
    currentPath = deckPath;
    set({ loading: true, error: null });
    try {
      const records = await window.api.activity.list(deckPath, limit);
      if (seq !== listSeq || currentPath !== deckPath) return;
      set({ records, loading: false });
    } catch (err) {
      // 迟到的失败同样不写：错误属于用户已经离开的那个 deck
      if (seq === listSeq && currentPath === deckPath) {
        set({ loading: false, error: toMessage(err) });
      }
      throw err;
    }
  },

  append(record) {
    set((state) => ({ records: [record, ...state.records] }));
  },

  reset(nextDeckPath = null) {
    // 作废「不属于 nextDeckPath」的在途请求：旧 deck 的响应若落地，日志抽屉会闪
    // 一下上一个 deck 的记录；但已经为新 deck 发出的那一个必须放行，否则它被丢掉
    // 之后没有任何东西会再发一次，抽屉就永远空着。
    currentPath = nextDeckPath;
    set({ records: [], loading: false, error: null });
  },
}));

export type { ActivityState };

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

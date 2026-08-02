import { create } from "zustand";
import type {
  SourceTaskProgress,
  SourceTaskRequest,
  SourceTaskResult,
} from "../../main/ipc/channels.js";
import {
  runSourceTask,
  type SourceTaskDeps,
  type SourceTaskTarget,
} from "../lib/source-task-core.js";

/**
 * 建页任务态 store —— 订阅 main 的 `deck:source-task-progress`。
 *
 * 与 run-store 分开是刻意的（design §4.1）：`DeckRunner` 的队列单元是 slide，
 * 而建页任务执行时 slide 还不存在。合成一个要给 runner 加一类没有 slideId 的
 * 队列项，污染它现有的 `page-done` / `stage-start` 事件语义。
 *
 * 编排规则（含竞态守卫）在 `lib/source-task-core.ts`，本文件只做「绑到真实 store」。
 */
interface SourceTaskState {
  running: boolean;
  kind: SourceTaskProgress["kind"] | null;
  index: number;
  total: number;
  message: string;
  error: string | null;
  /** 最近一次完成的结果；完成面板（抽取报告 / 生成结果）据此呈现 */
  lastResult: SourceTaskResult | null;

  subscribe(): () => void;
  run(
    target: SourceTaskTarget,
    request: SourceTaskRequest,
  ): Promise<SourceTaskResult | null>;
  /** 关掉完成面板 */
  dismissResult(): void;
  /**
   * 切换工作区时清掉**与那个 deck 绑定的**残留：错误条、完成面板与进度文字。
   *
   * `running` 不清：它照的是 main 侧那个进程级单例（`SourceTaskRunner.running`），
   * 与用户正看哪个 deck 无关。清成 false 会让互斥的界面一半凭空放行，而 main 那边
   * 照样会拒——用户点下去才发现不行。
   */
  reset(): void;
}

const IDLE = {
  running: false,
  kind: null,
  index: 0,
  total: 0,
  message: "",
  error: null,
  lastResult: null,
} as const;

/**
 * store 之外持有依赖注入点：`lib/workspace-switch` 会 import 本 store 之外的
 * 四个 store，直接在这里 import 它会绕成循环依赖。由 `installSourceTaskDeps`
 * 在应用启动时注入，测试里则直接测 `runSourceTask` 纯函数。
 */
let deps: SourceTaskDeps | null = null;

export function installSourceTaskDeps(next: SourceTaskDeps): void {
  deps = next;
}

export const useSourceTaskStore = create<SourceTaskState>((set) => ({
  ...IDLE,

  subscribe() {
    return window.api.onSourceTaskProgress((event) => {
      set({
        running: event.phase !== "done" && event.phase !== "failed",
        kind: event.kind,
        index: event.index,
        total: event.total,
        message: event.message,
      });
    });
  },

  async run(target, request) {
    if (deps === null) {
      set({ error: "建页任务尚未接线" });
      return null;
    }
    set({
      running: true,
      kind: request.kind,
      error: null,
      lastResult: null,
      message: "",
    });
    try {
      const result = await runSourceTask(deps, target, request);
      /*
       * 结果落地后**补写一次 kind**。
       *
       * 完成面板的判据是 `kind === "generate" && lastResult`，两者看似同源，实则由
       * 两次不同的写入产生：`kind` 来自进度事件（或上面这次预置），`lastResult` 来自
       * 编排收尾。新建场景中间夹着 `switchWorkspace`，它会清掉 deck 级会话态、
       * 连 `kind` 一起清走，于是面板判据只剩一半，整块面板与它上面的「去确认」都不出现
       * （走查实测）。补这一次写入让两半重新同源。
       *
       * 结果被丢弃（切了工作区）时不补：那次任务的种类不属于当前这个 deck。
       */
      if (result !== null) set({ kind: request.kind });
      return result;
    } finally {
      // 事件里的 done/failed 通常已经把 running 落回 false；这里兜底覆盖
      // 「被互斥挡下、一个进度事件都没发」的路径，否则界面会永远停在执行中。
      set({ running: false });
    }
  },

  dismissResult() {
    set({ lastResult: null });
  },

  reset() {
    const { running: _running, ...deckScoped } = IDLE;
    set(deckScoped);
  },
}));

/** 组件订阅用：建页任务在跑时流水线入口一律禁用（互斥的界面一半） */
export function selectSourceTaskRunning(state: SourceTaskState): boolean {
  return state.running;
}

export type { SourceTaskState };

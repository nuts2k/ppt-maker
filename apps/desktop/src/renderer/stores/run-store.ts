import type { RunStage } from "@shared/stages";
import { create } from "zustand";
import { getApi } from "@/lib/ipc-client";
import type {
  DeckRunEvent,
  DeckRunStartOptions,
} from "../../main/ipc/channels.js";
import {
  applyRunEvent,
  createRunSnapshot,
  withoutSlideLiveStages,
} from "./run-reducer.js";
import type { RunSnapshot } from "./run-types.js";

/**
 * 执行态 store —— 订阅 main 进程 DeckRunner 的 `deck:run-progress`，
 * 用 `applyRunEvent` 纯函数推进快照。
 *
 * 与 V1 pipeline-store 的关键差异：
 * - 不再用 Promise 包裹整轮执行；`runStart` 只表示"已排队"，进度全靠事件。
 * - 快照按 slideId 分桶，批量执行时切页不再串味。
 * - 计时只存 `stageStartedAt`，由 1s ticker 递增 `tick` 触发重渲染，不存增量。
 */

/** 启动执行时的上传/调用确认（PRD F2.1，由 UI 在启动前显式勾选） */
export interface RunConfirmOptions {
  readonly confirmApi?: boolean;
  readonly confirmUpload?: boolean;
}

interface RunState extends RunSnapshot {
  /** 1s ticker 计数，仅用于触发依赖耗时展示的组件重渲染 */
  tick: number;
  /** runStart 被拒绝或抛错时的提示；成功启动时清空 */
  startError: string | null;

  /**
   * 挂载 IPC 订阅；`onEvent` 用于把同一批事件转交给其它 store（deck 增量刷新、
   * 活动日志追加）。本 store 是 `deck:run-progress` 的**唯一**订阅方，其它 store
   * 一律经此回调联动，避免同一通道被重复订阅。
   */
  subscribe(onEvent?: (event: DeckRunEvent) => void): () => void;
  runAll(deckPath: string, opts?: RunConfirmOptions): Promise<void>;
  runSlide(
    deckPath: string,
    slideId: string,
    from?: RunStage,
    opts?: RunConfirmOptions,
  ): Promise<void>;
  stop(): Promise<void>;
  /** 清除某页的会话层结果（验收完成后收起闸门提示） */
  clearSessionResult(slideId: string): void;
  /**
   * 丢弃某页的会话层阶段状态，让轨道回落到 manifest 耐久层。
   * 人工失效阶段后必须调用，否则界面被上一轮 run 的 completed 盖住 stale。
   */
  clearLiveStages(slideId: string): void;
  reset(): void;
}

// ticker 是进程级副作用，不属于渲染状态，因此放在 store 之外持有
let tickerHandle: ReturnType<typeof setInterval> | null = null;

function startTicker(): void {
  if (tickerHandle !== null) return;
  tickerHandle = setInterval(() => {
    useRunStore.setState((state) => ({ tick: state.tick + 1 }));
  }, 1000);
}

function stopTicker(): void {
  if (tickerHandle === null) return;
  clearInterval(tickerHandle);
  tickerHandle = null;
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 组装 DeckRunStartOptions：exactOptionalPropertyTypes 下可选字段必须条件展开 */
function buildStartOptions(
  slideIds: readonly string[] | null,
  from: RunStage | undefined,
  opts: RunConfirmOptions | undefined,
): DeckRunStartOptions {
  return {
    ...(slideIds !== null ? { slideIds } : {}),
    ...(from !== undefined ? { from } : {}),
    ...(opts?.confirmApi !== undefined ? { confirmApi: opts.confirmApi } : {}),
    ...(opts?.confirmUpload !== undefined
      ? { confirmUpload: opts.confirmUpload }
      : {}),
  };
}

export const useRunStore = create<RunState>((set, get) => ({
  ...createRunSnapshot(),
  tick: 0,
  startError: null,

  subscribe(onEvent) {
    const detach = getApi().onDeckRunProgress((event) => {
      const state = get();
      const next = applyRunEvent(
        {
          status: state.status,
          total: state.total,
          doneCount: state.doneCount,
          currentSlideId: state.currentSlideId,
          currentPageLabel: state.currentPageLabel,
          currentIndex: state.currentIndex,
          currentStage: state.currentStage,
          stageStartedAt: state.stageStartedAt,
          liveStages: state.liveStages,
          sessionResults: state.sessionResults,
          lastSummary: state.lastSummary,
        },
        event,
        Date.now(),
      );
      set(next);
      // 只在有 run 在跑时空转 ticker
      if (next.status === "idle") {
        stopTicker();
      } else {
        startTicker();
      }
      onEvent?.(event);
    });

    return () => {
      detach();
      stopTicker();
    };
  },

  async runAll(deckPath, opts) {
    await requestStart(set, deckPath, buildStartOptions(null, undefined, opts));
  },

  async runSlide(deckPath, slideId, from, opts) {
    await requestStart(set, deckPath, buildStartOptions([slideId], from, opts));
  },

  async stop() {
    try {
      await getApi().deck.runStop();
    } catch (err) {
      set({ startError: toMessage(err) });
    }
  },

  clearSessionResult(slideId) {
    set((state) => {
      if (state.sessionResults[slideId] === undefined) return state;
      const next = { ...state.sessionResults };
      delete next[slideId];
      return { sessionResults: next };
    });
  },

  clearLiveStages(slideId) {
    set((state) => ({
      liveStages: withoutSlideLiveStages(state.liveStages, slideId),
    }));
  },

  reset() {
    stopTicker();
    set({ ...createRunSnapshot(), tick: 0, startError: null });
  },
}));

/**
 * 发起 runStart。只等待"是否受理"，不等待整轮执行完成——
 * 后续进度一律通过 `deck:run-progress` 事件到达。
 */
async function requestStart(
  set: (partial: Partial<RunState>) => void,
  deckPath: string,
  options: DeckRunStartOptions,
): Promise<void> {
  set({ startError: null });
  try {
    const result = await getApi().deck.runStart(deckPath, options);
    if (!result.accepted) {
      set({ startError: result.message });
    }
  } catch (err) {
    set({ startError: toMessage(err) });
  }
}

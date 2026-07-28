/**
 * DeckRunEvent → RunSnapshot 的纯函数推进器。
 *
 * 把"执行态怎么变"从 zustand store 里剥离出来，使其可在 node 环境下直接单测；
 * store 只负责订阅 IPC、持有快照与驱动 ticker。
 *
 * 与 run-types.ts 一样使用相对 `.js` 导入（不走 `@/` / `@shared` alias），
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node NodeNext）解析。
 */

import type { DeckRunEvent } from "../../main/ipc/channels.js";
import type { RunStage } from "../../shared/stages.js";
import type {
  LiveStageMap,
  LiveStageStatus,
  RunSnapshot,
} from "./run-types.js";

/** 初始快照：无 run 在跑，无任何历史 */
export function createRunSnapshot(): RunSnapshot {
  return {
    status: "idle",
    total: 0,
    doneCount: 0,
    currentSlideId: null,
    currentPageLabel: null,
    currentIndex: 0,
    currentStage: null,
    stageStartedAt: null,
    liveStages: {},
    sessionResults: {},
    lastSummary: null,
  };
}

/**
 * 按事件推进快照，永远返回全新对象，不修改入参。
 *
 * `nowMs` 由调用方注入（store 传 `Date.now()`，测试传固定值），
 * 用于记录阶段开始时刻——快照不存累计耗时，只存起点，由 ticker 触发重算。
 */
export function applyRunEvent(
  snapshot: RunSnapshot,
  event: DeckRunEvent,
  nowMs: number,
): RunSnapshot {
  switch (event.kind) {
    case "run-start":
      // 新一轮 run 清空上一轮的会话层数据（liveStages / sessionResults / lastSummary），
      // 耐久层状态由 deck-store 从 manifest 提供，不受影响。
      return {
        ...createRunSnapshot(),
        status: "running",
        total: event.total,
      };

    case "page-start":
      // DeckRunner 的 index 来自 processedCount，自 1 起递增（1-based）；
      // total 会随运行中追加入队而增大，因此每页都以事件值为准刷新。
      return {
        ...snapshot,
        status: snapshot.status === "idle" ? "running" : snapshot.status,
        total: event.total,
        currentSlideId: event.slideId,
        currentPageLabel: event.pageLabel,
        currentIndex: event.index,
        currentStage: null,
        stageStartedAt: null,
      };

    case "stage-start":
      return {
        ...snapshot,
        currentSlideId: event.slideId,
        currentStage: event.stage,
        stageStartedAt: nowMs,
        liveStages: withLiveStage(
          snapshot.liveStages,
          event.slideId,
          event.stage,
          "running",
        ),
      };

    case "stage-complete":
      return {
        ...snapshot,
        currentStage: null,
        stageStartedAt: null,
        liveStages: withLiveStage(
          snapshot.liveStages,
          event.slideId,
          event.stage,
          "completed",
        ),
      };

    case "page-done":
      // 保留 currentIndex，使"第 N/M 页"在页间空档仍然连续；
      // 其余当前页字段清空，避免残留到下一页。
      return {
        ...snapshot,
        doneCount: snapshot.doneCount + 1,
        currentSlideId: null,
        currentPageLabel: null,
        currentStage: null,
        stageStartedAt: null,
        sessionResults: {
          ...snapshot.sessionResults,
          [event.slideId]: {
            slideId: event.slideId,
            gate: event.gate,
            stoppedAt: event.stoppedAt,
            message: event.message,
            error: event.error,
          },
        },
      };

    case "run-stopping":
      return { ...snapshot, status: "stopping" };

    case "run-done":
      // liveStages 与 sessionResults 保留：卡片轨道与待办队列要展示本轮结果。
      return {
        ...snapshot,
        status: "idle",
        currentSlideId: null,
        currentPageLabel: null,
        currentIndex: 0,
        currentStage: null,
        stageStartedAt: null,
        lastSummary: event.summary,
      };
  }
}

/** 当前阶段已用毫秒；无进行中阶段时返回 null */
export function elapsedMs(snapshot: RunSnapshot, nowMs: number): number | null {
  if (snapshot.stageStartedAt === null) return null;
  return Math.max(0, nowMs - snapshot.stageStartedAt);
}

function withLiveStage(
  liveStages: Readonly<Record<string, LiveStageMap>>,
  slideId: string,
  stage: RunStage,
  status: LiveStageStatus,
): Readonly<Record<string, LiveStageMap>> {
  const current: LiveStageMap = liveStages[slideId] ?? {};
  return {
    ...liveStages,
    [slideId]: { ...current, [stage]: status },
  };
}

/**
 * 丢弃某页的会话层阶段状态，让该页的展示回落到 manifest 耐久层。
 *
 * `deriveStageViews` 是「耐久层打底、会话层覆盖」，而 `run-done` 会**保留**
 * `liveStages`（卡片轨道要展示本轮结果）。于是人工失效阶段后，磁盘已是 stale，
 * 界面却仍被上一轮 run 留下的 completed 盖着——2026-07-27 E1 走查实测：点「回到
 * 文本复核」后 mask 及下游六个阶段全部转 stale，阶段轨道却一片绿。
 *
 * `rerunFrom` 没暴露这个问题只是因为它立即启动 run，新的 stage-start 事件会马上
 * 覆盖旧值；不重跑的失效路径就一直挂着旧状态。
 */
export function withoutSlideLiveStages(
  liveStages: Readonly<Record<string, LiveStageMap>>,
  slideId: string,
): Readonly<Record<string, LiveStageMap>> {
  if (liveStages[slideId] === undefined) return liveStages;
  const next = { ...liveStages };
  delete next[slideId];
  return next;
}

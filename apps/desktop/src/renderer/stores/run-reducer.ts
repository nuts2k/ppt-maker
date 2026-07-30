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
        liveStages: withoutRunningLiveStages(
          snapshot.liveStages,
          event.slideId,
        ),
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
 * 一页收尾时撤掉所有仍挂在 `running` 的阶段，让它们回落到 manifest 耐久层。
 *
 * `stage-start` 与 `stage-complete` 并不成对：`runSlideRunFrom` 只在阶段**真的
 * 执行过**时回调 `onStageComplete`，而「起了但没完成」在正常流程里比失败常见得多——
 *
 * - 停人工门：`accept-pptx` 起了就 return `gate: "manual"`；`accept-clean` 更是
 *   刻意空转（design §3.2 把底板验收并进最终确认），两者都没有 complete 回调；
 * - 阶段失败：异常被收敛成 `gate: "error"` 由 `page-done` 带 `stoppedAt` 报出，
 *   同样没有 complete 回调。
 *
 * 会话层覆盖耐久层，于是这些阶段就永远停在「执行中」。2026-07-29 阶段 E 走查实测
 * 两处：clean 连接失败后错误条已写 `clean · UNKNOWN_ERROR`，轨道却还是「生成干净
 * 底图 · 执行中」；跑到最终确认门停下后，磁盘上 accept-clean 是 stale，轨道写的却是
 * 「验收底图 · 执行中」。都与「磁盘 stale、轨道一片绿」同源。
 *
 * `LiveStageStatus` 只有 `running | completed`——失败与失效归耐久层所有，会话层
 * 补不出，只能撤掉这条覆盖。判据用「page-done 时还 running」而不是「是不是失败」：
 * 这一页的执行已经结束，它上面不可能再有任何阶段在跑。同轮 `completed` 的阶段保留，
 * 卡片轨道仍要展示本轮结果。
 */
function withoutRunningLiveStages(
  liveStages: Readonly<Record<string, LiveStageMap>>,
  slideId: string,
): Readonly<Record<string, LiveStageMap>> {
  const current = liveStages[slideId];
  if (current === undefined) return liveStages;
  const entries = Object.entries(current) as [RunStage, LiveStageStatus][];
  const kept = entries.filter(([, status]) => status !== "running");
  if (kept.length === entries.length) return liveStages;
  return {
    ...liveStages,
    [slideId]: Object.fromEntries(kept) as LiveStageMap,
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

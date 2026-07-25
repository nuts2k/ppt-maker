/**
 * 阶段展示派生 —— 卡片轨道、StageRail、执行控制条共用的纯逻辑。
 *
 * 数据来源两层（design.md 3.2）：
 * - **耐久层** `SlideDetail.stages`：manifest 聚合，重启可恢复。
 * - **会话层** `LiveStageMap`：本次 run 的实时阶段状态，覆盖耐久层同名阶段。
 *
 * 状态色为全局唯一约定（design.md 3.3），所有阶段点位一律取 `STAGE_DOT_CLASS`，
 * 组件不得自行拼色，否则轨道、队列、日志三处会出现语义漂移。
 *
 * 与 run-types / todo-queue 一致，本文件使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node NodeNext）解析。
 */

import type { SlideDetail } from "../../main/ipc/channels.js";
import {
  RUN_STAGE_SEQUENCE,
  type RunStage,
  STAGE_LABELS,
} from "../../shared/stages.js";
import type { LiveStageMap } from "../stores/run-types.js";

export type StageViewStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "stale";

export interface StageView {
  readonly stage: RunStage;
  readonly label: string;
  readonly status: StageViewStatus;
}

const KNOWN_STATUSES = new Set<string>([
  "pending",
  "running",
  "completed",
  "failed",
  "interrupted",
  "stale",
]);

/** 状态 → 点位样式（背景 + 描边），design.md 3.3 状态色唯一表 */
export const STAGE_DOT_CLASS: Readonly<Record<StageViewStatus, string>> = {
  completed: "bg-success border-success",
  running: "bg-info border-info animate-pulse",
  failed: "bg-signature-coral border-signature-coral",
  interrupted: "bg-signature-coral border-signature-coral",
  stale: "bg-signature-mustard border-signature-mustard",
  pending: "bg-surface-strong border-hairline",
};

/** 状态 → 中文短名，卡片与轨道 tooltip 共用 */
export const STAGE_STATUS_TEXT: Readonly<Record<StageViewStatus, string>> = {
  completed: "已完成",
  running: "执行中",
  failed: "失败",
  interrupted: "已中断",
  stale: "已失效",
  pending: "待执行",
};

function normalize(status: string | undefined): StageViewStatus {
  if (status !== undefined && KNOWN_STATUSES.has(status)) {
    return status as StageViewStatus;
  }
  return "pending";
}

/**
 * 合并耐久层与会话层，产出执行序列全量（10 阶段）的展示状态。
 * `live` 为空表示该页当前不在本次 run 中，纯以 manifest 呈现。
 */
export function deriveStageViews(
  slide: Pick<SlideDetail, "stages">,
  live: LiveStageMap | undefined,
): StageView[] {
  const merged = new Map<string, StageViewStatus>();
  for (const detail of slide.stages) {
    merged.set(detail.stage, normalize(detail.status));
  }
  for (const [stage, status] of Object.entries(live ?? {})) {
    if (status !== undefined) merged.set(stage, status);
  }

  return RUN_STAGE_SEQUENCE.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    status: merged.get(stage) ?? "pending",
  }));
}

/**
 * 当前阶段：优先取正在执行的阶段；否则取第一个未完成阶段（= 断点续跑的起点）。
 * 全部完成时返回 null，调用方据此显示"已完成"。
 */
export function currentStageView(
  views: readonly StageView[],
): StageView | null {
  return (
    views.find((view) => view.status === "running") ??
    views.find((view) => view.status !== "completed") ??
    null
  );
}

/** 已完成阶段数，用于卡片"3/10"与进度条 */
export function completedStageCount(views: readonly StageView[]): number {
  return views.filter((view) => view.status === "completed").length;
}

/** 该页是否处于需要用户处理的失败态（含中断/失效） */
export function hasFailingStage(views: readonly StageView[]): boolean {
  return views.some(
    (view) =>
      view.status === "failed" ||
      view.status === "interrupted" ||
      view.status === "stale",
  );
}

/**
 * 计时文案：`42s` / `1m20s`。用于"已用 42s"这类实时耗时展示，
 * 与活动日志的 `formatDuration`（带毫秒档）分工不同——阶段计时不展示毫秒。
 */
export function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m${seconds % 60}s`;
}

/** 阶段开始时刻 → 已用时长文案；`startedAt` 为 null 时返回 null */
export function elapsedSince(
  startedAt: number | null,
  now: number,
): string | null {
  if (startedAt === null) return null;
  return formatElapsed(now - startedAt);
}

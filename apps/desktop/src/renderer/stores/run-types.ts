/**
 * 执行态（run）相关的共享类型定义 —— run-store 与待办队列派生共用。
 *
 * 区分两层数据来源（design.md 3.2）：
 * - **耐久层**：manifest 聚合而来的 `SlideDetail`，由 deck-store 持有，重启可恢复。
 * - **会话层**：本文件的 `SessionRunResult` / `RunSnapshot`，仅存活于本次进程，
 *   用于表达 manifest 无法区分的态（如 validate-review 失败）与实时计时。
 *
 * 本文件与 run-reducer / todo-queue 一样使用相对 `.js` 导入，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node）解析。
 */

import type { DeckRunSummary } from "../../main/ipc/channels.js";
import type { RunStage } from "../../shared/stages.js";

/** DeckRunner 状态机在 renderer 侧的镜像 */
export type RunStatus = "idle" | "running" | "stopping";

/** 本次 run 内单个阶段的实时状态（耐久状态另见 SlideDetail.stages） */
export type LiveStageStatus = "running" | "completed";

/** 单页在本次 run 中的收尾结果，来自 page-done 事件 */
export interface SessionRunResult {
  readonly slideId: string;
  /** DeckRunner 给出的闸门标识，如 "manual" / "validation-failed"；null 表示未被拦截 */
  readonly gate: string | null;
  /** 停在哪个阶段；gate 为 manual 时即待验收阶段名 */
  readonly stoppedAt: string | null;
  readonly message: string;
  readonly error: { readonly code: string; readonly message: string } | null;
}

/** 单页在本次 run 中的实时阶段状态表 */
export type LiveStageMap = Readonly<Partial<Record<RunStage, LiveStageStatus>>>;

/**
 * run 执行态快照 —— 由 `applyRunEvent` 纯函数推进，store 只负责持有与广播。
 * 计时不存增量，只存 `stageStartedAt`（epoch ms），由 ticker 触发重算。
 */
export interface RunSnapshot {
  readonly status: RunStatus;
  /** 本次 run 入队总页数 */
  readonly total: number;
  /** 已收到 page-done 的页数 */
  readonly doneCount: number;
  readonly currentSlideId: string | null;
  readonly currentPageLabel: string | null;
  /** 当前页序号（1-based，0 表示未开始） */
  readonly currentIndex: number;
  readonly currentStage: RunStage | null;
  /** 当前阶段开始时刻（epoch ms），null 表示无进行中的阶段 */
  readonly stageStartedAt: number | null;
  /** slideId -> 本次 run 的实时阶段状态 */
  readonly liveStages: Readonly<Record<string, LiveStageMap>>;
  /** slideId -> 本次 run 的收尾结果 */
  readonly sessionResults: Readonly<Record<string, SessionRunResult>>;
  /** 最近一次 run-done 的汇总；null 表示本次会话尚未跑完过 */
  readonly lastSummary: DeckRunSummary | null;
}

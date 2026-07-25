/**
 * 执行事件的跨 store 分发（design.md 4 数据流）。
 *
 * `deck:run-progress` 只被 run-store 订阅一次，事件经由本函数扇出到耐久层与日志层。
 * 抽成纯函数（依赖全部由参数注入）是为了能在 node 环境直接单测——V1 的核心缺陷
 * 正是"执行完了界面状态不刷新"，这段接线必须有回归保护。
 *
 * 与 run-types 一致使用相对 `.js` 导入，保证 renderer（vite）与 vitest 都能解析。
 */

import type { ActivityRecord, DeckRunEvent } from "../../main/ipc/channels.js";
import { runEventToActivity } from "./activity-format.js";

export interface RunBridgeDeps {
  /** 用于把 slideId 补成可读页名（事件本身只在 page-start 携带 pageLabel） */
  pageLabelOf(slideId: string): string | null;
  appendActivity(record: ActivityRecord): void;
  /** 单页耐久态增量刷新（阶段轨道/最近失败/耗时来自 manifest） */
  refreshSlide(slideId: string): Promise<void>;
  /** 整轮结束后的 deck 全量刷新 */
  refreshDeck(): Promise<void>;
  /** 整轮结束后用 main 落盘的 jsonl 覆盖本地乐观追加的记录 */
  reloadActivity(): Promise<void>;
}

/**
 * 分发单个事件。
 *
 * 刷新失败不向上抛出：耐久态刷新只是展示层的补偿，不应打断执行流水，
 * 错误由各 store 自身的 error 字段承载。
 */
export function dispatchRunEvent(
  event: DeckRunEvent,
  deps: RunBridgeDeps,
): void {
  const record = runEventToActivity(event, {
    pageLabelOf: deps.pageLabelOf,
  });
  if (record !== null) deps.appendActivity(record);

  if (event.kind === "page-done") {
    void deps.refreshSlide(event.slideId).catch(() => undefined);
    return;
  }

  if (event.kind === "run-done") {
    void deps.refreshDeck().catch(() => undefined);
    void deps.reloadActivity().catch(() => undefined);
  }
}

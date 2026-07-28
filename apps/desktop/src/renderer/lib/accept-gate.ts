/**
 * 最终确认闸门判定 —— 单页确认页与待办队列共用的唯一判据。
 *
 * 链路收敛后（PRD D1）人工停点只剩两个：前段的文本复核门与末尾的最终产物确认。
 * `accept-clean` 不再单独停顿，本文件也随之从「两个验收阶段」收敛为单一闸门。
 *
 * 判定仍然是两层合并，这条教训依旧成立：V1 只认会话层
 * `SessionRunResult.gate === "manual"`，重启后待办队列里的项点进去打不开验收面板——
 * 耐久层明明有 `pptx completed` 而 `accept-pptx` 未完成。因此：
 *
 * - **会话层**：本次 run 刚停在人工闸门（`gate === "manual"`，此后只对应最终确认），
 *   即便耐久层写入时序尚未反映出来也能立即进入确认布局。
 * - **耐久层**：manifest 中 `pptx` 已完成、`accept-pptx` 未完成，重启后仍然成立。
 *
 * `todo-queue` 直接复用本文件的 `awaitingFinalConfirm`，避免队列显示「待最终确认」
 * 而页面里打不开确认页这类语义漂移。
 *
 * 与 stage-view / todo-queue 一致使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node，NodeNext）解析。
 */

import type { SlideDetail } from "../../main/ipc/channels.js";
import type { RunStage } from "../../shared/stages.js";
import type { SessionRunResult } from "../stores/run-types.js";

/** 闸门来源：会话层（本次 run 停在此）/ 耐久层（manifest 推导） */
export type FinalGateSource = "session" | "durable";

export interface FinalGate {
  readonly source: FinalGateSource;
}

/** DeckRunner 停在人工闸门时给出的 gate 标识（收敛后只对应最终确认） */
const MANUAL_GATE = "manual";

export function stageStatusOf(
  slide: Pick<SlideDetail, "stages">,
  stage: RunStage,
): string | undefined {
  return slide.stages.find((detail) => detail.stage === stage)?.status;
}

/** PPTX 已产出但最终确认尚未完成（纯耐久层判据） */
export function awaitingFinalConfirm(
  slide: Pick<SlideDetail, "stages">,
): boolean {
  return (
    stageStatusOf(slide, "pptx") === "completed" &&
    stageStatusOf(slide, "accept-pptx") !== "completed"
  );
}

/**
 * 该页是否应进入最终确认；null 表示无待确认事项。
 *
 * 会话层优先——它精确表达「这一轮就停在这里」。
 */
export function deriveFinalGate(
  slide: Pick<SlideDetail, "stages">,
  sessionResult: SessionRunResult | undefined,
): FinalGate | null {
  if (sessionResult?.gate === MANUAL_GATE) {
    return { source: "session" };
  }
  return awaitingFinalConfirm(slide) ? { source: "durable" } : null;
}

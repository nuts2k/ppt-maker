/**
 * 待验收闸门判定 —— 单页验收布局与待办队列共用的唯一判据。
 *
 * V1（以及阶段 B 的过渡实现）只认会话层 `SessionRunResult.gate === "manual"`，
 * 导致重启后待办队列里的"待验收"项点进去无法验收——耐久层明明有 `clean completed`
 * 而 `accept-clean` 未完成。这里把两层合并成单点判定：
 *
 * - **会话层**：本次 run 刚停在某个验收阶段，`stoppedAt` 直接给出目标阶段，最精确。
 * - **耐久层**：manifest 中产出阶段已完成、对应验收阶段未完成，重启后仍然成立。
 *
 * 优先级与 todo-queue 一致：`accept-pptx` 先于 `accept-clean`——越靠后的阶段越接近
 * 完成，用户应先推进更近终点的页。`todo-queue` 直接复用本文件的 `awaitingAcceptance`，
 * 避免队列显示"待验收"而页面里打不开验收面板这类语义漂移。
 *
 * 与 stage-view / todo-queue 一致使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node，NodeNext）解析。
 */

import type { SlideDetail } from "../../main/ipc/channels.js";
import type { RunStage } from "../../shared/stages.js";
import type { SessionRunResult } from "../stores/run-types.js";

/** 两个人工验收闸门 */
export type AcceptStage = "accept-clean" | "accept-pptx";

/** 闸门来源：会话层（本次 run 停在此）/ 耐久层（manifest 推导） */
export type AcceptGateSource = "session" | "durable";

export interface AcceptGate {
  readonly stage: AcceptStage;
  readonly source: AcceptGateSource;
}

/** 判定顺序 = 展示优先级：pptx 先于 clean */
const ACCEPT_STAGE_PRIORITY: readonly AcceptStage[] = [
  "accept-pptx",
  "accept-clean",
];

/** 验收阶段 → 其所验收的产出阶段 */
const PRODUCED_STAGE: Readonly<Record<AcceptStage, RunStage>> = {
  "accept-clean": "clean",
  "accept-pptx": "pptx",
};

/** 拒绝验收后可重跑的起始阶段（越靠前越彻底），供 UI 生成「拒绝并重跑」选项 */
export const REJECT_RERUN_STAGES: Readonly<Record<AcceptStage, RunStage[]>> = {
  "accept-clean": ["mask", "clean"],
  "accept-pptx": ["pptx"],
};

/** DeckRunner 停在人工闸门时给出的 gate 标识 */
const MANUAL_GATE = "manual";

export function isAcceptStage(
  value: string | null | undefined,
): value is AcceptStage {
  return value === "accept-clean" || value === "accept-pptx";
}

export function stageStatusOf(
  slide: Pick<SlideDetail, "stages">,
  stage: RunStage,
): string | undefined {
  return slide.stages.find((detail) => detail.stage === stage)?.status;
}

/** 产出阶段已完成但对应人工验收阶段尚未完成（纯耐久层判据） */
export function awaitingAcceptance(
  slide: Pick<SlideDetail, "stages">,
  acceptStage: AcceptStage,
): boolean {
  return (
    stageStatusOf(slide, PRODUCED_STAGE[acceptStage]) === "completed" &&
    stageStatusOf(slide, acceptStage) !== "completed"
  );
}

/**
 * 该页当前应进入哪个验收闸门；null 表示无待验收事项。
 *
 * 会话层给出的 `stoppedAt` 优先——它精确表达"这一轮就停在这里"，即便耐久层
 * 因为写入时序尚未反映出来也能立即进入验收布局。
 */
export function deriveAcceptGate(
  slide: Pick<SlideDetail, "stages">,
  sessionResult: SessionRunResult | undefined,
): AcceptGate | null {
  if (
    sessionResult?.gate === MANUAL_GATE &&
    isAcceptStage(sessionResult.stoppedAt)
  ) {
    return { stage: sessionResult.stoppedAt, source: "session" };
  }

  for (const stage of ACCEPT_STAGE_PRIORITY) {
    if (awaitingAcceptance(slide, stage)) {
      return { stage, source: "durable" };
    }
  }

  return null;
}

/**
 * 阶段序列与展示名的唯一定义点（main 与 renderer 共用）。
 *
 * 注意区分两组"阶段"：
 * - `RUN_STAGE_SEQUENCE`：CLI `runSlideRunFrom` 的执行序列，含 `validate-review`，不含 `init`。
 *   这是用户可见的流水线轨道，也是断点续跑的判据序列。
 * - core 的 `SlideStage`（manifest.stages）：持久化阶段，含 `init`，**不含** `validate-review`。
 *   `validate-review` 没有耐久记录，其展示状态由下游 `mask` 推断（见 deriveStageStatuses）。
 */

export const RUN_STAGE_SEQUENCE = [
  "ocr",
  "review",
  "assist-review",
  "validate-review",
  "mask",
  "clean",
  "accept-clean",
  "pptx",
  "accept-pptx",
  "report",
] as const;

export type RunStage = (typeof RUN_STAGE_SEQUENCE)[number];

/** 无持久化 manifest 记录的阶段（状态需从相邻阶段推断） */
export const TRANSIENT_STAGES: readonly RunStage[] = ["validate-review"];

/** 阶段展示名（中文），卡片轨道、活动日志、队列共用 */
export const STAGE_LABELS: Readonly<Record<RunStage, string>> = {
  ocr: "文字识别",
  review: "生成复核稿",
  "assist-review": "AI 辅助复核",
  "validate-review": "复核校验",
  mask: "生成遮罩",
  clean: "生成干净底图",
  "accept-clean": "验收底图",
  pptx: "生成 PPTX",
  "accept-pptx": "验收 PPTX",
  report: "生成报告",
};

export function stageLabel(stage: string): string {
  return STAGE_LABELS[stage as RunStage] ?? stage;
}

export function isRunStage(value: string): value is RunStage {
  return (RUN_STAGE_SEQUENCE as readonly string[]).includes(value);
}

export function runStageIndex(stage: string): number {
  return (RUN_STAGE_SEQUENCE as readonly string[]).indexOf(stage);
}

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

/**
 * 瞬态阶段的失效替身：失效它 = 失效其下游第一个持久阶段。
 *
 * `validate-review` 不写 manifest，`invalidateStageAndDownstream` 拿它匹配不到任何
 * `WorkspaceStageState`，会**静默地什么都不失效**并返回空数组。语义上重做文字校验
 * 必然要重做 mask（mask 是 review 之后第一个持久阶段），所以映射到 mask。
 */
const TRANSIENT_INVALIDATION_TARGET: Readonly<
  Partial<Record<RunStage, RunStage>>
> = {
  "validate-review": "mask",
};

/**
 * 把界面点选的阶段翻译成可失效的持久阶段。
 *
 * 2026-07-27 E1 走查实测：点阶段轨道上的「复核校验」节点毫无效果——界面照常切回
 * 复核视图并给出正反馈，manifest 却一字未改，随后的 run 因全部阶段仍 completed
 * 被幂等规则整段跳过，只重跑了 report。根因是 IPC 两侧类型各标各的（renderer 侧
 * `RunStage` 含瞬态阶段、main 侧 `SlideStage` 不含），中间隔着无运行时校验的
 * `ipcRenderer.invoke`，编译期谁也拦不住谁。
 *
 * 未知阶段一律抛错：失效是「强制重做」的唯一入口，静默失败会直接退化成
 * 「点了没反应」，而这正是本轮反复在堵的那类洞。
 */
export function resolveInvalidationTarget(stage: string): RunStage {
  const mapped = TRANSIENT_INVALIDATION_TARGET[stage as RunStage];
  if (mapped !== undefined) return mapped;
  if (!isRunStage(stage)) {
    throw new Error(`无法失效未知阶段：${stage}`);
  }
  if (TRANSIENT_STAGES.includes(stage)) {
    throw new Error(`瞬态阶段 ${stage} 缺少失效替身，无法失效`);
  }
  return stage;
}

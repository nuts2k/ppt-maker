/**
 * 文本复核的分区判据 —— **每一项的标签，不再是列表结构**。
 *
 * 复核工作量的真实构成是「双源分歧」而非块数本身（PRD F-9：离线 OCR 与
 * ai_text_assist 在 57%/58% 的版式文字上不一致），所以每块按「需要看什么」归档：
 *
 * - 文字待确认：双源分歧的 layout_text，要逐字核对文本；
 * - 分类待确认：全部 object_integrated_symbol 与 uncertain，要判断该不该当版式文字
 *   （PRD F-7：被误判为 object_symbol 的文字既不进 mask 也不进 PPTX，会静默漏字）；
 * - 已一致：双源逐字一致的 layout_text。
 *
 * **不得再用它给列表分组**（`partitionBlocks` / `orderedReviewBlocks` 已删除）：
 * 分区键恰恰会被复核动作本身改变——把一个块改成版式文字，它当场从「分类待确认」
 * 跳到「已一致」，在 155 项的页面上表现为目标凭空消失外加一次跨屏滚动。列表结构
 * 改为线性列表 + 筛选条（`review-filter.ts`），筛选只 filter、永不重排。
 *
 * 与 review-status / stage-view / accept-gate 一致使用相对 `.js` 导入且不触碰
 * `window`，以便同时被 renderer（vite）与测试（vitest + NodeNext）解析。
 */

import { compareBlockSources, type TextReviewBlock } from "@ppt-maker/core";

export type ReviewPartition =
  | "text-pending"
  | "classification-pending"
  | "agreed";

export const REVIEW_PARTITION_LABELS: Record<ReviewPartition, string> = {
  "text-pending": "文字待确认",
  "classification-pending": "分类待确认",
  agreed: "已一致",
};

/**
 * 单块的分区判据。
 *
 * 非 layout_text（object_integrated_symbol / uncertain）一律进分类待确认；
 * layout_text 按双源是否逐字一致二分。比对逻辑由 core 的 `compareBlockSources`
 * 独占，此处不得复制口径，否则界面分区与 CLI 报告会漂移。
 */
export function partitionOf(block: TextReviewBlock): ReviewPartition {
  if (block.classification !== "layout_text") return "classification-pending";
  return compareBlockSources(block).agrees ? "agreed" : "text-pending";
}

/**
 * 一组块中尚未复核的 id —— 复核进度的**唯一口径**。
 *
 * 分区归属只看分类与双源比对，人工确认不改变归属：符号块确认后仍是符号块，
 * 文字块编辑后 `offline_ocr` 与 `ai_text_assist` 两个原始源也不变。所以「还剩多少
 * 要看」只能由 `reviewStatus` 表达，不能拿 `blocks.length` 顶替。
 *
 * 2026-07-27 E1 走查实测：标题徽标当时显示分区总数、折叠摘要显示未复核数，两处
 * 各写一份 filter 且口径不一。用户确认完一个符号块后看到标题计数纹丝不动，
 * 判定为「按了没反应」。徽标与摘要此后一律走本函数，不得就地再写 filter。
 */
export function unreviewedBlockIds(
  blocks: readonly TextReviewBlock[],
): readonly string[] {
  return blocks
    .filter((block) => block.reviewStatus === "unreviewed")
    .map((block) => block.id);
}

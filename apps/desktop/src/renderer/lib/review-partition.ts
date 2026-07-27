/**
 * 文本复核三分区派生 —— 列表主导复核界面的分组判据（design.md §4.1）。
 *
 * 复核工作量的真实构成是「双源分歧」而非块数本身（PRD F-9：离线 OCR 与
 * ai_text_assist 在 57%/58% 的版式文字上不一致）。所以列表按「需要看什么」分区：
 *
 * - 文字待确认：双源分歧的 layout_text，要逐字核对文本；
 * - 分类待确认：全部 object_integrated_symbol 与 uncertain，要判断该不该当版式文字
 *   （PRD F-7：被误判为 object_symbol 的文字既不进 mask 也不进 PPTX，会静默漏字）；
 * - 已一致：双源逐字一致的 layout_text，默认折叠，一次「全部通过」放行。
 *
 * **分区内保持输入数组顺序**，不做任何重排序。`text-blocks.json` 的存储顺序即阅读
 * 顺序（契约中并不存在 readingOrder 字段），重排会让画布联动的推进方向失去意义。
 *
 * 与 review-status / stage-view / accept-gate 一致使用相对 `.js` 导入且不触碰
 * `window`，以便同时被 renderer（vite）与测试（vitest + NodeNext）解析。
 */

import { compareBlockSources, type TextReviewBlock } from "@ppt-maker/core";

export type ReviewPartition =
  | "text-pending"
  | "classification-pending"
  | "agreed";

/** 三分区展示顺序：文字待确认 → 分类待确认 → 已一致 */
export const REVIEW_PARTITION_ORDER: readonly ReviewPartition[] = [
  "text-pending",
  "classification-pending",
  "agreed",
];

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

export interface ReviewPartitionGroup {
  readonly partition: ReviewPartition;
  readonly blocks: readonly TextReviewBlock[];
}

/**
 * 按 `REVIEW_PARTITION_ORDER` 返回三组。
 *
 * 空组也返回：分区标题与计数徽标要在打开界面时就全部可见（PRD 验收标准
 * 「无需任何点击或悬停」），缺组会让界面结构随数据变形。
 */
export function partitionBlocks(
  blocks: readonly TextReviewBlock[],
): readonly ReviewPartitionGroup[] {
  const buckets = new Map<ReviewPartition, TextReviewBlock[]>(
    REVIEW_PARTITION_ORDER.map((partition) => [partition, []]),
  );
  for (const block of blocks) {
    buckets.get(partitionOf(block))?.push(block);
  }
  return REVIEW_PARTITION_ORDER.map((partition) => ({
    partition,
    blocks: buckets.get(partition) ?? [],
  }));
}

/**
 * 三分区展平后的全局顺序，键盘 Tab / ↑↓ 逐项推进按此序。
 *
 * 与 `partitionBlocks` 同源，保证「列表里看到的顺序」和「键盘走过的顺序」一致。
 */
export function orderedReviewBlocks(
  blocks: readonly TextReviewBlock[],
): readonly TextReviewBlock[] {
  return partitionBlocks(blocks).flatMap((group) => group.blocks);
}

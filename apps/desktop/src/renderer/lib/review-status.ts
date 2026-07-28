/**
 * 复核状态派生 —— 工具栏计数用的纯逻辑。
 *
 * `assist-review` 只会自动确认高置信块（CLI `assist-review.ts`：无风险且分类不是
 * uncertain 才置 `reviewed`），其余留给人工。阶段 B 起，未确认的版式文字会让执行
 * 停在显式的 `human-edit` 门（`run-from.ts`），不再像 V1 那样以 mask/pptx 阶段
 * 报错的形式代偿（PRD F-11），所以这个数量是「这页还欠多少人工确认」的直接提示。
 *
 * 阶段 D 删去了此前的 `markAllBlocksReviewed`（整页一键标记）：PRD F-6 实测真实
 * 工作区 155 块全部 `reviewed` 却无一条 `updatedAt`，整页批量正是文本复核被架空的
 * 逃生口。批量确认现在只保留「已一致」分区的「全部通过」，走 `block-edit.ts` 的
 * `markBlocksReviewedById`，作用域限定在双源逐字一致的块上。
 *
 * 与 stage-view / accept-gate 一致使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node NodeNext）解析。
 */

import type { TextReviewBlock } from "@ppt-maker/core";

/** 待人工确认的块数；已确认与风险接受都不计入 */
export function countUnreviewed(blocks: readonly TextReviewBlock[]): number {
  return blocks.filter((block) => block.reviewStatus === "unreviewed").length;
}

/**
 * 复核状态派生 —— 工具栏计数与批量确认共用的纯逻辑。
 *
 * `assist-review` 只会自动确认高置信块（CLI `assist-review.ts`：无风险且分类不是
 * uncertain 才置 `reviewed`），其余留给人工。而下游两道门禁都卡在这个字段上：
 *
 * - `mask/run.ts`：参与抹字的块必须已确认，否则整页执行直接失败；
 * - `pptx/run.ts`：所有 `layout_text` 必须已确认，否则拒绝导出。
 *
 * 失败发生在流水线内部，界面上只表现为「跑了一下没反应」，所以剩余数量必须
 * 摆到工具栏上，并给出一键放行——整页几十个块逐个点击不现实。
 *
 * 与 stage-view / accept-gate 一致使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node NodeNext）解析。
 */

import type { TextReviewBlock } from "@ppt-maker/core";

/** 待人工确认的块数；已确认与风险接受都不计入 */
export function countUnreviewed(blocks: readonly TextReviewBlock[]): number {
  return blocks.filter((block) => block.reviewStatus === "unreviewed").length;
}

/**
 * 把所有未复核块标为已复核。
 *
 * `accepted_with_risk` 不动——那是带风险接受记录的独立状态，
 * 覆盖成 `reviewed` 会抹掉 `riskAcceptance` 的语义。
 * 返回新数组与实际改动数；无改动时返回原数组，避免触发无谓的重渲染。
 */
export function markAllBlocksReviewed(blocks: readonly TextReviewBlock[]): {
  readonly blocks: readonly TextReviewBlock[];
  readonly changed: number;
} {
  const changed = countUnreviewed(blocks);
  if (changed === 0) return { blocks, changed: 0 };
  return {
    blocks: blocks.map((block) =>
      block.reviewStatus === "unreviewed"
        ? { ...block, reviewStatus: "reviewed" as const }
        : block,
    ),
    changed,
  };
}

/**
 * 文本复核列表的筛选档与推进（design.md §4.1、任务 07-28 design §6）。
 *
 * 取代此前的三分区分组。分区仍然是有效的**判据**，但不能再当作**列表结构**：
 * 分组键（双源是否一致、分类是什么）恰恰会被复核动作本身改变，于是用户改完一个
 * 块的分类，那一项就当场从「分类待确认」传送到「已一致」区去了——在 155 项的页面上
 * 表现为目标凭空消失、还伴随一次跨屏滚动。
 *
 * 现在分区只作为每一项的标签，列表结构改为**单一线性列表 + 筛选条**：
 * 筛选只做 filter，永不重排，`partitionOf` 的结果变了也只是徽标文字变了。
 *
 * 与 review-partition / review-status / review-keyboard 一致：不触碰 `window`、
 * 不引 React 类型，以便同时被 renderer（vite）与测试（vitest + NodeNext）解析。
 */

import type { TextReviewBlock } from "@ppt-maker/core";
import { partitionOf } from "./review-partition.js";

export type ReviewFilter =
  | "unreviewed"
  | "text-pending"
  | "classification-pending"
  | "agreed"
  | "all";

/** 筛选条展示顺序：先按「还没做的」，再按分区，最后是全部 */
export const REVIEW_FILTER_ORDER: readonly ReviewFilter[] = [
  "unreviewed",
  "text-pending",
  "classification-pending",
  "agreed",
  "all",
];

export const REVIEW_FILTER_LABELS: Record<ReviewFilter, string> = {
  unreviewed: "未复核",
  "text-pending": "文字待确认",
  "classification-pending": "分类待确认",
  agreed: "已一致",
  all: "全部",
};

/**
 * 进入复核视图的意图，决定默认停在哪一档（design §6.5）。
 *
 * - `sweep`：正常扫一遍（打开页面、切页）——默认停在「未复核」；
 * - `targeted`：从最终确认页点「回到文本复核」——用户心里有具体的一处要改，
 *   但那一处很可能已经标过已复核，默认「未复核」会把它藏起来，所以停在「全部」。
 */
export type ReviewEntryIntent = "sweep" | "targeted";

/** 三个分区档直接复用 `partitionOf`，不复制判据 */
export function matchesFilter(
  block: TextReviewBlock,
  filter: ReviewFilter,
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "unreviewed":
      return block.reviewStatus === "unreviewed";
    default:
      return partitionOf(block) === filter;
  }
}

/** 每一档的条目数，用于筛选条上的计数——与列表实际渲染的条目同源 */
export function filterCounts(
  blocks: readonly TextReviewBlock[],
): Record<ReviewFilter, number> {
  const counts: Record<ReviewFilter, number> = {
    unreviewed: 0,
    "text-pending": 0,
    "classification-pending": 0,
    agreed: 0,
    all: blocks.length,
  };
  for (const block of blocks) {
    if (block.reviewStatus === "unreviewed") counts.unreviewed += 1;
    counts[partitionOf(block)] += 1;
  }
  return counts;
}

/**
 * 打开列表时停在哪一档。只决定**初值**，之后由用户自由切换。
 *
 * 全部复核完了还停在「未复核」会得到一个空列表——那时用户要看的是全貌。
 */
export function defaultFilter(
  blocks: readonly TextReviewBlock[],
  intent: ReviewEntryIntent,
): ReviewFilter {
  if (intent === "targeted") return "all";
  const hasUnreviewed = blocks.some(
    (block) => block.reviewStatus === "unreviewed",
  );
  return hasUnreviewed ? "unreviewed" : "all";
}

/**
 * 当前可见集合内、当前项之后的第一个未复核项，走到末尾**回绕**继续找。
 *
 * 回绕语义与 `todo-queue.ts` 的 `nextTodoItem` 一致：漏在前面的项不该因为
 * 光标已经走过去就再也够不着。无结果返回 null，调用方必须给出明确提示
 * （「当前筛选下已无未复核项」），不得静默失败。
 */
export function nextUnreviewedId(
  visible: readonly TextReviewBlock[],
  currentId: string | null,
): string | null {
  if (visible.length === 0) return null;
  const currentIndex = visible.findIndex((block) => block.id === currentId);
  for (let offset = 1; offset <= visible.length; offset += 1) {
    const candidate = visible[(currentIndex + offset) % visible.length];
    if (candidate === undefined) continue;
    if (candidate.id === currentId) continue;
    if (candidate.reviewStatus === "unreviewed") return candidate.id;
  }
  return null;
}

/**
 * 页间导航派生（PRD F3.7）—— 单页复核工具栏的上一页/下一页。
 *
 * 顺序口径与待办队列保持一致：只取未被软删除的页，按 `pageLabel` 数字自然序
 * （page-2 在 page-10 之前）。deck-store 里 `slides` 的顺序来自 deck manifest，
 * 不保证与用户看到的卡片顺序一致，因此导航必须自己排序，否则"下一页"会跳序。
 *
 * 与 stage-view / accept-gate 一致使用相对 `.js` 导入，便于 vitest 直接消费。
 */

import type { SlideDetail } from "../../main/ipc/channels.js";

/** pageLabel 自然序比较（与 todo-queue 同一口径） */
const pageLabelCollator = new Intl.Collator("en", { numeric: true });

export interface SlideNavigation {
  /** 上一页；当前页为首页或不在列表中时为 null */
  readonly prev: SlideDetail | null;
  readonly next: SlideDetail | null;
  /** 当前页序号（1-based）；不在列表中时为 0 */
  readonly index: number;
  /** 活动页总数 */
  readonly total: number;
}

/** 活动页（未软删除）按 pageLabel 自然序排列 */
export function orderedActiveSlides(
  slides: readonly SlideDetail[],
): readonly SlideDetail[] {
  return slides
    .filter((slide) => !slide.removed)
    .slice()
    .sort((left, right) =>
      pageLabelCollator.compare(left.pageLabel, right.pageLabel),
    );
}

/**
 * 当前页的相邻页与位置。
 *
 * 不做环形导航：到头即禁用按钮，避免用户误以为还有下一页而在首尾之间打转。
 * 需要"继续处理"的场景由待办队列的「处理下一项」承担（PRD F2.5 / F3.7）。
 */
export function adjacentSlides(
  slides: readonly SlideDetail[],
  slideId: string | null,
): SlideNavigation {
  const ordered = orderedActiveSlides(slides);
  const position =
    slideId === null
      ? -1
      : ordered.findIndex((slide) => slide.slideId === slideId);

  if (position < 0) {
    return { prev: null, next: null, index: 0, total: ordered.length };
  }

  return {
    prev: ordered[position - 1] ?? null,
    next: ordered[position + 1] ?? null,
    index: position + 1,
    total: ordered.length,
  };
}

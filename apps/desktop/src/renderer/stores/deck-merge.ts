/**
 * deck-store 的纯合并逻辑 —— 与 zustand / window 解耦，便于在 node 环境单测。
 *
 * 与 run-types 一致使用相对 `.js` 导入，保证 renderer（vite）与 vitest 都能解析。
 */

import type {
  DeckStatusDetailedResult,
  DeckStatusResult,
  SlideDetail,
} from "../../main/ipc/channels.js";

export type DeckSummary = DeckStatusResult["summary"];

/** deck-store 中由 IPC 结果决定的那部分状态 */
export interface DeckSnapshot {
  readonly deckPath: string;
  readonly name: string;
  readonly deckId: string;
  readonly slides: readonly SlideDetail[];
  readonly summary: DeckSummary;
}

/** 把 `deck:status-detailed` 的返回值转成 store 快照 */
export function applyDetailedResult(
  result: DeckStatusDetailedResult,
): DeckSnapshot {
  return {
    deckPath: result.deckPath,
    name: result.name,
    deckId: result.deckId,
    slides: [...result.slides],
    summary: result.summary,
  };
}

/**
 * 只替换目标页，其余元素保持原引用（避免整表重渲染）。
 *
 * 目标页不存在时原样返回同一个数组引用，调用方据此判断需要整体套用结果
 * （例如该页刚被移除、或 slideId 发生变化）。
 */
export function replaceSlide(
  slides: readonly SlideDetail[],
  next: SlideDetail,
): readonly SlideDetail[] {
  const index = slides.findIndex((slide) => slide.slideId === next.slideId);
  if (index < 0) return slides;
  const merged = [...slides];
  merged[index] = next;
  return merged;
}

export function findSlideById(
  slides: readonly SlideDetail[],
  slideId: string,
): SlideDetail | undefined {
  return slides.find((slide) => slide.slideId === slideId);
}

/** 控制台只展示未被软删除的页 */
export function filterActiveSlides(
  slides: readonly SlideDetail[],
): readonly SlideDetail[] {
  return slides.filter((slide) => !slide.removed);
}

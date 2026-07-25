import { useMemo } from "react";
import { useDeckStore } from "@/stores/deck-store";
import { SlideCard } from "./SlideCard";

/**
 * 控制台卡片网格 —— 控制台的主视图区域。
 *
 * 列数按 DESIGN.md 响应式约定：mobile 1 列、tablet 2 列、desktop 3–4 列，gutter 24px。
 * 已移除页不进入网格（软删除只保留在 manifest 里，界面不再干扰用户）。
 */

export function SlideCardGrid(): React.JSX.Element {
  // 直接订阅 slides 数组本身：selector 里过滤会每次返回新数组，触发无限重渲染
  const slides = useDeckStore((s) => s.slides);
  const activeSlides = useMemo(
    () => slides.filter((slide) => !slide.removed),
    [slides],
  );

  if (activeSlides.length === 0) {
    return (
      <div className="flex w-full items-center justify-center py-12 text-sm text-muted">
        当前 Deck 还没有任何页面
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      {activeSlides.map((slide) => (
        <SlideCard key={slide.slideId} slide={slide} />
      ))}
    </div>
  );
}

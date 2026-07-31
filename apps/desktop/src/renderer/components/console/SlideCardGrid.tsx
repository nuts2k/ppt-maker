import type { SlideDetail } from "../../../main/ipc/channels.js";
import { SlideCard } from "./SlideCard";

/**
 * 控制台卡片网格 —— 控制台的主视图区域。
 *
 * 纯展示：渲染哪些页由 ConsolePage 决定（含「全部 / 待处理」筛选与已移除页的过滤），
 * 本组件不自行取数也不自行判定，避免筛选口径在两处各写一份。
 *
 * 密度按一叠 20–50 页设计：`auto-fill` + 168px 下限，1400px 窗口下约 6 列，
 * 一屏（约 3 行）容纳 ≥12 张。列数无断点，窗口缩放时自然回流。
 */

interface SlideCardGridProps {
  readonly slides: readonly SlideDetail[];
  /** slideId → 待办原因，来自 `deriveTodoQueue`；卡片不自行判定，见 SlideCard 注释 */
  readonly todoReasons: ReadonlyMap<string, string>;
}

export function SlideCardGrid({
  slides,
  todoReasons,
}: SlideCardGridProps): React.JSX.Element {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3">
      {slides.map((slide) => (
        <SlideCard
          key={slide.slideId}
          slide={slide}
          todoReason={todoReasons.get(slide.slideId)}
        />
      ))}
    </div>
  );
}

export type { SlideCardGridProps };

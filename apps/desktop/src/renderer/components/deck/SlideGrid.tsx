import { useDeckStore } from "@/stores/deck-store";
import { SlideCard } from "./SlideCard";

export function SlideGrid(): React.JSX.Element {
  const slides = useDeckStore((s) => s.slides);

  if (slides.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        当前 Deck 还没有任何页面
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {slides.map((slide) => (
        <SlideCard key={slide.slideId} slide={slide} />
      ))}
    </div>
  );
}

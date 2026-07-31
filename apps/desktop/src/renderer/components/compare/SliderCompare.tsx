import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 原图 / 去字底板滑块对比。
 *
 * ## 键盘可操作（2026-07-31 阶段二 8.6）
 *
 * 分割手柄此前只是一个装饰 div：整块区域靠 pointer 事件驱动，键盘用户完全够不到
 * 这个视图，与「键盘是一等输入」直接矛盾。改为 `role="slider"` 的可聚焦元素，
 * 方向键步进 2%、Page 键 10%、Home/End 到端点，焦点环由全局 `:focus-visible` 提供。
 *
 * 手柄位置**不加过渡动效**：拖动时任何缓动都会让手柄追不上指针，看着像卡顿。
 * 动效只表达状态变化，而这里是连续操控。
 */

interface SliderCompareProps {
  sourceImageUrl: string;
  cleanPlateUrl: string;
}

/** 方向键步进（%），Page 键取其 5 倍 */
const KEY_STEP = 2;

export function SliderCompare({
  sourceImageUrl,
  cleanPlateUrl,
}: SliderCompareProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [sliderPos, setSliderPos] = useState(50);
  const [dragging, setDragging] = useState(false);

  const updatePosition = useCallback((clientX: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const x = clientX - rect.left;
    const percent = Math.max(0, Math.min(100, (x / rect.width) * 100));
    setSliderPos(percent);
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setDragging(true);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      updatePosition(e.clientX);
    },
    [updatePosition],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging) return;
      updatePosition(e.clientX);
    },
    [dragging, updatePosition],
  );

  const handlePointerUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const delta: Readonly<Record<string, number>> = {
      ArrowLeft: -KEY_STEP,
      ArrowRight: KEY_STEP,
      ArrowDown: -KEY_STEP,
      ArrowUp: KEY_STEP,
      PageDown: -KEY_STEP * 5,
      PageUp: KEY_STEP * 5,
    };
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setSliderPos(e.key === "Home" ? 0 : 100);
      return;
    }
    const step = delta[e.key];
    if (step === undefined) return;
    e.preventDefault();
    setSliderPos((prev) => Math.max(0, Math.min(100, prev + step)));
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative select-none overflow-hidden"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {/* clean plate（底层完整显示） */}
      <img
        src={cleanPlateUrl}
        alt="去字底板"
        className="block w-full"
        draggable={false}
      />

      {/* 原图（通过 clip-path 仅显示左半部分） */}
      <img
        src={sourceImageUrl}
        alt="原图"
        className="absolute inset-0 block w-full"
        style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
        draggable={false}
      />

      {/* 分割线 */}
      <div
        className="absolute bottom-0 top-0 w-0.5 bg-on-ink"
        style={{ left: `${sliderPos}%`, transform: "translateX(-50%)" }}
      >
        {/* 拖拽手柄：同时是键盘可操作的滑块 */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="原图与去字底板对比位置"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(sliderPos)}
          aria-valuetext={`原图显示 ${Math.round(sliderPos)}%`}
          onKeyDown={handleKeyDown}
          className={cn(
            "absolute left-1/2 top-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2",
            "cursor-ew-resize items-center justify-center rounded-full",
            "border-2 border-on-ink bg-ink/80 text-on-ink",
            "transition-colors duration-fast hover:bg-ink",
          )}
        >
          <ChevronLeft aria-hidden="true" className="-mr-1 size-3.5" />
          <ChevronRight aria-hidden="true" className="-ml-1 size-3.5" />
        </div>
      </div>

      {/* 标签：中文为界面唯一语言，两侧同一档 */}
      <span className="absolute left-3 top-3 rounded-sm bg-ink/70 px-2 py-0.5 text-xs font-medium text-on-ink">
        原图
      </span>
      <span className="absolute right-3 top-3 rounded-sm bg-ink/70 px-2 py-0.5 text-xs font-medium text-on-ink">
        去字底板
      </span>
    </div>
  );
}

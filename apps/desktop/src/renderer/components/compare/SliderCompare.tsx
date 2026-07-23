import { useCallback, useRef, useState } from "react";

interface SliderCompareProps {
  sourceImageUrl: string;
  cleanPlateUrl: string;
}

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
        alt="Clean plate"
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
        className="absolute top-0 bottom-0 w-0.5 bg-on-primary"
        style={{ left: `${sliderPos}%`, transform: "translateX(-50%)" }}
      >
        {/* 拖拽手柄 */}
        <div className="absolute top-1/2 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-on-primary bg-primary/80">
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            className="text-on-primary"
            role="img"
            aria-label="拖拽滑块"
          >
            <path
              d="M4 8L2 8M2 8L4 6M2 8L4 10M12 8L14 8M14 8L12 6M14 8L12 10"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {/* 标签 */}
      <div className="absolute top-3 left-3 rounded-sm bg-primary/70 px-2 py-0.5 text-xs text-on-primary">
        原图
      </div>
      <div className="absolute top-3 right-3 rounded-sm bg-primary/70 px-2 py-0.5 text-xs text-on-primary">
        Clean Plate
      </div>
    </div>
  );
}

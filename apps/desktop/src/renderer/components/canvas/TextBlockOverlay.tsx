import type { TextReviewBlock } from "@ppt-maker/core";
import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

interface TextBlockOverlayProps {
  block: TextReviewBlock;
  imageWidth: number;
  imageHeight: number;
  /** 是否为当前复核项 */
  current: boolean;
  /** 是否与当前项同属一个复核分区（当前项自身也为 true） */
  samePartition: boolean;
  /** 画布缩放，用于把屏幕位移换算回图片像素 */
  scale: number;
  onClick(): void;
  onUpdate?:
    | ((blockId: string, patch: Partial<TextReviewBlock>) => void)
    | undefined;
}

/**
 * 三态标注（design.md §4.2）：分类不再用边框色编码——分类由左侧列表分区表达，
 * 画布只回答「哪一块是当前项」。取色全部落在 DESIGN.md 色板内：
 *
 * - 当前项：沿用 DESIGN.md 的 focus 语言「外 2px 蓝环」，`info-border` 实线 +
 *   `canvas` 色间隔 + 半透明蓝晕 + 淡蓝底。白色间隔是关键——彩色底图上纯蓝边可能
 *   与底色同明度而糊掉，中间垫一圈白才能保证「当前项清晰可辨」；蓝晕向外扩散，
 *   让 13–19px 高的小块在缩略视图下也能一眼扫到。
 * - 非当前项：hairline(#dddddd) 在彩色底图上几乎不可见，故取色板内更强的
 *   `border-strong`(#9297a0)——中性灰在浅底与深底上都留得住形，且不构成强调色。
 *   同分区保持满不透明度；其他分区降到 35% 退居背景。
 *
 * **线宽必须按 scale 反算**：标注 div 在缩放容器内部，写死的 `border-2` 实际渲染
 * 宽度是 `2px × scale`。2048 宽的图 fit 进 ~780px 画布时 scale≈0.38，边框只剩
 * 0.76px、外发光同理——95 个框铺满时根本分不出当前项。下面所有描边与光晕都用
 * `/scale` 换算，保证屏幕上恒定粗细。
 */
const INFO_BORDER = "#458fff";
const CANVAS = "#ffffff";
const BORDER_STRONG = "#9297a0";

function annotationStyle(
  current: boolean,
  samePartition: boolean,
  scale: number,
): React.CSSProperties {
  // scale 可能为 0（尺寸未就绪的一帧），兜底避免除零得到 Infinity 线宽
  const px = (screenPx: number): number => screenPx / Math.max(scale, 0.01);
  if (current) {
    return {
      border: `${px(2)}px solid ${INFO_BORDER}`,
      backgroundColor: "rgba(69, 143, 255, 0.16)",
      boxShadow: `0 0 0 ${px(1)}px ${CANVAS}, 0 0 0 ${px(6)}px rgba(69, 143, 255, 0.35)`,
    };
  }
  return {
    border: `${px(1)}px solid ${BORDER_STRONG}`,
    opacity: samePartition ? 1 : 0.35,
  };
}

// 屏幕位移小于该像素数视为点击而非拖动，避免选中块时手抖改坐标
const DRAG_THRESHOLD_PX = 3;

interface DragState {
  pointerId: number;
  // 按下时的屏幕坐标与块原点，位移始终相对原点计算，避免逐帧累加漂移
  startClientX: number;
  startClientY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

// quadPx 跟随 bbox 做同一位移；bbox 已被夹在图内，故这里不再单独夹取，
// 保持四边形形状不被静默变形。
function translateQuad(
  quad: TextReviewBlock["quadPx"],
  dx: number,
  dy: number,
): TextReviewBlock["quadPx"] {
  if (quad === null) {
    return null;
  }
  return [
    { x: quad[0].x + dx, y: quad[0].y + dy },
    { x: quad[1].x + dx, y: quad[1].y + dy },
    { x: quad[2].x + dx, y: quad[2].y + dy },
    { x: quad[3].x + dx, y: quad[3].y + dy },
  ];
}

export function TextBlockOverlay({
  block,
  imageWidth,
  imageHeight,
  current,
  samePartition,
  scale,
  onClick,
  onUpdate,
}: TextBlockOverlayProps): React.JSX.Element {
  const { x, y, width, height } = block.bboxPx;

  const dragRef = useRef<DragState | null>(null);
  // 拖动结束后紧跟的 click 需要吞掉，否则拖完还会触发一次选中
  const suppressClickRef = useRef(false);

  const style: React.CSSProperties = {
    left: `${(x / imageWidth) * 100}%`,
    top: `${(y / imageHeight) * 100}%`,
    width: `${(width / imageWidth) * 100}%`,
    height: `${(height / imageHeight) * 100}%`,
    // 当前项的光晕要盖住相邻框，否则密集区里它会被后面的框压掉
    zIndex: current ? 2 : 1,
    ...annotationStyle(current, samePartition, scale),
  };

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      // 只接管左键；中键留给画布平移，只读画布完全不接管指针
      if (e.button !== 0 || !onUpdate) {
        return;
      }
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = {
        pointerId: e.pointerId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        originX: block.bboxPx.x,
        originY: block.bboxPx.y,
        moved: false,
      };
    },
    [block.bboxPx.x, block.bboxPx.y, onUpdate],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== e.pointerId || !onUpdate) {
        return;
      }
      e.stopPropagation();
      const screenDx = e.clientX - drag.startClientX;
      const screenDy = e.clientY - drag.startClientY;
      if (
        !drag.moved &&
        Math.abs(screenDx) < DRAG_THRESHOLD_PX &&
        Math.abs(screenDy) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      drag.moved = true;
      // 屏幕位移除以缩放换算回图片像素；bbox 必须完整落在图内（BBOX_OUT_OF_BOUNDS）
      const nextX = clamp(
        drag.originX + screenDx / scale,
        0,
        Math.max(0, imageWidth - block.bboxPx.width),
      );
      const nextY = clamp(
        drag.originY + screenDy / scale,
        0,
        Math.max(0, imageHeight - block.bboxPx.height),
      );
      const stepX = nextX - block.bboxPx.x;
      const stepY = nextY - block.bboxPx.y;
      if (stepX === 0 && stepY === 0) {
        return;
      }
      onUpdate(block.id, {
        bboxPx: { ...block.bboxPx, x: nextX, y: nextY },
        quadPx: translateQuad(block.quadPx, stepX, stepY),
      });
    },
    [
      block.id,
      block.bboxPx,
      block.quadPx,
      imageWidth,
      imageHeight,
      scale,
      onUpdate,
    ],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const drag = dragRef.current;
      if (drag === null || drag.pointerId !== e.pointerId) {
        return;
      }
      e.stopPropagation();
      e.currentTarget.releasePointerCapture(e.pointerId);
      suppressClickRef.current = drag.moved;
      dragRef.current = null;
    },
    [],
  );

  const handleClick = useCallback(() => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    onClick();
  }, [onClick]);

  return (
    // 块内不再渲染任何内容：识别文本叠在原图同处文字上会造成双层重影（PRD F-6），
    // 文本一律由左侧列表呈现，画布只画框。
    <button
      type="button"
      aria-label={block.text.length > 0 ? block.text : "未识别文字块"}
      aria-current={current ? "true" : undefined}
      style={style}
      onClick={handleClick}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={cn(
        "absolute box-border p-0",
        onUpdate ? "cursor-move" : "cursor-pointer",
      )}
    />
  );
}

import type { TextReviewBlock } from "@ppt-maker/core";
import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  BORDER_STRONG,
  CANVAS,
  INK,
  INK_FILL,
  PROOF,
  PROOF_FILL,
  PROOF_GLOW,
} from "./overlay-colors";

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
 * 标注视觉（design.md §4.2）：分类不再用边框色编码——分类由左侧列表分区表达，
 * 画布只回答「哪一块是当前项」。
 *
 * **当前项用校对红**（DESIGN.md：`proof` 只标「差异」与「待我处理」）。当前项正是
 * 此刻要你核的那一块，校样台上的红笔本来就落在这里；同时它与阶段状态色
 * （running/stale/failed）彻底分开，画布上的红不会被误读成「这一块出错了」。
 * 结构沿用「实线 + `canvas` 色间隔 + 半透明红晕」：白色间隔是关键——彩色底图上
 * 纯色边可能与底色同明度而糊掉，中间垫一圈白才保证「当前项清晰可辨」；红晕向外
 * 扩散，让 13–19px 高的小块在缩略视图下也能一眼扫到。
 *
 * 非当前项走中性 `border-strong`——`hairline` 在彩色底图上几乎不可见，
 * 而中性灰在浅底与深底上都留得住形，且不构成强调（有颜色 = 要你管）。同分区保持
 * 满不透明度，其他分区降到 35% 退居背景，**悬停时临时恢复满不透明**，否则淡掉的
 * 块无法确认鼠标指的是哪一个。
 *
 * **线宽必须按 scale 反算**：标注 div 在缩放容器内部，写死的 `border-2` 实际渲染
 * 宽度是 `2px × scale`。2048 宽的图 fit 进 ~780px 画布时 scale≈0.38，边框只剩
 * 0.76px、外发光同理——95 个框铺满时根本分不出当前项。下面所有描边、光晕与焦点环
 * 都用 `/scale` 换算，保证屏幕上恒定粗细。
 *
 * 取色来自 `overlay-colors.ts`：宽度与颜色写在同一条 `border` / `box-shadow`
 * 简写里，用不上 Tailwind 类，所以颜色只能落在 JS 侧。那里的取值与 palette
 * **逐字对齐**并由 `ui-design-rules` 测试锁住，本文件不再自行拼色。
 */

interface AnnotationState {
  readonly current: boolean;
  readonly samePartition: boolean;
  readonly scale: number;
  readonly hovered: boolean;
  /** 仅键盘焦点（:focus-visible）；鼠标点击不画焦点环 */
  readonly focused: boolean;
}

function annotationStyle({
  current,
  samePartition,
  scale,
  hovered,
  focused,
}: AnnotationState): React.CSSProperties {
  // scale 可能为 0（尺寸未就绪的一帧），兜底避免除零得到 Infinity 线宽
  const px = (screenPx: number): number => screenPx / Math.max(scale, 0.01);
  const style: React.CSSProperties = {};
  // box-shadow 列表里先写的画在上层，故顺序为「内白圈 → 焦点白晕 → 红晕」
  const rings: string[] = [];

  if (current) {
    style.border = `${px(2)}px solid ${PROOF}`;
    style.backgroundColor = PROOF_FILL;
    rings.push(`0 0 0 ${px(1)}px ${CANVAS}`);
  } else {
    style.border = `${px(hovered ? 1.5 : 1)}px solid ${hovered ? INK : BORDER_STRONG}`;
    style.opacity = samePartition || hovered ? 1 : 0.35;
    if (hovered) {
      style.backgroundColor = INK_FILL;
      rings.push(`0 0 0 ${px(1)}px ${CANVAS}`);
    }
  }

  if (focused) {
    // index.css 的全局 :focus-visible 环同样在缩放容器里被压成 2px × scale
    // （实测 0.76px），键盘用户几乎看不见。这里按 scale 反算一圈等效环——
    // inline style 优先级高于全局样式表，因此直接盖过它——并垫一圈白晕，
    // 保证近黑焦点环落在深色底图上也留得住形。
    style.outline = `${px(2)}px solid ${INK}`;
    style.outlineOffset = `${px(2)}px`;
    rings.push(`0 0 0 ${px(4)}px ${CANVAS}`);
  }

  if (current) {
    rings.push(`0 0 0 ${px(6)}px ${PROOF_GLOW}`);
  }

  if (rings.length > 0) {
    style.boxShadow = rings.join(", ");
  }
  return style;
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

  // 悬停与键盘焦点走组件状态而非 CSS 伪类：描边宽度要按 scale 反算，
  // 只能写在 inline style 里，`hover:` 类改不动它。
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);

  const style: React.CSSProperties = {
    left: `${(x / imageWidth) * 100}%`,
    top: `${(y / imageHeight) * 100}%`,
    width: `${(width / imageWidth) * 100}%`,
    height: `${(height / imageHeight) * 100}%`,
    // 当前项与被指到的块要盖住相邻框，否则密集区里它会被后面的框压掉
    zIndex: current ? 3 : hovered || focused ? 2 : 1,
    ...annotationStyle({ current, samePartition, scale, hovered, focused }),
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
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      // 只认键盘焦点：鼠标点击不该留下焦点环（index.css 的全局约定）
      onFocus={(e) => setFocused(e.currentTarget.matches(":focus-visible"))}
      onBlur={() => setFocused(false)}
      className={cn(
        "absolute box-border p-0",
        // 线宽随 scale 逐帧变，不纳入过渡，否则缩放时描边会拖影
        "transition-[background-color,border-color,opacity] duration-fast",
        onUpdate ? "cursor-move" : "cursor-pointer",
      )}
    />
  );
}

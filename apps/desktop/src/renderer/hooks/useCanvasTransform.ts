import {
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export interface CanvasTransform {
  // 缩放比例，限制在 0.1 ~ 5 之间
  scale: number;
  offsetX: number;
  offsetY: number;
}

// 内容原始尺寸，用于计算 fit-to-view
interface ContentSize {
  width: number;
  height: number;
}

// 内容坐标系中的矩形，用于 centerOn
interface ContentBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface UseCanvasTransformResult {
  transform: CanvasTransform;
  containerRef: RefObject<HTMLDivElement | null>;
  onWheel(e: ReactWheelEvent<HTMLDivElement>): void;
  onPointerDown(e: ReactPointerEvent<HTMLDivElement>): void;
  onPointerMove(e: ReactPointerEvent<HTMLDivElement>): void;
  onPointerUp(e: ReactPointerEvent<HTMLDivElement>): void;
  resetView(): void;
  /** 把内容坐标系里的 bbox 放大到可读比例并滚到视口中心 */
  focusOn(bbox: ContentBox): void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_SENSITIVITY = 0.0015;

/**
 * 跟随当前项时的目标屏幕高度（px）。
 *
 * 真实数据里正文行在原图中只有 13–19px 高，整页 fit 到画布后 scale≈0.38，
 * 屏幕上不足 8px——根本没法拿原图核对「象衽鲍洁高雅」到底是哪几个字，
 * 而这正是双源分歧要判的东西。放大到这个高度才谈得上核字。
 */
const FOCUS_BLOCK_HEIGHT_PX = 44;

/** 当前项横向最多占视口的比例，留出左右余量看上下文 */
const FOCUS_WIDTH_RATIO = 0.8;

/** 跟随缩放上限：短块（「口沿」这类两三个字）不要被放到糊 */
const FOCUS_MAX_SCALE = 3;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

// 计算把内容完整放入容器的 fit-to-view 变换（内容居中）
function computeFit(
  container: HTMLDivElement | null,
  content: ContentSize | null,
): CanvasTransform {
  if (container === null || content === null || content.width === 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const { clientWidth, clientHeight } = container;
  const scale = clampScale(
    Math.min(clientWidth / content.width, clientHeight / content.height),
  );
  const offsetX = (clientWidth - content.width * scale) / 2;
  const offsetY = (clientHeight - content.height * scale) / 2;
  return { scale, offsetX, offsetY };
}

/** 单轴偏移夹取：内容比视口窄时居中，否则保证内容边缘不越过视口边缘 */
function clampAxisOffset(
  offset: number,
  viewport: number,
  contentLength: number,
): number {
  if (contentLength <= 0) {
    return offset;
  }
  if (contentLength <= viewport) {
    return (viewport - contentLength) / 2;
  }
  return Math.min(0, Math.max(viewport - contentLength, offset));
}

export function useCanvasTransform(
  content?: ContentSize | null,
): UseCanvasTransformResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [transform, setTransform] = useState<CanvasTransform>({
    scale: 1,
    offsetX: 0,
    offsetY: 0,
  });

  // 中键拖拽平移状态
  const panRef = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const resetView = useCallback(() => {
    setTransform(computeFit(containerRef.current, content ?? null));
  }, [content]);

  // 内容尺寸就绪或变化时自动 fit-to-view
  useEffect(() => {
    resetView();
  }, [resetView]);

  const onWheel = useCallback((e: ReactWheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      // Ctrl/Cmd + 滚轮：以光标为中心缩放
      const container = containerRef.current;
      if (container === null) {
        return;
      }
      const rect = container.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      setTransform((prev) => {
        const nextScale = clampScale(
          prev.scale * (1 - e.deltaY * ZOOM_SENSITIVITY),
        );
        const ratio = nextScale / prev.scale;
        return {
          scale: nextScale,
          offsetX: px - (px - prev.offsetX) * ratio,
          offsetY: py - (py - prev.offsetY) * ratio,
        };
      });
      return;
    }
    // 普通滚轮：平移
    setTransform((prev) => ({
      ...prev,
      offsetX: prev.offsetX - e.deltaX,
      offsetY: prev.offsetY - e.deltaY,
    }));
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      // 仅中键触发拖拽平移
      if (e.button !== 1) {
        return;
      }
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      panRef.current = {
        active: true,
        startX: e.clientX,
        startY: e.clientY,
        originX: transform.offsetX,
        originY: transform.offsetY,
      };
    },
    [transform.offsetX, transform.offsetY],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (pan === null || !pan.active) {
      return;
    }
    setTransform((prev) => ({
      ...prev,
      offsetX: pan.originX + (e.clientX - pan.startX),
      offsetY: pan.originY + (e.clientY - pan.startY),
    }));
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (panRef.current?.active) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      panRef.current = null;
    }
  }, []);

  // content 走 ref：centerOn 需要内容尺寸做边界夹取，但把它放进依赖数组会让
  // centerOn 随每次 content 对象重建而换标识，调用方的居中 effect 会跟着抖动。
  const contentRef = useRef<ContentSize | null>(content ?? null);
  contentRef.current = content ?? null;

  /**
   * 把 bbox 放大到可读比例并滚到视口中心。
   *
   * **只居中不缩放是无效的**：fit-to-view 的定义就是两个轴都装得下，此时任何
   * 边界安全的平移都等于零位移，整个跟随会变成空操作；而不做边界夹取又会让靠边
   * 的块把整张图推出视口露白底。所以跟随必须连缩放一起给。
   *
   * 目标比例取「高度放到 FOCUS_BLOCK_HEIGHT_PX」与「宽度占满视口 FOCUS_WIDTH_RATIO」
   * 中较小者，再夹到 [fit, FOCUS_MAX_SCALE]：下界是整页 fit，保证横跨整页的宽块
   * 缩到能看全而不会再退到更远；上界防止两三个字的短块被放糊。
   *
   * 用户仍可自由缩放平移，双击 resetView 回到整页全景；下次切换当前项会重新跟随。
   */
  const focusOn = useCallback((bbox: ContentBox) => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const { clientWidth, clientHeight } = container;
    const content = contentRef.current;
    const byHeight =
      bbox.height > 0 ? FOCUS_BLOCK_HEIGHT_PX / bbox.height : FOCUS_MAX_SCALE;
    const byWidth =
      bbox.width > 0
        ? (clientWidth * FOCUS_WIDTH_RATIO) / bbox.width
        : FOCUS_MAX_SCALE;
    const fit = computeFit(container, content).scale;
    const scale = clampScale(
      Math.min(FOCUS_MAX_SCALE, Math.max(fit, Math.min(byHeight, byWidth))),
    );
    setTransform({
      scale,
      offsetX: clampAxisOffset(
        clientWidth / 2 - (bbox.x + bbox.width / 2) * scale,
        clientWidth,
        (content?.width ?? 0) * scale,
      ),
      offsetY: clampAxisOffset(
        clientHeight / 2 - (bbox.y + bbox.height / 2) * scale,
        clientHeight,
        (content?.height ?? 0) * scale,
      ),
    });
  }, []);

  return {
    transform,
    containerRef,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    resetView,
    focusOn,
  };
}

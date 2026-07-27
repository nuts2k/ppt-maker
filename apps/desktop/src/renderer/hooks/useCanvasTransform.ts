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
  /** 把内容坐标系里的 bbox 滚到视口中心；不改变当前 scale */
  centerOn(bbox: ContentBox): void;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const ZOOM_SENSITIVITY = 0.0015;

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
   * 把 bbox 滚到视口中心，但不把内容拖出视口。
   *
   * 当前 scale 用函数式 setTransform 读取，同样不进依赖数组。
   *
   * 边界夹取是必需的：进页时 scale 为 fit-to-view，整图本就完整可见，此时若
   * 无条件按块居中，靠边的块会把整张图推向一侧、露出大片空白底。故按轴分别
   * 处理——该轴上内容比视口窄时保持居中（结果与 fit 一致），否则把偏移夹在
   * 「内容边缘不越过视口边缘」的范围内。
   */
  const centerOn = useCallback((bbox: ContentBox) => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }
    const { clientWidth, clientHeight } = container;
    const content = contentRef.current;
    setTransform((prev) => ({
      scale: prev.scale,
      offsetX: clampAxisOffset(
        clientWidth / 2 - (bbox.x + bbox.width / 2) * prev.scale,
        clientWidth,
        (content?.width ?? 0) * prev.scale,
      ),
      offsetY: clampAxisOffset(
        clientHeight / 2 - (bbox.y + bbox.height / 2) * prev.scale,
        clientHeight,
        (content?.height ?? 0) * prev.scale,
      ),
    }));
  }, []);

  return {
    transform,
    containerRef,
    onWheel,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    resetView,
    centerOn,
  };
}

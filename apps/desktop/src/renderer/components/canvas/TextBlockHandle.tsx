import { useCallback, useRef } from "react";

interface HandleDragResult {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

type HandlePosition = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

interface TextBlockHandleProps {
  position: HandlePosition;
  scale: number;
  onDragStart: () => void;
  onDrag: (result: HandleDragResult) => void;
  onDragEnd: () => void;
}

const CURSOR_MAP: Record<HandlePosition, string> = {
  nw: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  se: "nwse-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

const POSITION_CLASSES: Record<HandlePosition, string> = {
  nw: "-top-1 -left-1",
  ne: "-top-1 -right-1",
  sw: "-bottom-1 -left-1",
  se: "-bottom-1 -right-1",
  n: "-top-1 left-1/2 -translate-x-1/2",
  s: "-bottom-1 left-1/2 -translate-x-1/2",
  e: "top-1/2 -right-1 -translate-y-1/2",
  w: "top-1/2 -left-1 -translate-y-1/2",
};

function computeDelta(
  position: HandlePosition,
  movementX: number,
  movementY: number,
): HandleDragResult {
  const result: HandleDragResult = { dx: 0, dy: 0, dw: 0, dh: 0 };
  if (position.includes("w")) {
    result.dx = movementX;
    result.dw = -movementX;
  }
  if (position.includes("e")) {
    result.dw = movementX;
  }
  if (position.includes("n")) {
    result.dy = movementY;
    result.dh = -movementY;
  }
  if (position.includes("s")) {
    result.dh = movementY;
  }
  return result;
}

export function TextBlockHandle({
  position,
  scale,
  onDragStart,
  onDrag,
  onDragEnd,
}: TextBlockHandleProps): React.JSX.Element {
  const dragging = useRef(false);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      e.preventDefault();
      dragging.current = true;
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      onDragStart();
    },
    [onDragStart],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      e.stopPropagation();
      const delta = computeDelta(
        position,
        e.movementX / scale,
        e.movementY / scale,
      );
      onDrag(delta);
    },
    [position, scale, onDrag],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (!dragging.current) return;
      e.stopPropagation();
      dragging.current = false;
      onDragEnd();
    },
    [onDragEnd],
  );

  return (
    <div
      className={`absolute z-10 h-2.5 w-2.5 rounded-xs border border-info-border bg-canvas ${POSITION_CLASSES[position]}`}
      style={{ cursor: CURSOR_MAP[position] }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    />
  );
}

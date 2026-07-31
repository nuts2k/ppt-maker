import type { VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { panelVariants } from "./variants";

/**
 * 面板 —— 三档层级（DESIGN.md `Elevation & Depth`）。
 *
 * 上一版全应用 `shadow` 命中 0 次，所有面板都是「白底 + 1px 灰边」，
 * 没有任何深度暗示哪个是主平面、哪个浮在上面。
 */

export interface PanelProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof panelVariants> {}

export const Panel = forwardRef<HTMLDivElement, PanelProps>(function Panel(
  { className, elevation, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(panelVariants({ elevation }), className)}
      {...rest}
    >
      {children}
    </div>
  );
});

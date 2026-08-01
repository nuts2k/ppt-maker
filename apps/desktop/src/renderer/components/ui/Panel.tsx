import type { VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { panelVariants } from "./variants";

/**
 * 面板 —— 三档层级（DESIGN.md `Elevation & Depth`）。
 *
 * 上一版全应用 `shadow` 命中 0 次，所有面板都是「白底 + 1px 灰边」，
 * 没有任何深度暗示哪个是主平面、哪个浮在上面。
 *
 * ## 为什么可以换标签
 *
 * 层级是**视觉**属性，与这块内容在文档结构里是什么无关：一个带标题的检查小节
 * 该是 `<section>`，一张浮层该是 `<div>`，两者的 elevation 却可能相同。
 * 写死 `div` 的后果是调用点为了拿正确的标签而绕开基座手拼
 * `cn(panelVariants(), …)`——`CheckSummary` 里就这样出现过三处，
 * 而绕过基座正是本次重构要根除的那件事。
 *
 * 只开放这几个容器标签。**整块可点击的折叠面板是例外**：它需要 `<button>` 的语义与
 * 键盘行为，不是容器，此时直接复用 `panelVariants()` 拼在 button 上
 * （见 `CheckSummary` 的折叠态）。那不算绕过基座——视觉仍出自同一个变体表，
 * 换掉的只是标签语义。
 */

const PANEL_TAGS = ["div", "section", "aside", "article"] as const;

export type PanelTag = (typeof PANEL_TAGS)[number];

export interface PanelProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof panelVariants> {
  /** 渲染成哪个容器标签，默认 `div`。语义由调用点决定，视觉层级由 elevation 决定。 */
  readonly as?: PanelTag;
}

export const Panel = forwardRef<HTMLElement, PanelProps>(function Panel(
  { as: Tag = "div", className, elevation, children, ...rest },
  ref,
) {
  return (
    <Tag
      // 各标签的 ref 类型互不相同，联合到 HTMLElement 后 TS 无法自动收窄；
      // 运行时是同一个 DOM 节点，这里的断言不掩盖任何真实差异。
      ref={ref as React.Ref<HTMLDivElement>}
      className={cn(panelVariants({ elevation }), className)}
      {...rest}
    >
      {children}
    </Tag>
  );
});

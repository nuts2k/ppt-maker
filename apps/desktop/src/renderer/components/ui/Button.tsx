import type { VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "./variants";

/**
 * 按钮 —— 全应用唯一的动作词汇（DESIGN.md `components.button-*`）。
 *
 * 取代此前散落在 TopNav / RunControlBar / SlideToolbar / FinalConfirmPage
 * 四个文件里的 `BUTTON_PRIMARY` / `BUTTON_SECONDARY` 局部常量。那四份已经漂移
 * （TopNav 用 px-4 py-2，RunControlBar 用 px-5 py-2.5），同一个动作在不同页面
 * 长得不一样。**同一个动作在任何页面都必须长得一样。**
 *
 * 六态齐全：default / hover / focus-visible / active / disabled / loading。
 * 焦点环由 index.css 的全局 `:focus-visible` 提供，此处不重复声明。
 *
 * 另有 `selected` 表达「二选一的当前值」（见 variants.ts）。它同时输出
 * `aria-pressed`，调用方无从分开写 —— 视觉与语义分头维护正是漂移的起点。
 */

export interface ButtonProps
  extends Omit<
      React.ButtonHTMLAttributes<HTMLButtonElement>,
      "type" | "aria-pressed"
    >,
    VariantProps<typeof buttonVariants> {
  /** 载入中：显示转圈并自动禁用。文案保留，避免按钮宽度跳动 */
  readonly loading?: boolean;
  /** 默认 button —— 显式给出，避免落进表单里变成意外的 submit */
  readonly type?: "button" | "submit" | "reset";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant,
      size,
      shape,
      selected,
      loading = false,
      disabled,
      children,
      ...rest
    },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled === true || loading}
        aria-busy={loading || undefined}
        // 视觉与语义绑死在一个 prop 上：`aria-pressed` 从类型上就不许调用方另写
        // （见上方 ButtonProps 的 Omit）。分头维护正是漂移的起点 —— 只要能分开写，
        // 迟早出现「看着是选中的但读屏说没按下」。
        aria-pressed={selected ?? undefined}
        className={cn(
          buttonVariants({ variant, size, shape, selected }),
          className,
        )}
        {...rest}
      >
        {loading && (
          // 减弱动效下转圈被全局兜底压成静止，此时它退化为静态图标，
          // 仍指示「载入中」，配合 aria-busy 不丢信息。
          <LoaderCircle
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
        )}
        {children}
      </button>
    );
  },
);

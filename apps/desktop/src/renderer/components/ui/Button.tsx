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
 */

export interface ButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">,
    VariantProps<typeof buttonVariants> {
  /** 载入中：显示转圈并自动禁用。文案保留，避免按钮宽度跳动 */
  readonly loading?: boolean;
  /** 默认 button —— 显式给出，避免落进表单里变成意外的 submit */
  readonly type?: "button" | "submit" | "reset";
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { className, variant, size, loading = false, disabled, children, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled === true || loading}
        aria-busy={loading || undefined}
        className={cn(buttonVariants({ variant, size }), className)}
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

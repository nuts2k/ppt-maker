import type { VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants, ICON_BUTTON_SIZE } from "./variants";

/**
 * 纯图标按钮 —— 与 `Button` 共用同一套变体，只把内边距换成正方形。
 *
 * `label` 是必填的：图标按钮没有可见文字，不给无障碍名等于对读屏用户不可用。
 * 它同时充当原生 tooltip，鼠标用户也能确认这个图标是干什么的。
 */

export interface IconButtonProps
  extends Omit<
      React.ButtonHTMLAttributes<HTMLButtonElement>,
      "type" | "aria-label"
    >,
    VariantProps<typeof buttonVariants> {
  /** 无障碍名 + 原生 tooltip。必填 */
  readonly label: string;
  readonly type?: "button" | "submit" | "reset";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    { className, variant, size = "md", label, children, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        className={cn(
          buttonVariants({ variant, size }),
          ICON_BUTTON_SIZE[size ?? "md"],
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

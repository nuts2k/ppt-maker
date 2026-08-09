import type { VariantProps } from "class-variance-authority";
import { LoaderCircle } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { buttonVariants, ICON_BUTTON_SIZE } from "./variants";

/**
 * 纯图标按钮 —— 与 `Button` 共用同一套变体，只把内边距换成正方形。
 *
 * `label` 是必填的：图标按钮没有可见文字，不给无障碍名等于对读屏用户不可用。
 * 它同时充当原生 tooltip，鼠标用户也能确认这个图标是干什么的。
 *
 * 六态：default / hover / focus-visible / active / disabled / loading。
 * MenuItem / Field / Segmented 不适用 loading（菜单项不做异步、字段由内部输入承载、
 * 选择器不异步），因此只有 IconButton 补齐。
 */

export interface IconButtonProps
  extends Omit<
      React.ButtonHTMLAttributes<HTMLButtonElement>,
      "type" | "aria-label" | "aria-pressed"
    >,
    VariantProps<typeof buttonVariants> {
  /** 无障碍名 + 原生 tooltip。必填 */
  readonly label: string;
  /** 载入中：显示转圈并自动禁用 */
  readonly loading?: boolean;
  readonly type?: "button" | "submit" | "reset";
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  function IconButton(
    {
      className,
      variant,
      size = "md",
      shape,
      selected,
      label,
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
        aria-label={label}
        title={label}
        disabled={disabled === true || loading}
        aria-busy={loading || undefined}
        aria-pressed={selected ?? undefined}
        className={cn(
          buttonVariants({ variant, size, shape, selected }),
          ICON_BUTTON_SIZE[size ?? "md"],
          className,
        )}
        {...rest}
      >
        {loading ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
        ) : (
          children
        )}
      </button>
    );
  },
);

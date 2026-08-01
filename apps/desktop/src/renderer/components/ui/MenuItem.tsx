import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * 下拉菜单项 —— 满宽、左对齐、无边框。
 *
 * **不是 `Button` 的一档。** 按钮是「一个可点的东西」，有自己的边界与内边距，
 * 排在一行里；菜单项是「一份清单里的一行」，满宽、左对齐、靠悬停底色表示可点，
 * 两者的形状语言不同。硬塞进 `buttonVariants` 会给按钮加一档只有菜单在用的变体，
 * 那正是变体表开始腐化的方式。
 *
 * 但它同样不该在调用点手拼——`WorkspaceMenu` 里那份手拼类串已经与
 * `DoctorChip` 的浮层内容各自演化。收进基座是为了下一个下拉菜单有东西可用。
 *
 * ## 禁用态为什么带 `title`
 *
 * 灰掉却不说为什么，等同于点了没反应。调用点必须给出 `disabledReason`，
 * 它会同时进 `title` 与读屏可见的说明。
 */

export interface MenuItemProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type"> {
  /** 禁用原因。灰掉必须说明，否则与「点了没反应」无从区分 */
  readonly disabledReason?: string | null;
}

export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(
  function MenuItem(
    { className, disabled, disabledReason, children, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        title={disabledReason ?? undefined}
        className={cn(
          "w-full rounded-sm px-3 py-2 text-left text-sm text-ink",
          "transition-colors duration-fast",
          disabled
            ? "cursor-not-allowed opacity-40"
            : "hover:bg-surface active:bg-surface-sunken",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

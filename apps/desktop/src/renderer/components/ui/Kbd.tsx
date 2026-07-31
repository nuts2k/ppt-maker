import type { VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { kbdVariants } from "./variants";

/**
 * 键位提示。
 *
 * 「键盘是一等输入」（PRODUCT.md 设计原则 4），所以键位要**印在界面上**而不是
 * 藏进 title —— 藏起来等于只有鼠标用户看得到。既然到处都要印，形态就必须统一：
 * 此前四处各写一份，`⌘S` 在工具栏是一种样子、`?` 在快捷键条是另一种样子。
 *
 * 用法约定：按钮内的尾随提示用默认的 `inline`，独立成项用 `cap`。
 */

export interface KbdProps
  extends React.HTMLAttributes<HTMLElement>,
    VariantProps<typeof kbdVariants> {}

export function Kbd({
  className,
  variant,
  children,
  ...rest
}: KbdProps): React.JSX.Element {
  return (
    <kbd className={cn(kbdVariants({ variant }), className)} {...rest}>
      {children}
    </kbd>
  );
}

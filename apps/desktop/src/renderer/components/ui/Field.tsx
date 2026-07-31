import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { FIELD_BASE } from "./variants";

/**
 * 表单控件 —— 统一的边框、占位符与焦点表现（DESIGN.md `components.field`）。
 * 焦点环由 index.css 的全局 `:focus-visible` 提供，此处只管边框态。
 */

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(FIELD_BASE, "h-9 px-2.5 text-sm", className)}
      {...rest}
    />
  );
});

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ className, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        className={cn(
          FIELD_BASE,
          "px-2.5 py-2 text-sm leading-relaxed",
          className,
        )}
        {...rest}
      />
    );
  },
);

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** 可见文案。整体包在 label 里，点文字也能切换 */
  readonly label: string;
  /** 悬停提示，用于解释这个开关到底做什么 */
  readonly hint?: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ className, label, hint, ...rest }, ref) {
    return (
      <label
        title={hint}
        className={cn(
          "inline-flex cursor-pointer select-none items-center gap-1.5 text-sm text-ink-secondary",
          "transition-colors duration-fast hover:text-ink",
          rest.disabled === true && "cursor-not-allowed opacity-60",
          className,
        )}
      >
        <input
          ref={ref}
          type="checkbox"
          className="size-3.5 shrink-0 accent-ink"
          {...rest}
        />
        {label}
      </label>
    );
  },
);

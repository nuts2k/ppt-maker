import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./Button";

/**
 * 分段控件 —— 一组互斥档位（页面筛选、视图切换这类）。
 *
 * 此前控制台、单页工具栏、最终确认页各写了一份 `fieldset` + 裸 `<button>`，
 * 三份的内边距已经开始漂移（px-2.5 / px-2.5 / px-3）。控件外壳与档位本来就是
 * 一件东西，拆开写就会各自演化，所以这里连外框一起收进基座。
 *
 * 档位复用 `Button` 的 `selected`，与独立按钮共用同一套选中视觉与
 * `aria-pressed` 语义 —— 两处若各自实现，迟早一处忘掉语义或一处换掉颜色。
 */

interface SegmentedGroupProps
  extends Omit<React.FieldsetHTMLAttributes<HTMLFieldSetElement>, "children"> {
  /** 这组档位在选什么。读屏用户没有视觉分组，得靠它 */
  readonly label: string;
  readonly children: React.ReactNode;
}

export function SegmentedGroup({
  label,
  className,
  children,
  ...rest
}: SegmentedGroupProps): React.JSX.Element {
  return (
    <fieldset
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-md border border-hairline p-0.5",
        className,
      )}
      {...rest}
    >
      <legend className="sr-only">{label}</legend>
      {children}
    </fieldset>
  );
}

/**
 * 一档。变体与尺寸由基座钉死：分段控件里出现 primary 或 md，说明用错了组件。
 */
export type SegmentedItemProps = Omit<
  ButtonProps,
  "variant" | "size" | "shape"
>;

export const SegmentedItem = forwardRef<HTMLButtonElement, SegmentedItemProps>(
  function SegmentedItem(props, ref) {
    return (
      <Button ref={ref} variant="ghost" size="sm" shape="segment" {...props} />
    );
  },
);

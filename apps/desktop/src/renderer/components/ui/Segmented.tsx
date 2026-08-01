import { forwardRef, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { resolveSegmentedNav } from "./segmented-nav";
import { buttonVariants } from "./variants";

/**
 * 分段控件 —— 一组互斥档位（页面筛选、视图切换这类）。
 *
 * 此前控制台、单页工具栏、最终确认页各写了一份 `fieldset` + 裸 `<button>`，
 * 三份的内边距已经开始漂移（px-2.5 / px-2.5 / px-3）。控件外壳与档位本来就是
 * 一件东西，拆开写就会各自演化，所以这里连外框一起收进基座。
 *
 * ## 语义是 radiogroup，不是一排切换按钮
 *
 * 档位曾复用 `Button` 的 `selected`，跟着拿到 `aria-pressed`。视觉没问题，语义不对：
 * `aria-pressed` 是「这个按钮当前被按下」，各档互相独立；实际是「一组里选一个，
 * 选了别的这个就自动松开」。读屏据此播报的内容与真实行为对不上。
 *
 * 换成 `radiogroup` / `radio` + `aria-checked` 就必须**连键盘行为一起换**——
 * 该模式承诺「整组只占一个 Tab 停靠点，组内用箭头键移动」。只改 role 不改键盘，
 * 等于承诺了不兑现，比原样保留 `aria-pressed` 更误导人。因此这里同时实现了
 * roving `tabIndex`（选中项 0、其余 -1）与箭头键导航（判定在 `segmented-nav.ts`）。
 *
 * 视觉仍走 `Button` 的 `selected`，与独立按钮共用同一套选中样式——
 * 两处若各自实现，迟早一处换掉颜色。
 */

interface SegmentedGroupProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children" | "role"> {
  /** 这组档位在选什么。读屏用户没有视觉分组，得靠它 */
  readonly label: string;
  readonly children: React.ReactNode;
}

/** 组内可聚焦档位。disabled 项不参与导航，与浏览器对 radiogroup 的处理一致 */
const ITEM_SELECTOR = '[role="radio"]:not([disabled])';

export function SegmentedGroup({
  label,
  className,
  children,
  onKeyDown,
  ...rest
}: SegmentedGroupProps): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * 兜底：一组里若一个都没选中（档位值可能暂时为空），所有项的 `tabIndex` 都是 -1，
   * 整组会从 Tab 序列里消失。这不是理论情况——「可用性随产物变化」的视图切换
   * 就可能短暂处于无选中态。此时把第一个可用档位设为 0，保证组始终可达。
   */
  useEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const items = [...root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
    const first = items[0];
    if (first === undefined) return;
    if (items.some((item) => item.tabIndex === 0)) return;
    first.tabIndex = 0;
  });

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      onKeyDown?.(event);
      if (event.defaultPrevented) return;

      const root = rootRef.current;
      if (root === null) return;
      const items = [...root.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
      const index = items.indexOf(event.target as HTMLElement);
      if (index === -1) return;

      const next = resolveSegmentedNav({
        key: event.key,
        count: items.length,
        index,
      });
      if (next === null) return;
      const target = items[next];
      if (target === undefined) return;

      event.preventDefault();
      /*
       * 移动焦点即选中，这是 radiogroup 的标准行为（区别于 tablist 的手动激活）。
       * 本项目三处分段控件切换都是即时且可逆的纯视图操作，没有「选错了代价很大」
       * 的档位，自动选中省掉一次确认按键。
       */
      target.focus();
      target.click();
    },
    [onKeyDown],
  );

  return (
    <div
      ref={rootRef}
      role="radiogroup"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex shrink-0 items-center gap-0.5 rounded-md border border-hairline p-0.5",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * 一档。变体与尺寸由基座钉死：分段控件里出现 primary 或 md，说明用错了组件。
 */
export interface SegmentedItemProps
  extends Omit<
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    "type" | "role" | "aria-checked" | "aria-pressed"
  > {
  /** 这一档是否为当前值。视觉与 `aria-checked` 由它一并决定，不许分开写 */
  readonly selected?: boolean;
}

/**
 * 这里直接渲染 `<button>` + `buttonVariants(...)`，而不是套 `Button` 组件。
 *
 * `Button` 把 `selected` 与 `aria-pressed` 绑死（那对独立的切换按钮是对的），
 * 而档位的选中语义必须是 `aria-checked`——同一个元素上挂两套互相矛盾的状态语义，
 * 读屏播报会自相打架。给 `Button` 加一个「不要输出 aria-pressed」的开关，等于把
 * 分段控件的特殊情况渗进通用按钮，正是变体表腐化的开始。
 *
 * 与 `Panel` 的折叠态是同一条原则：**语义不同就复用变体、不复用组件**，
 * 视觉仍出自同一张变体表，不构成漂移。
 */
export const SegmentedItem = forwardRef<HTMLButtonElement, SegmentedItemProps>(
  function SegmentedItem({ selected, className, children, ...rest }, ref) {
    return (
      /*
       * 原生 `<input type="radio">` 承载不了档位的按钮外观：它自带圆点，且带来原生
       * radiogroup 的焦点行为，会与这里的 roving tabindex 打架。
       * `button` + `role="radio"` 正是 WAI-ARIA APG 的 radio group 模式，
       * 代价是键盘行为要自己补齐 —— 上面的 `SegmentedGroup` 已经补了。
       */
      // biome-ignore lint/a11y/useSemanticElements: 见上，APG radio group 模式
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={selected ?? false}
        // roving tabindex：整组只占一个 Tab 停靠点，组内移动交给箭头键
        tabIndex={selected ? 0 : -1}
        className={cn(
          buttonVariants({
            variant: "ghost",
            size: "sm",
            shape: "segment",
            selected,
          }),
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

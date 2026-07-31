import { cva } from "class-variance-authority";
// 相对 `.js` 导入的理由同 status-spec.ts：测试侧的 tsconfig.node 不含 `@/*` 映射。
import { cn } from "../../lib/utils.js";

/**
 * 组件变体表 —— 纯数据，与组件实现分开。
 *
 * 分开是为了守住项目既有边界：测试一律只导入渲染层的纯 `.ts` 逻辑，不碰 `.tsx`
 * （`tsconfig.node.json` 覆盖 test/ 且不开 jsx，项目也因此不需要 DOM 测试库）。
 * 变体本来就是数据而非组件，放这里同时让 `test/ui-design-rules.test.ts`
 * 能直接把设计规则锁住。
 */

export const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md",
    "font-medium transition-colors",
    // 禁用与载入中一律不接受指针事件，避免「看着不能点其实点得动」
    "disabled:pointer-events-none disabled:opacity-40",
  ),
  {
    variants: {
      variant: {
        /** 主行动。**一屏只应出现一个。** */
        primary: "bg-ink text-on-ink hover:bg-ink-hover active:bg-ink-pressed",
        /** 与主按钮成对出现的次要动作 */
        secondary: cn(
          "border border-border bg-canvas text-ink",
          "hover:bg-surface active:bg-surface-sunken",
        ),
        /** 工具栏内的低权重动作，无边框 */
        ghost: cn(
          "text-ink-secondary",
          "hover:bg-surface hover:text-ink active:bg-surface-sunken",
        ),
        /** 破坏性动作，用校对红 */
        danger: cn(
          "bg-proof text-on-ink",
          "hover:bg-proof-hover active:bg-proof-strong",
        ),
      },
      size: {
        sm: "h-7 px-2.5 text-xs",
        md: "h-9 px-4 text-sm",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

/** 方形内边距，覆盖按钮变体里的横向 padding（IconButton 用） */
export const ICON_BUTTON_SIZE = {
  sm: "h-7 w-7 p-0",
  md: "h-9 w-9 p-0",
} as const;

/**
 * 面板层级 —— 三档，不做更多（DESIGN.md `Elevation & Depth`）。
 * 阴影极轻，只表达「浮在上面」，不做装饰。**禁止毛玻璃。**
 */
export const panelVariants = cva("rounded-lg", {
  variants: {
    elevation: {
      /** 默认面板：描边，不起浮 */
      flat: "border border-hairline bg-canvas",
      /** 浮层、下拉、当前选中：描边 + 极轻双层阴影 */
      raised: cn(
        "border border-hairline bg-canvas",
        "shadow-[0_1px_2px_rgb(0_0_0/0.04),0_1px_3px_rgb(0_0_0/0.06)]",
      ),
      /** 凹陷区、预览衬底：无描边，靠底色下沉 */
      sunken: "bg-surface-sunken",
    },
  },
  defaultVariants: { elevation: "flat" },
});

/** 表单控件基础态，Input / Textarea 共用 */
export const FIELD_BASE = cn(
  "w-full rounded-sm border border-border bg-canvas text-ink",
  // 占位符按正文标准要求 4.5:1（ink-muted 对 canvas 是 5.28:1），
  // 不适用「灰一点更优雅」的例外 —— 那是 AI 生成界面最常见的可读性失误。
  "placeholder:text-ink-muted",
  "transition-colors hover:border-border-strong",
  "disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-60",
);

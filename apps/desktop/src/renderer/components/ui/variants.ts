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
    "inline-flex shrink-0 items-center justify-center gap-1.5",
    // 时长显式声明，不吃 tailwind 配置里的 DEFAULT：基座是全局默认值的源头，
    // 这里隐式了，全应用的按钮都跟着隐式（PRD AC5 逐处核查）。
    "font-medium transition-colors duration-fast",
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
      /**
       * 几何两档，**只有这两档**。
       *
       * `segment` 存在的唯一理由是它嵌在 `SegmentedGroup` 的 p-0.5 外框内，
       * 内角必须比外框收一档才不会出现两条同心圆角。除此之外与独立按钮完全同形
       * （同高、同内边距），所以调用点不需要、也不允许再拿 className 补几何差异 ——
       * 上一版四份 BUTTON_* 常量的漂移就是从「这里稍微紧一点」开始的。
       */
      shape: {
        default: "rounded-md",
        segment: "rounded-sm",
      },
      /**
       * 选中态 —— 二选一 / 多选一控件的**当前值**，不是主行动。
       *
       * 刻意不复用 `primary`：primary 是全屏唯一主行动的专属变体（DESIGN.md
       * `Buttons`），拿它标当前值会让「主行动」在一屏里出现几十个，主次立刻失效。
       *
       * 双载体（下沉底色 + 字重），灰度与色弱下同样可分辨（PRD A3）。选中项照样
       * 给 hover / active 反馈，但只能往**更深**走 —— 沿用未选中态的 `hover:bg-surface`
       * 会让鼠标划过时选中项反而变浅，读起来像取消选中。
       *
       * 放在 `variant` 之后是有意的：cva 按声明顺序拼接，组件侧的 `cn`（tailwind-merge）
       * 因此让选中态的底色赢过任何变体底色，`variant="primary" selected` 也不会渲染成墨底。
       */
      selected: {
        true: cn(
          // 字重必须比未选中态**更重一档**（基础态已经是 font-medium），
          // 否则「双载体」只剩底色一条，灰度下就退化成单一载体了。
          "bg-surface-sunken font-semibold text-ink",
          "hover:bg-hairline hover:text-ink active:bg-hairline",
        ),
        false: "",
      },
    },
    compoundVariants: [
      // 有边框的变体多给一层灰度信号：底色之外再加深边框
      {
        variant: "secondary",
        selected: true,
        class: "border-border-strong",
      },
    ],
    defaultVariants: {
      variant: "secondary",
      size: "md",
      shape: "default",
      selected: false,
    },
  },
);

/**
 * 键位提示 —— 两档，按「有没有外壳」分。
 *
 * 字族一律 `font-sans`：⌘ ⇧ ⌥ ↓ 这些符号在等宽字体里字形普遍更差，
 * 而键位提示要的是一眼认出符号，不是对齐列。
 */
export const kbdVariants = cva("shrink-0 font-sans text-2xs", {
  variants: {
    variant: {
      /** 按钮内的尾随提示：外壳由按钮提供，再套一层框就成了框中框 */
      inline: "text-ink-muted",
      /** 独立成项（快捷键面板、说明列表）：没有外壳，得自己长一个才像「键」 */
      cap: "rounded-xs border border-hairline bg-surface px-1.5 py-0.5 font-medium text-ink",
    },
  },
  defaultVariants: { variant: "inline" },
});

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
  "transition-colors duration-fast hover:border-border-strong",
  "disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-60",
);

import type { Config } from "tailwindcss";

/**
 * 设计令牌 —— 校样台（proof desk）。
 *
 * 战略上下文见根目录 PRODUCT.md，视觉契约见根目录 DESIGN.md。
 *
 * 三条不可违背的约定：
 *
 * 1. **中性阶 chroma 严格为 0**。纸是真中性白，不是奶油/米色。暖调近白
 *    （OKLCH L 0.84–0.97、C < 0.06、hue 40–100）是被明令禁止的 AI 默认色带，
 *    令牌命名同样禁止出现 paper / cream / sand / parchment / linen / ivory。
 *    「暖意」由校对红、字体与排版承担，绝不由底色承担。
 *
 * 2. **有颜色 = 要你管**。完成是常态（一叠 20–50 页里绝大多数处于完成态），
 *    常态必须安静。所以 completed 走中性色，饱和色只留给 running / stale / failed
 *    这三个需要用户动作的状态。旧版用深绿标完成，9 个绿点满屏是全局最大噪音源。
 *
 * 3. **对比度逐项验算，不靠肉眼**。全部组合见
 *    `.trellis/tasks/07-30-desktop-design-language-rebuild/research/palette-contrast.mjs`。
 *    改动任一颜色令牌后必须重跑该脚本，22 项须全部通过。
 *
 * 颜色一律带 `<alpha-value>` 占位符，否则 `bg-proof/10` 这类透明度修饰符失效。
 */

/** 中性阶与语义色的唯一来源。改这里之前先读上面第 3 条。 */
const palette = {
  // ── 纸与面（中性阶，chroma 恒为 0）──────────────────────────
  canvas: "oklch(1 0 0 / <alpha-value>)", //            #ffffff 纸
  surface: "oklch(0.976 0 0 / <alpha-value>)", //       #f7f7f7 面板、次级面
  "surface-sunken": "oklch(0.945 0 0 / <alpha-value>)", // #ededed 预览衬底、凹陷区

  /** 仅装饰性分隔，不承担 WCAG 1.4.11 的 3:1 责任 */
  hairline: "oklch(0.902 0 0 / <alpha-value>)", //       #dedede
  /** 控件边界（输入框、次级按钮），已验算 ≥3:1 */
  border: "oklch(0.64 0 0 / <alpha-value>)", //          #8c8c8c
  "border-strong": "oklch(0.52 0 0 / <alpha-value>)", // #696969

  /** 焦点环。配 2px offset，在墨色主按钮上同样落到浅色面（17.31:1） */
  focus: "oklch(0.22 0 0 / <alpha-value>)", //           #1b1b1b

  // ── 墨 ────────────────────────────────────────────────────
  ink: "oklch(0.22 0 0 / <alpha-value>)", //             #1b1b1b 正文、主按钮底
  // 近黑按钮的 hover 应当变亮、按压才变暗；反过来在深色上几乎看不出变化
  "ink-hover": "oklch(0.3 0 0 / <alpha-value>)", //      #2c2c2c 主按钮悬停
  "ink-pressed": "oklch(0.12 0 0 / <alpha-value>)", //   #0b0b0b 主按钮按压
  "ink-secondary": "oklch(0.44 0 0 / <alpha-value>)", // #525252 次要文字
  "ink-muted": "oklch(0.53 0 0 / <alpha-value>)", //     #6c6c6c 弱化文字、占位符（4.93:1）
  "on-ink": "oklch(1 0 0 / <alpha-value>)", //           #ffffff 墨底上的字

  // ── 校对红：全屏唯一高饱和色，只标「差异」与「待我处理」──────
  proof: "oklch(0.52 0.19 25 / <alpha-value>)", //       #be222a
  "proof-hover": "oklch(0.575 0.19 25 / <alpha-value>)", // #d4383b 悬停（白字 4.81:1，勿再提亮）
  "proof-strong": "oklch(0.43 0.17 25 / <alpha-value>)", // #970818 按压态
  "proof-wash": "oklch(0.96 0.022 25 / <alpha-value>)", //  #ffedea 差异高亮底

  // ── 状态语义（与品牌色彻底分离，不再挪用 signature-*）────────
  "state-running": "oklch(0.5 0.15 250 / <alpha-value>)", // #0065b4 进行中
  "state-stale": "oklch(0.52 0.12 75 / <alpha-value>)", //   #905d00 失效（不是失败）
  "state-failed": "oklch(0.45 0.17 15 / <alpha-value>)", //  #9d1135 失败/中断
} as const;

/**
 * 迁移期的旧令牌别名（`primary` / `body` / `muted` / `success` / `info` / `link` /
 * `signature-*` / `surface-soft` 等）已于阶段二收尾**全部删除**，24 个组件文件均已改用
 * 上面的新令牌。**不要再把它们加回来**：别名的存在会让「完成态用绿色」这类旧语义
 * 有路可走，而这正是本次重构要根除的东西。
 */

const config: Config = {
  content: ["./src/renderer/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: palette,

      /**
       * 圆角比旧版收紧一档（旧：2/6/10/12）。
       * 校样台要的是精密感，12px 圆角偏消费级，读起来不像工具。
       */
      borderRadius: {
        xs: "2px",
        sm: "4px",
        md: "6px",
        lg: "8px",
      },

      /**
       * 字号：tailwind 默认的 xs/sm/base/lg/xl/2xl = 12/14/16/18/20/24px
       * 正好是本项目要的阶梯，不重复定义；只补默认刻度缺的两档。
       *
       * 背景：旧实现 139 处字号声明里 128 处是同一个 text-sm，等于没有层次。
       * 重构必须真正把层级用起来，而不是继续单字级。
       */
      fontSize: {
        "2xs": ["11px", { lineHeight: "1.4" }], // 状态角标、计数徽标
        "display-md": ["32px", { lineHeight: "1.2" }], // 仅空态品牌位
      },

      fontFamily: {
        sans: [
          "Inter",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },

      /**
       * 动效：product register 规范 150–250ms。用户在任务流里，
       * 不该等编排动画。DEFAULT 设 180ms，让裸 `transition` 也落在区间内
       * （旧实现 38 处 transition 全是裸默认 150ms，无显式声明也无减弱兜底）。
       */
      transitionDuration: {
        DEFAULT: "180ms",
        // 150ms 是区间下沿而非 120ms：`fast` 是悬停/焦点这类高频微反馈的默认档，
        // 占了全部动效声明的绝大多数，让它掉出规范区间等于规范形同虚设。
        // 150 与 120 在体感上无法分辨，但前者守住了 R3。
        fast: "150ms",
        slow: "250ms",
      },
      transitionTimingFunction: {
        // ease-out-quart：收尾平缓，无回弹无弹性
        DEFAULT: "cubic-bezier(0.25, 1, 0.5, 1)",
        "out-quart": "cubic-bezier(0.25, 1, 0.5, 1)",
      },

      /**
       * 层叠：只有三档，且都有名字。
       *
       * 裸数字的问题不是「不够用」而是「不可比」——三处 popover 各写各的 `z-20`
       * 时，谁也说不清它们该不该相等，下次新增一个浮层就只能靠猜。刻度一旦有语义，
       * 「粘性表头压不过弹出层」就成了看一眼名字即可判断的事。
       *
       * 画布内文本块的堆叠（`TextBlockOverlay` 的 zIndex 1/2/3）不走这套：
       * 那是同一平面内部的相对次序，与页面级浮层不构成同一个比较域。
       */
      zIndex: {
        sticky: "10", // 滚动容器内的粘性表头/工具条
        popover: "20", // 下拉菜单、快捷键面板、诊断浮层
        overlay: "30", // 覆盖整页的遮罩与模态
      },
    },
  },
  plugins: [],
};

export default config;

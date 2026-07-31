/**
 * 画布标注取色 —— `TextBlockOverlay` 专用。
 *
 * ## 为什么这些颜色不能写成类名
 *
 * 标注框在缩放容器内部，描边、光晕、焦点环的宽度必须按 `scale` 逐帧反算
 * （`border-2` 在 scale≈0.38 时实际只渲染 0.76px）。宽度只能写进 inline style，
 * 而 `border` / `box-shadow` / `outline` 是宽度与颜色一体的简写，颜色也就跟着
 * 落在了 JS 里，用不上 Tailwind 类。
 *
 * ## 为什么值写成 oklch 而不是 hex
 *
 * 这里与 `tailwind.config.ts` 的 `palette` 是同一件事的两处存放——本项目 spec
 * 反复记录的失效形状。更糟的是它**静默**：改了配置里的 `proof`，画布上的红纹丝
 * 不动，没有任何东西会报错。
 *
 * 解法不是靠注释提醒「记得两边一起改」（那是人肉同步，迟早漏），而是让两边成为
 * **可逐字比对的同一串字符**：本文件的基色与 palette 逐字对齐，只把配置里的
 * `<alpha-value>` 占位符换成实际透明度。若写成 hex，两边一个 `#be222a` 一个
 * `oklch(0.52 0.19 25)`，机器与肉眼都看不出漂移。
 *
 * 浏览器原生支持 oklch，inline style 直接可用。
 *
 * **同步由 `test/ui-design-rules.test.ts` 锁住**：对 `OVERLAY_BASE` 的每个键断言
 * `withAlpha(base, "<alpha-value>") === palette[同名键]`。故此处不需要、也不应该
 * 再写「改令牌时记得同步」这类提醒。
 */

/**
 * 基色 —— 键名与 `tailwind.config.ts` 的 `palette` 键**逐字同名**，值为该键去掉
 * ` / <alpha-value>` 后的部分。新增取色时先确认 palette 里有对应令牌，
 * 不要在这里发明画布专属的颜色。
 */
export const OVERLAY_BASE = {
  canvas: "oklch(1 0 0)",
  ink: "oklch(0.22 0 0)",
  "border-strong": "oklch(0.52 0 0)",
  proof: "oklch(0.52 0.19 25)",
} as const;

/**
 * 给基色补透明度，等价于 Tailwind 的 `bg-proof/12`。
 *
 * 传 `"<alpha-value>"` 即还原成 palette 里的原串，测试据此逐字比对。
 */
export function withAlpha(base: string, alpha: number | string): string {
  return `${base.slice(0, -1)} / ${alpha})`;
}

/** 当前项描边：校对红，全屏唯一高饱和色，只标「差异」与「待我处理」 */
export const PROOF = OVERLAY_BASE.proof;
/** 当前项底色：够浅，不遮住底图上的字形 */
export const PROOF_FILL = withAlpha(OVERLAY_BASE.proof, 0.12);
/** 当前项外晕：向外扩散，让 13–19px 高的小块在缩略视图下也能一眼扫到 */
export const PROOF_GLOW = withAlpha(OVERLAY_BASE.proof, 0.3);

/** 描边之间的白色间隔：彩色底图上纯色边可能与底色同明度而糊掉，垫一圈白才留得住形 */
export const CANVAS = OVERLAY_BASE.canvas;

/** 非当前项描边：中性，不构成强调（有颜色 = 要你管） */
export const BORDER_STRONG = OVERLAY_BASE["border-strong"];

/** 悬停描边与键盘焦点环共用；palette 里 `focus` 与 `ink` 同值 */
export const INK = OVERLAY_BASE.ink;
/** 悬停底色：比当前项更淡，不与「当前项」抢读 */
export const INK_FILL = withAlpha(OVERLAY_BASE.ink, 0.06);

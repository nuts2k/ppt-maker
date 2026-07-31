/**
 * 设计规则回归锁 —— 守的是 DESIGN.md 里几条容易被后续维护悄悄改掉的硬规则。
 *
 * 本项目测试一律纯逻辑（没有 DOM 测试库，也不为此新增依赖），因此这里测的是
 * cva 变体与状态表这些**纯函数产物**，而不是渲染结果。这反而更合适：
 * 要守的是「完成态不许用饱和色」这类规则，不是某个像素长什么样。
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  OVERLAY_BASE,
  withAlpha,
} from "../src/renderer/components/canvas/overlay-colors.js";
import { STATUS_SPEC } from "../src/renderer/components/ui/status-spec.js";
import {
  buttonVariants,
  kbdVariants,
  panelVariants,
} from "../src/renderer/components/ui/variants.js";
import type { StageViewStatus } from "../src/renderer/lib/stage-view.js";
import { cn } from "../src/renderer/lib/utils.js";
import config from "../tailwind.config.js";

/** 与 lib/stage-view.ts 的 StageViewStatus 一一对应；漏一个下面的穷尽性用例就会红 */
const ALL_STATUSES: readonly StageViewStatus[] = [
  "pending",
  "running",
  "completed",
  "failed",
  "interrupted",
  "stale",
];

/** 需要用户动作的状态 —— 只有这三类允许上饱和色 */
const ACTIONABLE: readonly StageViewStatus[] = [
  "running",
  "stale",
  "failed",
  "interrupted",
] as const;

/** 常态 —— 必须安静 */
const QUIET: readonly StageViewStatus[] = ["completed", "pending"];

describe("状态表", () => {
  it("覆盖全部 StageViewStatus，无遗漏", () => {
    for (const status of ALL_STATUSES) {
      expect(STATUS_SPEC[status], `缺少状态 ${status}`).toBeDefined();
    }
    expect(Object.keys(STATUS_SPEC).sort()).toEqual([...ALL_STATUSES].sort());
  });

  /**
   * 「有颜色 = 要你管」是本设计最重要的一条规则，也是最容易被后来人
   * 「顺手把完成态改成绿色」破坏的一条。上一版 9 个绿点满屏就是这么来的。
   */
  it("常态（已完成/待执行）不得使用饱和状态色", () => {
    for (const status of QUIET) {
      const spec = STATUS_SPEC[status];
      const surface = `${spec.dot} ${spec.text} ${spec.wash}`;
      expect(surface, `${status} 不该出现 state-* 饱和色`).not.toMatch(
        /state-(running|stale|failed)/,
      );
      expect(surface, `${status} 不该出现校对红`).not.toMatch(/proof/);
    }
  });

  it("需要动作的状态各自带饱和色", () => {
    for (const status of ACTIONABLE) {
      const spec = STATUS_SPEC[status];
      expect(`${spec.dot} ${spec.text}`, `${status} 应当带 state-* 色`).toMatch(
        /state-(running|stale|failed)/,
      );
    }
  });

  /**
   * A3 / PRD AC9：灰度与色弱条件下五态仍需可分辨，所以形状必须互不相同。
   * completed 与 pending 同为中性色，靠实心/空心区分。
   */
  it("形状可区分：完成实心圆、待执行空心圆、失效三角、失败方块", () => {
    expect(STATUS_SPEC.completed.dot).toMatch(/rounded-full/);
    expect(STATUS_SPEC.completed.dot).not.toMatch(/border-/);

    expect(STATUS_SPEC.pending.dot).toMatch(/rounded-full/);
    expect(STATUS_SPEC.pending.dot, "待执行必须是空心").toMatch(/border-/);

    expect(STATUS_SPEC.stale.dot, "失效必须是三角").toMatch(/clip-path/);

    expect(STATUS_SPEC.failed.dot, "失败必须是方块").toMatch(/rounded-xs/);
    expect(STATUS_SPEC.interrupted.dot).toMatch(/rounded-xs/);
  });

  it("每个状态都带图标与文字，不只靠颜色", () => {
    for (const status of ALL_STATUSES) {
      const spec = STATUS_SPEC[status];
      // lucide v1 的图标是 forwardRef 对象，typeof 为 "object" 而非 "function"，
      // 因此只断言它是个可渲染的组件引用，不锁具体形态。
      expect(spec.icon, `${status} 缺图标`).toBeTruthy();
      expect(["function", "object"], `${status} 图标不可渲染`).toContain(
        typeof spec.icon,
      );
      expect(spec.label.length, `${status} 缺文案`).toBeGreaterThan(0);
    }
  });

  /**
   * stale 不是 failed：「失效」是改了上游后的常规路径，写成「失败」会把一次
   * 正常的「改完了、重跑一下」报成红色故障。
   * 见 .trellis/spec/frontend/state-management.md「一个判据兼职两件事」邻节。
   */
  it("失效的文案不得写成失败", () => {
    expect(STATUS_SPEC.stale.label).not.toMatch(/失败/);
    expect(STATUS_SPEC.stale.label).toMatch(/变更/);
  });
});

const VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;

describe("按钮变体", () => {
  it("四个变体两两不同", () => {
    const rendered = VARIANTS.map((variant) => buttonVariants({ variant }));
    expect(new Set(rendered).size).toBe(VARIANTS.length);
  });

  /** 上一版全应用 hover 命中 0 次 —— 桌面应用鼠标划过毫无响应 */
  it("每个变体都有 hover 与 active 态", () => {
    for (const variant of VARIANTS) {
      const cls = buttonVariants({ variant });
      expect(cls, `${variant} 缺 hover 态`).toMatch(/hover:/);
      expect(cls, `${variant} 缺 active 态`).toMatch(/active:/);
    }
  });

  it("禁用态既降透明度也拦指针事件", () => {
    const cls = buttonVariants({});
    expect(cls).toMatch(/disabled:opacity-40/);
    expect(cls, "只降透明度会让按钮看着不能点其实点得动").toMatch(
      /disabled:pointer-events-none/,
    );
  });

  it("两个尺寸高度不同", () => {
    expect(buttonVariants({ size: "sm" })).not.toBe(
      buttonVariants({ size: "md" }),
    );
  });
});

/**
 * 选中态 —— 二选一控件的当前值。
 *
 * 组件侧渲染的是 `cn(buttonVariants(...), className)`，`cn` 会做 tailwind-merge，
 * 所以这里也一律先过 `cn` 再断言：只看 cva 的裸输出会把「后写的类赢过先写的类」
 * 这一层规则漏掉，断言就与真实渲染结果不是一回事。
 */
describe("按钮选中态", () => {
  const render = (options: Parameters<typeof buttonVariants>[0] = {}): string =>
    cn(buttonVariants(options));

  /** 抽出实际生效的某一类 utility，用于比较选中与未选中之间**真的有差别** */
  const pick = (cls: string, pattern: RegExp): string | undefined =>
    cls.split(" ").find((token) => pattern.test(token));

  /**
   * 选中不是主行动。primary 是全屏唯一主行动的专属变体，拿它标当前值会让
   * 「主行动」在一屏里出现几十个 —— 上一版把签名色挪作他用的同一种错误。
   * 连 `variant="primary" selected` 这种写法也必须被底色规则压回去。
   */
  it("任何变体上选中都不得渲染成墨底或校对红底", () => {
    for (const variant of VARIANTS) {
      const cls = render({ variant, selected: true });
      expect(cls, `${variant} 选中态不该出现墨底`).not.toMatch(
        /(^|\s)bg-ink(?![\w-])/,
      );
      expect(cls, `${variant} 选中态不该出现校对红底`).not.toMatch(
        /(^|\s)bg-proof(?![\w-])/,
      );
      expect(cls, `${variant} 选中态底色应为下沉面`).toMatch(
        /(^|\s)bg-surface-sunken(?![\w-])/,
      );
    }
  });

  /**
   * A3：状态不能只靠颜色。选中与未选中必须**同时**在底色与字重上有差别，
   * 灰度截图与色弱条件下才分得开。
   */
  it("选中与未选中在底色与字重上都不同（双载体）", () => {
    const on = render({ selected: true });
    const off = render({ selected: false });

    const bg = /^bg-/;
    const weight = /^font-(normal|medium|semibold|bold)$/;

    expect(pick(on, bg), "选中态缺底色").toBeDefined();
    expect(pick(on, bg)).not.toBe(pick(off, bg));

    expect(pick(on, weight), "选中态缺字重").toBeDefined();
    expect(
      pick(on, weight),
      "字重与未选中相同 = 灰度下只剩底色一条载体",
    ).not.toBe(pick(off, weight));
  });

  /** 选中项照样要有 hover 反馈，且只能更深 —— 变浅读起来像「按下去就取消了」 */
  it("选中态的 hover 不回落到未选中的浅底", () => {
    const on = render({ variant: "ghost", selected: true });
    expect(on).toMatch(/hover:bg-/);
    expect(pick(on, /^hover:bg-/)).not.toBe("hover:bg-surface");
  });

  /** 分段控件与独立按钮同高同内边距，只差圆角一档（外框已有圆角，内角要收） */
  it("segment 只改圆角，不改几何", () => {
    const seg = render({ shape: "segment", size: "sm" });
    const box = render({ shape: "default", size: "sm" });
    expect(seg).toMatch(/(^|\s)rounded-sm(?!\w)/);
    expect(box).toMatch(/(^|\s)rounded-md(?!\w)/);
    expect(pick(seg, /^h-/)).toBe(pick(box, /^h-/));
    expect(pick(seg, /^px-/)).toBe(pick(box, /^px-/));
  });
});

describe("键位提示", () => {
  /** ⌘ ⇧ ⌥ ↓ 在等宽字体里字形普遍更差，键位提示要的是一眼认出符号 */
  it("两档都用 font-sans，不用等宽", () => {
    for (const variant of ["inline", "cap"] as const) {
      expect(kbdVariants({ variant })).toMatch(/font-sans/);
      expect(kbdVariants({ variant })).not.toMatch(/font-mono/);
    }
  });

  it("按钮内的 inline 档不自带外壳，独立成项的 cap 档才有", () => {
    expect(kbdVariants({ variant: "inline" })).not.toMatch(/border|bg-/);
    expect(kbdVariants({ variant: "cap" })).toMatch(/border/);
  });
});

describe("面板层级", () => {
  it("只有 raised 起阴影，flat 与 sunken 不起", () => {
    expect(panelVariants({ elevation: "raised" })).toMatch(/shadow-/);
    expect(panelVariants({ elevation: "flat" })).not.toMatch(/shadow-/);
    expect(panelVariants({ elevation: "sunken" })).not.toMatch(/shadow-/);
  });

  it("不得使用毛玻璃", () => {
    for (const elevation of ["flat", "raised", "sunken"] as const) {
      expect(panelVariants({ elevation })).not.toMatch(/backdrop-blur/);
    }
  });
});

/**
 * 画布标注的线宽必须按 scale 逐帧反算，只能写 inline style，颜色因此无法用类名表达，
 * 只能取字面量 —— 这就构成「同一件事在两处各存一份」，而且是**静默**的那种：
 * 改了 tailwind 的 proof，画布上的红纹丝不动，没有任何东西会报错。
 * 见 .trellis/spec/guides/silent-failure-thinking-guide.md。
 *
 * 下面两条锁必须配对使用。只有正向锁的话，后来人绕过 overlay-colors 直接在 tsx 里
 * 写死 `#be222a`，正向锁照样全绿 —— 它守的是模块里的值，不是画布上真正用的值。
 */
describe("画布标注色与令牌同源", () => {
  const colors = config.theme?.extend?.colors as Record<string, string>;

  it("每个标注基色与 palette 同名令牌逐字相同", () => {
    for (const [key, base] of Object.entries(OVERLAY_BASE)) {
      expect(colors[key], `palette 里没有 ${key} 这个令牌`).toBeDefined();
      expect(withAlpha(base, "<alpha-value>"), `${key} 与令牌已漂移`).toBe(
        colors[key],
      );
    }
  });

  it("画布组件不得就地拼色，一律走 overlay-colors", () => {
    const src = readFileSync(
      new URL(
        "../src/renderer/components/canvas/TextBlockOverlay.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(src, "出现 hex 字面量，说明有人绕过了 overlay-colors").not.toMatch(
      /#[0-9a-fA-F]{6}\b/,
    );
    expect(src, "出现 rgba() 字面量，同上").not.toMatch(/rgba\(/);
  });
});

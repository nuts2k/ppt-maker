/**
 * 设计规则回归锁 —— 守的是 DESIGN.md 里几条容易被后续维护悄悄改掉的硬规则。
 *
 * 本项目测试一律纯逻辑（没有 DOM 测试库，也不为此新增依赖），因此这里测的是
 * cva 变体与状态表这些**纯函数产物**，而不是渲染结果。这反而更合适：
 * 要守的是「完成态不许用饱和色」这类规则，不是某个像素长什么样。
 */

import { describe, expect, it } from "vitest";
import { STATUS_SPEC } from "../src/renderer/components/ui/status-spec.js";
import {
  buttonVariants,
  panelVariants,
} from "../src/renderer/components/ui/variants.js";
import type { StageViewStatus } from "../src/renderer/lib/stage-view.js";

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

describe("按钮变体", () => {
  const VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;

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

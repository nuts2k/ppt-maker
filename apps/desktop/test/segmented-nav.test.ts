/**
 * 分段控件的 radiogroup 键盘模式。
 *
 * 这组用例存在的理由：把 `aria-pressed` 换成 `role="radio"` 就等于向读屏承诺了
 * 「组内箭头键可用、两端环绕、Home/End 到头尾」。承诺一旦写进 role，兑现与否
 * 就不再是可选项——用例锁的是这份承诺，不是某个像素。
 */

import { describe, expect, it } from "vitest";
import {
  resolveSegmentedNav,
  type SegmentedNavInput,
} from "../src/renderer/components/ui/segmented-nav.js";

function nav(overrides: Partial<SegmentedNavInput>): number | null {
  return resolveSegmentedNav({ key: "", count: 4, index: 0, ...overrides });
}

describe("组内移动", () => {
  it("→ 与 ↓ 都前进一档：横排是视觉事实，读屏用户的习惯键位并不统一", () => {
    expect(nav({ key: "ArrowRight", index: 1 })).toBe(2);
    expect(nav({ key: "ArrowDown", index: 1 })).toBe(2);
  });

  it("← 与 ↑ 都后退一档", () => {
    expect(nav({ key: "ArrowLeft", index: 2 })).toBe(1);
    expect(nav({ key: "ArrowUp", index: 2 })).toBe(1);
  });

  it("Home / End 直达首尾", () => {
    expect(nav({ key: "Home", index: 2 })).toBe(0);
    expect(nav({ key: "End", index: 2 })).toBe(3);
  });
});

describe("两端环绕", () => {
  // 与块列表的 Tab 边界放行不冲突：那里 Tab 兼着「离开列表」，
  // 这里箭头键只在组内移动，组的出口是 Tab 本身。
  it("末档前进回到首档", () => {
    expect(nav({ key: "ArrowRight", index: 3 })).toBe(0);
  });

  it("首档后退到末档", () => {
    expect(nav({ key: "ArrowLeft", index: 0 })).toBe(3);
  });
});

describe("放行边界", () => {
  it("Tab 不归组内导航管——它是整组的出口", () => {
    expect(nav({ key: "Tab", index: 1 })).toBeNull();
  });

  it("Enter / Space 交给按钮自身", () => {
    expect(nav({ key: "Enter", index: 1 })).toBeNull();
    expect(nav({ key: " ", index: 1 })).toBeNull();
  });

  it("普通字符不干预", () => {
    expect(nav({ key: "a", index: 1 })).toBeNull();
  });

  it("空组不返回下标，避免调用方索引到 undefined", () => {
    expect(nav({ key: "ArrowRight", count: 0, index: 0 })).toBeNull();
    expect(nav({ key: "Home", count: 0, index: 0 })).toBeNull();
  });

  it("单档组：任何方向都停在自己身上", () => {
    expect(nav({ key: "ArrowRight", count: 1, index: 0 })).toBe(0);
    expect(nav({ key: "ArrowLeft", count: 1, index: 0 })).toBe(0);
  });
});

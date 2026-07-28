/**
 * 键盘流用例锁定「全程仅用键盘完成一页复核」这条验收标准（PRD 复核体验层）。
 *
 * 输入法一组用例来自 2026-07-27 E1 走查实测的真实故障：中文输入法用 ↓ 选字时，
 * 列表把它当成「推进到下一个块」，表现为选不了字、光标却跳走了。
 */

import { describe, expect, it } from "vitest";
import {
  type ReviewKeyAction,
  type ReviewKeyInput,
  resolveReviewKeyAction,
} from "../src/renderer/lib/review-keyboard.js";

function press(overrides: Partial<ReviewKeyInput>): ReviewKeyAction {
  return resolveReviewKeyAction({
    key: "",
    code: "",
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    isComposing: false,
    targetIsButton: false,
    ...overrides,
  });
}

describe("列表导航", () => {
  it("Tab 前进、⇧Tab 后退", () => {
    expect(press({ key: "Tab" })).toEqual({ kind: "move", delta: 1 });
    expect(press({ key: "Tab", shiftKey: true })).toEqual({
      kind: "move",
      delta: -1,
    });
  });

  it("↓ 前进、↑ 后退", () => {
    expect(press({ key: "ArrowDown" })).toEqual({ kind: "move", delta: 1 });
    expect(press({ key: "ArrowUp" })).toEqual({ kind: "move", delta: -1 });
  });

  it("Enter 标记已复核并前进，⇧Enter 放行以插入换行", () => {
    expect(press({ key: "Enter" })).toEqual({ kind: "review-and-move" });
    expect(press({ key: "Enter", shiftKey: true })).toEqual({
      kind: "passthrough",
    });
  });

  it("普通字符不拦截，聚焦项可直接打字", () => {
    expect(press({ key: "a", code: "KeyA" })).toEqual({ kind: "passthrough" });
    expect(press({ key: "1", code: "Digit1" })).toEqual({
      kind: "passthrough",
    });
  });
});

describe("分类快捷键", () => {
  // macOS 上 ⌥1 的 key 是 `¡`、⌥2 是 `™`，按 key 判会完全失效
  it("⌥1 改为版式文字、⌥2 改为对象内符号，按 code 判定", () => {
    expect(press({ key: "¡", code: "Digit1", altKey: true })).toEqual({
      kind: "classify",
      toLayoutText: true,
    });
    expect(press({ key: "™", code: "Digit2", altKey: true })).toEqual({
      kind: "classify",
      toLayoutText: false,
    });
  });

  it("其余 ⌥ 组合一律放行", () => {
    expect(press({ key: "£", code: "Digit3", altKey: true })).toEqual({
      kind: "passthrough",
    });
    expect(press({ key: "ArrowDown", altKey: true })).toEqual({
      kind: "passthrough",
    });
  });
});

describe("放行边界", () => {
  it("⌘/Ctrl 组合冒泡到页面级监听（⌘S 保存）", () => {
    expect(press({ key: "s", code: "KeyS", metaKey: true })).toEqual({
      kind: "passthrough",
    });
    expect(press({ key: "s", code: "KeyS", ctrlKey: true })).toEqual({
      kind: "passthrough",
    });
  });

  it("焦点在项内按钮上时 Enter 放行，否则 preventDefault 会吃掉 click", () => {
    expect(press({ key: "Enter", targetIsButton: true })).toEqual({
      kind: "passthrough",
    });
  });
});

describe("输入法组字期间一律放行（E1 走查实测缺陷）", () => {
  it("↓/↑ 归输入法选字，不推进列表", () => {
    expect(press({ key: "ArrowDown", isComposing: true })).toEqual({
      kind: "passthrough",
    });
    expect(press({ key: "ArrowUp", isComposing: true })).toEqual({
      kind: "passthrough",
    });
  });

  it("Enter 归输入法确认候选，不标记已复核", () => {
    expect(press({ key: "Enter", isComposing: true })).toEqual({
      kind: "passthrough",
    });
  });

  it("Tab 归输入法翻候选页，不推进列表", () => {
    expect(press({ key: "Tab", isComposing: true })).toEqual({
      kind: "passthrough",
    });
  });

  it("⌥1/⌥2 在组字期间也不改分类", () => {
    expect(
      press({ key: "¡", code: "Digit1", altKey: true, isComposing: true }),
    ).toEqual({ kind: "passthrough" });
  });

  it("组字结束后同一个键恢复列表导航", () => {
    expect(press({ key: "ArrowDown", isComposing: false })).toEqual({
      kind: "move",
      delta: 1,
    });
  });
});

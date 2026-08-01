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
  resolveMoveTargetId,
  resolveReviewKeyAction,
  resolveShortcutPanelKey,
  type ShortcutPanelKeyAction,
  type ShortcutPanelKeyInput,
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
  it("Tab 前进、⇧Tab 后退，且到边界时可逃逸", () => {
    expect(press({ key: "Tab" })).toEqual({
      kind: "move",
      delta: 1,
      escapeAtEdge: true,
    });
    expect(press({ key: "Tab", shiftKey: true })).toEqual({
      kind: "move",
      delta: -1,
      escapeAtEdge: true,
    });
  });

  it("↑↓ 前进后退，但到边界不逃逸（它们抢的是光标移动，放行会让光标乱跳）", () => {
    expect(press({ key: "ArrowDown" })).toEqual({
      kind: "move",
      delta: 1,
      escapeAtEdge: false,
    });
    expect(press({ key: "ArrowUp" })).toEqual({
      kind: "move",
      delta: -1,
      escapeAtEdge: false,
    });
  });

  it("Enter 标记已复核并前进，⇧Enter 放行以插入换行", () => {
    expect(press({ key: "Enter" })).toEqual({ kind: "review-and-move" });
    expect(press({ key: "Enter", shiftKey: true })).toEqual({
      kind: "passthrough",
    });
  });

  it("Esc 交还焦点给项外壳（不是退出编辑态——那一档没有只读态可退）", () => {
    expect(press({ key: "Escape" })).toEqual({ kind: "exit-editor" });
  });

  it("组字期间 Esc 归输入法取消候选，不动焦点", () => {
    expect(press({ key: "Escape", isComposing: true })).toEqual({
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

describe("⌘↓ 跳到下一个未复核项", () => {
  it("⌘↓ / Ctrl↓ 命中", () => {
    expect(press({ key: "ArrowDown", metaKey: true })).toEqual({
      kind: "next-unreviewed",
    });
    expect(press({ key: "ArrowDown", ctrlKey: true })).toEqual({
      kind: "next-unreviewed",
    });
  });

  it("只截获这一个组合：⌘S 仍然放行", () => {
    expect(press({ key: "s", code: "KeyS", metaKey: true })).toEqual({
      kind: "passthrough",
    });
    expect(press({ key: "ArrowUp", metaKey: true })).toEqual({
      kind: "passthrough",
    });
  });

  it("组字期间 ⌘↓ 也放行——组字判定始终在最前", () => {
    expect(
      press({ key: "ArrowDown", metaKey: true, isComposing: true }),
    ).toEqual({ kind: "passthrough" });
  });

  it("不带修饰键的 ↓ 仍是逐项推进", () => {
    expect(press({ key: "ArrowDown" })).toEqual({
      kind: "move",
      delta: 1,
      escapeAtEdge: false,
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
      escapeAtEdge: false,
    });
  });
});

/**
 * 键盘陷阱回归（WCAG 2.1.2，A 级）。
 *
 * 2026-07-31 真机走查实测：焦点一旦进入块列表就出不来——末项按 Tab 连按 12 次
 * 无位移，首项 ⇧Tab 同理，因为 `handleKeyDown` 无条件 preventDefault，而 `moveBy`
 * 撞到边界后什么也不做。溯源到 M4 `9d736ca`，非设计语言重构引入。
 *
 * 修法是「撞到头时不再吞掉按键」：列表中间照旧是列表导航，只有两端交还给浏览器。
 * 下面用例锁住的正是这个边界语义。
 */
describe("列表边界（键盘陷阱回归）", () => {
  const ids = ["a", "b", "c"];

  it("中间位置向前向后都有目标", () => {
    expect(resolveMoveTargetId(ids, "b", 1)).toBe("c");
    expect(resolveMoveTargetId(ids, "b", -1)).toBe("a");
  });

  it("末项前进、首项后退都返回 null —— 调用方据此放行 Tab", () => {
    expect(resolveMoveTargetId(ids, "c", 1)).toBeNull();
    expect(resolveMoveTargetId(ids, "a", -1)).toBeNull();
  });

  it("空集合无处可去", () => {
    expect(resolveMoveTargetId([], null, 1)).toBeNull();
    expect(resolveMoveTargetId([], "a", -1)).toBeNull();
  });

  it("尚未选中任何项时，向下从头进、向上从尾进", () => {
    expect(resolveMoveTargetId(ids, null, 1)).toBe("a");
    expect(resolveMoveTargetId(ids, null, -1)).toBe("c");
  });

  it("当前项已不在可见集合内时按未选中处理（筛选切换后的常见状态）", () => {
    expect(resolveMoveTargetId(ids, "zzz", 1)).toBe("a");
  });

  it("单项列表：任何方向都到不了别处", () => {
    expect(resolveMoveTargetId(["only"], "only", 1)).toBeNull();
    expect(resolveMoveTargetId(["only"], "only", -1)).toBeNull();
  });
});

/**
 * 快捷键面板的键盘可达性。
 *
 * `?` 在可编辑区刻意不拦截（那里它是内容），后果是焦点困在块列表常驻 textarea 时，
 * 键盘用户连「求助」都打不开，唯一出口是鼠标。`⌘/` 带修饰键，因此不受此限制。
 */
describe("快捷键面板开关键", () => {
  function panel(
    overrides: Partial<ShortcutPanelKeyInput>,
  ): ShortcutPanelKeyAction {
    return resolveShortcutPanelKey({
      key: "",
      metaKey: false,
      ctrlKey: false,
      isTyping: false,
      ...overrides,
    });
  }

  it("非输入场景按 ? 开关面板", () => {
    expect(panel({ key: "?" })).toBe("toggle");
  });

  it("输入文字时 ? 是内容，不开面板", () => {
    expect(panel({ key: "?", isTyping: true })).toBe("ignore");
  });

  it("⌘/ 与 Ctrl+/ 在输入框内仍能唤起 —— 焦点在文本框时唯一的键盘出口", () => {
    expect(panel({ key: "/", metaKey: true, isTyping: true })).toBe("toggle");
    expect(panel({ key: "/", ctrlKey: true, isTyping: true })).toBe("toggle");
  });

  it("Esc 一律收起", () => {
    expect(panel({ key: "Escape" })).toBe("close");
    expect(panel({ key: "Escape", isTyping: true })).toBe("close");
  });

  it("其余键不干预（⌘S 保存等必须继续冒泡）", () => {
    expect(panel({ key: "s", metaKey: true })).toBe("ignore");
    expect(panel({ key: "/" })).toBe("ignore");
    expect(panel({ key: "a" })).toBe("ignore");
  });
});

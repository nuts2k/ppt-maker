/**
 * 顶栏工作区切换菜单的判据测试。
 *
 * 断言落在 `lib/workspace-menu.ts` 的纯函数上而非组件本身：组件经 stores /
 * workspace-switch 触碰 `window`，把它拉进 test 的类型图会让 tsconfig.node.json
 * （lib 仅 ES2023、无 DOM）解析失败。与 slide-store-edit / doctor-view 的既有做法一致。
 */

import { describe, expect, it, vi } from "vitest";
import {
  RUNNING_DISABLED_HINT,
  runWorkspaceAction,
  UNSAVED_SWITCH_NOTICE,
  type WorkspaceActionDeps,
  workspaceMenuIntent,
  workspaceMenuItems,
} from "../src/renderer/lib/workspace-menu.js";

function deps(dir: string | null): WorkspaceActionDeps & {
  selectDirectory: ReturnType<typeof vi.fn>;
  switchWorkspace: ReturnType<typeof vi.fn>;
  openSourcePicker: ReturnType<typeof vi.fn>;
  openPlanning: ReturnType<typeof vi.fn>;
} {
  return {
    selectDirectory: vi.fn(async () => dir),
    switchWorkspace: vi.fn(async () => undefined),
    openSourcePicker: vi.fn(() => undefined),
    openPlanning: vi.fn(() => undefined),
  };
}

describe("workspaceMenuItems", () => {
  it("空闲时三项均可用", () => {
    const items = workspaceMenuItems(false);
    expect(items.map((item) => item.action)).toEqual([
      "open",
      "create",
      "planning",
    ]);
    expect(items.every((item) => !item.disabled)).toBe(true);
    expect(items.every((item) => item.disabledReason === null)).toBe(true);
  });

  it("执行中三项均禁用并给出同一条原因", () => {
    const items = workspaceMenuItems(true);
    expect(items.every((item) => item.disabled)).toBe(true);
    expect(items.map((item) => item.disabledReason)).toEqual([
      RUNNING_DISABLED_HINT,
      RUNNING_DISABLED_HINT,
      RUNNING_DISABLED_HINT,
    ]);
  });
});

describe("workspaceMenuIntent", () => {
  it("空闲且无未保存改动时直接执行", () => {
    expect(
      workspaceMenuIntent("open", { running: false, dirty: false }),
    ).toEqual({ kind: "proceed", action: "open" });
    expect(
      workspaceMenuIntent("create", { running: false, dirty: false }),
    ).toEqual({ kind: "proceed", action: "create" });
  });

  it("有未保存改动时先要确认，动作原样带回", () => {
    expect(
      workspaceMenuIntent("open", { running: false, dirty: true }),
    ).toEqual({ kind: "confirm", action: "open" });
    expect(
      workspaceMenuIntent("create", { running: false, dirty: true }),
    ).toEqual({ kind: "confirm", action: "create" });
  });

  it("执行中一律忽略——即使有未保存改动也不去问确认", () => {
    expect(workspaceMenuIntent("open", { running: true, dirty: true })).toEqual(
      {
        kind: "ignored",
      },
    );
    expect(
      workspaceMenuIntent("create", { running: true, dirty: false }),
    ).toEqual({ kind: "ignored" });
  });
});

describe("未保存改动确认文案", () => {
  it("同时说明复核改动与规格草稿都会在切换时丢弃", () => {
    expect(UNSAVED_SWITCH_NOTICE.title).toContain("规格草稿");
    expect(UNSAVED_SWITCH_NOTICE.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "unsaved-review" }),
        expect.objectContaining({
          id: "unsaved-planning",
          label: "规格草稿",
        }),
      ]),
    );
  });
});

describe("runWorkspaceAction", () => {
  it("open 选定目录后调用 switchWorkspace", async () => {
    const d = deps("/decks/other");
    await runWorkspaceAction("open", d);
    expect(d.switchWorkspace).toHaveBeenCalledWith("/decks/other");
    expect(d.openSourcePicker).not.toHaveBeenCalled();
    expect(d.openPlanning).not.toHaveBeenCalled();
  });

  /*
   * 这条锁的是父任务的硬约束「不做三次零散增补」：顶栏的新建入口若自己开目录框，
   * deck 打开状态下就只剩「图片目录」一条新建路径，PDF 与内容规格两档无路可走。
   * 走查里正是这条先漏了（顶栏当时仍写着「从图片目录创建…」）。
   */
  it("create 只打开来源选择模态，不开目录框", async () => {
    const d = deps("/photos/deck-src");
    await runWorkspaceAction("create", d);
    expect(d.openSourcePicker).toHaveBeenCalledTimes(1);
    expect(d.selectDirectory).not.toHaveBeenCalled();
    expect(d.switchWorkspace).not.toHaveBeenCalled();
  });

  it("planning 只进入空 Deck 策划表单", async () => {
    const d = deps("/photos/deck-src");
    await runWorkspaceAction("planning", d);
    expect(d.openPlanning).toHaveBeenCalledTimes(1);
    expect(d.openSourcePicker).not.toHaveBeenCalled();
    expect(d.selectDirectory).not.toHaveBeenCalled();
    expect(d.switchWorkspace).not.toHaveBeenCalled();
  });

  it("用户取消目录框时什么都不做", async () => {
    const d = deps(null);
    await runWorkspaceAction("open", d);
    expect(d.switchWorkspace).not.toHaveBeenCalled();
    expect(d.openSourcePicker).not.toHaveBeenCalled();
  });
});

/**
 * 组件把点击交给 `workspaceMenuIntent`，只有 `proceed` / 确认条才会走
 * `runWorkspaceAction`。这里复现完整路径，锁住「dirty 时点了不能直接切」。
 */
describe("点击到执行的完整路径", () => {
  it("dirty 时点「新建 Deck…」也先出确认条，不打开模态", async () => {
    const d = deps("/decks/other");
    const intent = workspaceMenuIntent("create", {
      running: false,
      dirty: true,
    });
    if (intent.kind === "proceed") await runWorkspaceAction(intent.action, d);

    expect(intent.kind).toBe("confirm");
    expect(d.openSourcePicker).not.toHaveBeenCalled();
  });

  it("有未保存改动时只出确认条，不开目录框也不切换", async () => {
    const d = deps("/decks/other");
    const intent = workspaceMenuIntent("open", { running: false, dirty: true });
    if (intent.kind === "proceed") await runWorkspaceAction(intent.action, d);

    expect(intent.kind).toBe("confirm");
    expect(d.selectDirectory).not.toHaveBeenCalled();
    expect(d.switchWorkspace).not.toHaveBeenCalled();
  });

  it("确认「仍要切换」后才真正切换", async () => {
    const d = deps("/decks/other");
    const intent = workspaceMenuIntent("open", { running: false, dirty: true });
    if (intent.kind !== "confirm") throw new Error("应当要求确认");
    // 用户点「仍要切换」：TopNav 用同一个 action 调 executeWorkspaceAction
    await runWorkspaceAction(intent.action, d);

    expect(d.selectDirectory).toHaveBeenCalledTimes(1);
    expect(d.switchWorkspace).toHaveBeenCalledWith("/decks/other");
  });

  it("执行中点击既不确认也不切换", async () => {
    const d = deps("/decks/other");
    const intent = workspaceMenuIntent("open", { running: true, dirty: true });
    if (intent.kind !== "ignored") await runWorkspaceAction(intent.action, d);

    expect(d.selectDirectory).not.toHaveBeenCalled();
    expect(d.switchWorkspace).not.toHaveBeenCalled();
  });
});

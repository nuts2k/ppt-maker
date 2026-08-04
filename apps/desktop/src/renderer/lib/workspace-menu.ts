/**
 * 顶栏工作区切换菜单的展示与决策派生 —— 与 doctor-view 同一分工：
 * 组件只做渲染与事件绑定，能被断言的判据全部落在这里。
 *
 * 两条判据来自 PRD R4 / R5，都要求「点了不能直接生效」：
 *
 * - 执行中（`runStatus !== "idle"`）：两项禁用。不做「自动停止后切换」——
 *   `stop()` 只停队列，已发起的阶段仍在跑，其事件会打到新 deck 的界面上。
 * - 有未保存复核改动：先出确认条再走目录框，而不是选完目录才拦人。
 *
 * 与 doctor-view / stage-view 一致使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node NodeNext）解析。
 */

import type { DoctorNotice } from "./doctor-view.js";

/** 下拉三项：打开已有工作区 / 从来源新建 Deck / 从内容策划新建 */
export type WorkspaceAction = "open" | "create" | "planning";

export const RUNNING_DISABLED_HINT = "执行中不可切换，请先停止";

export interface WorkspaceMenuItemView {
  readonly action: WorkspaceAction;
  readonly label: string;
  readonly disabled: boolean;
  /** 禁用原因（作为 title 提示）；可用时为 null */
  readonly disabledReason: string | null;
}

const ITEM_LABELS: Record<WorkspaceAction, string> = {
  open: "打开其他工作区…",
  /*
   * 不写「从图片目录创建…」。M5 ④ 之后新建 deck 有三种来源，这一项若仍直接开
   * 目录框，deck 打开状态下就只剩「图片目录」一条新建路径——想从 PDF 新建的人
   * 无路可走，而这正是父任务点名禁止的「三次零散增补」。它现在只负责**打开来源
   * 选择模态**，三档来源由那一个组件统一承担。
   */
  create: "新建 Deck…",
  planning: "从内容策划开始…",
};

/**
 * 下拉项视图。两项禁用口径完全一致，与导出按钮同源（`runStatus !== "idle"`）。
 */
export function workspaceMenuItems(
  running: boolean,
): readonly WorkspaceMenuItemView[] {
  const actions: readonly WorkspaceAction[] = ["open", "create", "planning"];
  return actions.map((action) => ({
    action,
    label: ITEM_LABELS[action],
    disabled: running,
    disabledReason: running ? RUNNING_DISABLED_HINT : null,
  }));
}

/** 点击下拉项后的下一步 */
export type WorkspaceMenuIntent =
  /** 执行中：禁用项不产生任何后果 */
  | { readonly kind: "ignored" }
  /** 有未保存改动：先要一次确认，此时不得开目录框、不得切换 */
  | { readonly kind: "confirm"; readonly action: WorkspaceAction }
  | { readonly kind: "proceed"; readonly action: WorkspaceAction };

export interface WorkspaceMenuContext {
  /** run-store 的 `status !== "idle"` */
  readonly running: boolean;
  /** 单页复核或规格工作台有未保存草稿 */
  readonly dirty: boolean;
}

export function workspaceMenuIntent(
  action: WorkspaceAction,
  { running, dirty }: WorkspaceMenuContext,
): WorkspaceMenuIntent {
  if (running) return { kind: "ignored" };
  if (dirty) return { kind: "confirm", action };
  return { kind: "proceed", action };
}

/**
 * 未保存改动的确认条内容。沿用 DoctorNoticeBar 的形状（与导出前警告同一条形式），
 * 同时覆盖复核改动与规格草稿。不做自动保存：`saveReview()` 会连带作废下游阶段，
 * 而切 deck 的当口看不到「哪些阶段被作废」。
 */
export const UNSAVED_SWITCH_NOTICE: DoctorNotice = {
  level: "warn",
  title: "当前页或规格草稿有未保存改动，切换将丢弃",
  hint: "取消后可回到当前视图保存，再来切换工作区。",
  items: [
    {
      id: "unsaved-review",
      label: "未保存改动",
      status: "warn",
      message: "切换工作区会重新加载全部页面，当前页草稿不会保留。",
    },
    {
      id: "unsaved-planning",
      label: "规格草稿",
      status: "warn",
      message: "切换工作区会丢弃尚未保存的规格草稿。",
    },
  ],
};

export interface WorkspaceActionDeps {
  /** 原生目录选择框；用户取消时返回 null */
  readonly selectDirectory: () => Promise<string | null>;
  readonly switchWorkspace: (path: string) => Promise<void>;
  /** 打开来源选择模态（新建档）。选目录/选文件由模态内部按来源各自负责 */
  readonly openSourcePicker: () => void;
  /** 进入建空 Deck 的策划表单。 */
  readonly openPlanning: () => void;
}

/**
 * 真正执行动作。
 *
 * - `open`：选目录 → `switchWorkspace`，校验、清零与失败回退都在它内部，
 *   这里只负责「用户取消目录框就什么都不做」。
 * - `create`：**不开目录框**，只打开来源选择模态。三档来源要的东西各不相同
 *   （目录 / PDF 文件 / 规格文件或构思文本），在这里先要一个目录等于把
 *   「图片目录」这一档偷偷升成默认，另外两档就永远进不来。
 */
export async function runWorkspaceAction(
  action: WorkspaceAction,
  deps: WorkspaceActionDeps,
): Promise<void> {
  if (action === "create") {
    deps.openSourcePicker();
    return;
  }
  if (action === "planning") {
    deps.openPlanning();
    return;
  }
  const dir = await deps.selectDirectory();
  if (dir === null || dir === "") return;
  await deps.switchWorkspace(dir);
}

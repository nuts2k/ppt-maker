/**
 * 文本复核列表的键盘动作判定（design.md §4.1）。
 *
 * 从 `BlockListPanel` 的 `handleKeyDown` 抽出为纯函数，唯一目的是让键盘流可测：
 * 复核界面的验收标准之一是「全程仅用键盘完成一页复核」，而键位判定散在组件的
 * `useCallback` 里时无法写确定性用例，C 阶段因此整条路径零覆盖。
 *
 * **输入法组字期间一律放行（`isComposing`）**——2026-07-27 E1 走查实测暴露：
 * 中文输入法用 ↓/↑ 选字、Enter 确认候选、部分输入法用 Tab 翻候选页，这些键在
 * 组字期间全被列表导航吃掉，表现为「选不了字，光标却跳到了下一个块」。中文复核
 * 是本界面的主场景，这条路径不是边角。判据用 `KeyboardEvent.isComposing`：
 * 组字期间（含按 Enter 确认候选的那一次 keydown）它为 true，`compositionend`
 * 之后才转 false，正是需要的边界。
 *
 * 与 review-partition / review-status 一致：不触碰 `window`、不引 React 类型，
 * 以便同时被 renderer（vite）与测试（vitest + NodeNext）解析。
 */

/** 判定结果。`passthrough` 表示不拦截，交还给浏览器 / 输入法 / 按钮自身。 */
export type ReviewKeyAction =
  | { kind: "passthrough" }
  | { kind: "move"; delta: 1 | -1; escapeAtEdge: boolean }
  | { kind: "classify"; toLayoutText: boolean }
  | { kind: "review-and-move" }
  | { kind: "next-unreviewed" }
  | { kind: "exit-editor" };

/** `KeyboardEvent` 的最小结构切片，便于测试直接构造。 */
export interface ReviewKeyInput {
  readonly key: string;
  /** macOS 上 ⌥1 的 `key` 是 `¡`，分类快捷键必须按 `code` 判。 */
  readonly code: string;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  /** 取自 `KeyboardEvent.isComposing`（React 侧为 `event.nativeEvent.isComposing`）。 */
  readonly isComposing: boolean;
  /** 焦点是否落在项内按钮上。 */
  readonly targetIsButton: boolean;
}

const PASSTHROUGH: ReviewKeyAction = { kind: "passthrough" };

export function resolveReviewKeyAction(input: ReviewKeyInput): ReviewKeyAction {
  // 组字优先于一切：此时的 ↑↓/Enter/Tab 属于输入法，不属于列表导航
  if (input.isComposing) return PASSTHROUGH;

  /*
   * ⌘↓ = 跳到下一个未复核项。
   *
   * 必须排在下面「⌘ 一律放行」之前，且只截获这一个组合——⌘S 保存、⌘C 复制等
   * 其余 ⌘ 组合仍要冒泡到页面级监听，多截一个就会有人按不动保存。
   */
  if ((input.metaKey || input.ctrlKey) && input.key === "ArrowDown") {
    return { kind: "next-unreviewed" };
  }

  // ⌘S 等全局快捷键冒泡到页面级监听
  if (input.metaKey || input.ctrlKey) return PASSTHROUGH;

  // 焦点在按钮上时 Enter 必须放行：preventDefault 会连按钮的 click 一起吃掉，
  // 否则「标记已复核」「全部通过」「改为版式文字」用键盘按不动
  if (input.key === "Enter" && input.targetIsButton) return PASSTHROUGH;

  if (input.altKey) {
    if (input.code === "Digit1")
      return { kind: "classify", toLayoutText: true };
    if (input.code === "Digit2") {
      return { kind: "classify", toLayoutText: false };
    }
    return PASSTHROUGH;
  }

  switch (input.key) {
    /*
     * Tab 被改作「切换项」，但**撞到边界时必须交还给浏览器**（`escapeAtEdge`）。
     * 此前无条件 preventDefault，末项按 Tab、首项按 ⇧Tab 都原地不动，焦点一旦
     * 进入列表就再也出不去（WCAG 2.1.2 键盘陷阱，A 级）。放行只在列表两端发生，
     * 中间照旧是列表导航，键盘模型不变。
     */
    case "Tab":
      return {
        kind: "move",
        delta: input.shiftKey ? -1 : 1,
        escapeAtEdge: true,
      };
    /*
     * 箭头键相反：到边界仍然吞掉。它们抢占的是 textarea 内的光标移动（见
     * BlockListPanel.handleKeyDown 注释），放行会让光标乱跳，且箭头本来就带不出
     * 焦点，对键盘陷阱毫无帮助。
     */
    case "ArrowDown":
      return { kind: "move", delta: 1, escapeAtEdge: false };
    case "ArrowUp":
      return { kind: "move", delta: -1, escapeAtEdge: false };
    case "Enter":
      // ⇧Enter 插入换行
      return input.shiftKey ? PASSTHROUGH : { kind: "review-and-move" };
    /*
     * Esc = 把焦点交还给项外壳，**不是**退出编辑态。
     *
     * 「文字待确认」档常驻可编辑，没有可退回的只读态，所以 `BlockTextEditor`
     * 在不传 `onExit` 时直接放行 Esc——结果是这一档里 Esc 什么也不做，而它恰好是
     * 块列表最主要的一档。焦点留在 textarea 内，键盘用户按 Esc 的直觉落空。
     *
     * 「已一致」的就地编辑态另有出口：那里传了 `onExit`，`BlockTextEditor` 自己
     * `stopPropagation` 并退回只读，事件到不了这里，两条路互不干扰。
     *
     * 调用方**不要 preventDefault**：Esc 还要继续冒泡去关快捷键面板等浮层。
     */
    case "Escape":
      return { kind: "exit-editor" };
    default:
      return PASSTHROUGH;
  }
}

/** 快捷键面板的键位判定结果。 */
export type ShortcutPanelKeyAction = "toggle" | "close" | "ignore";

/** `resolveShortcutPanelKey` 的入参切片。 */
export interface ShortcutPanelKeyInput {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  /** 焦点是否落在 input / textarea / contentEditable 内。 */
  readonly isTyping: boolean;
}

/**
 * 快捷键面板的开关键位。
 *
 * 两个入口而不是一个，因为它们覆盖的场景互补：
 * - `?` 好按好记，但在可编辑区是**内容**，必须让位；
 * - `⌘/`（Windows/Linux 为 `Ctrl+/`）带修饰键，在输入框里不与内容冲突，
 *   于是成为「焦点在文本框时唯一的键盘求助出口」。
 *
 * 少了后者，块列表的常驻 textarea 里连快捷键面板都只能用鼠标打开。
 */
export function resolveShortcutPanelKey(
  input: ShortcutPanelKeyInput,
): ShortcutPanelKeyAction {
  if (input.key === "Escape") return "close";
  if ((input.metaKey || input.ctrlKey) && input.key === "/") return "toggle";
  // 无修饰的 `?` 只在非输入场景生效
  if (
    input.key === "?" &&
    !input.isTyping &&
    !input.metaKey &&
    !input.ctrlKey
  ) {
    return "toggle";
  }
  return "ignore";
}

/**
 * 在当前可见集合内按 `delta` 推进，返回应选中的项；**已在边界时返回 `null`**。
 *
 * 从 `BlockListPanel.moveBy` 抽出，唯一目的是让「撞到边界」这个状态可测：
 * Tab 的边界放行（`escapeAtEdge`）依赖它的返回值决定要不要 preventDefault，
 * 而组件层在本项目没有 DOM 测试库可验证（见 implement.md 偏差 2）。
 *
 * `null` 有两种来源，对调用方是同一件事——没有可去的下一项：
 * 集合为空，或当前项已在推进方向的尽头。
 */
export function resolveMoveTargetId(
  visibleIds: readonly string[],
  currentId: string | null,
  delta: number,
): string | null {
  if (visibleIds.length === 0) return null;
  // currentId 为 null 时 indexOf 返回 -1，正是「尚未选中」要走的分支
  const index = currentId === null ? -1 : visibleIds.indexOf(currentId);
  // 焦点尚未落在任何项上时，向下从头进、向上从尾进
  const nextIndex =
    index === -1
      ? delta > 0
        ? 0
        : visibleIds.length - 1
      : Math.min(visibleIds.length - 1, Math.max(0, index + delta));
  const target = visibleIds[nextIndex];
  if (target === undefined || target === currentId) return null;
  return target;
}

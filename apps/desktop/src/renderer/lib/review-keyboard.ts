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
  | { kind: "move"; delta: 1 | -1 }
  | { kind: "classify"; toLayoutText: boolean }
  | { kind: "review-and-move" };

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
    case "Tab":
      return { kind: "move", delta: input.shiftKey ? -1 : 1 };
    case "ArrowDown":
      return { kind: "move", delta: 1 };
    case "ArrowUp":
      return { kind: "move", delta: -1 };
    case "Enter":
      // ⇧Enter 插入换行
      return input.shiftKey ? PASSTHROUGH : { kind: "review-and-move" };
    default:
      return PASSTHROUGH;
  }
}

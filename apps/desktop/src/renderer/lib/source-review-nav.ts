/**
 * 源图审片视图的序列与导航 —— 纯函数，供 `pages/SourceReviewPage` 与测试共用。
 *
 * 本项目没有 DOM 测试库（也不为此新增依赖），所以「序列怎么取、下一张是哪张、
 * 已确认几张」这类真正会出错的逻辑一律抽到这里，断言跑在它们的产物上。
 *
 * ## 序列的来源：待办队列的 `confirm-source` 组，不另写 filter
 *
 * 成员判定**不在本文件里重写**一份 `sourceKind === "generated" && 阶段未完成`——
 * 同一件事在两处展示必须同源（见 .trellis/spec/frontend/state-management.md
 * 「错误条要指名出问题的阶段」的自查条）。待确认的那部分直接吃
 * `deriveTodoQueue` 的 `confirm-source` 组。
 *
 * ## 但序列不能**只**有待办
 *
 * 视图顶部是「已确认 3/12」、底部缩略图带要给已确认页打勾，而一页被接受后就会
 * 离开待办组。若成员集合只取待办，接受一张少一张，计数与勾选都无从谈起，
 * 已确认页也再进不来（U10 明确要求进得来）。
 *
 * 所以成员 = 待办组 ∪ 可达页，两个来源都取自 `accept-gate` 的同一组原子判据，
 * 由那里的恒等式保证「待办 ⊆ 可达」。`selectSourceReviewSlides` 把队列作为入参
 * 而不是自己算，正是为了让这条包含关系可被测试锁住。
 *
 * 与 accept-gate / todo-queue 一致使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node，NodeNext）解析。
 */

import type { SlideDetail } from "../../main/ipc/channels.js";
import type { TodoQueue } from "../stores/todo-queue.js";
import { sourceAccepted, sourceReviewReachable } from "./accept-gate.js";

/** 审片序列的一项：视图渲染与导航都只需要这几样 */
export interface SourceReviewEntry {
  readonly slideId: string;
  readonly pageLabel: string;
  readonly absWorkspacePath: string;
  readonly sourceKind: SlideDetail["sourceKind"];
  readonly specEntryId: string | null;
  /** 已确认（`accept-source` 已写入）；缩略图带据此打勾，动作区据此收起「接受」 */
  readonly accepted: boolean;
}

export interface SourceReviewProgress {
  readonly accepted: number;
  readonly total: number;
}

/** 待办队列里「待确认源图」组的页 id 集合 */
function pendingSlideIds(queue: TodoQueue): ReadonlySet<string> {
  const group = queue.groups.find((entry) => entry.group === "confirm-source");
  return new Set(group?.items.map((item) => item.slideId) ?? []);
}

/**
 * 审片序列。顺序取 deck 顺序（`slides` 数组顺序），与控制台卡片网格一致——
 * 用户在两个视图之间来回时页面的相对位置不该变。
 *
 * 已移除页一律排除：它们的工作区压根不加载，没有源图可看。
 */
export function selectSourceReviewSlides(
  slides: readonly SlideDetail[],
  queue: TodoQueue,
): readonly SourceReviewEntry[] {
  const pending = pendingSlideIds(queue);
  const entries: SourceReviewEntry[] = [];
  for (const slide of slides) {
    if (slide.removed) continue;
    if (!pending.has(slide.slideId) && !sourceReviewReachable(slide)) continue;
    entries.push({
      slideId: slide.slideId,
      pageLabel: slide.pageLabel,
      absWorkspacePath: slide.absWorkspacePath,
      sourceKind: slide.sourceKind,
      specEntryId: slide.specEntryId,
      accepted: sourceAccepted(slide),
    });
  }
  return entries;
}

/** 顶部计数「已确认 3/12」的两个数字 */
export function sourceReviewProgress(
  entries: readonly SourceReviewEntry[],
): SourceReviewProgress {
  let accepted = 0;
  for (const entry of entries) if (entry.accepted) accepted += 1;
  return { accepted, total: entries.length };
}

/** 该页在序列中的位置；不在序列中返回 null */
export function indexOfSlide(
  entries: readonly SourceReviewEntry[],
  slideId: string | null,
): number | null {
  if (slideId === null) return null;
  const index = entries.findIndex((entry) => entry.slideId === slideId);
  return index < 0 ? null : index;
}

/** 序列中第一个未确认的位置；全部已确认返回 null */
export function firstPendingIndex(
  entries: readonly SourceReviewEntry[],
): number | null {
  const index = entries.findIndex((entry) => !entry.accepted);
  return index < 0 ? null : index;
}

/**
 * 接受当前页之后要跳去的下一张：从当前位置**之后**找第一个未确认的，走到末尾
 * 回绕到开头继续找（跳过当前页自身）。全部确认完返回 null，调用方据此回控制台。
 *
 * 回绕是刻意的，与待办队列的 `nextTodoItem` 同一理由：用户可能从中间某页进来，
 * 不回绕的话前面没确认的页会被永远留在后面。
 */
export function nextPendingIndex(
  entries: readonly SourceReviewEntry[],
  fromIndex: number,
): number | null {
  const total = entries.length;
  if (total === 0) return null;
  for (let step = 1; step <= total; step += 1) {
    const candidate = (fromIndex + step) % total;
    if (candidate === fromIndex) continue;
    if (entries[candidate]?.accepted === false) return candidate;
  }
  return null;
}

/**
 * 进入视图时停在哪一张：指定页优先（卡片直达、完成面板「去确认」），
 * 其次第一个未确认的（「逐张确认」这类从头过一遍的入口），
 * 再其次序列首项（全部已确认时的回看）。序列为空返回 null。
 */
export function resolveEntryIndex(
  entries: readonly SourceReviewEntry[],
  slideId: string | null,
): number | null {
  if (entries.length === 0) return null;
  return indexOfSlide(entries, slideId) ?? firstPendingIndex(entries) ?? 0;
}

/**
 * ←/→ 逐张移动：**边界钳制、不回绕**。
 *
 * 与「接受后跳下一张」不同，这里是用户自己在翻，回绕会让他分不清有没有翻到头。
 * 序列为空返回 null。
 */
export function stepIndex(
  entries: readonly SourceReviewEntry[],
  index: number,
  delta: number,
): number | null {
  if (entries.length === 0) return null;
  const next = index + delta;
  if (next < 0) return 0;
  if (next > entries.length - 1) return entries.length - 1;
  return next;
}

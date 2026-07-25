/**
 * 待办队列派生（design.md 3.2）—— 纯函数，不新增任何持久化。
 *
 * 队列由两层数据合并而来：
 * - **耐久层**：`SlideDetail`（manifest 聚合），重启后仍可恢复。覆盖失败/中断/失效、
 *   待验收底图、待验收 PPTX 三类。
 * - **会话层**：`SessionRunResult`（本次进程的 page-done 结果），只用于表达 manifest
 *   无法区分的 `validation-failed` 态。该态没有耐久标记，应用重启后这些页会被耐久层
 *   归入失败组（停在 validate-review 之前的阶段），由用户重跑重新暴露。
 *
 * 约定：
 * - 每页最多产出一项，按 `failed > revalidate > accept-pptx > accept-clean` 取第一条。
 *   验收组中 pptx 优先于 clean，因为越靠后的阶段越接近完成，用户应先推进更近终点的页。
 * - 组顺序固定为同一优先级顺序；组内按 `pageLabel` 数字自然序（page-2 在 page-10 之前）。
 * - 空组不出现在 `groups` 中，面板直接遍历渲染即可。
 *
 * 本文件与 run-types 一样使用相对 `.js` 导入，以便同时被 renderer（vite）与
 * 测试（vitest + tsconfig.node，NodeNext 解析）消费。
 */

import type { SlideDetail } from "../../main/ipc/channels.js";
import { stageLabel } from "../../shared/stages.js";
import { awaitingAcceptance } from "../lib/accept-gate.js";
import type { SessionRunResult } from "./run-types.js";

export type TodoGroup =
  | "failed"
  | "revalidate"
  | "accept-pptx"
  | "accept-clean";

export interface TodoItem {
  readonly slideId: string;
  readonly pageLabel: string;
  readonly group: TodoGroup;
  /** 中文原因短句，直接用于面板展示 */
  readonly reason: string;
  /** 相关阶段（失败组=失败阶段；验收组=待验收阶段） */
  readonly stage: string | null;
}

export interface TodoQueueGroup {
  readonly group: TodoGroup;
  readonly label: string;
  readonly items: readonly TodoItem[];
}

export interface TodoQueue {
  readonly groups: readonly TodoQueueGroup[];
  readonly total: number;
}

/** 分组优先级 = 分组展示顺序 = 单页命中多条规则时的取用顺序 */
const GROUP_ORDER: readonly TodoGroup[] = [
  "failed",
  "revalidate",
  "accept-pptx",
  "accept-clean",
];

const GROUP_LABELS: Readonly<Record<TodoGroup, string>> = {
  failed: "失败/需重跑",
  revalidate: "需复核校验",
  "accept-pptx": "待验收 PPTX",
  "accept-clean": "待验收底图",
};

/** 归入失败组的耐久阶段状态 */
const FAILING_STAGE_STATUSES = new Set<string>([
  "failed",
  "interrupted",
  "stale",
]);

/** 缺少 `lastError` 时按耐久状态给出的通用文案 */
const FAILING_STATUS_TEXT: Readonly<Record<string, string>> = {
  failed: "执行失败",
  interrupted: "执行中断",
  stale: "上游已变更，需重跑",
};

/** DeckRunner 在复核校验未通过时给出的闸门标识 */
const VALIDATION_FAILED_GATE = "validation-failed";

/** pageLabel 自然序比较（page-2 < page-10） */
const pageLabelCollator = new Intl.Collator("en", { numeric: true });

function failedReason(slide: SlideDetail): string {
  if (slide.lastError !== null) {
    return `${slide.lastError.code}: ${slide.lastError.message}`;
  }
  const text = FAILING_STATUS_TEXT[slide.stageStatus] ?? "需重跑";
  return `阶段「${stageLabel(slide.currentStage)}」${text}`;
}

/** 单页取优先级最高的一条待办；无待办返回 null */
function deriveSlideItem(
  slide: SlideDetail,
  sessionResult: SessionRunResult | undefined,
): TodoItem | null {
  const base = { slideId: slide.slideId, pageLabel: slide.pageLabel } as const;

  if (FAILING_STAGE_STATUSES.has(slide.stageStatus)) {
    return {
      ...base,
      group: "failed",
      reason: failedReason(slide),
      stage: slide.lastError?.stage ?? slide.currentStage,
    };
  }

  if (sessionResult?.gate === VALIDATION_FAILED_GATE) {
    return {
      ...base,
      group: "revalidate",
      reason: "复核校验未通过，需修正文字块后重跑",
      stage: "validate-review",
    };
  }

  if (awaitingAcceptance(slide, "accept-pptx")) {
    return {
      ...base,
      group: "accept-pptx",
      reason: "PPTX 已生成，等待人工验收",
      stage: "accept-pptx",
    };
  }

  if (awaitingAcceptance(slide, "accept-clean")) {
    return {
      ...base,
      group: "accept-clean",
      reason: "干净底图已生成，等待人工验收",
      stage: "accept-clean",
    };
  }

  return null;
}

export function deriveTodoQueue(
  slides: readonly SlideDetail[],
  sessionResults: Readonly<Record<string, SessionRunResult>>,
): TodoQueue {
  const items: TodoItem[] = [];
  for (const slide of slides) {
    if (slide.removed) continue;
    const item = deriveSlideItem(slide, sessionResults[slide.slideId]);
    if (item !== null) items.push(item);
  }

  const groups: TodoQueueGroup[] = [];
  for (const group of GROUP_ORDER) {
    const groupItems = items
      .filter((item) => item.group === group)
      .sort((left, right) =>
        pageLabelCollator.compare(left.pageLabel, right.pageLabel),
      );
    if (groupItems.length > 0) {
      groups.push({ group, label: GROUP_LABELS[group], items: groupItems });
    }
  }

  return { groups, total: items.length };
}

/** 按组顺序摊平成单一处理序列（「处理下一项」的遍历口径） */
export function flattenTodoQueue(queue: TodoQueue): readonly TodoItem[] {
  return queue.groups.flatMap((group) => group.items);
}

/**
 * 「处理下一项」的目标项（PRD F3.7）。
 *
 * 语义：在摊平序列中从当前页之后往下找第一个**不同页**的待办；走到末尾则回绕到
 * 序列开头继续找。回绕是刻意的——用户处理完一项后该项通常已离队，若不回绕，
 * 处理最后一项后按钮会失效，而队列里其实还有前面的组没做完。
 *
 * 当前页不在队列中（例如刚验收完成）时直接返回队首。队列为空、或唯一待办就是
 * 当前页时返回 null，调用方据此禁用按钮。
 */
export function nextTodoItem(
  queue: TodoQueue,
  currentSlideId: string | null,
): TodoItem | null {
  const items = flattenTodoQueue(queue);
  if (items.length === 0) return null;

  const position =
    currentSlideId === null
      ? -1
      : items.findIndex((item) => item.slideId === currentSlideId);
  if (position < 0) return items[0] ?? null;

  // 从当前项之后开始环形扫描，跳过当前页自身
  for (let step = 1; step <= items.length; step += 1) {
    const candidate = items[(position + step) % items.length];
    if (candidate !== undefined && candidate.slideId !== currentSlideId) {
      return candidate;
    }
  }
  return null;
}

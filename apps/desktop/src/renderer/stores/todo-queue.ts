/**
 * 待办队列派生（design.md §3.4）—— 纯函数，不新增任何持久化。
 *
 * 链路收敛后（PRD D1/R1.6）人工停点只剩文本复核与最终确认两个，分组随之改为
 * 失败 / 需修数据错误 / 需文本复核 / 待最终确认，原「待验收底图」组删除。
 *
 * 队列由两层数据合并而来：
 * - **耐久层**：`SlideDetail`（manifest 聚合 + main 侧读复核稿得到的
 *   `pendingTextReview`），重启后仍可恢复。覆盖失败/中断/失效、需文本复核、
 *   待最终确认三类。
 * - **会话层**：`SessionRunResult`（本次进程的 page-done 结果），用于表达耐久层
 *   无法区分或写入时序尚未反映的态：`validation-failed` 没有任何耐久标记，
 *   应用重启后这些页会被耐久层归入失败组（停在 validate-review 之前的阶段），
 *   由用户重跑重新暴露；`human-edit` 则与耐久层判据并行命中。
 *
 * 约定：
 * - 每页最多产出一项，按 `GROUP_ORDER` 取第一条。
 * - `failed` 置于最前是延续 V1 的既有约定（最紧急、且往往阻断其余判定），
 *   与 design §3.4 表格的列举顺序不同但不冲突——表格只列判据，不定优先级。
 * - 组顺序固定为同一优先级顺序；组内按 `pageLabel` 数字自然序（page-2 在 page-10 之前）。
 * - 空组不出现在 `groups` 中，面板直接遍历渲染即可。
 *
 * 本文件与 run-types 一样使用相对 `.js` 导入，以便同时被 renderer（vite）与
 * 测试（vitest + tsconfig.node，NodeNext 解析）消费。
 */

import type { SlideDetail } from "../../main/ipc/channels.js";
import { stageLabel } from "../../shared/stages.js";
import { awaitingFinalConfirm, stageStatusOf } from "../lib/accept-gate.js";
import type { SessionRunResult } from "./run-types.js";

export type TodoGroup =
  | "failed"
  | "fix-validation"
  | "review-text"
  | "final-confirm";

export interface TodoItem {
  readonly slideId: string;
  readonly pageLabel: string;
  readonly group: TodoGroup;
  /** 中文原因短句，直接用于面板展示 */
  readonly reason: string;
  /** 相关阶段（失败组=失败阶段；其余=该待办所指向的阶段） */
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
  "fix-validation",
  "review-text",
  "final-confirm",
];

const GROUP_LABELS: Readonly<Record<TodoGroup, string>> = {
  failed: "失败/需重跑",
  "fix-validation": "需修数据错误",
  "review-text": "需文本复核",
  "final-confirm": "待最终确认",
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

/** DeckRunner 停在文本复核门时给出的闸门标识 */
const HUMAN_EDIT_GATE = "human-edit";

/** pageLabel 自然序比较（page-2 < page-10） */
const pageLabelCollator = new Intl.Collator("en", { numeric: true });

function failedReason(slide: SlideDetail): string {
  if (slide.lastError !== null) {
    return `${slide.lastError.code}: ${slide.lastError.message}`;
  }
  const text = FAILING_STATUS_TEXT[slide.stageStatus] ?? "需重跑";
  return `阶段「${stageLabel(slide.currentStage)}」${text}`;
}

/**
 * 该页是否需要文本复核。
 *
 * 耐久层：`review` 已完成且仍有未复核的版式目标文字块。会话层的 `human-edit`
 * 闸门同样命中——本次 run 刚被文本复核门拦下，即便 `pendingTextReview` 因为
 * 读取时序尚未刷新也应立即入队。
 */
function needsTextReview(
  slide: SlideDetail,
  sessionResult: SessionRunResult | undefined,
): boolean {
  if (sessionResult?.gate === HUMAN_EDIT_GATE) return true;
  return (
    stageStatusOf(slide, "review") === "completed" &&
    slide.pendingTextReview > 0
  );
}

function textReviewReason(slide: SlideDetail): string {
  return slide.pendingTextReview > 0
    ? `${slide.pendingTextReview} 个版式目标文字待复核`
    : "存在待复核的版式目标文字";
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
      group: "fix-validation",
      reason: "复核校验未通过，需修正文字块后重跑",
      stage: "validate-review",
    };
  }

  if (needsTextReview(slide, sessionResult)) {
    return {
      ...base,
      group: "review-text",
      reason: textReviewReason(slide),
      stage: "review",
    };
  }

  if (awaitingFinalConfirm(slide)) {
    return {
      ...base,
      group: "final-confirm",
      reason: "PPTX 已生成，等待最终确认",
      stage: "accept-pptx",
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
 * 当前页不在队列中（例如刚确认完成）时直接返回队首。队列为空、或唯一待办就是
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

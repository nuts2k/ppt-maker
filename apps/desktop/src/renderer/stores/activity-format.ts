/**
 * 活动日志的纯展示逻辑 —— 分组、事件转记录、单行文案。
 *
 * 与 main 的关系（design.md 2.2）：日志的**权威来源是 main 落盘的 jsonl**。
 * 本文件的 `runEventToActivity` 只负责把 `deck:run-progress` 事件转成本地即时记录，
 * 让面板在执行过程中立刻有反馈；其 kind / result / detail 必须与
 * `main/runner/deck-runner.ts` 的 `record(...)` 调用逐条对齐，
 * 否则重新 `load()` 之后同一条事件会呈现两种文案。
 *
 * 导入使用相对 `.js` 路径（不用 `@/`、`@shared` alias），
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node NodeNext）解析。
 */

import type {
  ActivityRecord,
  ActivityResult,
  DeckRunEvent,
} from "../../main/ipc/channels.js";
import { stageLabel } from "../../shared/stages.js";

/** 按本地日期聚合后的一组记录 */
export interface ActivityDateGroup {
  readonly date: string;
  readonly records: ActivityRecord[];
}

/** `at` 无法解析时的分组键，恒排在最后 */
const UNKNOWN_DATE = "未知日期";

/** 无 detail 时的兜底文案（正常路径 detail 均非空） */
const KIND_LABELS: Readonly<Record<string, string>> = {
  "run-start": "开始批量执行",
  "run-stop": "请求停止",
  "run-done": "批量执行结束",
  "page-start": "开始处理页面",
  "stage-complete": "阶段完成",
  "page-done": "页面处理结束",
  "accept-clean": "验收底图",
  "accept-pptx": "验收 PPTX",
  export: "导出 PPTX",
};

/**
 * 按本地日期分组：组间按日期倒序，组内按时间倒序。
 * ActivityPanel 据此渲染日期分隔线（design.md 3.3）。
 */
export function groupByDate(
  records: readonly ActivityRecord[],
): ActivityDateGroup[] {
  const buckets = new Map<string, ActivityRecord[]>();

  for (const record of records) {
    const key = localDateKey(record.at);
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, [record]);
    } else {
      bucket.push(record);
    }
  }

  const groups: ActivityDateGroup[] = [];
  for (const [date, items] of buckets) {
    items.sort((a, b) => timestamp(b) - timestamp(a));
    groups.push({ date, records: items });
  }

  groups.sort((a, b) => {
    if (a.date === b.date) return 0;
    // 未知日期恒沉底，其余按日期字符串倒序（YYYY-MM-DD 可直接字典序比较）
    if (a.date === UNKNOWN_DATE) return 1;
    if (b.date === UNKNOWN_DATE) return -1;
    return a.date < b.date ? 1 : -1;
  });

  return groups;
}

/**
 * 把 run 事件转成本地即时记录；无需展示的事件返回 null。
 *
 * `stage-start` 返回 null：main 也不为它落盘（只记 stage-complete，带耗时），
 * 逐阶段开始事件写进流水只会刷屏，实时进度由 run-store 的当前阶段承担。
 */
export function runEventToActivity(
  event: DeckRunEvent,
  ctx: { pageLabelOf(slideId: string): string | null },
): ActivityRecord | null {
  switch (event.kind) {
    case "run-start":
      return build({
        kind: "run-start",
        result: "info",
        detail: `开始执行 ${event.total} 页`,
      });

    case "page-start":
      return build({
        kind: "page-start",
        result: "info",
        detail: `开始处理 ${event.pageLabel}`,
        slideId: event.slideId,
        pageLabel: event.pageLabel,
      });

    case "stage-start":
      return null;

    case "stage-complete": {
      const label = ctx.pageLabelOf(event.slideId) ?? event.slideId;
      return build({
        at: event.at,
        kind: "stage-complete",
        result: "success",
        detail: `${label} · ${stageLabel(event.stage)} 完成`,
        slideId: event.slideId,
        pageLabel: label,
        stage: event.stage,
        durationMs: event.durationMs,
      });
    }

    case "page-done": {
      const label = ctx.pageLabelOf(event.slideId) ?? event.slideId;
      const failed = event.error !== null || event.gate === "error";
      const result: ActivityResult = failed
        ? "failure"
        : event.gate !== null
          ? "gate"
          : "success";
      return build({
        kind: "page-done",
        result,
        detail: `${label} · ${event.message}`,
        slideId: event.slideId,
        pageLabel: label,
        stage: event.stoppedAt,
      });
    }

    case "run-stopping":
      // main 侧该记录的 kind 为 "run-stop"（在 stop() 中写入），此处保持一致
      return build({
        kind: "run-stop",
        result: "info",
        detail: "已请求停止，当前页完成后结束",
      });

    case "run-done": {
      const { completed, gated, failed } = event.summary;
      return build({
        kind: "run-done",
        result: failed > 0 ? "failure" : "info",
        detail: `执行结束：完成 ${completed}，待人工 ${gated}，失败 ${failed}`,
      });
    }
  }
}

/**
 * 单行中文展示文案：以 `detail` 为正文（main 写入时已是完整中文句），
 * detail 缺失时用 kind + 阶段中文名兜底；带耗时的记录追加 "· 用时 12.3s"。
 */
export function describeActivity(record: ActivityRecord): string {
  const parts: string[] = [];
  const body = record.detail.trim();
  parts.push(body !== "" ? body : fallbackText(record));
  if (record.durationMs !== null) {
    parts.push(`用时 ${formatDuration(record.durationMs)}`);
  }
  return parts.join(" · ");
}

/** 耗时文案：毫秒 / 秒（1 位小数）/ 分秒 */
export function formatDuration(durationMs: number): string {
  const ms = Math.max(0, Math.round(durationMs));
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m${seconds}s`;
}

function fallbackText(record: ActivityRecord): string {
  const parts: string[] = [];
  if (record.pageLabel !== null && record.pageLabel !== "") {
    parts.push(record.pageLabel);
  }
  if (record.stage !== null && record.stage !== "") {
    parts.push(stageLabel(record.stage));
  }
  parts.push(KIND_LABELS[record.kind] ?? record.kind);
  return parts.join(" · ");
}

function build(input: {
  at?: string;
  kind: string;
  result: ActivityResult;
  detail: string;
  slideId?: string;
  pageLabel?: string;
  stage?: string | null;
  durationMs?: number;
}): ActivityRecord {
  return {
    at: input.at ?? new Date().toISOString(),
    kind: input.kind,
    slideId: input.slideId ?? null,
    pageLabel: input.pageLabel ?? null,
    stage: input.stage ?? null,
    result: input.result,
    durationMs: input.durationMs ?? null,
    detail: input.detail,
  };
}

function localDateKey(at: string): string {
  const time = Date.parse(at);
  if (Number.isNaN(time)) return UNKNOWN_DATE;
  const date = new Date(time);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function timestamp(record: ActivityRecord): number {
  const time = Date.parse(record.at);
  return Number.isNaN(time) ? 0 : time;
}

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { describeActivity, groupByDate } from "@/stores/activity-format";
import { useActivityStore } from "@/stores/activity-store";
import { useUIStore } from "@/stores/ui-store";
import type { ActivityRecord } from "../../../main/ipc/channels.js";

interface ActivityPanelProps {
  className?: string;
}

/**
 * 底部活动日志抽屉（design.md 3.3）。
 *
 * 只消费 activity-store，不主动 `load`：deckPath 变化时的拉取由 ConsolePage
 * 统一负责，避免同一份日志被多处重复请求。
 */
export function ActivityPanel({
  className,
}: ActivityPanelProps): React.JSX.Element {
  const open = useUIStore((s) => s.activityPanelOpen);
  const toggle = useUIStore((s) => s.toggleActivityPanel);
  const records = useActivityStore((s) => s.records);
  const loading = useActivityStore((s) => s.loading);

  // 分组是纯派生，放在组件内 memo，避免 selector 返回新数组导致无限重渲染。
  // 记录本身没有主键，这里顺带算出稳定 key（同秒同类事件靠序号区分）。
  const groups = useMemo(
    () =>
      groupByDate(records).map((group) => ({
        date: group.date,
        rows: group.records.map((record, index) => ({
          key: `${record.at}-${record.kind}-${index}`,
          record,
        })),
      })),
    [records],
  );

  if (!open) {
    const latest = records[0];
    return (
      <div
        className={cn(
          "flex h-10 shrink-0 items-center gap-3 border-t border-hairline bg-canvas px-6",
          className,
        )}
      >
        <span className="shrink-0 text-sm font-medium text-muted">
          活动日志
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted">
          {latest ? describeActivity(latest) : "暂无记录"}
        </span>
        <button
          type="button"
          aria-label="展开活动日志"
          onClick={() => toggle(true)}
          className="shrink-0 rounded-sm border border-hairline px-2 py-0.5 text-sm text-muted transition active:border-border-strong"
        >
          ⌃
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "h-64 shrink-0 overflow-y-auto border-t border-hairline bg-canvas",
        className,
      )}
    >
      <div className="sticky top-0 z-10 flex h-10 items-center gap-3 border-b border-hairline bg-canvas px-6">
        <span className="text-base font-medium text-ink">活动日志</span>
        <span className="flex-1 text-sm font-medium text-muted">
          {records.length} 条
        </span>
        <button
          type="button"
          aria-label="收起活动日志"
          onClick={() => toggle(false)}
          className="shrink-0 rounded-sm border border-hairline px-2 py-0.5 text-sm text-muted transition active:border-border-strong"
        >
          ⌄
        </button>
      </div>

      {records.length === 0 ? (
        <div className="flex h-[calc(100%-40px)] items-center justify-center text-sm font-medium text-muted">
          {loading ? "加载中…" : "暂无活动记录"}
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-6 py-3">
          {groups.map((group) => (
            <section key={group.date} className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <span className="shrink-0 text-sm font-medium text-muted">
                  {group.date}
                </span>
                <span className="flex-1 border-t border-hairline" />
              </div>
              {group.rows.map((row) => (
                <ActivityRow key={row.key} record={row.record} />
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/** 单行：结果色竖条 + 时间 + 中文描述 */
function ActivityRow({
  record,
}: {
  record: ActivityRecord;
}): React.JSX.Element {
  return (
    <div className="flex items-stretch gap-3 py-0.5">
      <span
        className={cn("w-0.5 shrink-0 rounded-xs", RESULT_BAR[record.result])}
      />
      <span className="w-20 shrink-0 text-sm font-medium tabular-nums text-muted">
        {formatTime(record.at)}
      </span>
      <span className="min-w-0 flex-1 text-sm text-body">
        {describeActivity(record)}
      </span>
    </div>
  );
}

/** 结果语义色，与 design.md 3.3 的状态色约定一致 */
const RESULT_BAR: Readonly<Record<ActivityRecord["result"], string>> = {
  success: "bg-success",
  failure: "bg-signature-coral",
  gate: "bg-signature-mustard",
  info: "bg-surface-strong",
};

/** `at` 无法解析时给出占位，避免整行因一条脏记录消失 */
function formatTime(at: string): string {
  const time = Date.parse(at);
  if (Number.isNaN(time)) return "--:--:--";
  const date = new Date(time);
  const hh = `${date.getHours()}`.padStart(2, "0");
  const mm = `${date.getMinutes()}`.padStart(2, "0");
  const ss = `${date.getSeconds()}`.padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

export type { ActivityPanelProps };

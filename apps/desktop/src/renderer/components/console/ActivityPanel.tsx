import { ChevronDown, ChevronUp } from "lucide-react";
import { useMemo } from "react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { describeActivity, groupByDate } from "@/stores/activity-format";
import { useActivityStore } from "@/stores/activity-store";
import { useUIStore } from "@/stores/ui-store";
import type { ActivityRecord } from "../../../main/ipc/channels.js";

interface ActivityPanelProps {
  className?: string;
}

/**
 * 底部活动日志抽屉。
 *
 * 只消费 activity-store，不主动 `load`：deckPath 变化时的拉取由 ConsolePage
 * 统一负责，避免同一份日志被多处重复请求。
 *
 * 日志里的「执行结束：完成 N，待人工 M」说的是**本次 run 的结果**，与控制条上的
 * 「Deck 累计：…已完成 N」不是一回事。并排读起来曾经矛盾（顶部「已完成 19」、
 * 底部「完成 0」），现由控制条侧的「Deck 累计：」前缀消歧。
 *
 * 日志这一侧**尚未**加限定语，是刻意留的：同一句文案由主进程的
 * `main/runner/deck-runner.ts` 一并写入持久化 jsonl，只改渲染层会让实时显示
 * 与重启后从日志读出的内容不一致。要改得两边一起改，属于渲染层之外的改动。
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
        <span className="shrink-0 text-2xs font-semibold text-ink-muted">
          活动日志
        </span>
        <span className="min-w-0 flex-1 truncate text-sm text-ink-secondary">
          {latest ? describeActivity(latest) : "暂无记录"}
        </span>
        <IconButton
          size="sm"
          variant="ghost"
          label="展开活动日志"
          onClick={() => toggle(true)}
        >
          <ChevronUp aria-hidden="true" className="size-4" />
        </IconButton>
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
      <div className="sticky top-0 z-sticky flex h-10 items-center gap-3 border-b border-hairline bg-canvas px-6">
        <span className="text-sm font-semibold text-ink">活动日志</span>
        <span className="flex-1 text-2xs tabular-nums text-ink-muted">
          {records.length} 条
        </span>
        <IconButton
          size="sm"
          variant="ghost"
          label="收起活动日志"
          onClick={() => toggle(false)}
        >
          <ChevronDown aria-hidden="true" className="size-4" />
        </IconButton>
      </div>

      {records.length === 0 ? (
        <div className="flex h-[calc(100%-40px)] items-center justify-center text-sm text-ink-muted">
          {loading ? "加载中…" : "还没有活动记录 · 跑一轮后这里会逐条留痕"}
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-6 py-3">
          {groups.map((group) => (
            <section key={group.date} className="flex flex-col gap-1">
              <div className="flex items-center gap-3">
                <span className="shrink-0 text-2xs font-semibold tabular-nums text-ink-muted">
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
        aria-hidden="true"
        className={cn("w-0.5 shrink-0 rounded-xs", RESULT_BAR[record.result])}
      />
      <span className="w-20 shrink-0 text-sm tabular-nums text-ink-muted">
        {formatTime(record.at)}
      </span>
      <span className="min-w-0 flex-1 text-sm text-ink-secondary">
        {describeActivity(record)}
      </span>
    </div>
  );
}

/**
 * 结果语义色。成功与普通信息走中性——一次执行里成功记录占绝大多数，
 * 用彩色标常态等于把最强的视觉手段给了最不需要注意的信息（有颜色 = 要你管）。
 */
const RESULT_BAR: Readonly<Record<ActivityRecord["result"], string>> = {
  success: "bg-border",
  failure: "bg-state-failed",
  gate: "bg-state-stale",
  info: "bg-hairline",
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

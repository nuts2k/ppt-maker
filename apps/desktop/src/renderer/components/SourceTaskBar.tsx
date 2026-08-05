import { LoaderCircle } from "lucide-react";
import { Button, Panel } from "@/components/ui";
import { sourceTaskBlockedReason } from "@/lib/source-task-core";
import { cn } from "@/lib/utils";
import { useSourceTaskStore } from "@/stores/source-task-store";

/**
 * 建页任务条 —— 抽取 / 生成这类长任务的进度、被挡下的理由与错误。
 *
 * **空态不占版面**：三样都没有时整条不渲染，而不是留一条写着「暂无任务」
 * 的空条（DESIGN.md）。它与 `RunControlBar` 分开是因为两者互斥而非并列：
 * 同一时刻最多只有一个在动。
 *
 * 「被互斥挡下」必须在这里说出来。它不是失败（什么都没跑坏），也不是成功结果
 * （`GenerateResultPanel` 与抽取报告都只认 `accepted`），落在两者中间——不渲染的
 * 话，用户点完「追加页面」只看到模态关掉，界面一动不动，理由静静躺在 store 里。
 *
 * ## 为什么放在 `components/` 顶层而不是 `components/console/`
 *
 * 子目录按视图分域（console / review / slide / final …），本组件被**控制台与策划
 * 工作台共用**：建页可以从策划页的「待建页」发起，而进度只在控制台可见等于点完
 * 什么都没发生。放进 console 目录再由策划页反向引用，读起来像是策划页在借用别人的
 * 东西；抄第二份进度条则会重蹈「两处措辞各自演化」的覆辙（见 `formatSpecHistoryWarning`
 * 的注释）。因此顶层 = 跨视图共用，`components/ui/` 仍只放无业务语义的基座。
 *
 * 它完全由 `useSourceTaskStore` 驱动、除 `className` 外不吃 props，两页各自渲染
 * 同一个组件即可，不需要任何提升到父级的状态。
 */
export function SourceTaskBar({
  className,
}: {
  className?: string;
}): React.JSX.Element | null {
  const running = useSourceTaskStore((s) => s.running);
  const index = useSourceTaskStore((s) => s.index);
  const total = useSourceTaskStore((s) => s.total);
  const message = useSourceTaskStore((s) => s.message);
  const error = useSourceTaskStore((s) => s.error);
  const result = useSourceTaskStore((s) => s.lastResult);
  const dismiss = useSourceTaskStore((s) => s.dismissResult);

  // 被挡下用 state-stale 而不是 state-failed：没有任何东西失败，是「现在不能跑」，
  // 且理由本身就写着下一步该做什么（先停止流水线 / 等建页任务结束）
  const blocked = sourceTaskBlockedReason(result);

  if (!running && error === null && blocked === null) return null;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {running && (
        <Panel className="flex items-center gap-3 bg-surface px-4 py-3">
          <LoaderCircle
            aria-hidden="true"
            className="size-3.5 shrink-0 animate-spin text-state-running motion-reduce:animate-none"
          />
          <span className="min-w-0 flex-1 truncate text-sm tabular-nums text-ink">
            {buildSourceTaskText(index, total, message)}
          </span>
        </Panel>
      )}
      {blocked !== null && (
        <Panel className="flex items-center gap-3 bg-surface px-4 py-3">
          <span className="min-w-0 flex-1 text-sm font-medium text-state-stale">
            {blocked}
          </span>
          <Button size="sm" variant="ghost" onClick={dismiss}>
            知道了
          </Button>
        </Panel>
      )}
      {error !== null && (
        <p className="rounded-sm bg-state-failed/10 px-3 py-2 text-sm font-medium text-state-failed">
          {error}
        </p>
      )}
    </div>
  );
}

/** 进度文案：总数未知（抽取在渲染前不知道有几页能过 16:9）时只报序号 */
function buildSourceTaskText(
  index: number,
  total: number,
  message: string,
): string {
  const parts: string[] = [];
  if (index > 0) {
    parts.push(total > 0 ? `第 ${index}/${total} 项` : `第 ${index} 项`);
  }
  if (message !== "") parts.push(message);
  return parts.length > 0 ? parts.join(" · ") : "建页任务执行中…";
}

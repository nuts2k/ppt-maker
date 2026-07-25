import { stageLabel } from "@shared/stages";
import { elapsedSince } from "@/lib/stage-view";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/deck-store";
import { useRunStore } from "@/stores/run-store";

/**
 * 批量执行控制条（design.md 3.3）。
 *
 * 两态共用同一容器，避免切换时布局跳动：
 * - **空闲态**：全局摘要 +（若本次会话跑完过）上一轮汇总，右侧「处理全部」为主行动。
 * - **执行态**：总进度条 + 「第 N/M 页 · 页名 · 阶段 · 已用 42s」，右侧「停止」接管。
 *
 * 数据一律自 store 逐字段订阅，不经 props 传入——控制条是全局单例，
 * 由父级透传只会让 ConsolePage 跟着每秒 tick 重渲染。
 */

/** DESIGN.md `button-primary`：近黑底、12px 圆角，全屏仅此一个主行动 */
const BUTTON_PRIMARY =
  "rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-on-primary transition active:bg-primary-active disabled:opacity-40";

/** DESIGN.md `button-secondary`：白底 + hairline 描边，与主按钮成对出现 */
const BUTTON_SECONDARY =
  "rounded-lg border border-hairline bg-canvas px-4 py-2.5 text-sm text-ink transition active:border-border-strong disabled:opacity-40";

interface RunControlBarProps {
  readonly className?: string;
}

export function RunControlBar({
  className,
}: RunControlBarProps): React.JSX.Element {
  // 逐字段订阅：selector 返回新对象会让控制条在每次 store 变更时整体重渲染
  const status = useRunStore((s) => s.status);
  const total = useRunStore((s) => s.total);
  const doneCount = useRunStore((s) => s.doneCount);
  const currentIndex = useRunStore((s) => s.currentIndex);
  const currentPageLabel = useRunStore((s) => s.currentPageLabel);
  const currentStage = useRunStore((s) => s.currentStage);
  const stageStartedAt = useRunStore((s) => s.stageStartedAt);
  const lastSummary = useRunStore((s) => s.lastSummary);
  const startError = useRunStore((s) => s.startError);
  // 订阅 1s ticker：耗时按 stageStartedAt 实时算出，
  // tick 递增是「已用 42s」重新计算的唯一驱动，值本身不参与渲染。
  useRunStore((s) => s.tick);

  const deckPath = useDeckStore((s) => s.deckPath);
  const summary = useDeckStore((s) => s.summary);

  const running = status !== "idle";
  // 活动页 = 未被软删除的页；无页可跑时主按钮无意义
  const canStart = !running && deckPath !== null && (summary?.active ?? 0) > 0;
  const percent = total > 0 ? Math.min(100, (doneCount / total) * 100) : 0;

  function handleRunAll(): void {
    if (deckPath === null) return;
    // 批量执行会调用云端 API 并上传图片，确认在入口一次性给出（PRD F2.1）
    void useRunStore
      .getState()
      .runAll(deckPath, { confirmApi: true, confirmUpload: true });
  }

  function handleStop(): void {
    void useRunStore.getState().stop();
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center gap-4 rounded-lg border border-hairline bg-surface-soft px-6 py-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {running ? (
            <>
              <div
                role="progressbar"
                aria-label="总进度"
                aria-valuemin={0}
                aria-valuemax={total}
                aria-valuenow={doneCount}
                className="h-1.5 w-full overflow-hidden rounded-xs bg-surface-strong"
              >
                {total > 0 && (
                  <div
                    className="h-full rounded-xs bg-info transition-[width]"
                    style={{ width: `${percent}%` }}
                  />
                )}
              </div>
              <span className="truncate text-sm font-medium text-muted">
                {buildRunningText({
                  stopping: status === "stopping",
                  currentIndex,
                  total,
                  pageLabel: currentPageLabel,
                  stage: currentStage,
                  elapsed: elapsedSince(stageStartedAt, Date.now()),
                })}
              </span>
            </>
          ) : (
            <>
              <span className="truncate text-sm text-body">
                {buildSummaryText(summary)}
              </span>
              {lastSummary !== null && (
                <span className="truncate text-sm font-medium text-muted">
                  {`上轮：完成 ${lastSummary.completed} · 待人工 ${lastSummary.gated} · 失败 ${lastSummary.failed}`}
                </span>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <button
            type="button"
            onClick={handleRunAll}
            disabled={!canStart}
            className={BUTTON_PRIMARY}
          >
            处理全部
          </button>
          {/* 停止在空闲态保留占位并禁用，避免执行态出现时按钮组宽度突变 */}
          <button
            type="button"
            onClick={handleStop}
            disabled={status !== "running"}
            className={BUTTON_SECONDARY}
          >
            停止
          </button>
        </div>
      </div>

      {startError !== null && (
        <p className="rounded-sm bg-signature-coral/10 px-3 py-2 text-sm font-medium text-signature-coral">
          {startError}
        </p>
      )}
    </div>
  );
}

/** 空闲态摘要：口径与 CLI `deck status` 一致（completed + inProgress + notStarted = active） */
function buildSummaryText(
  summary: {
    readonly active: number;
    readonly completed: number;
    readonly inProgress: number;
    readonly notStarted: number;
  } | null,
): string {
  if (summary === null) return "尚未打开 Deck";
  return `共 ${summary.active} 页 · 已完成 ${summary.completed} · 进行中 ${summary.inProgress} · 未开始 ${summary.notStarted}`;
}

/** 执行态状态行；缺失的片段（未开始的页/阶段、无计时）直接省略而非显示占位符 */
function buildRunningText(params: {
  stopping: boolean;
  currentIndex: number;
  total: number;
  pageLabel: string | null;
  stage: string | null;
  elapsed: string | null;
}): string {
  const parts: string[] = [];
  if (params.stopping) parts.push("正在停止 · 当前页完成后结束");
  if (params.currentIndex > 0) {
    parts.push(`第 ${params.currentIndex}/${params.total} 页`);
  }
  if (params.pageLabel !== null) parts.push(params.pageLabel);
  if (params.stage !== null) parts.push(stageLabel(params.stage));
  if (params.elapsed !== null) parts.push(`已用 ${params.elapsed}`);
  return parts.length > 0 ? parts.join(" · ") : "正在启动…";
}

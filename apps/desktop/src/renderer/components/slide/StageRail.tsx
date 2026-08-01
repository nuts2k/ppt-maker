import { ChevronDown, CircleX } from "lucide-react";
import { useMemo, useState } from "react";
import { StageTrack } from "@/components/console/StageTrack";
import { Button, IconButton, NoticeBar, StatusDot } from "@/components/ui";
import {
  blockingStageView,
  completedStageCount,
  currentStageView,
  deriveStageViews,
  elapsedSince,
  STAGE_STATUS_TEXT,
  type StageView,
} from "@/lib/stage-view";
import { cn } from "@/lib/utils";
import { useRunStore } from "@/stores/run-store";
import { useUIStore } from "@/stores/ui-store";
import type { SlideDetail } from "../../../main/ipc/channels.js";
import {
  isRunStage,
  type RunStage,
  stageLabel,
} from "../../../shared/stages.js";

/**
 * 单页阶段轨道 —— 画布上方常驻，默认**收起**为单行（design.md §5）。
 *
 * 展开态的九段轨道曾是常驻形态，占 175px（复核页可视高度的 11%）。但用户走到
 * 这一页时已经在做页内作业，9 个等权重点位提供的信息价值极低：真正要回答的问题
 * 只有「这页现在卡在哪、要不要我动手」。于是收起态只留一条分段进度条 + 一句话
 * 状态，异常阶段用形状 + 颜色直接标在条上（不只靠颜色，灰度下也分得开）。
 *
 * **错误条不随收起消失。** V1 的关键缺陷之一是"错误只在侧边栏 Pipeline 标签短暂
 * 显示"；把它折进展开态等于把那个缺陷重新打开。错误条与「重跑失败阶段」入口一律
 * 挂在收起态之外，耐久层错误来自 manifest attempts，重启后依然可见。
 *
 * **轨道是只读的状态显示，不是操作入口。** 点位曾经可点击 = 从该阶段重跑，
 * 但 9 个点位里绝大多数重跑没有意义：想重做的内容改动会经由保存自动失效下游，
 * 想重试的失败阶段只有一个、且已经由错误条上的按钮直达。可点击面积远大于
 * 有意义的动作面积，只会制造误触与困惑。唯一保留的重跑入口是错误条上的
 * 「重跑失败阶段」，以及最终确认页的「重做底图」。
 *
 * 视觉与控制台卡片轨道同源（`StageTrack`，配色形状取自
 * `components/ui/status-spec.ts` 的唯一状态表），保证同一状态在两处语义一致。
 */

interface StageRailProps {
  readonly slide: SlideDetail;
  /** 从指定阶段重跑；仅供错误条的「重跑失败阶段」使用。执行中由调用方置 disabled */
  readonly onRerunFrom: (stage: RunStage) => void;
  readonly disabled: boolean;
  /** 本次 run 该页的错误（会话层），与 slide.lastError（耐久层）合并展示 */
  readonly sessionError: {
    readonly code: string;
    readonly message: string;
  } | null;
}

const DETAIL_ID = "stage-rail-detail";

export function StageRail({
  slide,
  onRerunFrom,
  disabled,
  sessionError,
}: StageRailProps): React.JSX.Element {
  const [errorDetailOpen, setErrorDetailOpen] = useState(false);

  // 逐字段订阅：selector 返回新对象会让轨道随任意 store 变更整体重渲染
  const open = useUIStore((s) => s.stageRailOpen);
  const toggleStageRail = useUIStore((s) => s.toggleStageRail);
  const liveStages = useRunStore((s) => s.liveStages[slide.slideId]);
  const runStatus = useRunStore((s) => s.status);
  const currentSlideId = useRunStore((s) => s.currentSlideId);
  const stageStartedAt = useRunStore((s) => s.stageStartedAt);
  // 订阅 1s ticker：耗时按 stageStartedAt 实时算出，tick 是重算的唯一驱动
  useRunStore((s) => s.tick);

  const views = useMemo(
    () => deriveStageViews(slide, liveStages),
    [slide, liveStages],
  );

  const isRunningThisSlide =
    slide.slideId === currentSlideId && runStatus !== "idle";
  const current = currentStageView(views);
  // 「哪个阶段要你管」与卡片、待办队列同源：各写一份判据迟早各说各话
  const blocking = blockingStageView(views);
  const doneCount = completedStageCount(views);
  const elapsed = isRunningThisSlide
    ? elapsedSince(stageStartedAt, Date.now())
    : null;

  // 耐久层错误优先：它带阶段与时间，且重启后仍然存在
  const error = slide.lastError ?? sessionError;
  const errorStage =
    slide.lastError?.stage ??
    views.find((view) => view.status === "failed")?.stage ??
    null;
  // 失败阶段可能来自 manifest 的任意字符串（含已移出可见序列的 report），
  // 只有落在执行序列内才可重跑——不能强转，否则会把 IPC 那边的运行时错误留到用户点击时才炸
  const rerunStage: RunStage | null =
    errorStage !== null && isRunStage(errorStage) ? errorStage : null;

  return (
    <div className="flex shrink-0 flex-col border-b border-hairline bg-surface">
      {/* 收起态：一条分段进度条 + 一句话状态，整行约 36px */}
      <div className="flex items-center gap-3 px-6 py-1">
        <StageProgressBar views={views} />
        <span className="min-w-0 flex-1 truncate text-sm text-ink">
          {railSummary(isRunningThisSlide, current, blocking)}
        </span>
        <span className="shrink-0 text-2xs font-semibold tabular-nums text-ink-muted">
          {doneCount}/{views.length}
          {elapsed !== null && ` · 已用 ${elapsed}`}
        </span>
        <IconButton
          size="sm"
          variant="ghost"
          label={open ? "收起阶段轨道" : "展开阶段轨道"}
          aria-expanded={open}
          aria-controls={DETAIL_ID}
          onClick={() => toggleStageRail()}
        >
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "size-4 transition-transform duration-fast",
              open && "rotate-180",
            )}
          />
        </IconButton>
      </div>

      {/*
        展开收起用 grid 行高过渡而非高度写死：阶段数是常量但标签换行不是。
        收起时内容被裁掉且对读屏隐藏，减弱动效下由 index.css 兜底为直切，
        不依赖动画来决定内容在不在——藏没了就成了能力静默消失。
      */}
      <div
        id={DETAIL_ID}
        aria-hidden={!open}
        className={cn(
          "grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out-quart",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="flex flex-col gap-3 px-6 pb-4 pt-1">
            {/* 只读状态显示，与卡片轨道共用同一组件与色表 */}
            <StageTrack views={views} size="md" />

            {/* 阶段名与点位一一对齐：首尾贴边、中间均分，与轨道的 flex-1 连接线同构 */}
            <ul className="flex w-full items-start">
              {views.map((view, index) => (
                <li
                  key={view.stage}
                  className={cn(
                    "flex min-w-0 items-start",
                    index > 0 && "flex-1 justify-end",
                  )}
                >
                  <span
                    className={cn(
                      "truncate text-2xs",
                      // 两个常态一律安静，要你管的三个状态才加重字重
                      view.status === "completed" || view.status === "pending"
                        ? "text-ink-muted"
                        : "font-semibold text-ink",
                    )}
                    title={`${view.label} · ${STAGE_STATUS_TEXT[view.status]}`}
                  >
                    {view.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* 错误条挂在折叠区之外：收起态同样要能看见失败并直达重跑入口 */}
      {error !== null && (
        <NoticeBar level="failed" className="flex flex-col gap-2 py-2">
          <div className="flex items-center gap-3">
            {/* 与 STATUS_SPEC.failed 同一个图标，形状 + 颜色 + 文字三重表达 */}
            <CircleX
              aria-hidden="true"
              className="size-4 shrink-0 text-state-failed"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-state-failed">
              {errorStage !== null && `${stageLabel(errorStage)} · `}
              {error.code}: {error.message}
            </span>
            {/* 轨道降为只读后，这里是失败重试的唯一入口——只指向真正失败的那个阶段 */}
            {rerunStage !== null && (
              <Button
                size="sm"
                variant="secondary"
                disabled={disabled}
                onClick={() => onRerunFrom(rerunStage)}
              >
                重跑失败阶段
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={errorDetailOpen}
              onClick={() => setErrorDetailOpen((value) => !value)}
            >
              {errorDetailOpen ? "收起" : "详情"}
            </Button>
          </div>
          {errorDetailOpen && (
            <div className="flex flex-col gap-1 border-t border-state-failed/30 pt-2 text-sm text-ink-secondary">
              <p className="whitespace-pre-wrap break-words">{error.message}</p>
              {slide.lastError !== null && (
                <p className="font-medium">发生于 {slide.lastError.at}</p>
              )}
              <p className="font-medium">
                修正后点上方的「重跑失败阶段」即可从该阶段继续
              </p>
            </div>
          )}
        </NoticeBar>
      )}
    </div>
  );
}

/**
 * 收起态的一句话状态。
 *
 * 措辞遵循 STAGE_STATUS_TEXT 的约定：`stale` 写「上游已变更」而非失败——失效是
 * 改了上游后的常规路径，写成失败会把「改完了、重跑一下」报成红色故障。
 */
function railSummary(
  running: boolean,
  current: StageView | null,
  blocking: StageView | null,
): string {
  if (running) return `执行中 · ${current?.label ?? ""}`;
  if (blocking !== null) {
    return `停在「${blocking.label}」· ${STAGE_STATUS_TEXT[blocking.status]}`;
  }
  if (current === null) return "全部阶段已完成";
  return `下一步「${current.label}」· ${STAGE_STATUS_TEXT[current.status]}`;
}

/**
 * 分段进度条 —— 收起态的扫读面。
 *
 * 已完成/待执行两个常态只用中性深浅区分（有颜色 = 要你管），需要用户动作的三个
 * 状态额外压一个 `StatusDot`：三角 = 上游已变更、方块 = 失败、脉冲圆 = 执行中。
 * 形状来自唯一状态表，因此灰度与色弱条件下仍可分辨（PRD A3）。
 *
 * 纯装饰：语义由同一行的文字状态与计数承担，读屏不该逐段朗读 9 个无文本节点。
 */
function StageProgressBar({
  views,
}: {
  readonly views: readonly StageView[];
}): React.JSX.Element {
  return (
    <ul
      aria-hidden="true"
      className="flex h-4 w-48 shrink-0 items-center gap-0.5"
    >
      {views.map((view) => {
        const needsAttention =
          view.status !== "completed" && view.status !== "pending";
        return (
          <li
            key={view.stage}
            title={`${view.label} · ${STAGE_STATUS_TEXT[view.status]}`}
            className="relative flex h-full min-w-0 flex-1 items-center"
          >
            <span
              className={cn(
                "h-1 w-full rounded-full",
                view.status === "completed" ? "bg-border" : "bg-hairline",
              )}
            />
            {needsAttention && (
              <StatusDot
                status={view.status}
                size="sm"
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

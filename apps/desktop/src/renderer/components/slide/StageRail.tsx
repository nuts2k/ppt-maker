import { useEffect, useMemo, useRef, useState } from "react";
import { StageTrack } from "@/components/console/StageTrack";
import {
  completedStageCount,
  currentStageView,
  deriveStageViews,
  elapsedSince,
  STAGE_DOT_CLASS,
  STAGE_STATUS_TEXT,
} from "@/lib/stage-view";
import { cn } from "@/lib/utils";
import { useRunStore } from "@/stores/run-store";
import type { SlideDetail } from "../../../main/ipc/channels.js";
import type { RunStage } from "../../../shared/stages.js";

/**
 * 单页阶段轨道（design.md 3.3 StageRail）—— 画布上方常驻，不再藏进侧边栏标签页。
 *
 * V1 的关键缺陷之一是"错误只在侧边栏 Pipeline 标签短暂显示"。这里把 10 阶段轨道
 * 与失败详情提到常驻位置：轨道点位可点击 = 从该阶段重跑，失败时错误条直接展开
 * `code: message`（耐久层来自 manifest attempts，重启后依然可见）。
 *
 * 视觉与控制台卡片轨道同源（`StageTrack` size="md"，`STAGE_DOT_CLASS` 唯一色表），
 * 保证同一状态在两处颜色语义一致。
 */

/** 待确认态自动取消的等待时间 */
const CONFIRM_TIMEOUT_MS = 5000;

interface StageRailProps {
  readonly slide: SlideDetail;
  /** 从指定阶段重跑；执行中由调用方置 disabled */
  readonly onRerunFrom: (stage: RunStage) => void;
  readonly disabled: boolean;
  /** 本次 run 该页的错误（会话层），与 slide.lastError（耐久层）合并展示 */
  readonly sessionError: {
    readonly code: string;
    readonly message: string;
  } | null;
}

export function StageRail({
  slide,
  onRerunFrom,
  disabled,
  sessionError,
}: StageRailProps): React.JSX.Element {
  const [detailOpen, setDetailOpen] = useState(false);
  const [pendingStage, setPendingStage] = useState<RunStage | null>(null);
  const railRef = useRef<HTMLDivElement>(null);

  // 逐字段订阅：selector 返回新对象会让轨道随任意 store 变更整体重渲染
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
  const doneCount = completedStageCount(views);
  const elapsed = isRunningThisSlide
    ? elapsedSince(stageStartedAt, Date.now())
    : null;

  // 待确认态的退出路径：5 秒无操作、点到轨道之外、或本页转入执行中
  useEffect(() => {
    if (pendingStage === null) return;
    if (disabled) {
      setPendingStage(null);
      return;
    }
    const timer = window.setTimeout(
      () => setPendingStage(null),
      CONFIRM_TIMEOUT_MS,
    );
    function handlePointerDown(event: PointerEvent): void {
      const target = event.target;
      if (
        target instanceof Node &&
        railRef.current?.contains(target) === true
      ) {
        return;
      }
      setPendingStage(null);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [pendingStage, disabled]);

  // 耐久层错误优先：它带阶段与时间，且重启后仍然存在
  const error = slide.lastError ?? sessionError;
  const errorStage =
    slide.lastError?.stage ??
    views.find((view) => view.status === "failed")?.stage ??
    null;

  /**
   * 已完成阶段需点两次才重跑。
   *
   * 重跑会作废该阶段及其全部下游产物，clean 这类阶段还要重新调用付费 API；而 10 个
   * 点位横贯整个顶栏，误触的命中面积与代价完全不成比例。pending/failed 阶段没有
   * 产物可作废，单击直达。
   *
   * 曾经误触是无害的——因为重跑压根不生效（run 把已完成阶段幂等跳过），那正是
   * 「点了没反应」那个缺陷；修好之后误触才第一次有了真实后果。
   */
  function handleStageClick(stage: RunStage): void {
    if (disabled) return;
    const status = views.find((view) => view.stage === stage)?.status;
    if (status !== "completed") {
      setPendingStage(null);
      onRerunFrom(stage);
      return;
    }
    if (pendingStage !== stage) {
      setPendingStage(stage);
      return;
    }
    setPendingStage(null);
    onRerunFrom(stage);
  }

  return (
    <div
      ref={railRef}
      className="flex shrink-0 flex-col gap-3 border-b border-hairline bg-surface-soft px-6 py-4"
    >
      <div className="flex items-baseline gap-3">
        <span className="shrink-0 text-base font-medium text-ink">
          {isRunningThisSlide
            ? `执行中 · ${current?.label ?? ""}`
            : current === null
              ? "全部阶段已完成"
              : `${current.label} · ${STAGE_STATUS_TEXT[current.status]}`}
        </span>
        <span className="shrink-0 text-sm font-medium text-muted">
          {doneCount}/{views.length}
          {elapsed !== null && ` · 已用 ${elapsed}`}
        </span>
        <span className="min-w-0 flex-1" />
        <span className="shrink-0 text-sm font-medium text-muted">
          {disabled
            ? "执行中不可重跑"
            : "点击阶段点位可从该阶段重跑，已完成阶段需确认"}
        </span>
      </div>

      {/* 轨道点位承担"从该阶段重跑"入口，与卡片轨道共用同一组件与色表 */}
      <StageTrack
        views={views}
        size="md"
        {...(disabled ? {} : { onStageClick: handleStageClick })}
      />

      {pendingStage !== null && (
        <p className="rounded-sm bg-signature-mustard px-4 py-2 text-sm font-medium text-ink">
          重跑「{views.find((view) => view.stage === pendingStage)?.label}
          」将作废该阶段及之后所有产物，再点一次该阶段确认
        </p>
      )}

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
                "truncate text-sm",
                view.status === "running"
                  ? "font-medium text-info"
                  : view.status === "completed"
                    ? "text-muted"
                    : "font-medium text-muted",
              )}
              title={`${view.label} · ${STAGE_STATUS_TEXT[view.status]}`}
            >
              {view.label}
            </span>
          </li>
        ))}
      </ul>

      {error !== null && (
        <div className="flex flex-col gap-2 rounded-sm bg-signature-coral px-4 py-2">
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={cn(
                "h-2 w-2 shrink-0 rounded-full border",
                STAGE_DOT_CLASS.failed,
                "border-on-primary",
              )}
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-on-primary">
              {errorStage !== null && `${errorStage} · `}
              {error.code}: {error.message}
            </span>
            <button
              type="button"
              onClick={() => setDetailOpen((open) => !open)}
              className="shrink-0 rounded-xs border border-on-primary/40 px-2 py-0.5 text-sm font-medium text-on-primary transition active:border-on-primary"
            >
              {detailOpen ? "收起" : "详情"}
            </button>
          </div>
          {detailOpen && (
            <div className="flex flex-col gap-1 border-t border-on-primary/30 pt-2 text-sm text-on-primary">
              <p className="whitespace-pre-wrap break-words">{error.message}</p>
              {slide.lastError !== null && (
                <p className="font-medium">发生于 {slide.lastError.at}</p>
              )}
              <p className="font-medium">
                修正后点击上方对应阶段点位即可从该阶段重跑
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

import { stageLabel } from "@shared/stages";
import { useEffect, useMemo, useState } from "react";
import {
  blockingStageView,
  completedStageCount,
  currentStageView,
  deriveStageViews,
  elapsedSince,
  STAGE_STATUS_TEXT,
} from "@/lib/stage-view";
import { cn } from "@/lib/utils";
import { useRunStore } from "@/stores/run-store";
import { useUIStore } from "@/stores/ui-store";
import type { SlideDetail } from "../../../main/ipc/channels.js";
import { StageTrack } from "./StageTrack";

/**
 * 控制台卡片（design.md 3.3 `demo-grid-card` 规格）。
 *
 * 一张卡承载单页的全部可判读信息：缩略图 → 页名 → 阶段轨道 → 状态/计时 → 失败错误条，
 * 用户扫一眼网格即可定位「哪页卡住了、卡在哪一步」，无需进入单页视图。
 *
 * 数据来自两层：耐久层 `SlideDetail`（deck-store）与会话层 `liveStages`（run-store），
 * 由 `deriveStageViews` 合并，重启后仅剩耐久层也能正确呈现。
 */

interface SlideCardProps {
  slide: SlideDetail;
}

type ThumbnailState = "loading" | "ready" | "empty";

export function SlideCard({ slide }: SlideCardProps): React.JSX.Element {
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [thumbnailState, setThumbnailState] =
    useState<ThumbnailState>("loading");

  // 逐字段订阅：selector 返回新对象会导致每次 store 变更都重渲染整片网格
  const liveStages = useRunStore((s) => s.liveStages[slide.slideId]);
  const runStatus = useRunStore((s) => s.status);
  const currentSlideId = useRunStore((s) => s.currentSlideId);
  const currentStage = useRunStore((s) => s.currentStage);
  const stageStartedAt = useRunStore((s) => s.stageStartedAt);
  // 订阅 1s ticker：耗时是按 stageStartedAt 实时算出来的，
  // tick 递增是本组件重新计算「已用 42s」的唯一驱动，值本身不参与渲染。
  useRunStore((s) => s.tick);

  useEffect(() => {
    let cancelled = false;
    setThumbnailState("loading");
    void window.api.slide
      .loadImage(slide.absWorkspacePath, "source_image")
      .then((dataUrl) => {
        if (cancelled) return;
        setThumbnail(dataUrl);
        setThumbnailState(dataUrl ? "ready" : "empty");
      })
      .catch(() => {
        if (cancelled) return;
        setThumbnail(null);
        setThumbnailState("empty");
      });
    return () => {
      cancelled = true;
    };
  }, [slide.absWorkspacePath]);

  const views = useMemo(
    () => deriveStageViews(slide, liveStages),
    [slide, liveStages],
  );

  const isRunningThisSlide =
    slide.slideId === currentSlideId && runStatus !== "idle";
  const doneCount = completedStageCount(views);
  const current = currentStageView(views);
  const blocking = blockingStageView(views);
  const failed = slide.lastError !== null || blocking !== null;

  const statusText = buildStatusText({
    isRunningThisSlide,
    runningStageLabel:
      currentStage !== null ? stageLabel(currentStage) : (current?.label ?? ""),
    elapsed: elapsedSince(stageStartedAt, Date.now()),
    doneCount,
    total: views.length,
    current,
  });

  /*
   * 错误条指名的是**出问题的那个阶段**（blocking），不是「当前阶段」（current）：
   * current 取第一个未完成的阶段，失效场景下往往落在它前面的某个 pending 上。
   *
   * 「失效」也不等于「失败」：阶段 A 起，保存复核内容与「回到文本复核」都会按粒度
   * 失效下游，stale 从此是常规路径而非故障，写成「执行失败」会把一次正常的
   * 「改完了、重跑一下」报成红色故障。措辞与待办队列的 `TODO_REASON_TEXT` 对齐。
   */
  const errorText = failed
    ? slide.lastError !== null
      ? `${slide.lastError.code}: ${slide.lastError.message}`
      : `阶段「${blocking?.label ?? slide.currentStage}」${
          blocking?.status === "stale" ? "上游已变更" : "执行失败"
        }，需重跑`
    : null;

  function handleOpen(): void {
    useUIStore.getState().openSlide(slide.slideId);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    // 空格默认会滚动页面，卡片作为按钮使用时需拦下
    event.preventDefault();
    handleOpen();
  }

  return (
    // 卡片内部可能出现按钮（阶段点位），外层用 button 会构成非法嵌套，
    // 因此用 div + role="button" 自行补齐键盘可达性。
    // biome-ignore lint/a11y/useSemanticElements: 见上，语义按钮会导致 button 嵌套
    <div
      role="button"
      tabIndex={0}
      aria-label={`打开 ${slide.pageLabel}`}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex flex-col gap-3 rounded-md border border-hairline bg-canvas p-4 text-left transition active:border-border-strong",
        isRunningThisSlide && "border-info",
        slide.removed && "opacity-50",
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-sm bg-surface-soft">
        {thumbnailState === "ready" && thumbnail ? (
          <img
            src={thumbnail}
            alt={slide.pageLabel}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-muted">
            {thumbnailState === "loading" ? "加载中…" : "无预览"}
          </div>
        )}
        {slide.removed && (
          <span className="absolute left-2 top-2 rounded-xs bg-surface-dark px-1.5 py-0.5 text-sm font-medium text-on-dark">
            已移除
          </span>
        )}
      </div>

      <span
        className="truncate text-base font-medium text-ink"
        title={slide.pageLabel}
      >
        {slide.pageLabel}
      </span>

      <StageTrack views={views} size="sm" />

      <span className="text-sm font-medium text-muted">{statusText}</span>

      {errorText !== null && (
        <span
          title={errorText}
          className="line-clamp-2 rounded-sm bg-signature-coral px-2 py-1 text-sm font-medium text-on-primary"
        >
          {errorText}
        </span>
      )}
    </div>
  );
}

/** 状态行文案：执行中 > 全部完成 > 停在某阶段，三选一 */
function buildStatusText(params: {
  isRunningThisSlide: boolean;
  runningStageLabel: string;
  elapsed: string | null;
  doneCount: number;
  total: number;
  current: { label: string; status: keyof typeof STAGE_STATUS_TEXT } | null;
}): string {
  const { isRunningThisSlide, runningStageLabel, elapsed, doneCount, total } =
    params;

  if (isRunningThisSlide) {
    const parts = ["执行中", runningStageLabel];
    if (elapsed !== null) parts.push(`已用 ${elapsed}`);
    return parts.filter((part) => part !== "").join(" · ");
  }
  if (params.current === null) {
    return `已完成 · ${doneCount}/${total}`;
  }
  const { label, status } = params.current;
  return `${label} · ${STAGE_STATUS_TEXT[status]} · ${doneCount}/${total}`;
}

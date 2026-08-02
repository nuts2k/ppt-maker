import { stageLabel } from "@shared/stages";
import { useEffect, useMemo, useState } from "react";
import { StatusChip } from "@/components/ui";
import { awaitingSourceConfirm } from "@/lib/accept-gate";
import {
  sourceBadgeLabel,
  sourceSummaryText,
  specDriftText,
} from "@/lib/source-view";
import {
  blockingStageView,
  completedStageCount,
  currentStageView,
  deriveStageViews,
  elapsedSince,
  type StageViewStatus,
} from "@/lib/stage-view";
import { cn } from "@/lib/utils";
import { useRunStore } from "@/stores/run-store";
import { useUIStore } from "@/stores/ui-store";
import type { SlideDetail } from "../../../main/ipc/channels.js";
import { StageTrack } from "./StageTrack";

/**
 * 控制台卡片 —— 一叠 20–50 页的扫读单元，目标一屏容纳 ≥12 张。
 *
 * 一张卡承载单页的全部可判读信息：缩略图 → 页名 + 阶段计数 → 阶段轨道 → 一行详情，
 * 用户扫一眼网格即可定位「哪页卡住了、卡在哪一步」，无需进入单页视图。
 *
 * 两条密度决策：
 * 1. **状态标记恒在缩略图右上角**，不随文字长度浮动——远距离扫读靠的是位置固定。
 *    完成/待执行只给一个中性点（有颜色 = 要你管），需要动作的三态才升级为带文字的 chip。
 * 2. **详情行不复述状态点已经说过的话**。完成态那行留空（保留行高避免网格错位），
 *    执行中给阶段名与计时，待执行给「下一步」，异常给出问题的那个阶段与原因。
 *
 * 数据来自两层：耐久层 `SlideDetail`（deck-store）与会话层 `liveStages`（run-store），
 * 由 `deriveStageViews` 合并，重启后仅剩耐久层也能正确呈现。
 */

interface SlideCardProps {
  slide: SlideDetail;
  /**
   * 该页在待办队列里的原因，**取自 `deriveTodoQueue` 的同一条记录**（由 ConsolePage 透传）。
   *
   * 不在卡片里另算一遍：「需文本复核」这类待办没有任何阶段处于异常态，卡片自己
   * 只能算出「下一步 生成干净底图」，于是筛到「待处理」档时会出现一张不带任何标记、
   * 看不出为什么在这儿的卡片。同一件事在两处展示，必须是同一个函数算出来的。
   */
  todoReason?: string | undefined;
}

type ThumbnailState = "loading" | "ready" | "empty";

/** 需要用户动作的三态才配文字 chip，常态只给点 */
const ACTIONABLE: ReadonlySet<StageViewStatus> = new Set([
  "running",
  "stale",
  "failed",
  "interrupted",
]);

export function SlideCard({
  slide,
  todoReason,
}: SlideCardProps): React.JSX.Element {
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

  /*
   * 卡片状态取自既有判据的组合，不新写一套：执行中 > 有阻塞阶段 > 有错误 > 全完成 > 待执行。
   * 状态点与详情行同源于此，两处不会各说各话。
   */
  const cardStatus: StageViewStatus = isRunningThisSlide
    ? "running"
    : (blocking?.status ??
      (slide.lastError !== null
        ? "failed"
        : current === null
          ? "completed"
          : "pending"));

  /*
   * 详情行指名的是**出问题的那个阶段**（blocking），不是「当前阶段」（current）：
   * current 取第一个未完成的阶段，失效场景下往往落在它前面的某个 pending 上。
   *
   * 「失效」也不等于「失败」：阶段 A 起，保存复核内容与「回到文本复核」都会按粒度
   * 失效下游，stale 从此是常规路径而非故障，写成「执行失败」会把一次正常的
   * 「改完了、重跑一下」报成红色故障。措辞与待办队列的 `TODO_REASON_TEXT` 对齐。
   */
  const errorText =
    slide.lastError !== null || blocking !== null
      ? slide.lastError !== null
        ? `${slide.lastError.code}: ${slide.lastError.message}`
        : `阶段「${blocking?.label ?? slide.currentStage}」${
            blocking?.status === "stale" ? "上游已变更" : "执行失败"
          }，需重跑`
      : null;

  /*
   * 规格漂移（R6）：**只是标注**。它排在 `todoReason` 之后、进度描述之前——
   * 比「待我处理」弱（没人要求你现在做什么），比常态强（图确实与规格对不上了）。
   * 它不进待办队列、不改任何阶段状态、不影响 `cardStatus`，改回原样自动消失。
   */
  const driftText = specDriftText(slide.specDrift);
  const sourceLabel = sourceBadgeLabel(slide.sourceKind);
  const sourceSummary = sourceSummaryText(slide);

  // 优先级：真出错 > 待办原因 > 规格漂移 > 进度描述。待办原因用校对红——它就是「待我处理」
  const detail =
    errorText ??
    todoReason ??
    driftText ??
    buildDetailText({
      isRunningThisSlide,
      runningStageLabel:
        currentStage !== null
          ? stageLabel(currentStage)
          : (current?.label ?? ""),
      elapsed: elapsedSince(stageStartedAt, Date.now()),
      current,
    });
  /*
   * 详情行的色调必须**按严重度排序**，否则会出现语义倒挂。
   *
   * 初版写成「有 todoReason 就上校对红、否则中性」，结果是：真失败
   * （CLEAN_PLATE_TIMEOUT）渲染成中性灰，而「需文本复核」这个常规人工门
   * 渲染成红色 —— 失败比日常流程还不显眼。40 页真机截图里一眼可见。
   *
   * 现在的顺序：失败 > 失效 > 待我处理 > 常态。与 STATUS_SPEC 的配色同源，
   * 卡片角标（失败/上游已变更）也用同一套色，两者不会再各说各话。
   */
  const detailTone =
    errorText !== null
      ? blocking?.status === "stale"
        ? "text-state-stale"
        : "text-state-failed"
      : todoReason !== undefined
        ? "text-proof"
        : driftText !== null
          ? // stale 的语义正是「上游已变更」，与漂移的定义精确对应
            "text-state-stale"
          : "text-ink-secondary";

  /*
   * 停在源图确认的页点卡片进**审片视图**，不进复核页：那页连 OCR 都还没跑，
   * 复核页的 480px 列表与标注画布全是空的，用户还得自己找回控制台再绕一圈。
   *
   * 判据取 `accept-gate` 的同一个待办口径（可达且未确认），不在这里就地写
   * `sourceKind === "generated"`——那样它就成了第二份 filter。
   */
  function handleOpen(): void {
    const ui = useUIStore.getState();
    if (awaitingSourceConfirm(slide)) {
      ui.openSourceReview(slide.slideId);
      return;
    }
    ui.openSlide(slide.slideId);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    // 空格默认会滚动页面，卡片作为按钮使用时需拦下
    event.preventDefault();
    handleOpen();
  }

  return (
    // 卡片内部可能出现按钮（阶段点位），外层用 button 会构成非法嵌套，
    // 因此用 div + role="button" 自行补齐键盘可达性。焦点环由 index.css 全局提供。
    // biome-ignore lint/a11y/useSemanticElements: 见上，语义按钮会导致 button 嵌套
    <div
      role="button"
      tabIndex={0}
      aria-label={`打开 ${slide.pageLabel}`}
      onClick={handleOpen}
      onKeyDown={handleKeyDown}
      className={cn(
        "flex cursor-pointer flex-col gap-1.5 rounded-md border border-hairline bg-canvas p-2 text-left",
        "transition-colors duration-fast hover:border-border hover:bg-surface active:border-border-strong",
        isRunningThisSlide && "border-state-running",
        slide.removed && "opacity-50",
      )}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-sm bg-surface-sunken">
        {thumbnailState === "ready" && thumbnail ? (
          <img
            src={thumbnail}
            alt={slide.pageLabel}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xs text-ink-muted">
            {thumbnailState === "loading" ? "加载中…" : "无预览"}
          </div>
        )}

        {/*
          状态角位固定在右上：远距离扫读靠位置恒定，不随卡内文字长度浮动。
          **只有需要动作的三态才在这里留标记**——一叠 20–50 页里绝大多数是完成态，
          给常态也挂一枚角标，等于把满屏角落重新填满噪音（旧版 9 个绿点的同一个错误，
          换成灰色不算修好）。完成与待执行由下方的 9/9 计数与阶段轨道表达。
          垫一层 canvas 底 —— chip 的 wash 是 10% 透明色，直接压在缩略图上读不出来。
        */}
        {ACTIONABLE.has(cardStatus) && (
          <span className="absolute right-1 top-1 flex items-center rounded-sm bg-canvas p-0.5">
            <StatusChip status={cardStatus} />
          </span>
        )}

        {/*
          左上角：已移除 > 来源，两者互斥。移除页 `sourceKind` 本就是 null
          （CLI 不加载已移除页的工作区），这里的顺序只是把这件事写明白。

          来源**不上色**：一叠 20–50 页里每一页都有来源，它是常态信息。
          给常态上色等于把最强的视觉手段给了最不需要注意的信息，
          「有颜色 = 要你管」这条扫读规则就作废了。垫一层 canvas 底是因为
          它压在缩略图上，直接铺中性字读不出来。
        */}
        {slide.removed ? (
          <span className="absolute left-1 top-1 rounded-xs bg-ink px-1 py-0.5 text-2xs font-semibold text-on-ink">
            已移除
          </span>
        ) : (
          sourceLabel !== null && (
            /*
              徽标只写来源那一个词（网格里 20–50 张，多一个词就撑破角位），
              「人工确认 / 按来源自动放行」进 title：总览这一层要的是能查证，
              逐页的正面陈述由单页工具栏承担（A10）。
            */
            <span
              title={sourceSummary ?? sourceLabel}
              className="absolute left-1 top-1 rounded-xs bg-canvas px-1 py-0.5 text-xs text-ink-muted"
            >
              {sourceLabel}
            </span>
          )
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span
          className="min-w-0 flex-1 truncate text-sm font-medium text-ink"
          title={slide.pageLabel}
        >
          {slide.pageLabel}
        </span>
        <span className="shrink-0 text-2xs tabular-nums text-ink-muted">
          {doneCount}/{views.length}
        </span>
      </div>

      <StageTrack views={views} size="sm" />

      {/* 完成态留空行：保留行高，网格不因文案有无而错位 */}
      <span
        title={detail === "" ? undefined : detail}
        className={cn("min-h-4 truncate text-2xs", detailTone)}
      >
        {detail}
      </span>
    </div>
  );
}

/** 详情行：执行中给阶段与计时，待执行给下一步，全部完成时留空（点位已表达） */
function buildDetailText(params: {
  isRunningThisSlide: boolean;
  runningStageLabel: string;
  elapsed: string | null;
  current: { label: string } | null;
}): string {
  const { isRunningThisSlide, runningStageLabel, elapsed, current } = params;

  if (isRunningThisSlide) {
    const parts = [runningStageLabel];
    if (elapsed !== null) parts.push(`已用 ${elapsed}`);
    return parts.filter((part) => part !== "").join(" · ");
  }
  if (current === null) return "";
  return `下一步 ${current.label}`;
}

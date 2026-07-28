import { RUN_STAGE_SEQUENCE, STAGE_LABELS, stageLabel } from "@shared/stages";
import { useEffect, useRef, useState } from "react";
import type { SlideNavigation } from "@/lib/slide-nav";
import { elapsedSince } from "@/lib/stage-view";
import { cn } from "@/lib/utils";
import { useRunStore } from "@/stores/run-store";
import type { RunStage } from "../../../shared/stages.js";

/**
 * 单页复核工具栏（design.md 3.3 SlideToolbar）。
 *
 * V1 用一个 `<select>` 下拉框当执行入口——既不像行动，也看不出当前状态。这里改为：
 * - 「运行此页」为唯一主按钮（断点续跑，与批量共用 DeckRunner 队列）；
 * - 「从阶段重跑」降为次级菜单，显式列出 10 阶段；
 * - 保存与脏标记常驻可见，本页执行中时内联显示当前阶段与计时。
 *
 * 计时在组件内部订阅 1s ticker 自行计算（阶段 C 约定）：若由 ReviewPage 透传，
 * 整页——包括画布——会每秒重渲染一次。
 */

/** DESIGN.md `button-primary`：近黑底 + 12px 圆角，本视图唯一主行动 */
const BUTTON_PRIMARY =
  "shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition active:bg-primary-active disabled:opacity-40";

/** DESIGN.md `button-secondary`：白底 + hairline 描边 */
const BUTTON_SECONDARY =
  "shrink-0 rounded-lg border border-hairline bg-canvas px-4 py-2 text-sm text-ink transition active:border-border-strong disabled:opacity-40";

/** 小尺寸次级控件（返回、页间导航），归 `rounded-sm` */
const BUTTON_COMPACT =
  "shrink-0 rounded-sm border border-hairline bg-canvas px-2.5 py-1.5 text-sm text-ink transition active:border-border-strong disabled:opacity-40";

/**
 * 两个视图态对应链路仅剩的两个人工停点（阶段 D）。
 *
 * 阶段 C 暂留的 `compare` 与 `accept` 在此撤除：滑块对比降级为最终确认页内的
 * 一档视图，验收由 FinalConfirmPage 承担。
 */
export type SlideViewMode = "review" | "final";

interface SlideToolbarProps {
  readonly slideId: string;
  readonly pageLabel: string;
  readonly navigation: SlideNavigation;
  readonly viewMode: SlideViewMode;
  /** 该页已停在最终确认门；决定「最终确认」档是否出现 */
  readonly hasFinalGate: boolean;
  readonly dirty: boolean;
  /**
   * 本页未复核块数，只读展示。
   *
   * 阶段 D 撤除了这里的「全部标为已复核」批量入口：PRD F-6 实测真实行为就是
   * 「打开 → 一键全标 → 跑下去」，155 块无一条 `updatedAt`，该按钮正是文本复核
   * 被整体架空的逃生口。数量仍要显示——它是「这页还欠多少人工确认」的唯一提示，
   * 逐项确认在 BlockListPanel 内完成。
   */
  readonly unreviewedCount: number;
  /** 本页正在执行：禁用执行类动作，避免同一页被重复入队 */
  readonly pageBusy: boolean;
  /** 待办队列中的下一项；null 表示队列内已无其它页 */
  readonly nextTodo: {
    readonly pageLabel: string;
    readonly reason: string;
  } | null;

  readonly onBack: () => void;
  readonly onNavigate: (slideId: string) => void;
  readonly onViewModeChange: (mode: SlideViewMode) => void;
  readonly onSave: () => void;
  readonly onRunSlide: () => void;
  readonly onRerunFrom: (stage: RunStage) => void;
  readonly onNextTodo: () => void;
}

export function SlideToolbar({
  slideId,
  pageLabel,
  navigation,
  viewMode,
  hasFinalGate,
  dirty,
  unreviewedCount,
  pageBusy,
  nextTodo,
  onBack,
  onNavigate,
  onViewModeChange,
  onSave,
  onRunSlide,
  onRerunFrom,
  onNextTodo,
}: SlideToolbarProps): React.JSX.Element {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // 逐字段订阅；tick 只为触发耗时重算，值本身不参与渲染
  const currentSlideId = useRunStore((s) => s.currentSlideId);
  const currentStage = useRunStore((s) => s.currentStage);
  const stageStartedAt = useRunStore((s) => s.stageStartedAt);
  useRunStore((s) => s.tick);

  const showProgress = pageBusy && currentSlideId === slideId;
  const elapsed = showProgress
    ? elapsedSince(stageStartedAt, Date.now())
    : null;

  // 点击菜单外部收起（与 TopNav 的 doctor 下拉同一模式）
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent): void {
      const node = menuRef.current;
      if (node && !node.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  const viewModes: ReadonlyArray<{
    readonly mode: SlideViewMode;
    readonly label: string;
    readonly available: boolean;
  }> = [
    { mode: "review", label: "文本复核", available: true },
    { mode: "final", label: "最终确认", available: hasFinalGate },
  ];

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-hairline bg-canvas px-6 py-3">
      <button type="button" onClick={onBack} className={BUTTON_COMPACT}>
        ← 控制台
      </button>

      <div className="flex min-w-0 items-baseline gap-2">
        <span
          className="truncate text-lg font-medium text-ink"
          title={pageLabel}
        >
          {pageLabel}
        </span>
        {navigation.total > 0 && (
          <span className="shrink-0 text-sm font-medium text-muted">
            第 {navigation.index}/{navigation.total} 页
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          aria-label="上一页"
          disabled={navigation.prev === null}
          onClick={() => {
            if (navigation.prev !== null) onNavigate(navigation.prev.slideId);
          }}
          className={BUTTON_COMPACT}
        >
          ←
        </button>
        <button
          type="button"
          aria-label="下一页"
          disabled={navigation.next === null}
          onClick={() => {
            if (navigation.next !== null) onNavigate(navigation.next.slideId);
          }}
          className={BUTTON_COMPACT}
        >
          →
        </button>
      </div>

      {/* 视图切换：不可用的视图直接隐藏而非禁用，减少空态噪音 */}
      <div className="flex shrink-0 items-center gap-1 rounded-sm border border-hairline p-0.5">
        {viewModes
          .filter((entry) => entry.available)
          .map((entry) => (
            <button
              key={entry.mode}
              type="button"
              onClick={() => onViewModeChange(entry.mode)}
              className={cn(
                "rounded-xs px-2.5 py-1 text-sm transition",
                viewMode === entry.mode
                  ? "bg-surface-strong font-medium text-ink"
                  : "text-muted active:bg-surface-soft",
              )}
            >
              {entry.label}
            </button>
          ))}
      </div>

      {showProgress && (
        <span className="min-w-0 shrink truncate text-sm font-medium text-info">
          执行中
          {currentStage !== null && ` · ${stageLabel(currentStage)}`}
          {elapsed !== null && ` · 已用 ${elapsed}`}
        </span>
      )}

      <div className="ml-auto flex shrink-0 items-center gap-3">
        {nextTodo !== null && (
          <button
            type="button"
            onClick={onNextTodo}
            title={`${nextTodo.pageLabel} · ${nextTodo.reason}`}
            className={BUTTON_SECONDARY}
          >
            处理下一项
          </button>
        )}

        {/*
          未复核块会让执行停在文本复核门（阶段 B 起为显式 human-edit 门，不再是
          mask 阶段报错）。这里只报数，逐项确认在左侧列表里做。
        */}
        {unreviewedCount > 0 && (
          <span
            title="仍待人工确认的文字块数；执行会停在文本复核门直到清零"
            className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-muted"
          >
            待复核
            <span className="text-ink">{unreviewedCount}</span>
          </span>
        )}

        {dirty && (
          <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-muted">
            <span
              aria-hidden="true"
              className="h-2 w-2 rounded-full bg-signature-mustard"
            />
            未保存
          </span>
        )}

        <button
          type="button"
          onClick={onSave}
          disabled={!dirty}
          title="保存复核文档（⌘S）"
          className={BUTTON_SECONDARY}
        >
          保存
          <span className="ml-1 text-sm text-muted">⌘S</span>
        </button>

        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            disabled={pageBusy}
            className={BUTTON_SECONDARY}
          >
            从阶段重跑 ▾
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-30 mt-2 w-56 rounded-md border border-hairline bg-canvas p-2">
              <p className="px-2 pb-2 text-sm font-medium text-muted">
                选择起始阶段（该阶段及其后续会重做）
              </p>
              <ul className="flex flex-col">
                {RUN_STAGE_SEQUENCE.map((stage) => (
                  <li key={stage}>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        onRerunFrom(stage);
                      }}
                      className="w-full rounded-sm px-2 py-1.5 text-left text-sm text-ink transition active:bg-surface-soft"
                    >
                      {STAGE_LABELS[stage]}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={onRunSlide}
          disabled={pageBusy}
          title="从第一个未完成阶段继续执行此页"
          className={BUTTON_PRIMARY}
        >
          运行此页
        </button>
      </div>
    </div>
  );
}

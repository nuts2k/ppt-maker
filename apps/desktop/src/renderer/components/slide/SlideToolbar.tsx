import { stageLabel } from "@shared/stages";
import { ArrowLeft, ChevronLeft, ChevronRight, Play } from "lucide-react";
import {
  Button,
  IconButton,
  Kbd,
  SegmentedGroup,
  SegmentedItem,
  StatusChip,
} from "@/components/ui";
import type { SlideNavigation } from "@/lib/slide-nav";
import { elapsedSince } from "@/lib/stage-view";
import { useRunStore } from "@/stores/run-store";

/**
 * 单页复核工具栏（design.md 3.3 SlideToolbar）。
 *
 * V1 用一个 `<select>` 下拉框当执行入口——既不像行动，也看不出当前状态。这里改为：
 * - 「运行此页」为唯一主按钮（断点续跑，与批量共用 DeckRunner 队列）；
 * - 保存与脏标记常驻可见，本页执行中时内联显示当前阶段与计时。
 *
 * 「从阶段重跑 ▾」菜单已撤除：9 个入口里语义有效的极少，而改内容后的重做已由
 * 保存时的粒度失效自动完成，失败重试则由 StageRail 错误条上的单个按钮承担。
 *
 * 计时在组件内部订阅 1s ticker 自行计算（阶段 C 约定）：若由 ReviewPage 透传，
 * 整页——包括画布——会每秒重渲染一次。
 *
 * 按钮一律取自 `components/ui` 基座：此前这里有三份局部按钮类常量（主/次/紧凑
 * 各一份），与 TopNav、RunControlBar、FinalConfirmPage 各抄一份且已经漂移。
 * **同一个动作在任何页面都必须长得一样**，所以不再就地拼类字符串。
 *
 * 本工具栏统一用 `size="sm"`：它是密度型条带，压到 h-7 一档能把整条从 ~75px
 * 收到 ~48px——复核页的纵向预算本来就紧（顶栏 + 工具栏 + 阶段条已吃掉三成多）。
 */

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
  /**
   * 该页的最终确认页是否可达（PPTX 已产出）；决定「最终确认」档是否出现。
   *
   * 不等于「还没验收」：已验收页同样要能进去重做底图，否则那个按钮随确认页一起
   * 消失，界面上再无任何重做入口（2026-07-30 R2）。
   */
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
  onNextTodo,
}: SlideToolbarProps): React.JSX.Element {
  // 逐字段订阅；tick 只为触发耗时重算，值本身不参与渲染
  const currentSlideId = useRunStore((s) => s.currentSlideId);
  const currentStage = useRunStore((s) => s.currentStage);
  const stageStartedAt = useRunStore((s) => s.stageStartedAt);
  useRunStore((s) => s.tick);

  const showProgress = pageBusy && currentSlideId === slideId;
  const elapsed = showProgress
    ? elapsedSince(stageStartedAt, Date.now())
    : null;

  const viewModes: ReadonlyArray<{
    readonly mode: SlideViewMode;
    readonly label: string;
    readonly available: boolean;
  }> = [
    { mode: "review", label: "文本复核", available: true },
    { mode: "final", label: "最终确认", available: hasFinalGate },
  ];

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-hairline bg-canvas px-6 py-2">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft aria-hidden="true" className="size-3.5" />
        控制台
      </Button>

      <div className="flex min-w-0 items-baseline gap-2">
        <span
          className="truncate text-lg font-semibold text-ink"
          title={pageLabel}
        >
          {pageLabel}
        </span>
        {navigation.total > 0 && (
          <span className="shrink-0 text-sm tabular-nums text-ink-secondary">
            第 {navigation.index}/{navigation.total} 页
          </span>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          variant="secondary"
          size="sm"
          label="上一页"
          disabled={navigation.prev === null}
          onClick={() => {
            if (navigation.prev !== null) onNavigate(navigation.prev.slideId);
          }}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </IconButton>
        <IconButton
          variant="secondary"
          size="sm"
          label="下一页"
          disabled={navigation.next === null}
          onClick={() => {
            if (navigation.next !== null) onNavigate(navigation.next.slideId);
          }}
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </IconButton>
      </div>

      {/* 视图切换：不可用的视图直接隐藏而非禁用，减少空态噪音 */}
      <SegmentedGroup label="视图切换">
        {viewModes
          .filter((entry) => entry.available)
          .map((entry) => (
            <SegmentedItem
              key={entry.mode}
              selected={viewMode === entry.mode}
              onClick={() => onViewModeChange(entry.mode)}
            >
              {entry.label}
            </SegmentedItem>
          ))}
      </SegmentedGroup>

      {showProgress && (
        <StatusChip
          status="running"
          label={buildProgressText(currentStage, elapsed)}
          className="shrink-0 tabular-nums"
        />
      )}

      <div className="ml-auto flex shrink-0 items-center gap-2.5">
        {nextTodo !== null && (
          <Button
            variant="secondary"
            size="sm"
            onClick={onNextTodo}
            title={`${nextTodo.pageLabel} · ${nextTodo.reason}`}
          >
            处理下一项
          </Button>
        )}

        {/*
          未复核块会让执行停在文本复核门（阶段 B 起为显式 human-edit 门，不再是
          mask 阶段报错）。这里只报数，逐项确认在左侧列表里做。

          数字走中性而非校对红：一页 155 块时它开局就是满额，把常态染红等于
          让红色失去「要你管」的分量——真正的待办由左侧列表逐项承载。
        */}
        {unreviewedCount > 0 && (
          <span
            title="仍待人工确认的文字块数；执行会停在文本复核门直到清零"
            className="flex shrink-0 items-center gap-1 text-sm text-ink-secondary"
          >
            待复核
            <span className="font-semibold tabular-nums text-ink">
              {unreviewedCount}
            </span>
          </span>
        )}

        {/*
          未保存用校对红：离开本页就会丢掉编辑，属于「要你管」。
          点 + 文字双载体，不只靠颜色（A3）。
        */}
        {dirty && (
          <span className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-proof">
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-proof"
            />
            未保存
          </span>
        )}

        <Button
          variant="secondary"
          size="sm"
          onClick={onSave}
          disabled={!dirty}
          title="保存复核文档（⌘S）"
        >
          保存
          <Kbd>⌘S</Kbd>
        </Button>

        <Button
          variant="primary"
          size="sm"
          onClick={onRunSlide}
          disabled={pageBusy}
          loading={showProgress}
          title="从第一个未完成阶段继续执行此页"
        >
          {!showProgress && <Play aria-hidden="true" className="size-3.5" />}
          运行此页
        </Button>
      </div>
    </div>
  );
}

/** 执行态一行字：缺失片段直接省略，不留「--」这类占位符 */
function buildProgressText(
  stage: string | null,
  elapsed: string | null,
): string {
  const parts = ["执行中"];
  if (stage !== null) parts.push(stageLabel(stage));
  if (elapsed !== null) parts.push(`已用 ${elapsed}`);
  return parts.join(" · ");
}

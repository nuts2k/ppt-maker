import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ActivityPanel } from "@/components/console/ActivityPanel";
import { DeckEmptyState } from "@/components/console/DeckEmptyState";
import { ExtractionReportHost } from "@/components/console/ExtractionReportPanel";
import { RunControlBar } from "@/components/console/RunControlBar";
import { SlideCardGrid } from "@/components/console/SlideCardGrid";
import { SourcePicker } from "@/components/console/SourcePicker";
import { TodoQueuePanel } from "@/components/console/TodoQueuePanel";
import { SourceTaskBar } from "@/components/SourceTaskBar";
import { Button, Panel, SegmentedGroup, SegmentedItem } from "@/components/ui";
import {
  buildEmptyDeckCopy,
  type DeckSpecSnapshot,
  pendingSpecCount,
  probeDeckSpec,
  specForDeck,
} from "@/lib/console-empty-view";
import { cn } from "@/lib/utils";
import { useActivityStore } from "@/stores/activity-store";
import { useDeckStore } from "@/stores/deck-store";
import { useRunStore } from "@/stores/run-store";
import { useSourceTaskStore } from "@/stores/source-task-store";
import { deriveTodoQueue, flattenTodoQueue } from "@/stores/todo-queue";
import { type ConsoleFilter, useUIStore } from "@/stores/ui-store";

/**
 * 控制台 —— 批量优先的主视图。
 *
 * 三个区域各自从 store 取数，本页负责布局与三件跨组件的事：
 * 1. deck 切换时拉取活动日志（面板组件本身不发 IPC，避免折叠/展开触发重复请求）；
 * 2. **筛选**：「待处理」的成员判定直接复用待办队列的 `deriveTodoQueue`，
 *    不另写一套判据——控制台筛选与右侧队列问的是同一个问题，必须同源；
 * 3. 页面级次要操作（添加页面 / 刷新 / 改规格）——执行相关操作一律归 RunControlBar，
 *    导出归 TopNav，此处只放不影响流水线状态的工具动作。
 *
 * 本页同时渲染**来源选择模态**与**建页任务条**：新建 deck 期间 `deckPath` 仍是
 * null，空态与已打开 deck 两条分支都要能看见进度，放进更下层的组件会漏掉其中一条。
 * 任务条本身是 `components/SourceTaskBar`（跨视图共用，策划页也发起建页），
 * 由 source-task-store 自驱动，这里只决定它挂在哪。
 *
 * 筛选的硬约束（见 .trellis/spec/frontend/state-management.md「一个判据兼职两件事」）：
 * 切换常驻可见、不折叠不藏菜单；筛选**只影响本页列表渲染**，不影响任何判据、
 * 待办队列的「处理下一项」遍历口径或键盘可达性；筛选态存 ui-store 会话级、不写磁盘。
 * 否则「打开已完成页复看」这个能力会随默认筛选一起静默消失。
 */
export function ConsolePage(): React.JSX.Element {
  const deckPath = useDeckStore((s) => s.deckPath);
  const slides = useDeckStore((s) => s.slides);
  const loading = useDeckStore((s) => s.loading);
  const error = useDeckStore((s) => s.error);
  const refreshStatus = useDeckStore((s) => s.refreshStatus);
  const loadActivity = useActivityStore((s) => s.load);
  const resetActivity = useActivityStore((s) => s.reset);
  // 逐字段订阅：sessionResults 只在 page-done 时变，不会跟着每秒 tick 重渲染整页
  const sessionResults = useRunStore((s) => s.sessionResults);
  const filter = useUIStore((s) => s.consoleFilter);
  const setFilter = useUIStore((s) => s.setConsoleFilter);
  const openPlanning = useUIStore((s) => s.openPlanning);
  // 建页任务在跑时禁用「添加页面」——真正的互斥防线在 main 的两个执行器里，
  // 这里的禁用只是让用户不必先点一次才知道现在不行
  const sourceTaskRunning = useSourceTaskStore((s) => s.running);
  // 模态开关在 ui-store：顶栏下拉的「新建 Deck…」与本页的「添加页面」是同一个模态
  // 的两个入口，而顶栏不在本页子树内
  const pickerTarget = useUIStore((s) => s.sourcePicker);
  const openPicker = useUIStore((s) => s.openSourcePicker);
  const closePicker = useUIStore((s) => s.closeSourcePicker);

  // 活动日志随 deck 切换整体重载；run-done 后的覆盖式刷新由 run-bridge 负责
  useEffect(() => {
    if (deckPath === null) {
      resetActivity();
      return;
    }
    void loadActivity(deckPath).catch(() => {
      // 日志缺失不应阻断控制台使用，错误已记入 activity-store
    });
  }, [deckPath, loadActivity, resetActivity]);

  const activeSlides = useMemo(
    () => slides.filter((slide) => !slide.removed),
    [slides],
  );

  /*
   * 零页时读一次 deck 内规格，用于空态指路（R7）。
   *
   * 只在零页时读：有页可看的时候这个数字没有任何用处，没必要为它发 IPC。
   * 视图切到策划工作台时本页整个卸载（App.tsx 是条件渲染），改完规格回来会重读，
   * 因此不需要额外的失效通道。
   *
   * 切 deck 竞态是**两道**，缺一不可（见 .trellis/spec/frontend/state-management.md）：
   * cleanup 的 `cancelled` 挡迟到的写入，`specForDeck` 挡已经写在 state 里的上一个
   * deck 的值——后者靠 effect 时序追不上，只能把归属做进数据本身。
   */
  const [specSnapshot, setSpecSnapshot] = useState<DeckSpecSnapshot | null>(
    null,
  );
  const emptyDeck = deckPath !== null && activeSlides.length === 0;
  useEffect(() => {
    if (deckPath === null || !emptyDeck) {
      setSpecSnapshot(null);
      return;
    }
    let cancelled = false;
    void probeDeckSpec(() => window.api.deck.readDeckSpec(deckPath)).then(
      (spec) => {
        if (!cancelled) setSpecSnapshot({ deckPath, spec });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [deckPath, emptyDeck]);

  // 建完页后 slides 变化即自动收缩，不必重读规格
  const pendingSpecEntries = useMemo(
    () => pendingSpecCount(specForDeck(specSnapshot, deckPath), slides),
    [specSnapshot, deckPath, slides],
  );

  /*
   * 「改规格」与空态里的「去策划工作台」是同一个动作的两个入口，禁用理由因此
   * 只写一处——两句各写一份，迟早只改其中一句。
   */
  const planningBlockedReason = sourceTaskRunning
    ? "建页任务正在执行，请等它结束后再修改规格"
    : null;

  /*
   * 待处理集合与右侧队列同源：筛选口径与卡片上显示的待办原因都取这一份，
   * 卡片不自行判定「为什么在待处理里」。派生放在组件内，selector 里返回新对象会触发重渲染。
   */
  const todoReasons = useMemo(() => {
    const queue = deriveTodoQueue(slides, sessionResults);
    return new Map(
      flattenTodoQueue(queue).map((item) => [item.slideId, item.reason]),
    );
  }, [slides, sessionResults]);

  const visibleSlides = useMemo(
    () =>
      filter === "todo"
        ? activeSlides.filter((slide) => todoReasons.has(slide.slideId))
        : activeSlides,
    [filter, activeSlides, todoReasons],
  );

  if (deckPath === null) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <DeckEmptyState
          className="min-h-0 flex-1"
          onCreate={() => openPicker("new")}
        />
        {/* 新建期间 deckPath 仍是 null，进度条与抽取报告都得在空态里看得见 */}
        <SourceTaskBar className="mx-6 mb-6" />
        <GenerateResultPanel className="mx-6 mb-6" />
        <ExtractionReportHost />
        {pickerTarget !== null && (
          <SourcePicker deckPath={null} onClose={closePicker} />
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-col gap-2 px-6 pt-6">
            <RunControlBar />
            <SourceTaskBar />
            <GenerateResultPanel />
          </div>

          {error !== null && (
            <p className="mx-6 mt-3 rounded-sm bg-state-failed/10 px-3 py-2 text-sm font-medium text-state-failed">
              {error}
            </p>
          )}

          <div className="flex shrink-0 items-center gap-4 px-6 pb-3 pt-5">
            <FilterSwitch
              filter={filter}
              onChange={setFilter}
              allCount={activeSlides.length}
              todoCount={todoReasons.size}
            />
            <div className="flex flex-1 items-center justify-end gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void refreshStatus()}
                disabled={loading}
              >
                <RefreshCw aria-hidden="true" className="size-3.5" />
                刷新
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={openPlanning}
                disabled={loading || sourceTaskRunning}
                title={planningBlockedReason ?? undefined}
              >
                改规格
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => openPicker("append")}
                disabled={loading || sourceTaskRunning}
                title={
                  sourceTaskRunning
                    ? "建页任务正在执行，请等它结束"
                    : "从图片、PDF 或内容规格追加页面"
                }
              >
                <Plus aria-hidden="true" className="size-3.5" />
                添加页面
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
            {visibleSlides.length > 0 ? (
              <SlideCardGrid slides={visibleSlides} todoReasons={todoReasons} />
            ) : (
              <GridEmptyState
                filtered={filter === "todo" && activeSlides.length > 0}
                allCount={activeSlides.length}
                onShowAll={() => setFilter("all")}
                pendingSpecEntries={pendingSpecEntries}
                onOpenPlanning={openPlanning}
                planningBlockedReason={planningBlockedReason}
              />
            )}
          </div>
        </div>

        <TodoQueuePanel />
      </div>

      <ActivityPanel />

      {/* 自足宿主：两条来路（刚跑完 / 从日志回溯）都在它内部取舍，这里不传 props */}
      <ExtractionReportHost />

      {/*
        目标由 store 说了算，不由「当前有没有 deck」反推：顶栏下拉的「新建 Deck…」
        在 deck 已打开时给的是 `new`，反推会把它错当成追加。
      */}
      {pickerTarget !== null && (
        <SourcePicker
          deckPath={pickerTarget === "new" ? null : deckPath}
          onClose={closePicker}
        />
      )}
    </div>
  );
}

/**
 * 批量生成的完成面板（design §5.4 的入口 2）。
 *
 * 只管**生成**这一种结果：抽取的结果由 `ExtractionReportHost` 接管（它也走
 * `dismissResult()`，两处都渲染会出现两个面板抢同一个关闭动作）；重新生成的反馈
 * 长在审片视图里，用户此刻根本不在控制台。判据取 store 的 `kind`——它与
 * `lastResult` 由同一次任务写入，不是两条来路。
 *
 * 「去确认」是 secondary：全屏唯一的 primary 是「处理全部」（DESIGN.md）。
 * 不给 slideId，由审片视图落到序列里第一个待确认的页。
 */
function GenerateResultPanel({
  className,
}: {
  className?: string;
}): React.JSX.Element | null {
  const kind = useSourceTaskStore((s) => s.kind);
  const result = useSourceTaskStore((s) => s.lastResult);
  const dismiss = useSourceTaskStore((s) => s.dismissResult);
  const openSourceReview = useUIStore((s) => s.openSourceReview);

  if (kind !== "generate" || result === null || !result.accepted) return null;

  return (
    <Panel
      className={cn("flex items-center gap-3 bg-surface px-4 py-3", className)}
    >
      <span className="min-w-0 flex-1 truncate text-sm tabular-nums text-ink">
        {result.message}
        {result.created > 0 && " · 每页都需要你逐张确认源图"}
      </span>
      {result.created > 0 && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            dismiss();
            openSourceReview();
          }}
        >
          去确认
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={dismiss}>
        知道了
      </Button>
    </Panel>
  );
}

/**
 * 「全部 N / 待处理 M」切换 —— 常驻可见，不折叠不藏菜单。
 *
 * 选中视觉与 `aria-pressed` 一律由基座给（`components/ui/Segmented`），
 * 这里只管口径：全屏唯一的主行动是「处理全部」，筛选开关不该长得像主按钮。
 */
function FilterSwitch({
  filter,
  onChange,
  allCount,
  todoCount,
}: {
  filter: ConsoleFilter;
  onChange: (next: ConsoleFilter) => void;
  allCount: number;
  todoCount: number;
}): React.JSX.Element {
  const options: readonly { value: ConsoleFilter; label: string }[] = [
    { value: "todo", label: "待处理" },
    { value: "all", label: "全部" },
  ];
  const counts: Readonly<Record<ConsoleFilter, number>> = {
    todo: todoCount,
    all: allCount,
  };

  return (
    <SegmentedGroup label="页面筛选">
      {options.map((option) => (
        <SegmentedItem
          key={option.value}
          selected={filter === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          <span className="text-2xs font-semibold tabular-nums text-ink-muted">
            {counts[option.value]}
          </span>
        </SegmentedItem>
      ))}
    </SegmentedGroup>
  );
}

/**
 * 空态不写「暂无内容」，而是说明当前看到的是什么、下一步能点什么。
 *
 * 零页那一支的措辞由 `buildEmptyDeckCopy` 给：规格里还有条目没建页时写明条数并
 * 指向策划工作台，否则退回「从图片 / PDF / 规格文件添加」的兜底说法。
 * 判断落在纯函数里是为了能被测——本项目没有 DOM 测试库。
 */
function GridEmptyState({
  filtered,
  allCount,
  onShowAll,
  pendingSpecEntries,
  onOpenPlanning,
  planningBlockedReason,
}: {
  filtered: boolean;
  allCount: number;
  onShowAll: () => void;
  /** 规格里尚未建页的条目数；读不到规格时为 null */
  pendingSpecEntries: number | null;
  onOpenPlanning: () => void;
  /** 现在不能去策划工作台的理由；能去则为 null。与工具栏「改规格」同源 */
  planningBlockedReason: string | null;
}): React.JSX.Element {
  if (!filtered) {
    const copy = buildEmptyDeckCopy(pendingSpecEntries);
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <p className="text-sm font-medium text-ink">{copy.title}</p>
        <p className="max-w-prose text-sm tabular-nums text-ink-muted">
          {copy.body}
        </p>
        {copy.actionLabel !== null && (
          <Button
            className="mt-1"
            size="sm"
            variant="secondary"
            onClick={onOpenPlanning}
            disabled={planningBlockedReason !== null}
            title={planningBlockedReason ?? undefined}
          >
            {copy.actionLabel}
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <p className="text-sm font-medium text-ink">没有需要你处理的页面</p>
      <p className="text-sm text-ink-muted">
        全部 {allCount} 页都已推进到位；已完成的页仍可打开复看。
      </p>
      <Button size="sm" variant="secondary" onClick={onShowAll}>
        查看全部 {allCount} 页
      </Button>
    </div>
  );
}

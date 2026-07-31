import { Plus, RefreshCw } from "lucide-react";
import { useEffect, useMemo } from "react";
import { ActivityPanel } from "@/components/console/ActivityPanel";
import { DeckEmptyState } from "@/components/console/DeckEmptyState";
import { RunControlBar } from "@/components/console/RunControlBar";
import { SlideCardGrid } from "@/components/console/SlideCardGrid";
import { TodoQueuePanel } from "@/components/console/TodoQueuePanel";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useActivityStore } from "@/stores/activity-store";
import { useDeckStore } from "@/stores/deck-store";
import { useRunStore } from "@/stores/run-store";
import { deriveTodoQueue, flattenTodoQueue } from "@/stores/todo-queue";
import { type ConsoleFilter, useUIStore } from "@/stores/ui-store";

/**
 * 控制台 —— 批量优先的主视图。
 *
 * 三个区域各自从 store 取数，本页负责布局与三件跨组件的事：
 * 1. deck 切换时拉取活动日志（面板组件本身不发 IPC，避免折叠/展开触发重复请求）；
 * 2. **筛选**：「待处理」的成员判定直接复用待办队列的 `deriveTodoQueue`，
 *    不另写一套判据——控制台筛选与右侧队列问的是同一个问题，必须同源；
 * 3. 页面级次要操作（添加页面 / 刷新）——执行相关操作一律归 RunControlBar，
 *    导出归 TopNav，此处只放不影响流水线状态的工具动作。
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
  const addSlide = useDeckStore((s) => s.addSlide);
  const refreshStatus = useDeckStore((s) => s.refreshStatus);
  const loadActivity = useActivityStore((s) => s.load);
  const resetActivity = useActivityStore((s) => s.reset);
  // 逐字段订阅：sessionResults 只在 page-done 时变，不会跟着每秒 tick 重渲染整页
  const sessionResults = useRunStore((s) => s.sessionResults);
  const filter = useUIStore((s) => s.consoleFilter);
  const setFilter = useUIStore((s) => s.setConsoleFilter);

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

  async function handleAddSlide(): Promise<void> {
    if (deckPath === null) return;
    const imagePath = await window.api.system.selectFile([
      { name: "图片", extensions: ["png", "jpg", "jpeg"] },
    ]);
    if (imagePath === null) return;
    await addSlide(imagePath).catch(() => {
      // 失败信息已写入 deck-store.error，由下方错误条呈现
    });
  }

  if (deckPath === null) {
    return <DeckEmptyState />;
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="shrink-0 px-6 pt-6">
            <RunControlBar />
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
                variant="secondary"
                onClick={() => void handleAddSlide()}
                disabled={loading}
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
              />
            )}
          </div>
        </div>

        <TodoQueuePanel />
      </div>

      <ActivityPanel />
    </div>
  );
}

/**
 * 「全部 N / 待处理 M」切换 —— 常驻可见，不折叠不藏菜单。
 *
 * 选中态用下沉底色而非墨底：全屏唯一的主行动是「处理全部」，
 * 一个筛选开关不该长得像主按钮。
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
    <fieldset className="flex shrink-0 items-center gap-0.5 rounded-md border border-hairline p-0.5">
      <legend className="sr-only">页面筛选</legend>
      {options.map((option) => {
        const selected = filter === option.value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-sm transition-colors duration-fast",
              selected
                ? "bg-surface-sunken font-medium text-ink"
                : "text-ink-secondary hover:bg-surface hover:text-ink active:bg-surface-sunken",
            )}
          >
            {option.label}
            <span className="text-2xs font-semibold tabular-nums text-ink-muted">
              {counts[option.value]}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}

/** 空态不写「暂无内容」，而是说明当前看到的是什么、下一步能点什么 */
function GridEmptyState({
  filtered,
  allCount,
  onShowAll,
}: {
  filtered: boolean;
  allCount: number;
  onShowAll: () => void;
}): React.JSX.Element {
  if (!filtered) {
    return (
      <div className="flex flex-col items-center gap-2 py-16 text-center">
        <p className="text-sm font-medium text-ink">当前 Deck 还没有任何页面</p>
        <p className="text-sm text-ink-muted">
          用右上角「添加页面」选一张 16:9 截图加进来。
        </p>
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

import {
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  CircleX,
  type LucideIcon,
  PenLine,
  Stamp,
  TriangleAlert,
} from "lucide-react";
import { useMemo } from "react";
import { IconButton } from "@/components/ui";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/deck-store";
import { useRunStore } from "@/stores/run-store";
import {
  deriveTodoQueue,
  type TodoGroup,
  type TodoItem,
  type TodoQueueGroup,
} from "@/stores/todo-queue";
import { useUIStore } from "@/stores/ui-store";

/**
 * 待办队列面板（右栏 240px）。
 *
 * 队列是控制台的主要驱动入口——用户不必扫完整片卡片网格，从这里逐项点进去处理即可。
 * 数据完全派生自 deck-store（耐久层）+ run-store（会话层），不新增任何持久化，
 * 与控制台「待处理」筛选同源于 `deriveTodoQueue`。
 *
 * 两条视觉约定：
 * 1. **不用彩色左竖条**（DESIGN.md 明令禁止）。分组紧迫度由顺序 + 图标 + 一处文字色承担：
 *    失败给失败色、需修数据给失效色、需文本复核给校对红（这是字面意义上的「待我处理」），
 *    待最终确认保持中性——它不是故障，只是等你拍板。
 * 2. **空态不占固定宽度**。无待办时整栏收成 40px 窄条，不再拿 240px 去显示一行
 *    「暂无待办」。窄条上不放展开按钮：没有内容可展开时给个按钮等于制造一次空点击。
 */

interface TodoQueuePanelProps {
  readonly className?: string;
}

/** 组 → 图标与文字色。彩色只用于区分紧迫度，不做装饰 */
const GROUP_SPEC: Readonly<
  Record<TodoGroup, { readonly icon: LucideIcon; readonly tone: string }>
> = {
  failed: { icon: CircleX, tone: "text-state-failed" },
  "fix-validation": { icon: TriangleAlert, tone: "text-state-stale" },
  "review-text": { icon: PenLine, tone: "text-proof" },
  "final-confirm": { icon: Stamp, tone: "text-ink-secondary" },
};

const COUNT_BADGE =
  "shrink-0 rounded-xs bg-surface-sunken px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-ink-secondary";

/** 总计数用校对红：它字面意义上就是「待我处理」的数量。分组计数保持中性，免得满屏泛红 */
const TOTAL_BADGE =
  "shrink-0 rounded-xs bg-proof-wash px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-proof";

export function TodoQueuePanel({
  className,
}: TodoQueuePanelProps): React.JSX.Element {
  const open = useUIStore((s) => s.queuePanelOpen);
  const toggleQueuePanel = useUIStore((s) => s.toggleQueuePanel);
  const slides = useDeckStore((s) => s.slides);
  const sessionResults = useRunStore((s) => s.sessionResults);

  // 派生放在组件内：selector 里返回新对象会让每次 store 变更都触发重渲染
  const queue = useMemo(
    () => deriveTodoQueue(slides, sessionResults),
    [slides, sessionResults],
  );

  function handleToggle(): void {
    toggleQueuePanel();
  }

  if (queue.total === 0) {
    // 无待办：收成窄条，把横向空间还给卡片网格
    return (
      <aside
        title="暂无待办 · 全部页面已推进到位"
        className={cn(
          "flex w-10 shrink-0 flex-col items-center gap-2 border-l border-hairline bg-canvas py-4",
          className,
        )}
      >
        <CheckCheck aria-hidden="true" className="size-4 text-ink-muted" />
        <span className="sr-only">暂无待办</span>
        <span className={COUNT_BADGE}>0</span>
      </aside>
    );
  }

  if (!open) {
    // 收起态保留一条 40px 竖条：总计数仍可见，用户知道还有多少事没做
    return (
      <aside
        className={cn(
          "flex w-10 shrink-0 flex-col items-center gap-2 border-l border-hairline bg-canvas py-4",
          className,
        )}
      >
        <IconButton
          size="sm"
          variant="ghost"
          label="展开待办队列"
          onClick={handleToggle}
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
        </IconButton>
        <span className={TOTAL_BADGE}>{queue.total}</span>
      </aside>
    );
  }

  return (
    <aside
      className={cn(
        "flex w-60 shrink-0 flex-col border-l border-hairline bg-canvas",
        className,
      )}
    >
      <div className="flex items-center gap-2 px-3 py-3">
        <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
          待办队列
        </h2>
        <span className={TOTAL_BADGE}>{queue.total}</span>
        <IconButton
          size="sm"
          variant="ghost"
          label="收起待办队列"
          onClick={handleToggle}
        >
          <ChevronRight aria-hidden="true" className="size-4" />
        </IconButton>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-3 pb-4">
        {queue.groups.map((group) => (
          <QueueGroup key={group.group} group={group} />
        ))}
      </div>
    </aside>
  );
}

function QueueGroup({ group }: { group: TodoQueueGroup }): React.JSX.Element {
  const { icon: Icon, tone } = GROUP_SPEC[group.group];

  return (
    <section className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 px-1">
        <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", tone)} />
        {/* 中文无大小写，分组标题以字重 + 图标色区分层级，不做 uppercase */}
        <h3
          className={cn("min-w-0 flex-1 truncate text-2xs font-semibold", tone)}
        >
          {group.label}
        </h3>
        <span className={COUNT_BADGE}>{group.items.length}</span>
      </div>
      <ul className="flex flex-col">
        {group.items.map((item) => (
          <li key={item.slideId}>
            <QueueItem item={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function QueueItem({ item }: { item: TodoItem }): React.JSX.Element {
  function handleClick(): void {
    useUIStore.getState().openSlide(item.slideId);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full flex-col gap-0.5 rounded-sm px-2 py-1.5 text-left transition-colors duration-fast hover:bg-surface active:bg-surface-sunken"
    >
      <span className="truncate text-sm text-ink">{item.pageLabel}</span>
      <span
        title={item.reason}
        className="line-clamp-2 text-2xs text-ink-muted"
      >
        {item.reason}
      </span>
    </button>
  );
}

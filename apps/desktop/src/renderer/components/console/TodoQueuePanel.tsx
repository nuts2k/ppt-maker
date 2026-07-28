import { useMemo } from "react";
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
 * 待办队列面板（design.md 3.3，`topic-filter-rail` 规格 240px 右栏）。
 *
 * 队列是控制台的主要驱动入口——用户不必扫完整片卡片网格，从这里逐项点进去处理即可。
 * 数据完全派生自 deck-store（耐久层）+ run-store（会话层），不新增任何持久化。
 *
 * 分组视觉承担"该做什么"的语义：前三组用签名色竖条按紧迫度递减标出，
 * 最终确认组整体落在 cream 卡片上，表达"产物已就绪、等你拍板"而非"系统出错了"。
 * cream 卡片只给一个组——两块相邻的 cream 会糊成一片，反而失去强调。
 */

interface TodoQueuePanelProps {
  readonly className?: string;
}

/** 组 → 项左缘强调竖条；最终确认组不用竖条（整组已由 cream 卡片承载强调） */
const GROUP_ACCENT: Readonly<Record<TodoGroup, string | null>> = {
  failed: "bg-signature-coral",
  "fix-validation": "bg-signature-mustard",
  "review-text": "bg-signature-forest",
  "final-confirm": null,
};

/** 落在 cream 卡片上的组 */
const CREAM_GROUPS: readonly TodoGroup[] = ["final-confirm"];

const ICON_BUTTON =
  "rounded-sm border border-hairline px-1.5 py-1 text-sm text-ink transition active:border-border-strong";

const COUNT_BADGE =
  "shrink-0 rounded-xs bg-surface-strong px-1.5 py-0.5 text-sm font-medium text-ink";

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

  if (!open) {
    // 收起态保留一条 40px 竖条：总计数仍可见，用户知道还有多少事没做
    return (
      <aside
        className={cn(
          "flex w-10 shrink-0 flex-col items-center gap-2 border-l border-hairline bg-canvas py-4",
          className,
        )}
      >
        <button
          type="button"
          aria-label="展开待办队列"
          onClick={handleToggle}
          className={ICON_BUTTON}
        >
          ‹
        </button>
        <span className={COUNT_BADGE}>{queue.total}</span>
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
      <div className="flex items-center gap-2 px-4 py-4">
        <h2 className="min-w-0 flex-1 truncate text-base font-medium text-ink">
          待办队列
        </h2>
        <span className={COUNT_BADGE}>{queue.total}</span>
        <button
          type="button"
          aria-label="收起待办队列"
          onClick={handleToggle}
          className={ICON_BUTTON}
        >
          ›
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        {queue.total === 0 ? (
          <p className="px-2 py-8 text-center text-sm font-medium text-muted">
            暂无待办 · 全部页面已推进到位
          </p>
        ) : (
          queue.groups.map((group) => (
            <QueueGroup key={group.group} group={group} />
          ))
        )}
      </div>
    </aside>
  );
}

function QueueGroup({ group }: { group: TodoQueueGroup }): React.JSX.Element {
  const accent = GROUP_ACCENT[group.group];
  const onCream = CREAM_GROUPS.includes(group.group);

  return (
    <section
      className={cn(
        "flex flex-col gap-2",
        onCream && "rounded-md bg-signature-cream p-6",
      )}
    >
      <div className="flex items-center gap-2">
        {/* 中文无大小写，分组标题以字重 + muted 色区分层级，不做 uppercase */}
        <h3 className="min-w-0 flex-1 truncate text-sm font-medium tracking-[0.16px] text-muted">
          {group.label}
        </h3>
        <span className={COUNT_BADGE}>{group.items.length}</span>
      </div>
      <ul className="flex flex-col gap-1">
        {group.items.map((item) => (
          <li key={item.slideId}>
            <QueueItem item={item} accent={accent} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function QueueItem({
  item,
  accent,
}: {
  item: TodoItem;
  accent: string | null;
}): React.JSX.Element {
  function handleClick(): void {
    useUIStore.getState().openSlide(item.slideId);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex w-full gap-2 rounded-sm px-2 py-2 text-left transition active:bg-surface-strong"
    >
      {accent !== null && (
        <span
          aria-hidden="true"
          className={cn("w-0.5 shrink-0 self-stretch rounded-xs", accent)}
        />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-sm text-ink">{item.pageLabel}</span>
        <span
          title={item.reason}
          className="line-clamp-2 text-sm font-medium text-muted"
        >
          {item.reason}
        </span>
      </span>
    </button>
  );
}

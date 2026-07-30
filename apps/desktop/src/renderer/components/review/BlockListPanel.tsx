import type { TextReviewBlock } from "@ppt-maker/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultFilter,
  filterCounts,
  matchesFilter,
  nextUnreviewedId,
  REVIEW_FILTER_LABELS,
  REVIEW_FILTER_ORDER,
  type ReviewEntryIntent,
  type ReviewFilter,
} from "@/lib/review-filter";
import { resolveReviewKeyAction } from "@/lib/review-keyboard";
import {
  partitionOf,
  REVIEW_PARTITION_LABELS,
  unreviewedBlockIds,
} from "@/lib/review-partition";
import { cn } from "@/lib/utils";
import { ClassificationRow } from "./ClassificationRow";
import { TextDiffRow } from "./TextDiffRow";

/**
 * 文本复核列表面板（design.md §4.1）——列表主导、画布联动的主操作面。
 *
 * V1 的复核界面在真实使用中零使用（PRD F-6）：编辑要双击画布上 13–19px 高的框、
 * 改分类要切到右侧标签页、块间没有键盘导航，于是实际行为退化成「打开 → 全部标记
 * 已复核 → 跑下去」。这里把主次反过来：列表承载全部编辑能力，画布只负责定位。
 *
 * **核心不变量：列表渲染顺序恒等于 `blocks` 数组顺序，任何编辑都不重排。**
 * 这是本次改动全部收益的来源，也是最容易在后续迭代中被无意破坏的一条：
 * 渲染直接 `blocks.filter(...).map(...)`，不经过任何 sort / groupBy；筛选只做
 * filter；标记已复核的项不从 DOM 移除，只加视觉态。
 *
 * 上一版按三分区分组，而分组键（双源是否一致、分类是什么）恰恰会被复核动作本身
 * 改变——用户把一个块改成版式文字，那一项当场传送到另一个分区去了。分区现在退化为
 * 每一项上的徽标（`partitionOf`），判据仍只来自 core 的 `compareBlockSources`。
 *
 * 纯展示组件：所有写入通过 props 回调交给页面壳层，不直接触碰 store 或 window.api。
 */

export interface BlockListPanelProps {
  readonly blocks: readonly TextReviewBlock[];
  /** 当前复核项 id（画布据此高亮居中） */
  readonly currentBlockId: string | null;
  /** 进入复核视图的意图，决定筛选默认停在哪一档 */
  readonly entryIntent: ReviewEntryIntent;
  /** 当前页 id：切页时重置筛选与会话集合 */
  readonly slideId: string | null;
  readonly onSelectBlock: (blockId: string) => void;
  /** 人工编辑（文本 / 分类 / includeInMask）；store 会写 updatedAt + manual 来源 */
  readonly onUpdateBlock: (
    blockId: string,
    patch: Partial<TextReviewBlock>,
  ) => void;
  /** 标记单项已复核（不写溯源字段） */
  readonly onMarkReviewed: (blockId: string) => void;
  /** 「全部通过」：批量标记一批块已复核 */
  readonly onMarkBlocksReviewed: (blockIds: readonly string[]) => void;
  readonly onDeleteBlock: (blockId: string) => void;
  /** 无处可跳等需要说明的情形；不得静默失败 */
  readonly onNotice: (message: string) => void;
}

/** 元信息统一落在 DESIGN.md 的 `caption` 档（14px / 500 / 0.16px） */
const CAPTION = "text-sm font-medium tracking-[0.16px] text-muted";

/** DESIGN.md `button-secondary` 的紧凑版 */
const BUTTON_COMPACT =
  "shrink-0 rounded-sm border border-hairline bg-canvas px-2.5 py-1 text-sm text-ink transition active:border-border-strong disabled:opacity-40";

const REVIEW_STATUS_VIEW: Readonly<
  Record<
    TextReviewBlock["reviewStatus"],
    { readonly label: string; readonly dot: string }
  >
> = {
  unreviewed: { label: "未复核", dot: "bg-signature-mustard" },
  reviewed: { label: "已复核", dot: "bg-success-border" },
  accepted_with_risk: { label: "风险接受", dot: "bg-signature-coral" },
};

export function BlockListPanel({
  blocks,
  currentBlockId,
  entryIntent,
  slideId,
  onSelectBlock,
  onUpdateBlock,
  onMarkReviewed,
  onMarkBlocksReviewed,
  onDeleteBlock,
  onNotice,
}: BlockListPanelProps): React.JSX.Element {
  const [filter, setFilter] = useState<ReviewFilter>(() =>
    defaultFilter(blocks, entryIntent),
  );
  /**
   * 「本次筛选会话内曾可见」的项（design §6.3）。
   *
   * 标记已复核后该项不再匹配「未复核」档，但它必须留在原位淡化打勾——当场消失
   * 等于每确认一项就重排一次列表，正是本次改动要根除的行为。集合在切筛选、切页时
   * 清空：它表达的是「你刚才在这一屏做过什么」，跨页保留没有意义且会无限增长。
   */
  const [stickyIds, setStickyIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  // 意图或页面变化时重算筛选初值——否则「回到文本复核」不会生效（design §6.5）
  // biome-ignore lint/correctness/useExhaustiveDependencies: 只在 slideId/intent 变化时复位，blocks 变化不得重置用户已选的档
  useEffect(() => {
    setFilter(defaultFilter(blocks, entryIntent));
    setStickyIds(new Set());
  }, [slideId, entryIntent]);

  const counts = useMemo(() => filterCounts(blocks), [blocks]);

  /*
   * 可见集合 = 匹配当前档的项 + 本次会话内曾可见的项。
   * filter 之外没有任何排序——顺序恒等于 blocks 数组顺序。
   */
  const visible = useMemo(
    () =>
      blocks.filter(
        (block) => matchesFilter(block, filter) || stickyIds.has(block.id),
      ),
    [blocks, filter, stickyIds],
  );

  const currentBlock = useMemo(
    () => blocks.find((block) => block.id === currentBlockId) ?? null,
    [blocks, currentBlockId],
  );

  const changeFilter = useCallback((next: ReviewFilter) => {
    setFilter(next);
    setStickyIds(new Set());
  }, []);

  const keepVisible = useCallback((blockId: string) => {
    setStickyIds((prev) => {
      if (prev.has(blockId)) return prev;
      const next = new Set(prev);
      next.add(blockId);
      return next;
    });
  }, []);

  const markReviewed = useCallback(
    (blockId: string) => {
      keepVisible(blockId);
      onMarkReviewed(blockId);
    },
    [keepVisible, onMarkReviewed],
  );

  /** 在当前可见集合内逐项推进；不跨筛选、不自动展开任何东西 */
  const moveBy = useCallback(
    (delta: number) => {
      if (visible.length === 0) return;
      const index = visible.findIndex((block) => block.id === currentBlockId);
      const nextIndex =
        index === -1
          ? delta > 0
            ? 0
            : visible.length - 1
          : Math.min(visible.length - 1, Math.max(0, index + delta));
      const target = visible[nextIndex];
      if (target === undefined || target.id === currentBlockId) return;
      onSelectBlock(target.id);
    },
    [visible, currentBlockId, onSelectBlock],
  );

  const jumpToNextUnreviewed = useCallback(() => {
    const target = nextUnreviewedId(visible, currentBlockId);
    if (target === null) {
      onNotice("当前筛选下已无未复核项");
      return;
    }
    onSelectBlock(target);
  }, [visible, currentBlockId, onSelectBlock, onNotice]);

  const setClassification = useCallback(
    (block: TextReviewBlock, toLayoutText: boolean) => {
      // 分类与 includeInMask 必须同改：core 的 LAYOUT_TEXT_MUST_BE_MASKED 把
      // 「layout_text 却不参与 mask」判为 error，只改分类会立刻触发校验失败
      keepVisible(block.id);
      onUpdateBlock(
        block.id,
        toLayoutText
          ? { classification: "layout_text", includeInMask: true }
          : {
              classification: "object_integrated_symbol",
              includeInMask: false,
            },
      );
    },
    [keepVisible, onUpdateBlock],
  );

  /**
   * 键盘流（design.md §4.1）。事件从各项的 textarea 冒泡到面板容器统一处理。
   *
   * 键位判定本身在 `@/lib/review-keyboard`（纯函数、有确定性用例），此处只负责
   * 把 React 事件切成它的入参、按结果 preventDefault 并派发副作用。↑↓ 抢占了
   * textarea 内的光标移动：真实数据里 155 个块全部单行（PRD F-3），多行编辑用
   * ⇧Enter 换行后仍可用鼠标定位，代价可接受。
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const action = resolveReviewKeyAction({
        key: event.key,
        code: event.code,
        altKey: event.altKey,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        // React 的 SyntheticEvent 不透出 isComposing，必须取原生事件
        isComposing: event.nativeEvent.isComposing,
        targetIsButton: event.target instanceof HTMLButtonElement,
      });

      if (action.kind === "passthrough") return;
      event.preventDefault();

      switch (action.kind) {
        case "move":
          moveBy(action.delta);
          return;
        case "classify":
          if (currentBlock === null) return;
          setClassification(currentBlock, action.toLayoutText);
          return;
        case "review-and-move":
          if (currentBlockId !== null) markReviewed(currentBlockId);
          moveBy(1);
          return;
        case "next-unreviewed":
          jumpToNextUnreviewed();
          return;
        default:
      }
    },
    [
      currentBlock,
      currentBlockId,
      moveBy,
      markReviewed,
      setClassification,
      jumpToNextUnreviewed,
    ],
  );

  /*
   * 「全部通过」只在「已一致」档出现：双源逐字一致意味着无需改动，可以整批放行；
   * 其余档必须逐项过目，给批量入口等于把 F-6 的「一键全标已复核」搬回来。
   */
  const bulkPassIds = useMemo(
    () =>
      filter === "agreed"
        ? unreviewedBlockIds(blocks.filter((b) => matchesFilter(b, "agreed")))
        : [],
    [filter, blocks],
  );

  return (
    // 容器只做键盘事件汇聚，本身不是控件；焦点始终落在项内的 textarea 或项卡上
    // biome-ignore lint/a11y/noStaticElementInteractions: 见上，键盘事件由子项冒泡而来
    <div
      className="flex h-full w-full flex-col bg-surface-soft"
      onKeyDown={handleKeyDown}
    >
      <div className="flex shrink-0 flex-col gap-2 border-b border-hairline px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {REVIEW_FILTER_ORDER.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => changeFilter(entry)}
              className={cn(
                "shrink-0 rounded-sm px-2.5 py-1 text-sm transition",
                filter === entry
                  ? "bg-surface-strong font-medium text-ink"
                  : "text-muted active:bg-surface-strong/60",
              )}
            >
              {REVIEW_FILTER_LABELS[entry]}
              <span className="ml-1.5 text-sm text-muted">{counts[entry]}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={jumpToNextUnreviewed}
            title="在当前筛选内跳到下一个未复核项，走到末尾回绕"
            className={BUTTON_COMPACT}
          >
            下一个未复核
            <span className="ml-1 text-sm text-muted">⌘↓</span>
          </button>
          {filter === "agreed" && (
            <button
              type="button"
              disabled={bulkPassIds.length === 0}
              onClick={() => {
                for (const id of bulkPassIds) keepVisible(id);
                onMarkBlocksReviewed(bulkPassIds);
              }}
              title="把「已一致」下所有未复核项标为已复核（不写人工编辑痕迹）"
              className={BUTTON_COMPACT}
            >
              全部通过
              {bulkPassIds.length > 0 && (
                <span className="ml-1 text-sm text-muted">
                  {bulkPassIds.length}
                </span>
              )}
            </button>
          )}
          <span className={cn("ml-auto shrink-0", CAPTION)}>
            {visible.length} 项
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto p-4">
        {visible.length === 0 ? (
          <p
            className={cn(
              "rounded-sm border border-hairline bg-canvas px-3 py-2",
              CAPTION,
            )}
          >
            当前筛选下没有条目
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {visible.map((block) => (
              <ReviewRow
                key={block.id}
                block={block}
                isCurrent={block.id === currentBlockId}
                onSelectBlock={onSelectBlock}
                onUpdateBlock={onUpdateBlock}
                onMarkReviewed={markReviewed}
                onDeleteBlock={onDeleteBlock}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

interface ReviewRowProps {
  readonly block: TextReviewBlock;
  readonly isCurrent: boolean;
  readonly onSelectBlock: (blockId: string) => void;
  readonly onUpdateBlock: (
    blockId: string,
    patch: Partial<TextReviewBlock>,
  ) => void;
  readonly onMarkReviewed: (blockId: string) => void;
  readonly onDeleteBlock: (blockId: string) => void;
}

/**
 * 项卡外壳：分区徽标、状态、人工改动标记、标记已复核与删除。
 *
 * 正文按该项当下的分区选择控件（双源 diff / 分类选择 / 只读段落），判据来源仍是
 * `partitionOf`——它现在每次渲染实时求值，改完分类下一帧正文就换成对应控件，
 * 而项本身留在原位。
 *
 * 「文字待确认」项的焦点目标在 TextDiffRow 的 textarea 内，由它自己聚焦；
 * 其余项没有输入框，由外壳的 `tabIndex={-1}` 容器接管焦点，键盘事件才有处冒泡。
 */
function ReviewRow({
  block,
  isCurrent,
  onSelectBlock,
  onUpdateBlock,
  onMarkReviewed,
  onDeleteBlock,
}: ReviewRowProps): React.JSX.Element {
  const itemRef = useRef<HTMLLIElement | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const partition = partitionOf(block);
  const manageFocus = partition !== "text-pending";

  useEffect(() => {
    if (!isCurrent) return;
    itemRef.current?.scrollIntoView({ block: "nearest" });
    if (manageFocus) itemRef.current?.focus();
  }, [isCurrent, manageFocus]);

  // 切走当前项时收起删除确认，避免下次回来时它仍是「确认删除」状态
  useEffect(() => {
    if (!isCurrent) setConfirmingDelete(false);
  }, [isCurrent]);

  const status = REVIEW_STATUS_VIEW[block.reviewStatus];
  const reviewed = block.reviewStatus !== "unreviewed";
  // layout_text 却不参与 mask：文字既留在底板位图里、又生成原生文本框，导出即重影
  const willGhost =
    block.classification === "layout_text" && !block.includeInMask;

  return (
    // 整卡可点选：非当前项的正文是只读段落、没有可聚焦元素，仅靠 onFocusCapture
    // 会让「点一下这条文字把它设为当前项」失效，只能去点卡内按钮才切得动。
    // biome-ignore lint/a11y/useKeyWithClickEvents: 项卡的键盘等价物是列表级 Tab/↑↓ 导航
    <li
      ref={itemRef}
      tabIndex={-1}
      onClick={() => onSelectBlock(block.id)}
      onFocusCapture={() => onSelectBlock(block.id)}
      className={cn(
        "flex flex-col gap-2 rounded-sm border px-3 py-2 transition focus:outline-none",
        isCurrent
          ? "border-border-strong bg-surface-strong"
          : "border-hairline bg-canvas",
        // 已复核项留在原位、只淡化：它是「做过了」的痕迹，不是要移走的东西
        reviewed && !isCurrent && "opacity-60",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("flex shrink-0 items-center gap-1.5", CAPTION)}>
          <span
            aria-hidden="true"
            className={cn("h-2 w-2 rounded-full", status.dot)}
          />
          {status.label}
        </span>
        <span
          className="shrink-0 rounded-xs bg-surface-strong px-1.5 py-0.5 text-sm font-medium text-ink"
          title="该块当前归入的复核类别，会随分类与文字改动实时变化"
        >
          {REVIEW_PARTITION_LABELS[partition]}
        </span>
        {/* 人工改过的块（updatedAt 非空）——回答「我刚才动过哪几块」，不参与任何判定 */}
        {block.updatedAt !== null && (
          <span className={cn("shrink-0", CAPTION)} title="本块有人工改动">
            已修改
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-sm text-muted">
          {block.id}
        </span>
        {block.reviewStatus === "unreviewed" && (
          <button
            type="button"
            onClick={() => onMarkReviewed(block.id)}
            className={BUTTON_COMPACT}
          >
            标记已复核
          </button>
        )}
        {confirmingDelete ? (
          <>
            <button
              type="button"
              onClick={() => onDeleteBlock(block.id)}
              className="shrink-0 rounded-sm border border-signature-coral bg-canvas px-2.5 py-1 text-sm font-medium text-signature-coral transition active:bg-surface-strong"
            >
              确认删除
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className={BUTTON_COMPACT}
            >
              取消
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            title="删除重复或碎片块；删除后该块不再进入 mask 与 PPTX"
            className={BUTTON_COMPACT}
          >
            删除此块
          </button>
        )}
      </div>

      {partition === "text-pending" ? (
        <TextDiffRow
          block={block}
          isCurrent={isCurrent}
          onUpdateBlock={onUpdateBlock}
        />
      ) : partition === "classification-pending" ? (
        <ClassificationRow block={block} onUpdateBlock={onUpdateBlock} />
      ) : (
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
          {block.text}
        </p>
      )}

      {willGhost && (
        <div className="flex flex-wrap items-center gap-2 rounded-xs bg-signature-coral/10 px-2 py-1">
          <span className="min-w-0 flex-1 text-sm font-medium text-signature-coral">
            会重影：这块字未参与去字，导出后底板里的原字与新建文本框会叠在一起
          </span>
          <button
            type="button"
            onClick={() => onUpdateBlock(block.id, { includeInMask: true })}
            className={BUTTON_COMPACT}
          >
            修正为参与去字
          </button>
        </div>
      )}
    </li>
  );
}

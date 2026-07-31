import type { TextReviewBlock } from "@ppt-maker/core";
import {
  Check,
  CheckCheck,
  ChevronsDown,
  Circle,
  Image as ImageIcon,
  PenLine,
  ShieldAlert,
  Trash2,
  TriangleAlert,
  Type as TypeIcon,
} from "lucide-react";
import type { ComponentType } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton, Kbd, Panel } from "@/components/ui";
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
  type ReviewPartition,
  unreviewedBlockIds,
} from "@/lib/review-partition";
import { cn } from "@/lib/utils";
import { BlockTextEditor } from "./BlockTextEditor";
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

  /*
   * 因「留在原位」而多显示出来的项数。
   *
   * 这是筛选区唯一保留的第二个数字：它解释「为什么未复核档里还挂着几条已复核」，
   * 是筛选档计数答不了的问题。旧版右侧那个「N 项」与「全部 N」在多数档位上是同一个
   * 数，属于同一件事写两遍——已删。
   */
  const stickyExtra = visible.length - counts[filter];

  return (
    // 容器只做键盘事件汇聚，本身不是控件；焦点始终落在项内的 textarea 或项卡上
    // biome-ignore lint/a11y/noStaticElementInteractions: 见上，键盘事件由子项冒泡而来
    <div
      className="flex h-full w-full flex-col bg-surface"
      onKeyDown={handleKeyDown}
    >
      <div className="flex shrink-0 flex-col gap-1.5 border-b border-hairline bg-canvas px-3 py-2.5">
        {/*
          筛选档：五个同高胶囊，计数一律等宽数字（tabular-nums），
          切档时数字宽度不变，整行不抖。
        */}
        <div className="flex flex-wrap items-center gap-0.5">
          {REVIEW_FILTER_ORDER.map((entry) => {
            const active = filter === entry;
            return (
              <Button
                key={entry}
                size="sm"
                variant="ghost"
                selected={active}
                onClick={() => changeFilter(entry)}
              >
                {REVIEW_FILTER_LABELS[entry]}
                <span
                  data-numeric
                  className={cn(
                    "text-2xs font-semibold",
                    // 未复核数就是字面意义上的「待我处理」，全屏唯一一抹校对红
                    entry === "unreviewed" && counts.unreviewed > 0
                      ? "text-proof"
                      : active
                        ? "text-ink-secondary"
                        : "text-ink-muted",
                  )}
                >
                  {counts[entry]}
                </span>
              </Button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="secondary"
            onClick={jumpToNextUnreviewed}
            title="在当前筛选内跳到下一个未复核项，走到末尾回绕"
          >
            <ChevronsDown aria-hidden="true" className="size-3.5" />
            下一个未复核
            <Kbd>⌘↓</Kbd>
          </Button>
          {filter === "agreed" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={bulkPassIds.length === 0}
              onClick={() => {
                for (const id of bulkPassIds) keepVisible(id);
                onMarkBlocksReviewed(bulkPassIds);
              }}
              title="把「已一致」下所有未复核项标为已复核（不写人工编辑痕迹）"
            >
              <CheckCheck aria-hidden="true" className="size-3.5" />
              全部通过
              {bulkPassIds.length > 0 && (
                <span data-numeric className="text-2xs font-semibold">
                  {bulkPassIds.length}
                </span>
              )}
            </Button>
          )}
          {stickyExtra > 0 && (
            <span
              data-numeric
              title="刚处理过的项留在原位，切换筛选后归位"
              className="ml-auto shrink-0 text-2xs text-ink-muted"
            >
              另含 {stickyExtra} 项刚处理
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto p-3">
        {visible.length === 0 ? (
          // 空态说清「下一步该点什么」，且不占固定版面
          <Panel className="px-3 py-2 text-sm text-ink-secondary">
            {filter === "unreviewed"
              ? "这一档已清空。切到「全部」可回看已复核的项。"
              : "当前筛选下没有条目。换一档看看。"}
          </Panel>
        ) : (
          <ul className="flex flex-col gap-1.5">
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

/**
 * 行状态槽 —— **一行只给一个判断**。
 *
 * 旧实现在同一行并排两个徽标：`reviewStatus`（未复核 / 已复核 / 风险接受）与
 * `partitionOf`（文字待确认 / 分类待确认 / 已一致）。两者语义不同，但文案直接打架
 * ——「已复核」紧挨着「文字待确认」，用户读不出这一项到底还要不要管。
 *
 * 收敛为单槽，判据完全沿用原来那两个（不新写口径）：
 *
 * - **已复核 / 风险接受 → 中性、安静**。它们是常态，一页 155 个块最终全部落到这里，
 *   给常态上色等于把最强的视觉手段给最不需要注意的信息（旧版「已复核」是绿点）。
 * - **未复核 → 按「要你管的类型」给颜色**：真要动手的两类（逐字核对、二选一分类）
 *   上校对红；双源逐字一致的那类只需过目，保持中性空心圆。
 *
 * 分区信息没有丢：正文控件本身就是分区的标志（双源 diff / 二选一按钮 / 纯文本）。
 */
interface RowStatusView {
  readonly icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  readonly label: string;
  readonly className: string;
  readonly title: string;
}

function rowStatusView(
  block: TextReviewBlock,
  partition: ReviewPartition,
): RowStatusView {
  if (block.reviewStatus === "reviewed") {
    return {
      icon: Check,
      label: "已复核",
      className: "text-ink-muted",
      title: "本项已确认；留在原位只是痕迹，不需要再管",
    };
  }
  if (block.reviewStatus === "accepted_with_risk") {
    return {
      icon: ShieldAlert,
      label: "风险接受",
      className: "bg-surface-sunken text-ink-secondary",
      title: "已知有风险仍然放行；这是一次人工决定，不是待办",
    };
  }
  switch (partition) {
    case "text-pending":
      return {
        icon: PenLine,
        label: REVIEW_PARTITION_LABELS["text-pending"],
        className: "bg-proof-wash text-proof",
        title: "两个来源的文字不一致，需要逐字核对",
      };
    case "classification-pending":
      return {
        icon: TypeIcon,
        label: REVIEW_PARTITION_LABELS["classification-pending"],
        className: "bg-proof-wash text-proof",
        title: "需判断这块字是版式文字还是对象符号（⌥1 / ⌥2）",
      };
    default:
      return {
        icon: Circle,
        label: "待过目",
        className: "text-ink-muted",
        title: "两个来源逐字一致，扫一眼没问题按 Enter 即确认并跳到下一项",
      };
  }
}

function RowStatus({
  block,
  partition,
}: {
  readonly block: TextReviewBlock;
  readonly partition: ReviewPartition;
}): React.JSX.Element {
  const view = rowStatusView(block, partition);
  const Icon = view.icon;
  return (
    <span
      title={view.title}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-semibold",
        view.className,
      )}
    >
      <Icon aria-hidden className="size-3" />
      {view.label}
    </span>
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
 * 项卡外壳：行状态、人工改动标记、标记已复核与删除。
 *
 * 正文按该项当下的分区选择控件（双源 diff / 分类选择 / 可转编辑的文本），判据来源
 * 仍是 `partitionOf`——它现在每次渲染实时求值，改完分类下一帧正文就换成对应控件，
 * 而项本身留在原位。
 *
 * 「文字待确认」项的焦点目标在 TextDiffRow 的 textarea 内，由它自己聚焦；
 * 其余项没有输入框，由外壳的 `tabIndex={-1}` 容器接管焦点，键盘事件才有处冒泡。
 * 「已一致」项转入编辑态时也有了输入框，此时同样把焦点交给它（见 `manageFocus`），
 * 否则外壳会在选中的同一帧把焦点抢回去，表现为点了字却打不进去。
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
  /**
   * 「已一致」项的就地编辑态（R1）。
   *
   * 双源一致不等于正确：OCR 与 AI 助手会犯同一个错（字形相近的己/已、末/未，
   * 专有名词、品牌名、行业术语），同错即被判为「无需改动」，此前这一档只渲染只读
   * 段落，错字一路进最终 PPTX 而界面上无处拦截。但也不能一上来就铺 155 个
   * textarea——那正是 07-28 收敛掉的视觉噪音。折中为点击文本才转编辑。
   */
  const [editingText, setEditingText] = useState(false);
  const partition = partitionOf(block);
  // 分区优先于编辑态：⌥1/⌥2 可以在编辑当前项时把它改成分类待确认，那一档没有输入框
  const hasEditor =
    partition === "text-pending" || (partition === "agreed" && editingText);
  const manageFocus = !hasEditor;

  useEffect(() => {
    if (!isCurrent) return;
    itemRef.current?.scrollIntoView({ block: "nearest" });
    if (manageFocus) itemRef.current?.focus();
  }, [isCurrent, manageFocus]);

  // 切走当前项时收起删除确认与编辑态，避免下次回来时它仍停在中间状态
  useEffect(() => {
    if (!isCurrent) {
      setConfirmingDelete(false);
      setEditingText(false);
    }
  }, [isCurrent]);

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
        "flex flex-col gap-1.5 rounded-md border px-2.5 py-2",
        // 淡化的已复核项在悬停时回到全不透明，方便回看；opacity 也要进 transition。
        // 任意值写法只产出 transition-property，时长与缓动必须显式补齐。
        "transition-[opacity,background-color,border-color] duration-fast ease-out-quart",
        "focus:outline-none",
        isCurrent
          ? "border-border-strong bg-surface"
          : "border-hairline bg-canvas hover:border-border",
        // 已复核项留在原位、只淡化：它是「做过了」的痕迹，不是要移走的东西
        reviewed && !isCurrent && "opacity-60 hover:opacity-100",
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <RowStatus block={block} partition={partition} />
        {/* 人工改过的块（updatedAt 非空）——回答「我刚才动过哪几块」，不参与任何判定 */}
        {block.updatedAt !== null && (
          <span
            className="shrink-0 text-2xs text-ink-muted"
            title="本块有人工改动"
          >
            已修改
          </span>
        )}
        <span
          className="min-w-0 flex-1 truncate text-2xs text-ink-muted"
          title={block.id}
        >
          {block.id}
        </span>
        {block.reviewStatus === "unreviewed" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onMarkReviewed(block.id)}
            title="确认这一项没问题（Enter 同时跳到下一项）"
          >
            <Check aria-hidden="true" className="size-3.5" />
            标记已复核
          </Button>
        )}
        {confirmingDelete ? (
          <>
            <Button
              size="sm"
              variant="danger"
              onClick={() => onDeleteBlock(block.id)}
            >
              确认删除
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirmingDelete(false)}
            >
              取消
            </Button>
          </>
        ) : (
          <IconButton
            size="sm"
            variant="ghost"
            label="删除此块"
            title="删除重复或碎片块；删除后该块不再进入 mask 与 PPTX"
            onClick={() => setConfirmingDelete(true)}
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
          </IconButton>
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
      ) : editingText ? (
        <BlockTextEditor
          block={block}
          onUpdateBlock={onUpdateBlock}
          autoFocus
          onExit={() => setEditingText(false)}
        />
      ) : (
        <div className="flex flex-col items-start gap-1">
          {/* 段落本身即入口：整段可点，不额外占一行常驻控件。
              项卡的键盘等价物是列表级 Tab/↑↓/Enter，正文改用 button 会让焦点落在
              按钮上，Enter 随即被 resolveReviewKeyAction 放行，「确认并下一项」的
              键盘流当场断掉——所以这里沿用 li 的同一处理：可点的非交互元素。 */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: 见上，键盘流走列表级导航 */}
          <p
            onClick={() => setEditingText(true)}
            title="双源一致不代表正确：OCR 与 AI 可能同时认错。点击这段文字即可修正"
            className={cn(
              "w-full cursor-text whitespace-pre-wrap break-words rounded-sm px-1 py-0.5",
              "text-sm leading-relaxed text-ink",
              "transition-colors duration-fast hover:bg-surface-sunken",
            )}
          >
            {block.text}
          </p>
          {/* 只在当前项给出可见入口：155 项各挂一个就是把收敛掉的噪音原样加回来。
              动作一律用按钮词汇，不做成文字链接（DESIGN.md `Buttons`）。 */}
          {isCurrent && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setEditingText(true)}
            >
              <PenLine aria-hidden="true" className="size-3.5" />
              修正文本
            </Button>
          )}
        </div>
      )}

      {willGhost && (
        // 校对红的第二个正当用途：「要你管」。这不是阶段失败，是这块数据本身有问题
        <div className="flex flex-wrap items-center gap-2 rounded-sm bg-proof-wash px-2 py-1.5">
          <TriangleAlert aria-hidden="true" className="size-3.5 text-proof" />
          <span className="min-w-0 flex-1 text-2xs font-medium text-proof">
            会重影：这块字未参与去字，导出后底板里的原字与新建文本框会叠在一起
          </span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => onUpdateBlock(block.id, { includeInMask: true })}
          >
            <ImageIcon aria-hidden="true" className="size-3.5" />
            改为参与去字
          </Button>
        </div>
      )}
    </li>
  );
}

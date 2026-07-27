import type { TextReviewBlock } from "@ppt-maker/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  orderedReviewBlocks,
  partitionBlocks,
  partitionOf,
  REVIEW_PARTITION_LABELS,
  type ReviewPartition,
  type ReviewPartitionGroup,
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
 * 分区判据与展平顺序全部来自 `@/lib/review-partition`（其内部又只认 core 的
 * `compareBlockSources`），此处不复制任何口径。
 *
 * 纯展示组件：所有写入通过 props 回调交给页面壳层，不直接触碰 store 或 window.api。
 */

export interface BlockListPanelProps {
  readonly blocks: readonly TextReviewBlock[];
  /** 当前复核项 id（画布据此高亮居中） */
  readonly currentBlockId: string | null;
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
}

/** 分区标题与元信息统一落在 DESIGN.md 的 `caption` 档（14px / 500 / 0.16px） */
const CAPTION = "text-sm font-medium tracking-[0.16px] text-muted";

const COUNT_BADGE =
  "shrink-0 rounded-xs bg-surface-strong px-1.5 py-0.5 text-sm font-medium text-ink";

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

/** 分区折叠时的汇总文案；「已一致」默认折叠，另两个分区要求逐项过目 */
const PARTITION_SUMMARY: Readonly<Record<ReviewPartition, string>> = {
  "text-pending": "项双源分歧，需逐项核对文字",
  "classification-pending": "项分类待判定",
  agreed: "项双源逐字一致",
};

export function BlockListPanel({
  blocks,
  currentBlockId,
  onSelectBlock,
  onUpdateBlock,
  onMarkReviewed,
  onMarkBlocksReviewed,
  onDeleteBlock,
}: BlockListPanelProps): React.JSX.Element {
  // 「已一致」默认折叠为汇总行 + 「全部通过」，另两个分区默认展开
  const [collapsed, setCollapsed] = useState<readonly ReviewPartition[]>([
    "agreed",
  ]);

  const groups = useMemo(() => partitionBlocks(blocks), [blocks]);
  const ordered = useMemo(() => orderedReviewBlocks(blocks), [blocks]);
  const currentBlock = useMemo(
    () => blocks.find((block) => block.id === currentBlockId) ?? null,
    [blocks, currentBlockId],
  );

  const expandPartition = useCallback((partition: ReviewPartition) => {
    setCollapsed((prev) =>
      prev.includes(partition) ? prev.filter((p) => p !== partition) : prev,
    );
  }, []);

  const togglePartition = useCallback((partition: ReviewPartition) => {
    setCollapsed((prev) =>
      prev.includes(partition)
        ? prev.filter((p) => p !== partition)
        : [...prev, partition],
    );
  }, []);

  /**
   * 按 `orderedReviewBlocks` 的全局顺序跨分区连续推进。
   *
   * 推进到折叠分区时**自动展开**而非跳过：跳过会让折叠区里的块永远无法用键盘到达，
   * 而「全程仅用键盘完成一页复核」是硬验收项。展开的代价只是多滚一屏。
   */
  const moveBy = useCallback(
    (delta: number) => {
      if (ordered.length === 0) return;
      const index = ordered.findIndex((block) => block.id === currentBlockId);
      const nextIndex =
        index === -1
          ? delta > 0
            ? 0
            : ordered.length - 1
          : Math.min(ordered.length - 1, Math.max(0, index + delta));
      const target = ordered[nextIndex];
      if (target === undefined || target.id === currentBlockId) return;
      expandPartition(partitionOf(target));
      onSelectBlock(target.id);
    },
    [ordered, currentBlockId, expandPartition, onSelectBlock],
  );

  const setClassification = useCallback(
    (block: TextReviewBlock, toLayoutText: boolean) => {
      // 分类与 includeInMask 必须同改：core 的 LAYOUT_TEXT_MUST_BE_MASKED 把
      // 「layout_text 却不参与 mask」判为 error，只改分类会立刻触发校验失败
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
    [onUpdateBlock],
  );

  /**
   * 键盘流（design.md §4.1）。事件从各项的 textarea 冒泡到面板容器统一处理。
   *
   * ⌘S 一律放行冒泡到页面全局监听；⌥1/⌥2 用 `event.code` 判定——macOS 上
   * ⌥1 的 `event.key` 是 `¡`，按 `key` 判会完全失效。
   * ↑↓ 抢占了 textarea 内的光标移动：真实数据里 155 个块全部单行（PRD F-3），
   * 多行编辑用 ⇧Enter 换行后仍可用鼠标定位，代价可接受。
   *
   * 焦点落在项内按钮上时 Enter 必须放行：keydown 的 preventDefault 会连按钮的
   * click 一起吃掉，否则「标记已复核」「全部通过」「改为版式文字」用键盘按不动。
   */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.metaKey || event.ctrlKey) return;
      if (event.key === "Enter" && event.target instanceof HTMLButtonElement) {
        return;
      }

      if (event.altKey) {
        if (event.code !== "Digit1" && event.code !== "Digit2") return;
        event.preventDefault();
        if (currentBlock === null) return;
        setClassification(currentBlock, event.code === "Digit1");
        return;
      }

      switch (event.key) {
        case "Tab":
          event.preventDefault();
          moveBy(event.shiftKey ? -1 : 1);
          return;
        case "ArrowDown":
          event.preventDefault();
          moveBy(1);
          return;
        case "ArrowUp":
          event.preventDefault();
          moveBy(-1);
          return;
        case "Enter":
          if (event.shiftKey) return; // ⇧Enter 插入换行
          event.preventDefault();
          if (currentBlockId !== null) onMarkReviewed(currentBlockId);
          moveBy(1);
          return;
        default:
      }
    },
    [currentBlock, currentBlockId, moveBy, onMarkReviewed, setClassification],
  );

  return (
    // 容器只做键盘事件汇聚，本身不是控件；焦点始终落在项内的 textarea 或项卡上
    // biome-ignore lint/a11y/noStaticElementInteractions: 见上，键盘事件由子项冒泡而来
    <div
      className="flex h-full w-full flex-col bg-surface-soft"
      onKeyDown={handleKeyDown}
    >
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4">
        {groups.map((group) => (
          <PartitionSection
            key={group.partition}
            group={group}
            collapsed={collapsed.includes(group.partition)}
            currentBlockId={currentBlockId}
            onToggle={togglePartition}
            onSelectBlock={onSelectBlock}
            onUpdateBlock={onUpdateBlock}
            onMarkReviewed={onMarkReviewed}
            onMarkBlocksReviewed={onMarkBlocksReviewed}
            onDeleteBlock={onDeleteBlock}
          />
        ))}
      </div>
    </div>
  );
}

interface PartitionSectionProps {
  readonly group: ReviewPartitionGroup;
  readonly collapsed: boolean;
  readonly currentBlockId: string | null;
  readonly onToggle: (partition: ReviewPartition) => void;
  readonly onSelectBlock: (blockId: string) => void;
  readonly onUpdateBlock: (
    blockId: string,
    patch: Partial<TextReviewBlock>,
  ) => void;
  readonly onMarkReviewed: (blockId: string) => void;
  readonly onMarkBlocksReviewed: (blockIds: readonly string[]) => void;
  readonly onDeleteBlock: (blockId: string) => void;
}

function PartitionSection({
  group,
  collapsed,
  currentBlockId,
  onToggle,
  onSelectBlock,
  onUpdateBlock,
  onMarkReviewed,
  onMarkBlocksReviewed,
  onDeleteBlock,
}: PartitionSectionProps): React.JSX.Element {
  const unreviewedIds = group.blocks
    .filter((block) => block.reviewStatus === "unreviewed")
    .map((block) => block.id);

  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onToggle(group.partition)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <span aria-hidden="true" className="w-3 shrink-0 text-sm text-muted">
            {collapsed ? "▸" : "▾"}
          </span>
          <span className={cn("min-w-0 flex-1 truncate", CAPTION)}>
            {REVIEW_PARTITION_LABELS[group.partition]}
          </span>
          <span className={COUNT_BADGE}>{group.blocks.length}</span>
        </button>
        {/*
          「全部通过」只出现在「已一致」：双源逐字一致意味着无需改动，可以整批放行；
          另两个分区必须逐项过目，给批量入口等于把 F-6 的「一键全标已复核」搬回来。
        */}
        {group.partition === "agreed" && (
          <button
            type="button"
            disabled={unreviewedIds.length === 0}
            onClick={() => onMarkBlocksReviewed(unreviewedIds)}
            title="把本区所有未复核项标为已复核（不写人工编辑痕迹）"
            className={BUTTON_COMPACT}
          >
            全部通过
            {unreviewedIds.length > 0 && (
              <span className="ml-1 text-sm text-muted">
                {unreviewedIds.length}
              </span>
            )}
          </button>
        )}
      </div>

      {group.blocks.length === 0 ? (
        <p
          className={cn(
            "rounded-sm border border-hairline bg-canvas px-3 py-2",
            CAPTION,
          )}
        >
          无
        </p>
      ) : collapsed ? (
        <p className="rounded-sm border border-hairline bg-canvas px-3 py-2 text-sm text-body">
          {group.blocks.length}
          {PARTITION_SUMMARY[group.partition]}
          {unreviewedIds.length > 0 && ` · ${unreviewedIds.length} 项待确认`}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {group.blocks.map((block) => (
            <ReviewRow
              key={block.id}
              block={block}
              partition={group.partition}
              isCurrent={block.id === currentBlockId}
              onSelectBlock={onSelectBlock}
              onUpdateBlock={onUpdateBlock}
              onMarkReviewed={onMarkReviewed}
              onDeleteBlock={onDeleteBlock}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

interface ReviewRowProps {
  readonly block: TextReviewBlock;
  readonly partition: ReviewPartition;
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
 * 项卡外壳：状态徽标、重影警告、标记已复核与删除。
 *
 * 三个分区的正文各不相同，但外壳一致——放在一处，避免三份分头演化。
 * 「文字待确认」项的焦点目标在 TextDiffRow 的 textarea 内，由它自己聚焦；
 * 其余分区没有输入框，由外壳的 `tabIndex={-1}` 容器接管焦点，键盘事件才有处冒泡。
 */
function ReviewRow({
  block,
  partition,
  isCurrent,
  onSelectBlock,
  onUpdateBlock,
  onMarkReviewed,
  onDeleteBlock,
}: ReviewRowProps): React.JSX.Element {
  const itemRef = useRef<HTMLLIElement | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
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
      )}
    >
      <div className="flex items-center gap-2">
        <span className={cn("flex shrink-0 items-center gap-1.5", CAPTION)}>
          <span
            aria-hidden="true"
            className={cn("h-2 w-2 rounded-full", status.dot)}
          />
          {status.label}
        </span>
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

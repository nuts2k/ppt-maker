import type { TextReviewBlock } from "@ppt-maker/core";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

/**
 * 属性面板（PRD F3.2，视觉按 DESIGN.md 重做）。
 *
 * 交互逻辑与 V1 一致（分类、includeInMask、文字内容），仅调整视觉：
 * - 字号统一到 `body-md` / `caption`（14px），不再使用文档外的 12px；
 * - 无 hover 态（DESIGN.md 只定义 Default 与 Active/Pressed），选中靠背景色调切换表达；
 * - 输入控件 `rounded-sm` + hairline 描边，与 `text-input` 规格一致。
 */

const CLASSIFICATION_OPTIONS = [
  { value: "layout_text" as const, label: "版式文字" },
  { value: "object_integrated_symbol" as const, label: "对象符号" },
  { value: "uncertain" as const, label: "待定" },
] as const;

const REVIEW_STATUS_TEXT: Readonly<Record<string, string>> = {
  unreviewed: "未复核",
  reviewed: "已复核",
  accepted_with_risk: "风险接受",
};

/** 分组标题：`caption`（14px / 500 / 0.16px） */
const FIELD_LABEL = "text-sm font-medium tracking-[0.16px] text-muted";

interface PropertyPanelProps {
  block: TextReviewBlock | null;
  onUpdate: (blockId: string, patch: Partial<TextReviewBlock>) => void;
}

export function PropertyPanel({
  block,
  onUpdate,
}: PropertyPanelProps): React.JSX.Element {
  const blockId = block?.id ?? null;
  const blockIncludeInMask = block?.includeInMask ?? false;

  const handleClassificationChange = useCallback(
    (classification: TextReviewBlock["classification"]) => {
      if (blockId) onUpdate(blockId, { classification });
    },
    [blockId, onUpdate],
  );

  const handleIncludeInMaskToggle = useCallback(() => {
    if (blockId) onUpdate(blockId, { includeInMask: !blockIncludeInMask });
  }, [blockId, blockIncludeInMask, onUpdate]);

  const handleMarkReviewed = useCallback(() => {
    if (blockId) onUpdate(blockId, { reviewStatus: "reviewed" });
  }, [blockId, onUpdate]);

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      if (!blockId) return;
      const text = e.target.value;
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      onUpdate(blockId, { text, lines: lines.length > 0 ? lines : [text] });
    },
    [blockId, onUpdate],
  );

  if (!block) {
    return (
      <p className="px-4 py-8 text-center text-sm font-medium text-muted">
        选中文字框以编辑属性
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <span className={FIELD_LABEL}>文字内容</span>
        <textarea
          className="w-full rounded-sm border border-hairline bg-canvas px-4 py-3 text-sm leading-relaxed text-ink focus:border-info-border focus:outline-none"
          rows={4}
          value={block.text}
          onChange={handleTextChange}
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className={FIELD_LABEL}>分类</span>
        <div className="flex flex-col gap-1">
          {CLASSIFICATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={cn(
                "rounded-sm border px-4 py-2 text-left text-sm transition",
                block.classification === opt.value
                  ? "border-border-strong bg-surface-strong font-medium text-ink"
                  : "border-hairline text-body active:border-border-strong",
              )}
              onClick={() => handleClassificationChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <label className="flex cursor-pointer items-center gap-3 text-sm text-body">
          <input
            id="include-in-mask"
            type="checkbox"
            checked={block.includeInMask}
            onChange={handleIncludeInMaskToggle}
            className="h-4 w-4 shrink-0 accent-primary"
          />
          参与 Mask（该块文字将被抹除）
        </label>
        {block.includeInMask && block.classification !== "layout_text" && (
          // 约束提示用签名色底 + ink 文字：mustard 作为前景色在白底上对比度不足
          <span className="rounded-xs bg-signature-mustard px-2 py-0.5 text-sm font-medium text-ink">
            仅「版式文字」可参与 Mask，校验会报错
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className={FIELD_LABEL}>复核状态</span>
        <span className="text-sm text-body">
          {REVIEW_STATUS_TEXT[block.reviewStatus] ?? block.reviewStatus}
        </span>
        {/*
          未复核块无法通过 mask 门禁（CLI `mask/run.ts` 要求参与抹字的块已确认），
          在此提供单块确认；整页批量确认在 SlideToolbar。
        */}
        {block.reviewStatus === "unreviewed" && (
          <button
            type="button"
            onClick={handleMarkReviewed}
            className="rounded-sm border border-hairline px-4 py-2 text-sm font-medium text-ink transition active:border-border-strong"
          >
            标记已复核
          </button>
        )}
      </div>

      {block.style.fontSizePx !== null && (
        <div className="flex flex-col gap-2">
          <span className={FIELD_LABEL}>字号</span>
          <span className="text-sm text-body">{block.style.fontSizePx}px</span>
        </div>
      )}

      {block.style.colorHex !== null && (
        <div className="flex flex-col gap-2">
          <span className={FIELD_LABEL}>颜色</span>
          <span className="flex items-center gap-2 text-sm text-body">
            <span
              aria-hidden="true"
              className="h-4 w-4 rounded-xs border border-hairline"
              style={{ backgroundColor: block.style.colorHex }}
            />
            {block.style.colorHex}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <span className={FIELD_LABEL}>位置（源图像素）</span>
        <div className="grid grid-cols-2 gap-2 text-sm text-body">
          <span>X {Math.round(block.bboxPx.x)}</span>
          <span>Y {Math.round(block.bboxPx.y)}</span>
          <span>宽 {Math.round(block.bboxPx.width)}</span>
          <span>高 {Math.round(block.bboxPx.height)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-hairline pt-4">
        <span className={FIELD_LABEL}>块 ID</span>
        <span className="break-all text-sm text-muted">{block.id}</span>
      </div>
    </div>
  );
}

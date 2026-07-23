import type { TextReviewBlock } from "@ppt-maker/core";
import { useCallback } from "react";
import { cn } from "@/lib/utils";

interface PropertyPanelProps {
  block: TextReviewBlock | null;
  onUpdate: (blockId: string, patch: Partial<TextReviewBlock>) => void;
}

const CLASSIFICATION_OPTIONS = [
  {
    value: "layout_text" as const,
    label: "版式文字",
  },
  {
    value: "object_integrated_symbol" as const,
    label: "对象符号",
  },
  { value: "uncertain" as const, label: "待定" },
] as const;

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
      <div className="flex h-full items-center justify-center text-sm text-muted">
        选中文字框以编辑属性
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <div>
        <div className="mb-1 text-xs font-medium text-muted">ID</div>
        <div className="text-sm text-body">{block.id}</div>
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-muted">文字内容</div>
        <textarea
          className="w-full rounded-sm border border-hairline bg-canvas px-3 py-2 text-sm text-ink focus:border-info-border focus:outline-none"
          rows={4}
          value={block.text}
          onChange={handleTextChange}
        />
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-muted">分类</div>
        <div className="flex flex-col gap-1">
          {CLASSIFICATION_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={cn(
                "rounded-sm border px-3 py-1.5 text-left text-sm transition-colors",
                block.classification === opt.value
                  ? "border-info-border bg-surface-soft font-medium"
                  : "border-hairline hover:bg-surface-soft",
              )}
              onClick={() => handleClassificationChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <input
          id="include-in-mask"
          type="checkbox"
          checked={block.includeInMask}
          onChange={handleIncludeInMaskToggle}
          className="rounded"
        />
        <label htmlFor="include-in-mask">参与 Mask</label>
        {block.includeInMask && block.classification !== "layout_text" && (
          <span className="text-xs text-block-uncertain">
            仅 layout_text 可参与 mask
          </span>
        )}
      </div>

      <div>
        <div className="mb-1 text-xs font-medium text-muted">复核状态</div>
        <div className="text-sm text-body">
          {block.reviewStatus === "unreviewed" && "未复核"}
          {block.reviewStatus === "reviewed" && "已复核"}
          {block.reviewStatus === "accepted_with_risk" && "风险接受"}
        </div>
      </div>

      {block.style.fontSizePx !== null && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted">字号</div>
          <div className="text-sm text-body">{block.style.fontSizePx}px</div>
        </div>
      )}

      {block.style.colorHex !== null && (
        <div>
          <div className="mb-1 text-xs font-medium text-muted">颜色</div>
          <div className="flex items-center gap-2 text-sm text-body">
            <div
              className="h-4 w-4 rounded-xs border border-hairline"
              style={{ backgroundColor: block.style.colorHex }}
            />
            {block.style.colorHex}
          </div>
        </div>
      )}

      <div>
        <div className="mb-1 text-xs font-medium text-muted">位置</div>
        <div className="grid grid-cols-2 gap-2 text-xs text-body">
          <div>X: {Math.round(block.bboxPx.x)}</div>
          <div>Y: {Math.round(block.bboxPx.y)}</div>
          <div>W: {Math.round(block.bboxPx.width)}</div>
          <div>H: {Math.round(block.bboxPx.height)}</div>
        </div>
      </div>
    </div>
  );
}

import type { TextReviewBlock } from "@ppt-maker/core";

/**
 * 候选来源列表（PRD F3.2，视觉按 DESIGN.md 重做）。
 *
 * 每条候选是一张 `rounded-sm` hairline 卡片：来源名 + 置信度在同一行（caption），
 * 文字内容为 `body-md`，provider 作为末行元信息。字号统一 14px，不使用文档外的 12px。
 */

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  offline_ocr: "离线 OCR",
  cloud_vision: "云端视觉",
  reference_text: "参考文案",
  manual: "手动",
};

interface SourceListProps {
  block: TextReviewBlock | null;
}

export function SourceList({ block }: SourceListProps): React.JSX.Element {
  if (!block) {
    return (
      <p className="px-4 py-8 text-center text-sm font-medium text-muted">
        选中文字框以查看候选来源
      </p>
    );
  }

  if (block.sources.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm font-medium text-muted">
        该文字块没有候选来源记录
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-6">
      <h3 className="text-sm font-medium tracking-[0.16px] text-muted">
        候选来源 {block.sources.length}
      </h3>
      <ul className="flex flex-col gap-2">
        {block.sources.map((source) => (
          <li
            key={`${source.kind}-${source.provider}-${source.text}`}
            className="flex flex-col gap-1 rounded-sm border border-hairline p-4"
          >
            <div className="flex items-baseline gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                {SOURCE_LABELS[source.kind] ?? source.kind}
              </span>
              {source.confidence !== null && (
                <span className="shrink-0 text-sm font-medium text-muted">
                  {(source.confidence * 100).toFixed(0)}%
                </span>
              )}
            </div>
            <p className="text-sm leading-relaxed text-body">{source.text}</p>
            <p className="truncate text-sm text-muted" title={source.provider}>
              {source.provider}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

import type { TextReviewBlock } from "@ppt-maker/core";

interface SourceListProps {
  block: TextReviewBlock | null;
}

const SOURCE_LABELS: Record<string, string> = {
  offline_ocr: "离线 OCR",
  cloud_vision: "云端视觉",
  reference_text: "参考文案",
  manual: "手动",
};

export function SourceList({ block }: SourceListProps): React.JSX.Element {
  if (!block) {
    return (
      <div className="flex h-full items-center justify-center text-muted text-sm">
        选中文字框以查看来源
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <h3 className="text-xs font-medium text-muted">
        候选来源 ({block.sources.length})
      </h3>
      {block.sources.map((source) => (
        <div
          key={`${source.kind}-${source.provider}-${source.text}`}
          className="rounded-sm border border-hairline p-3"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-body">
              {SOURCE_LABELS[source.kind] ?? source.kind}
            </span>
            {source.confidence !== null && (
              <span className="text-xs text-muted">
                {(source.confidence * 100).toFixed(0)}%
              </span>
            )}
          </div>
          <div className="mt-1 text-sm text-ink">{source.text}</div>
          <div className="mt-0.5 text-xs text-muted">{source.provider}</div>
        </div>
      ))}
    </div>
  );
}

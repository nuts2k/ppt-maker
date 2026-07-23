import { cn } from "@/lib/utils";

const STAGE_ORDER = [
  { key: "init", label: "初始化" },
  { key: "ocr", label: "OCR" },
  { key: "review", label: "候选合并" },
  { key: "assist-review", label: "AI 复核" },
  { key: "mask", label: "Mask" },
  { key: "clean", label: "Clean Plate" },
  { key: "accept-clean", label: "验收 Clean" },
  { key: "pptx", label: "PPTX" },
  { key: "accept-pptx", label: "验收 PPTX" },
  { key: "report", label: "报告" },
] as const;

interface StageProgressProps {
  stageStatuses: Record<string, string>;
  running: boolean;
}

function statusColor(status: string | undefined): string {
  switch (status) {
    case "completed":
      return "bg-success border-success-border";
    case "running":
      return "bg-info border-info-border animate-pulse";
    case "failed":
      return "bg-error border-error-border";
    case "interrupted":
    case "stale":
      return "bg-warning border-warning-border";
    default:
      return "bg-surface-strong border-hairline";
  }
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case "completed":
      return "完成";
    case "running":
      return "执行中";
    case "failed":
      return "失败";
    case "interrupted":
      return "中断";
    case "stale":
      return "过期";
    case "pending":
      return "待执行";
    default:
      return "待执行";
  }
}

export function StageProgress({
  stageStatuses,
  running,
}: StageProgressProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 p-4">
      <h3 className="mb-2 text-xs font-medium text-muted">
        Pipeline 阶段 {running && <span className="text-info">（执行中）</span>}
      </h3>
      {STAGE_ORDER.map((stage) => {
        const status = stageStatuses[stage.key];
        return (
          <div key={stage.key} className="flex items-center gap-2">
            <div
              className={cn(
                "h-2.5 w-2.5 shrink-0 rounded-full border",
                statusColor(status),
              )}
            />
            <span className="flex-1 text-sm text-body">{stage.label}</span>
            <span className="text-xs text-muted">{statusLabel(status)}</span>
          </div>
        );
      })}
    </div>
  );
}

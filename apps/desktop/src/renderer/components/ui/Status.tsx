import type { StageViewStatus } from "@/lib/stage-view";
import { cn } from "@/lib/utils";
import { STATUS_DOT_SIZE, STATUS_SPEC } from "./status-spec";

/**
 * 状态呈现组件。配色、形状、图标、文案一律取自 `status-spec.ts`，
 * **组件内不得自行拼色** —— 见该文件顶部说明。
 */

interface StatusDotProps {
  readonly status: StageViewStatus;
  readonly size?: keyof typeof STATUS_DOT_SIZE;
  /** 覆盖悬停提示；不传则用状态默认文案 */
  readonly title?: string;
  readonly className?: string;
}

export function StatusDot({
  status,
  size = "sm",
  title,
  className,
}: StatusDotProps): React.JSX.Element {
  const spec = STATUS_SPEC[status];
  return (
    <span
      // 纯装饰：语义由同处的文字承担，读屏不该逐点朗读
      aria-hidden="true"
      title={title ?? spec.label}
      className={cn("shrink-0", STATUS_DOT_SIZE[size], spec.dot, className)}
    />
  );
}

interface StatusChipProps {
  readonly status: StageViewStatus;
  /** 覆盖默认文案（例如带上阶段名） */
  readonly label?: string;
  readonly className?: string;
}

export function StatusChip({
  status,
  label,
  className,
}: StatusChipProps): React.JSX.Element {
  const spec = STATUS_SPEC[status];
  const Icon = spec.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-2xs font-semibold",
        spec.wash,
        spec.text,
        className,
      )}
    >
      <Icon aria-hidden className="size-3" />
      {label ?? spec.label}
    </span>
  );
}

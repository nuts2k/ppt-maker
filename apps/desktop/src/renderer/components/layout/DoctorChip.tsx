import { useEffect, useRef, useState } from "react";
import { Panel } from "@/components/ui";
import {
  CHECK_DOT_CLASS,
  CHECK_STATUS_TEXT,
  doctorChipView,
} from "@/lib/doctor-view";
import { cn } from "@/lib/utils";
import type { DoctorReport } from "../../../main/ipc/channels.js";

/**
 * 顶栏环境状态 chip + 明细下拉。
 *
 * 报告由 TopNav 持有并透传——导出前警告要用同一份数据，
 * 若 chip 自行拉取会出现两份报告不一致的可能。
 */

interface DoctorChipProps {
  readonly report: DoctorReport | null;
  /** doctor IPC 调用失败：降级为「环境未知」而非隐藏，避免用户以为检查通过 */
  readonly failed: boolean;
}

export function DoctorChip({
  report,
  failed,
}: DoctorChipProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 点击卡片外部收起下拉
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent): void {
      const node = rootRef.current;
      if (node && !node.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const chip = doctorChipView(report, failed);
  if (chip === null) return null;

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "rounded-sm px-2 py-1 text-sm font-medium transition-colors duration-fast hover:bg-surface active:bg-surface-sunken",
          chip.className,
        )}
      >
        {chip.label}
      </button>
      {open && (
        <Panel
          elevation="raised"
          className="absolute right-0 top-full z-20 mt-2 w-80 p-4"
        >
          {report ? (
            <ul className="flex flex-col gap-3">
              {report.checks.map((check) => (
                <li key={check.id} className="flex gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-1.5 size-2 shrink-0",
                      CHECK_DOT_CLASS[check.status],
                    )}
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">
                      {check.label}
                      <span className="sr-only">
                        ：{CHECK_STATUS_TEXT[check.status]}
                      </span>
                    </p>
                    <p className="text-sm leading-relaxed text-ink-secondary">
                      {check.message}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-secondary">
              环境检查未能完成，请确认依赖是否可用。
            </p>
          )}
        </Panel>
      )}
    </div>
  );
}

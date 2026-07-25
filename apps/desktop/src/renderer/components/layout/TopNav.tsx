import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/deck-store";
import { useRunStore } from "@/stores/run-store";
import type { DoctorReport } from "../../../main/ipc/channels.js";

interface ExportResult {
  ok: boolean;
  message: string;
}

// doctor 单项状态 → 状态点颜色（沿用全局状态色约定）
const CHECK_DOT_CLASS: Record<string, string> = {
  pass: "bg-success",
  warn: "bg-signature-mustard",
  fail: "bg-signature-coral",
};

interface ChipStyle {
  label: string;
  className: string;
}

function chipStyleOf(report: DoctorReport): ChipStyle {
  const { fail, warn } = report.summary;
  if (fail > 0) {
    return {
      label: `环境异常 ${fail} 项`,
      className: "bg-signature-coral text-on-primary",
    };
  }
  if (warn > 0) {
    return {
      label: `环境警告 ${warn} 项`,
      className: "bg-signature-mustard text-ink",
    };
  }
  return { label: "环境正常", className: "bg-success/10 text-success" };
}

export function TopNav(): React.JSX.Element {
  const deckPath = useDeckStore((s) => s.deckPath);
  const name = useDeckStore((s) => s.name);
  const runStatus = useRunStore((s) => s.status);

  const [report, setReport] = useState<DoctorReport | null>(null);
  // doctor 调用失败不应阻断界面，仅降级为「环境未知」
  const [doctorFailed, setDoctorFailed] = useState(false);
  const [doctorOpen, setDoctorOpen] = useState(false);
  const doctorRef = useRef<HTMLDivElement | null>(null);

  const [strict, setStrict] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await window.api.system.doctor();
        if (!cancelled) setReport(result);
      } catch {
        if (!cancelled) setDoctorFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 点击卡片外部收起下拉
  useEffect(() => {
    if (!doctorOpen) return;
    function onPointerDown(event: MouseEvent): void {
      const node = doctorRef.current;
      if (node && !node.contains(event.target as Node)) setDoctorOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [doctorOpen]);

  const running = runStatus !== "idle";
  const exportDisabled = !deckPath || exporting || running;

  async function handleExport(): Promise<void> {
    if (!deckPath) return;
    const outputPath = await window.api.system.saveFileDialog("output.pptx");
    if (!outputPath) return;
    setExporting(true);
    setExportResult(null);
    try {
      const result = await window.api.deck.export(deckPath, outputPath, strict);
      setExportResult({
        ok: true,
        message: `导出成功：${result.nativeSlides} 页原生 + ${result.placeholderSlides} 页占位 → ${result.outputPath}`,
      });
      void useDeckStore.getState().refreshStatus();
    } catch (err) {
      setExportResult({
        ok: false,
        message: `导出失败：${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setExporting(false);
    }
  }

  const chip: ChipStyle | null = report
    ? chipStyleOf(report)
    : doctorFailed
      ? { label: "环境未知", className: "bg-surface-strong text-muted" }
      : null;

  return (
    <div className="shrink-0 border-b border-hairline bg-canvas">
      {/*
        导航条自身即 macOS hiddenInset 的拖拽区（否则要额外叠一条空白标题栏），
        左内距让开红绿灯按钮；其中所有可交互元素必须显式 no-drag，否则点击会被拖拽吞掉。
      */}
      <div
        className="flex h-16 items-center gap-6 pl-20 pr-6"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <span className="shrink-0 text-base font-medium text-ink">
          PPT Maker
        </span>

        {deckPath ? (
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-lg font-medium text-ink">
              {name ?? "未命名 Deck"}
            </span>
            <span
              className="truncate text-sm font-medium text-muted"
              title={deckPath}
            >
              {deckPath}
            </span>
          </div>
        ) : (
          <div className="flex-1" />
        )}

        <div
          className="flex shrink-0 items-center gap-4"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          {chip && (
            <div className="relative shrink-0" ref={doctorRef}>
              <button
                type="button"
                onClick={() => setDoctorOpen((open) => !open)}
                className={cn(
                  "rounded-xs px-2 py-0.5 text-sm font-medium transition",
                  chip.className,
                )}
              >
                {chip.label}
              </button>
              {doctorOpen && (
                <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-md border border-hairline bg-canvas p-4">
                  {report ? (
                    <ul className="flex flex-col gap-3">
                      {report.checks.map((check) => (
                        <li key={check.id} className="flex gap-2">
                          <span
                            className={cn(
                              "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                              CHECK_DOT_CLASS[check.status] ??
                                "bg-surface-strong",
                            )}
                          />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink">
                              {check.label}
                            </p>
                            <p className="text-sm leading-relaxed text-body">
                              {check.message}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-body">
                      环境检查未能完成，请确认依赖是否可用。
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 未打开 deck 时导出无从谈起，严格模式开关一并隐藏以减少空态噪音 */}
          {deckPath !== null && (
            <label
              className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-muted"
              title="要求所有页面通过 accept-pptx 验收后才允许导出"
            >
              <input
                type="checkbox"
                checked={strict}
                onChange={(e) => setStrict(e.target.checked)}
              />
              严格模式
            </label>
          )}

          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={exportDisabled}
            title={running ? "执行中不可导出" : undefined}
            className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition active:bg-primary-active disabled:opacity-40"
          >
            {exporting ? "导出中…" : "导出 PPTX"}
          </button>
        </div>
      </div>

      {exportResult && (
        <div
          className={cn(
            "flex items-center gap-4 border-t border-hairline px-6 py-2 text-sm",
            exportResult.ok
              ? "bg-success/10 text-success"
              : "bg-signature-coral/10 text-signature-coral",
          )}
        >
          <span
            className="min-w-0 flex-1 truncate"
            title={exportResult.message}
          >
            {exportResult.message}
          </span>
          <button
            type="button"
            onClick={() => setExportResult(null)}
            className="shrink-0 rounded-xs px-2 py-0.5 text-sm font-medium transition active:bg-surface-strong"
          >
            关闭
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import {
  type DoctorNotice,
  exportNotice,
  startupNotice,
} from "@/lib/doctor-view";
import { cn } from "@/lib/utils";
import {
  UNSAVED_SWITCH_NOTICE,
  type WorkspaceAction,
} from "@/lib/workspace-menu";
import { useDeckStore } from "@/stores/deck-store";
import { useRunStore } from "@/stores/run-store";
import type { DoctorReport } from "../../../main/ipc/channels.js";
import { DoctorChip } from "./DoctorChip";
import { DoctorNoticeBar } from "./DoctorNoticeBar";
import { executeWorkspaceAction, WorkspaceMenu } from "./WorkspaceMenu";

interface ExportResult {
  ok: boolean;
  message: string;
}

/** DESIGN.md `button-primary`：近黑底、12px 圆角；条内动作按钮比控制条主按钮略紧凑 */
const BUTTON_PRIMARY =
  "rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary transition active:bg-primary-active disabled:opacity-40";

/** DESIGN.md `button-secondary`：白底 + hairline 描边 */
const BUTTON_SECONDARY =
  "rounded-lg border border-hairline bg-canvas px-4 py-2 text-sm text-ink transition active:border-border-strong";

export function TopNav(): React.JSX.Element {
  const deckPath = useDeckStore((s) => s.deckPath);
  const name = useDeckStore((s) => s.name);
  const runStatus = useRunStore((s) => s.status);

  const [report, setReport] = useState<DoctorReport | null>(null);
  // doctor 调用失败不应阻断界面，仅降级为「环境未知」
  const [doctorFailed, setDoctorFailed] = useState(false);
  // 启动提示只提示一次；关掉后仍可从 chip 下拉看到完整明细
  const [noticeDismissed, setNoticeDismissed] = useState(false);

  const [strict, setStrict] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  // 非 null 表示导出被环境警告拦下，等待用户确认「仍要导出」
  const [exportConfirm, setExportConfirm] = useState<DoctorNotice | null>(null);
  // 非 null 表示切换工作区被未保存的复核改动拦下，等待用户确认「仍要切换」
  const [switchConfirm, setSwitchConfirm] = useState<WorkspaceAction | null>(
    null,
  );

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

  const running = runStatus !== "idle";
  const exportDisabled = !deckPath || exporting || running;

  async function runExport(): Promise<void> {
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

  /** PRD F5.1：环境问题不阻止打开与复核，但导出前必须警告一次 */
  function handleExportClick(): void {
    if (!deckPath) return;
    const notice = exportNotice(report);
    if (notice !== null) {
      setExportConfirm(notice);
      return;
    }
    void runExport();
  }

  function handleConfirmExport(): void {
    setExportConfirm(null);
    void runExport();
  }

  /** PRD R5：确认发生在开目录框之前，避免用户选完目录才被拦下 */
  function handleConfirmSwitch(): void {
    if (switchConfirm === null) return;
    const action = switchConfirm;
    setSwitchConfirm(null);
    void executeWorkspaceAction(action);
  }

  const notice = noticeDismissed ? null : startupNotice(report);

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
          <WorkspaceMenu
            name={name}
            deckPath={deckPath}
            onRequestConfirm={setSwitchConfirm}
          />
        ) : (
          <div className="flex-1" />
        )}

        <div
          className="flex shrink-0 items-center gap-4"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <DoctorChip report={report} failed={doctorFailed} />

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
            onClick={handleExportClick}
            disabled={exportDisabled}
            title={running ? "执行中不可导出" : undefined}
            className={cn("shrink-0", BUTTON_PRIMARY)}
          >
            {exporting ? "导出中…" : "导出 PPTX"}
          </button>
        </div>
      </div>

      {notice && (
        <DoctorNoticeBar
          notice={notice}
          actions={
            <button
              type="button"
              onClick={() => setNoticeDismissed(true)}
              className={BUTTON_SECONDARY}
            >
              知道了
            </button>
          }
        />
      )}

      {exportConfirm && (
        <DoctorNoticeBar
          notice={exportConfirm}
          actions={
            <>
              <button
                type="button"
                onClick={handleConfirmExport}
                className={BUTTON_PRIMARY}
              >
                仍要导出
              </button>
              <button
                type="button"
                onClick={() => setExportConfirm(null)}
                className={BUTTON_SECONDARY}
              >
                取消
              </button>
            </>
          }
        />
      )}

      {switchConfirm !== null && (
        <DoctorNoticeBar
          notice={UNSAVED_SWITCH_NOTICE}
          actions={
            <>
              <button
                type="button"
                onClick={handleConfirmSwitch}
                className={BUTTON_PRIMARY}
              >
                仍要切换
              </button>
              <button
                type="button"
                onClick={() => setSwitchConfirm(null)}
                className={BUTTON_SECONDARY}
              >
                取消
              </button>
            </>
          }
        />
      )}

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

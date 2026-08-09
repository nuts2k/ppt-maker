import { Upload, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Checkbox, IconButton } from "@/components/ui";
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
import { useSourceTaskStore } from "@/stores/source-task-store";
import type { DoctorReport } from "../../../main/ipc/channels.js";
import { DoctorChip } from "./DoctorChip";
import { DoctorNoticeBar } from "./DoctorNoticeBar";
import { executeWorkspaceAction, WorkspaceMenu } from "./WorkspaceMenu";

interface ExportResult {
  ok: boolean;
  message: string;
}

export function TopNav(): React.JSX.Element {
  const deckPath = useDeckStore((s) => s.deckPath);
  const name = useDeckStore((s) => s.name);
  const runStatus = useRunStore((s) => s.status);
  const sourceTaskRunning = useSourceTaskStore((s) => s.running);

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
  const exportDisabled = !deckPath || exporting || running || sourceTaskRunning;

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
        className="flex h-14 items-center gap-4 pl-20 pr-6"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        {/*
          品牌名弱化为一枚标识：这是一个单窗口工具，用户从不需要辨认自己在哪个应用里，
          顶栏第一顺位应当是「当前是哪个 deck」。
        */}
        <span className="shrink-0 text-2xs font-semibold text-ink-muted">
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
          className="flex shrink-0 items-center gap-3"
          style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        >
          <DoctorChip report={report} failed={doctorFailed} />

          {/* 未打开 deck 时导出无从谈起，严格模式开关一并隐藏以减少空态噪音 */}
          {deckPath !== null && (
            <Checkbox
              className="shrink-0"
              label="严格模式"
              hint="要求所有页面通过 accept-pptx 验收后才允许导出"
              checked={strict}
              onChange={(e) => setStrict(e.target.checked)}
            />
          )}

          {/*
            导出是次要变体：全屏唯一的主行动是控制台的「处理全部」（DESIGN.md
            `Buttons`）。两个墨底按钮同屏会让用户分不清这一步该先点哪个，
            而在流程上导出恰恰是最后一步。
          */}
          <Button
            variant="secondary"
            className="shrink-0"
            onClick={handleExportClick}
            disabled={exportDisabled}
            loading={exporting}
            title={
              running
                ? "流水线执行中不可导出"
                : sourceTaskRunning
                  ? "建页任务执行中不可导出"
                  : undefined
            }
          >
            {!exporting && <Upload aria-hidden="true" className="size-3.5" />}
            {exporting ? "导出中…" : "导出 PPTX"}
          </Button>
        </div>
      </div>

      {notice && (
        <DoctorNoticeBar
          notice={notice}
          actions={
            <Button size="sm" onClick={() => setNoticeDismissed(true)}>
              知道了
            </Button>
          }
        />
      )}

      {exportConfirm && (
        <DoctorNoticeBar
          notice={exportConfirm}
          actions={
            <>
              <Button size="sm" variant="primary" onClick={handleConfirmExport}>
                仍要导出
              </Button>
              <Button size="sm" onClick={() => setExportConfirm(null)}>
                取消
              </Button>
            </>
          }
        />
      )}

      {switchConfirm !== null && (
        <DoctorNoticeBar
          notice={UNSAVED_SWITCH_NOTICE}
          actions={
            <>
              <Button size="sm" variant="primary" onClick={handleConfirmSwitch}>
                仍要切换
              </Button>
              <Button size="sm" onClick={() => setSwitchConfirm(null)}>
                取消
              </Button>
            </>
          }
        />
      )}

      {/*
        导出结果条。成功走中性——它是一次完成态反馈，不需要用户再做什么；
        失败才给颜色（有颜色 = 要你管）。
      */}
      {exportResult && (
        <div
          className={cn(
            "flex items-center gap-3 border-t border-hairline px-6 py-2 text-sm",
            exportResult.ok
              ? "bg-surface text-ink-secondary"
              : "bg-state-failed/10 text-state-failed",
          )}
        >
          <span
            className="min-w-0 flex-1 truncate"
            title={exportResult.message}
          >
            {exportResult.message}
          </span>
          <IconButton
            size="sm"
            variant="ghost"
            label="关闭导出结果"
            onClick={() => setExportResult(null)}
          >
            <X aria-hidden="true" className="size-4" />
          </IconButton>
        </div>
      )}
    </div>
  );
}

import type { PdfExtractionReport } from "@ppt-maker/core";
import { X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import { Button, IconButton, Panel, SECTION_LABEL } from "@/components/ui";
import {
  createdLines,
  groupSkippedPages,
  summarizeExtraction,
} from "@/lib/extraction-report-view";
import { cn } from "@/lib/utils";
import { useSourceTaskStore } from "@/stores/source-task-store";

/**
 * PDF 抽取报告面板（E4）。
 *
 * 两条来路合成一个面板：
 *
 * 1. 抽取刚结束 —— 来自 `source-task-store` 的 `lastResult.report`，关闭走 `dismissResult()`；
 * 2. 从活动日志回溯 —— 带 `reportPath` 的记录点「查看报告」，重新读盘。
 *
 * **不常驻版面，但也不能「关了就再也找不到」**：报告文件本就落在 `<deck>/extractions/`，
 * 路径进了活动日志，因此第二条来路只是把同一份文件重新读回来，不是另存一份状态。
 *
 * 打开状态放在本文件的模块级小 store 而不是塞进 `source-task-store`：那个 store 管的是
 * 「建页任务跑到哪了」，回溯查看与任务执行毫无关系，混进去会让 `dismissResult()` 之类的
 * 动作同时影响两件事。
 */

interface ExtractionReportViewerState {
  /** 回溯读回的报告；null 表示当前没有在看回溯的那一份 */
  report: PdfExtractionReport | null;
  reportPath: string | null;
  loading: boolean;
  error: string | null;
  open(reportPath: string): Promise<void>;
  close(): void;
}

/**
 * 在途请求的序号。
 *
 * 读盘期间用户可能又点了另一条记录、或者直接关掉面板；迟到的响应若照写，
 * 会把已经关掉的面板重新弹开、或者显示上一条记录的报告。`close()` 里同样递增，
 * 否则「关掉 → 迟到响应到达」这条路径没人守。
 */
let openSeq = 0;

export const useExtractionReportViewer = create<ExtractionReportViewerState>(
  (set) => ({
    report: null,
    reportPath: null,
    loading: false,
    error: null,

    async open(reportPath) {
      openSeq += 1;
      const seq = openSeq;
      set({ loading: true, error: null, report: null, reportPath });
      try {
        const report = await window.api.deck.readExtractionReport(reportPath);
        if (seq !== openSeq) return;
        set({ report, loading: false });
      } catch (error) {
        // 失败路径同样要守：迟到的失败会让一个用户已经关掉的面板重新弹出错误
        if (seq !== openSeq) return;
        set({ loading: false, error: describeError(error) });
      }
    },

    close() {
      openSeq += 1;
      set({ report: null, reportPath: null, loading: false, error: null });
    },
  }),
);

/** 供活动日志调用：打开某条记录对应的报告 */
export function openExtractionReport(reportPath: string): void {
  void useExtractionReportViewer.getState().open(reportPath);
}

const TITLE_ID = "extraction-report-title";

/**
 * 自足宿主：自己订阅两个来源、自己决定显不显示。挂载点只写一行
 * `<ExtractionReportHost />`，不传 props——两条来路的取舍留在这里，
 * 调用点不需要知道有几条来路。
 */
export function ExtractionReportHost(): React.JSX.Element | null {
  const taskReport = useSourceTaskStore((s) => s.lastResult?.report ?? null);
  const dismissResult = useSourceTaskStore((s) => s.dismissResult);
  const viewerReport = useExtractionReportViewer((s) => s.report);
  const loading = useExtractionReportViewer((s) => s.loading);
  const error = useExtractionReportViewer((s) => s.error);
  const closeViewer = useExtractionReportViewer((s) => s.close);

  // 回溯是用户的显式动作，优先级高于「刚跑完那一份」：抽取完不关面板直接去日志里
  // 点另一份时，屏幕上该换成他点的那一份。
  const fromViewer = viewerReport !== null || loading || error !== null;
  const report = viewerReport ?? taskReport;
  const visible = fromViewer || report !== null;

  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const close = useCallback(() => {
    if (fromViewer) closeViewer();
    else dismissResult();
  }, [fromViewer, closeViewer, dismissResult]);

  useEffect(() => {
    if (!visible) return;
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      event.preventDefault();
      close();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [visible, close]);

  useEffect(() => {
    if (visible) closeRef.current?.focus();
  }, [visible]);

  // 点击面板外部关闭（与快捷键面板、顶栏下拉同一套行为）。
  // 用 document 监听而不是给遮罩 div 挂 onMouseDown：那是给静态元素加交互，
  // 读屏与键盘都拿不到它，biome 的 a11y 规则也会拦。
  useEffect(() => {
    if (!visible) return;
    function handlePointerDown(event: MouseEvent): void {
      const node = panelRef.current;
      if (node && !node.contains(event.target as Node)) close();
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [visible, close]);

  const summary = useMemo(
    () => (report === null ? null : summarizeExtraction(report)),
    [report],
  );
  const created = useMemo(
    () => (report === null ? [] : createdLines(report)),
    [report],
  );
  const skipGroups = useMemo(
    () => (report === null ? [] : groupSkippedPages(report.skipped)),
    [report],
  );

  if (!visible) return null;

  return (
    // 遮罩用半透明墨色，**不用毛玻璃**（DESIGN.md 明令禁止）
    <div className="fixed inset-0 z-overlay flex items-center justify-center bg-ink/20 p-6">
      <Panel
        ref={panelRef}
        elevation="raised"
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        className="flex max-h-full w-[680px] max-w-full flex-col overflow-hidden"
      >
        <div className="flex items-start gap-3 border-b border-hairline px-5 py-3">
          <div className="min-w-0 flex-1">
            <h2 id={TITLE_ID} className="text-base font-semibold text-ink">
              抽取报告
            </h2>
            {summary !== null && (
              // 文档名可能很长，必须能断行而不是把面板撑破
              <p className="mt-0.5 break-all text-xs text-ink-muted">
                {summary.documentName} · {summary.requestedPagesText} ·{" "}
                {summary.rendererText}
              </p>
            )}
          </div>
          <IconButton
            ref={closeRef}
            size="sm"
            variant="ghost"
            label="关闭抽取报告"
            onClick={close}
          >
            <X aria-hidden="true" className="size-4" />
          </IconButton>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {loading && <p className="text-sm text-ink-muted">读取报告中…</p>}

          {error !== null && (
            <p className="rounded-sm bg-state-failed/10 px-3 py-2 text-sm font-medium leading-relaxed text-state-failed">
              读取报告失败：{error}
            </p>
          )}

          {summary !== null && (
            <>
              <div className="flex items-center gap-4 text-sm text-ink-secondary">
                <span>
                  建立{" "}
                  <strong className="text-xl font-semibold tabular-nums text-ink">
                    {summary.createdCount}
                  </strong>{" "}
                  页
                </span>
                <span aria-hidden="true" className="h-4 w-px bg-hairline" />
                <span>
                  跳过{" "}
                  <strong className="text-xl font-semibold tabular-nums text-ink">
                    {summary.skippedCount}
                  </strong>{" "}
                  页
                </span>
              </div>

              {created.length > 0 && (
                <section className="flex flex-col gap-1">
                  <p className={SECTION_LABEL}>建立的页面</p>
                  <ul className="flex flex-col gap-0.5">
                    {created.map((line) => (
                      <li
                        key={line.pageNumber}
                        className="text-sm leading-relaxed text-ink-secondary"
                      >
                        {line.text}
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {skipGroups.map((group) => (
                <section key={group.code} className="flex flex-col gap-1">
                  <p className={SECTION_LABEL}>
                    {group.label}（{group.lines.length}）
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {group.lines.map((line) => (
                      <li
                        key={line.pageNumber}
                        className={cn(
                          "text-sm leading-relaxed",
                          // 有颜色 = 要你管：按规矩跳过的页保持中性，
                          // 「本该能出、结果没出」的那两类才标注（判据在 lib/extraction-report-view.ts）
                          group.tone === "stale"
                            ? "text-state-stale"
                            : "text-ink-secondary",
                        )}
                      >
                        {line.text}
                      </li>
                    ))}
                  </ul>
                </section>
              ))}

              {created.length === 0 && skipGroups.length === 0 && (
                <p className="text-sm text-ink-muted">
                  这份报告里没有任何页面记录。
                </p>
              )}
            </>
          )}
        </div>

        {/*
          只有一个「关闭」，且是 secondary：完成面板不该再造一个主行动去抢
          控制台上「处理全部」那唯一的 primary（DESIGN.md：primary 全屏唯一）。
        */}
        <div className="flex justify-end border-t border-hairline px-5 py-3">
          <Button size="sm" variant="secondary" onClick={close}>
            关闭
          </Button>
        </div>
      </Panel>
    </div>
  );
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

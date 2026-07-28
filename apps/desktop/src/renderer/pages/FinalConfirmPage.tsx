import type { TextReviewBlock } from "@ppt-maker/core";
import { useCallback, useEffect, useState } from "react";
import { SliderCompare } from "@/components/compare/SliderCompare";
import { CheckSummary } from "@/components/final/CheckSummary";
import { CompositePreview } from "@/components/final/CompositePreview";
import { cn } from "@/lib/utils";
import type { FinalChecks } from "../../main/ipc/channels.js";

/**
 * 最终确认页（PRD R2，design.md §4.3）。
 *
 * 取代 AcceptFlow 的两道验收界面：D1 把五个人工门收敛为「前段文本复核 + 末尾最终
 * 产物确认」，accept-clean 不再单独停顿，滑块对比降级为本页可切换的一档视图。
 *
 * 默认视图是合成预览（clean plate 作背景 + 按 text-blocks 渲染文本层），因为
 * 「界面里看不到最终效果」正是 F-5 记录的问题——原界面只给一张底板图和一句
 * 「请去 PowerPoint 打开」，人无从判断该不该接受。
 *
 * 本页只呈现与回调，不自己做失效与重跑：「先 invalidate 再启动」的纪律在
 * ReviewPage 的 rerunFrom 里已实现一遍（空转陷阱见 SlidePage.tsx:245 的注释），
 * 在这里再写一份必然出现两套语义。检查结果是唯一的例外，它是本页自有的读取。
 */

const BUTTON_PRIMARY =
  "rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-on-primary transition active:bg-primary-active disabled:opacity-40";

const BUTTON_SECONDARY =
  "rounded-lg border border-hairline bg-canvas px-4 py-2.5 text-sm text-ink transition active:border-border-strong disabled:opacity-40";

type FinalViewMode = "preview" | "compare";

const VIEW_LABELS: Readonly<Record<FinalViewMode, string>> = {
  preview: "合成预览",
  compare: "原图对比",
};

export interface FinalConfirmPageProps {
  readonly workspacePath: string;
  readonly sourceImageUrl: string | null;
  readonly cleanPlateUrl: string | null;
  readonly blocks: readonly TextReviewBlock[];
  readonly imageSize: {
    readonly width: number;
    readonly height: number;
  } | null;
  /** 本页正在执行：全部动作禁用 */
  readonly busy: boolean;
  /** 验收提交中 */
  readonly submitting: boolean;
  /** 闸门来源，durable 时提示「状态由工作区恢复」 */
  readonly gateSource: "session" | "durable";
  /** 完成：调用方负责调 slide.acceptFinal 并刷新 */
  readonly onComplete: (note: string) => void;
  /** 重做底板：调用方负责 invalidate(clean) 后重跑 */
  readonly onRedoCleanPlate: () => void;
  /** 回到文本复核：调用方负责作废下游产物（invalidate mask）并切视图 */
  readonly onBackToReview: () => void;
}

export function FinalConfirmPage({
  workspacePath,
  sourceImageUrl,
  cleanPlateUrl,
  blocks,
  imageSize,
  busy,
  submitting,
  gateSource,
  onComplete,
  onRedoCleanPlate,
  onBackToReview,
}: FinalConfirmPageProps): React.JSX.Element {
  const [viewMode, setViewMode] = useState<FinalViewMode>("preview");
  const [note, setNote] = useState("");
  const [checks, setChecks] = useState<FinalChecks | null>(null);
  const [checksLoading, setChecksLoading] = useState(true);
  const [checksError, setChecksError] = useState<string | null>(null);
  /** 打开 PPTX 的失败原因；main 返回 opened:false 时必须让人看见，不能静默 */
  const [openMessage, setOpenMessage] = useState<string | null>(null);

  const canPreview = cleanPlateUrl !== null && imageSize !== null;
  const canCompare = sourceImageUrl !== null && cleanPlateUrl !== null;
  const actionsDisabled = busy || submitting;

  /**
   * 检查结果按 workspacePath 重新加载。cancelled 标志覆盖两种情形：组件卸载，
   * 以及加载途中切页——后者若不丢弃结果，上一页的检查会写进新页的界面。
   */
  useEffect(() => {
    let cancelled = false;
    setChecksLoading(true);
    setChecksError(null);
    void (async (): Promise<void> => {
      try {
        const result = await window.api.slide.loadFinalChecks(workspacePath);
        if (cancelled) return;
        setChecks(result);
      } catch (err) {
        if (cancelled) return;
        setChecks(null);
        setChecksError(
          `自动检查结果读取失败：${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        if (!cancelled) setChecksLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [workspacePath]);

  // 可用性随产物变化：底板还没产出时不要停在一个空的档位上
  useEffect(() => {
    if (viewMode === "preview" && !canPreview && canCompare) {
      setViewMode("compare");
    } else if (viewMode === "compare" && !canCompare && canPreview) {
      setViewMode("preview");
    }
  }, [viewMode, canPreview, canCompare]);

  const handleOpenPptx = useCallback((): void => {
    setOpenMessage(null);
    void (async (): Promise<void> => {
      try {
        const result = await window.api.slide.openPptx(workspacePath);
        if (!result.opened) setOpenMessage(result.message);
      } catch (err) {
        setOpenMessage(
          `打开 PPTX 失败：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  }, [workspacePath]);

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-strong">
        {/* 视图切换。R2.6 的保真差异提示写在 CompositePreview 内部（只在预览档成立），
            这里不重复第二遍 */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-canvas px-6 py-3">
          <div className="flex shrink-0 items-center gap-1 rounded-lg bg-surface-soft p-1">
            {(["preview", "compare"] as const).map((mode) => {
              const available = mode === "preview" ? canPreview : canCompare;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={!available}
                  onClick={() => setViewMode(mode)}
                  title={available ? undefined : "缺少所需产物"}
                  className={cn(
                    "rounded-md px-4 py-1.5 text-sm font-medium transition disabled:opacity-40",
                    viewMode === mode
                      ? "bg-canvas text-ink"
                      : "bg-transparent text-muted",
                  )}
                >
                  {VIEW_LABELS[mode]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
          {viewMode === "preview" ? (
            canPreview ? (
              <div className="w-full max-w-5xl overflow-hidden rounded-md">
                <CompositePreview
                  cleanPlateUrl={cleanPlateUrl}
                  blocks={blocks}
                  imageWidth={imageSize.width}
                  imageHeight={imageSize.height}
                />
              </div>
            ) : (
              <p className="max-w-md text-center text-sm font-medium text-muted">
                {cleanPlateUrl === null
                  ? "缺少去字底板，无法合成预览；请用「重做底板」重跑 clean 阶段"
                  : "缺少页面尺寸信息，无法合成预览；请确认该页复核产物完整"}
              </p>
            )
          ) : canCompare ? (
            <div className="w-full max-w-5xl overflow-hidden rounded-md">
              <SliderCompare
                sourceImageUrl={sourceImageUrl}
                cleanPlateUrl={cleanPlateUrl}
              />
            </div>
          ) : (
            <p className="max-w-md text-center text-sm font-medium text-muted">
              缺少原图或去字底板，无法对比；请用「重做底板」重跑 clean 阶段
            </p>
          )}
        </div>
      </div>

      <aside className="flex w-96 shrink-0 flex-col gap-6 overflow-y-auto border-l border-hairline bg-surface-soft p-8">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-ink">确认最终产物</h2>
          <p className="text-sm leading-relaxed text-body">
            核对合成预览与去字底板；确认后一次写入干净底图与 PPTX
            两条验收记录，该页即完成。不满意时用下方两个动作退回相应环节重做。
          </p>
          {gateSource === "durable" && (
            <p className="text-sm font-medium text-muted">
              该页在此前的执行中已停在最终确认，状态由工作区恢复
            </p>
          )}
        </div>

        {/* 自动检查只呈现不拦截（R2.5）：clean 的指标当前没有判定阈值（F-4），
            用它做硬门禁会把人拦在一个自己都不可信的数字后面 */}
        {checksError !== null ? (
          <p className="rounded-sm bg-signature-coral/10 px-4 py-2 text-sm font-medium text-signature-coral">
            {checksError}
          </p>
        ) : (
          <CheckSummary
            pptx={checks?.pptx ?? null}
            clean={checks?.clean ?? null}
            loading={checksLoading}
          />
        )}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleOpenPptx}
            className={BUTTON_SECONDARY}
          >
            在 PowerPoint 中打开
          </button>
          {openMessage !== null && (
            <p className="rounded-sm bg-signature-coral/10 px-4 py-2 text-sm font-medium text-signature-coral">
              {openMessage}
            </p>
          )}
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted">备注（可选）</span>
          <textarea
            rows={3}
            value={note}
            disabled={actionsDisabled}
            onChange={(event) => setNote(event.target.value)}
            placeholder="记录验收判断依据，会随两条验收记录写入 manifest"
            className="w-full rounded-sm border border-hairline bg-canvas px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-info-border focus:outline-none disabled:opacity-40"
          />
        </label>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => onComplete(note)}
            disabled={actionsDisabled}
            className={BUTTON_PRIMARY}
          >
            {submitting ? "提交中…" : "完成"}
          </button>

          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">
              不满意？退回重做
            </span>
            <button
              type="button"
              onClick={onRedoCleanPlate}
              disabled={actionsDisabled}
              title="作废当前底板并重新生成，会再次调用付费接口"
              className={BUTTON_SECONDARY}
            >
              重做底板
            </button>
            <button
              type="button"
              onClick={onBackToReview}
              disabled={actionsDisabled}
              title="作废文本复核之后的全部产物，回到复核界面"
              className={BUTTON_SECONDARY}
            >
              回到文本复核
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}

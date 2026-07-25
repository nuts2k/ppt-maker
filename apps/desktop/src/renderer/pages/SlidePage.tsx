import type { TextReviewBlock } from "@ppt-maker/core";
import { isRunStage } from "@shared/stages";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ReviewCanvas } from "@/components/canvas/ReviewCanvas";
import { SliderCompare } from "@/components/compare/SliderCompare";
import { AcceptPanel } from "@/components/pipeline/AcceptPanel";
import { StageProgress } from "@/components/pipeline/StageProgress";
import { ConfidenceQueue } from "@/components/sidebar/ConfidenceQueue";
import { PropertyPanel } from "@/components/sidebar/PropertyPanel";
import { SourceList } from "@/components/sidebar/SourceList";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/deck-store";
import { useRunStore } from "@/stores/run-store";
import { useSlideStore } from "@/stores/slide-store";
import { useUIStore } from "@/stores/ui-store";

type SidebarTab = "properties" | "sources" | "queue" | "pipeline";

/** 人工闸门对应的验收阶段 */
const ACCEPT_STAGES = ["accept-clean", "accept-pptx"] as const;
type AcceptStage = (typeof ACCEPT_STAGES)[number];

function isAcceptStage(value: string | null): value is AcceptStage {
  return value !== null && (ACCEPT_STAGES as readonly string[]).includes(value);
}

export function SlidePage(): React.JSX.Element {
  const selectedSlideId = useUIStore((s) => s.selectedSlideId);
  const selectedBlockId = useUIStore((s) => s.selectedBlockId);
  const selectBlock = useUIStore((s) => s.selectBlock);
  const backToConsole = useUIStore((s) => s.backToConsole);
  const slides = useDeckStore((s) => s.slides);
  const deckPath = useDeckStore((s) => s.deckPath);
  const refreshSlide = useDeckStore((s) => s.refreshSlide);

  const slide = slides.find((s) => s.slideId === selectedSlideId);
  // SlideDetail 已提供绝对路径，renderer 不再与 deckPath 拼接
  const workspacePath = slide?.absWorkspacePath ?? null;

  const loadSlide = useSlideStore((s) => s.loadSlide);
  const saveReview = useSlideStore((s) => s.saveReview);
  const updateBlock = useSlideStore((s) => s.updateBlock);
  const reset = useSlideStore((s) => s.reset);
  const reviewDocument = useSlideStore((s) => s.reviewDocument);
  const sourceImageUrl = useSlideStore((s) => s.sourceImageUrl);
  const cleanPlateUrl = useSlideStore((s) => s.cleanPlateUrl);
  const dirty = useSlideStore((s) => s.dirty);
  const loading = useSlideStore((s) => s.loading);

  const runStatus = useRunStore((s) => s.status);
  const liveStages = useRunStore((s) => s.liveStages);
  const sessionResults = useRunStore((s) => s.sessionResults);
  const startError = useRunStore((s) => s.startError);
  const runSlide = useRunStore((s) => s.runSlide);
  const clearSessionResult = useRunStore((s) => s.clearSessionResult);

  const pipelineRunning = runStatus !== "idle";
  const slideId = slide?.slideId ?? null;

  // 阶段展示 = 耐久层（manifest）叠加本次 run 的实时状态
  const stageStatuses = useMemo<Record<string, string>>(() => {
    const merged: Record<string, string> = {};
    for (const detail of slide?.stages ?? []) {
      merged[detail.stage] = detail.status;
    }
    const live = slideId === null ? undefined : liveStages[slideId];
    for (const [stage, status] of Object.entries(live ?? {})) {
      merged[stage] = status;
    }
    return merged;
  }, [slide, liveStages, slideId]);

  const sessionResult = slideId === null ? undefined : sessionResults[slideId];
  const pendingGate =
    sessionResult?.gate === "manual" && isAcceptStage(sessionResult.stoppedAt)
      ? sessionResult.stoppedAt
      : null;
  const pipelineError =
    sessionResult?.error ??
    (startError === null
      ? null
      : { code: "RUN_START_REJECTED", message: startError });

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("properties");
  const [compareMode, setCompareMode] = useState(false);
  const [saveResult, setSaveResult] = useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  useEffect(() => {
    if (workspacePath === null) return;
    void loadSlide(workspacePath);
    return () => reset();
  }, [workspacePath, loadSlide, reset]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty) void handleSave();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dirty, saveReview]);

  const blocks = reviewDocument?.blocks ?? [];
  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null;

  const handleBlockUpdate = useCallback(
    (blockId: string, patch: Partial<TextReviewBlock>) => {
      updateBlock(blockId, patch);
    },
    [updateBlock],
  );

  async function handleSave(): Promise<void> {
    try {
      const result = await saveReview();
      setSaveResult({
        ok: result.valid,
        message: result.valid
          ? "保存成功"
          : `保存完成，${result.errors} 个错误 / ${result.warnings} 个警告`,
      });
      setTimeout(() => setSaveResult(null), 3000);
    } catch (err) {
      setSaveResult({
        ok: false,
        message: `保存失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // 执行统一交给 DeckRunner（单页也走同一队列），进度由 run-store 的事件驱动
  const handleRunPipeline = useCallback(
    (from: string) => {
      if (deckPath === null || slideId === null || !isRunStage(from)) return;
      void runSlide(deckPath, slideId, from, {
        confirmApi: true,
        confirmUpload: true,
      });
      setSidebarTab("pipeline");
    },
    [deckPath, slideId, runSlide],
  );

  const handleAccept = useCallback(
    async (note: string) => {
      if (!workspacePath || !pendingGate || slideId === null) return;
      const api = window.api;
      if (pendingGate === "accept-clean") {
        await api.slide.acceptClean(workspacePath, { note });
      } else {
        await api.slide.acceptPptx(workspacePath, { note });
      }
      clearSessionResult(slideId);
      void refreshSlide(slideId);
    },
    [workspacePath, pendingGate, slideId, clearSessionResult, refreshSlide],
  );

  const handleReject = useCallback(() => {
    if (slideId !== null) clearSessionResult(slideId);
  }, [slideId, clearSessionResult]);

  if (workspacePath === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        未选中任何页面
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-hairline bg-canvas px-4">
        <button
          type="button"
          className="rounded-sm border border-hairline px-2.5 py-1 text-xs text-body transition active:border-border-strong"
          onClick={backToConsole}
        >
          ← 返回
        </button>
        <span className="text-sm font-medium text-ink">
          {slide?.pageLabel ?? selectedSlideId}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {sourceImageUrl && cleanPlateUrl && (
            <button
              type="button"
              className={cn(
                "rounded-sm border px-2 py-1 text-xs transition",
                compareMode
                  ? "border-info-border bg-info/10 text-info"
                  : "border-hairline text-body",
              )}
              onClick={() => setCompareMode(!compareMode)}
            >
              对比
            </button>
          )}

          <select
            className="rounded-sm border border-hairline bg-canvas px-2 py-1 text-xs text-ink"
            disabled={pipelineRunning}
            value=""
            onChange={(e) => {
              if (e.target.value) handleRunPipeline(e.target.value);
            }}
          >
            <option value="" disabled>
              {pipelineRunning ? "Pipeline 执行中…" : "运行 Pipeline…"}
            </option>
            <option value="ocr">从 OCR 开始</option>
            <option value="review">从候选合并开始</option>
            <option value="assist-review">从 AI 复核开始</option>
            <option value="validate-review">从校验开始</option>
            <option value="mask">从 Mask 开始</option>
            <option value="clean">从 Clean 开始</option>
            <option value="pptx">从 PPTX 开始</option>
          </select>

          {dirty && <span className="text-xs text-warning">未保存</span>}
          {saveResult && (
            <span
              className={cn(
                "text-xs",
                saveResult.ok ? "text-success" : "text-error",
              )}
            >
              {saveResult.message}
            </span>
          )}
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={!dirty}
            className="rounded-lg bg-primary px-3 py-1 text-sm text-on-primary transition active:bg-primary-active disabled:opacity-40"
          >
            保存
            <span className="ml-1 text-xs text-on-primary/60">⌘S</span>
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 画布区域 */}
        <main className="relative min-w-0 flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              加载中…
            </div>
          ) : compareMode && sourceImageUrl && cleanPlateUrl ? (
            <SliderCompare
              sourceImageUrl={sourceImageUrl}
              cleanPlateUrl={cleanPlateUrl}
            />
          ) : sourceImageUrl ? (
            <ReviewCanvas
              imageUrl={sourceImageUrl}
              blocks={blocks}
              selectedBlockId={selectedBlockId}
              onSelectBlock={selectBlock}
              onUpdateBlock={handleBlockUpdate}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted">
              暂无源图
            </div>
          )}

          {pendingGate && (
            <div className="absolute bottom-4 left-4 right-4 z-20">
              <AcceptPanel
                gate={pendingGate}
                onAccept={(note) => void handleAccept(note)}
                onReject={handleReject}
              />
            </div>
          )}
        </main>

        {/* 侧边栏 */}
        <aside className="flex w-80 shrink-0 flex-col border-l border-hairline bg-surface-soft">
          <div className="flex shrink-0 border-b border-hairline">
            {(
              [
                ["properties", "属性"],
                ["sources", "来源"],
                ["queue", "队列"],
                ["pipeline", "Pipeline"],
              ] as const
            ).map(([tab, label]) => (
              <button
                key={tab}
                type="button"
                className={cn(
                  "flex-1 py-2 text-xs transition-colors",
                  sidebarTab === tab
                    ? "border-b-2 border-primary font-medium text-ink"
                    : "text-muted",
                )}
                onClick={() => setSidebarTab(tab)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 overflow-y-auto">
            {sidebarTab === "properties" && (
              <PropertyPanel
                block={selectedBlock}
                onUpdate={handleBlockUpdate}
              />
            )}
            {sidebarTab === "sources" && <SourceList block={selectedBlock} />}
            {sidebarTab === "queue" && (
              <ConfidenceQueue
                blocks={blocks}
                selectedBlockId={selectedBlockId}
                onSelect={selectBlock}
              />
            )}
            {sidebarTab === "pipeline" && (
              <div>
                <StageProgress
                  stageStatuses={stageStatuses}
                  running={pipelineRunning}
                />
                {pipelineError && (
                  <div className="mx-4 rounded-sm bg-error-light p-2 text-xs text-error">
                    {pipelineError.code}: {pipelineError.message}
                  </div>
                )}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

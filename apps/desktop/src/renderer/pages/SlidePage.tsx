import type { TextReviewBlock } from "@ppt-maker/core";
import { useCallback, useEffect, useState } from "react";
import { ReviewCanvas } from "@/components/canvas/ReviewCanvas";
import { SliderCompare } from "@/components/compare/SliderCompare";
import { AcceptPanel } from "@/components/pipeline/AcceptPanel";
import { StageProgress } from "@/components/pipeline/StageProgress";
import { ConfidenceQueue } from "@/components/sidebar/ConfidenceQueue";
import { PropertyPanel } from "@/components/sidebar/PropertyPanel";
import { SourceList } from "@/components/sidebar/SourceList";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/deck-store";
import { usePipelineStore } from "@/stores/pipeline-store";
import { useSlideStore } from "@/stores/slide-store";
import { useUIStore } from "@/stores/ui-store";

type SidebarTab = "properties" | "sources" | "queue" | "pipeline";

export function SlidePage(): React.JSX.Element {
  const selectedSlideId = useUIStore((s) => s.selectedSlideId);
  const selectedBlockId = useUIStore((s) => s.selectedBlockId);
  const selectBlock = useUIStore((s) => s.selectBlock);
  const setView = useUIStore((s) => s.setView);
  const slides = useDeckStore((s) => s.slides);
  const deckPath = useDeckStore((s) => s.deckPath);
  const refreshStatus = useDeckStore((s) => s.refreshStatus);

  const slide = slides.find((s) => s.slideId === selectedSlideId);
  const workspacePath = slide
    ? deckPath
      ? `${deckPath}/${slide.workspacePath}`
      : slide.workspacePath
    : null;

  const loadSlide = useSlideStore((s) => s.loadSlide);
  const saveReview = useSlideStore((s) => s.saveReview);
  const updateBlock = useSlideStore((s) => s.updateBlock);
  const reset = useSlideStore((s) => s.reset);
  const reviewDocument = useSlideStore((s) => s.reviewDocument);
  const sourceImageUrl = useSlideStore((s) => s.sourceImageUrl);
  const cleanPlateUrl = useSlideStore((s) => s.cleanPlateUrl);
  const dirty = useSlideStore((s) => s.dirty);
  const loading = useSlideStore((s) => s.loading);

  const pipelineRunning = usePipelineStore((s) => s.running);
  const stageStatuses = usePipelineStore((s) => s.stageStatuses);
  const pendingGate = usePipelineStore((s) => s.pendingGate);
  const pipelineError = usePipelineStore((s) => s.error);
  const startPipeline = usePipelineStore((s) => s.startPipeline);
  const acceptGate = usePipelineStore((s) => s.acceptGate);

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("properties");
  const [compareMode, setCompareMode] = useState(false);

  useEffect(() => {
    if (workspacePath === null) return;
    void loadSlide(workspacePath);
    return () => reset();
  }, [workspacePath, loadSlide, reset]);

  // Cmd+S 保存快捷键
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (dirty) void saveReview();
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

  const handleRunPipeline = useCallback(
    (from: string) => {
      if (!workspacePath) return;
      void startPipeline(workspacePath, from, {
        confirmApi: true,
        confirmUpload: true,
      });
    },
    [workspacePath, startPipeline],
  );

  const handleAccept = useCallback(
    async (note: string) => {
      if (!workspacePath || !pendingGate) return;
      const api = window.api;
      if (pendingGate === "accept-clean") {
        await api.slide.acceptClean(workspacePath, { note });
      } else {
        await api.slide.acceptPptx(workspacePath, { note });
      }
      acceptGate();
      void refreshStatus();
    },
    [workspacePath, pendingGate, acceptGate, refreshStatus],
  );

  const handleReject = useCallback(() => {
    acceptGate();
  }, [acceptGate]);

  if (workspacePath === null) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted">
        未选中任何页面
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* 页内工具栏 */}
      <div className="flex h-10 shrink-0 items-center gap-3 border-b border-hairline bg-canvas px-4">
        <button
          type="button"
          className="text-sm text-body hover:text-ink"
          onClick={() => setView("deck")}
        >
          ← 返回
        </button>
        <span className="text-sm font-medium text-ink">
          {slide?.workspacePath.split("/").pop() ?? selectedSlideId}
        </span>

        <div className="ml-auto flex items-center gap-2">
          {sourceImageUrl && cleanPlateUrl && (
            <button
              type="button"
              className={cn(
                "rounded-sm border px-2 py-1 text-xs",
                compareMode
                  ? "border-info-border bg-surface-soft"
                  : "border-hairline",
              )}
              onClick={() => setCompareMode(!compareMode)}
            >
              对比
            </button>
          )}

          {/* Pipeline 触发 */}
          <select
            className="rounded-sm border border-hairline bg-canvas px-2 py-1 text-xs text-ink"
            disabled={pipelineRunning}
            value=""
            onChange={(e) => {
              if (e.target.value) handleRunPipeline(e.target.value);
            }}
          >
            <option value="" disabled>
              运行 Pipeline…
            </option>
            <option value="init">从 init 开始</option>
            <option value="ocr">从 OCR 开始</option>
            <option value="review">从 review 开始</option>
            <option value="mask">从 mask 开始</option>
            <option value="clean">从 clean 开始</option>
            <option value="pptx">从 PPTX 开始</option>
          </select>

          {dirty && (
            <span className="text-xs text-block-uncertain">未保存</span>
          )}
          <button
            type="button"
            onClick={() => void saveReview()}
            disabled={!dirty}
            className="rounded-lg bg-primary px-3 py-1 text-sm text-on-primary disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 画布区域 */}
        <main className="min-w-0 flex-1">
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

          {/* 验收面板 */}
          {pendingGate && (
            <div className="absolute bottom-4 left-4 right-84 z-20">
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
                    ? "border-b-2 border-info font-medium text-ink"
                    : "text-muted hover:text-body",
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
                  <div className="mx-4 rounded-sm bg-red-50 p-2 text-xs text-red-600">
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

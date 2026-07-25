import type { TextReviewBlock } from "@ppt-maker/core";
import type { RunStage } from "@shared/stages";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ReviewCanvas } from "@/components/canvas/ReviewCanvas";
import { SliderCompare } from "@/components/compare/SliderCompare";
import { ConfidenceQueue } from "@/components/sidebar/ConfidenceQueue";
import { PropertyPanel } from "@/components/sidebar/PropertyPanel";
import { SourceList } from "@/components/sidebar/SourceList";
import { AcceptFlow } from "@/components/slide/AcceptFlow";
import {
  SlideToolbar,
  type SlideViewMode,
} from "@/components/slide/SlideToolbar";
import { StageRail } from "@/components/slide/StageRail";
import { deriveAcceptGate } from "@/lib/accept-gate";
import { countUnreviewed } from "@/lib/review-status";
import { adjacentSlides } from "@/lib/slide-nav";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/deck-store";
import { useRunStore } from "@/stores/run-store";
import { useSlideStore } from "@/stores/slide-store";
import { deriveTodoQueue, nextTodoItem } from "@/stores/todo-queue";
import { useUIStore } from "@/stores/ui-store";

/**
 * 单页复核（design.md 3.3 SlidePage）—— 壳层重写，画布内核（ReviewCanvas /
 * TextBlockOverlay / TextEditor / SliderCompare / useCanvasTransform）行为不变。
 *
 * 三个视图态共用同一壳层：`canvas`（编辑文字块）、`compare`（滑块擦除对比）、
 * `accept`（人工验收布局）。验收闸门由 `deriveAcceptGate` 从**耐久层 + 会话层**推导——
 * 这是待办队列"点一次到达能完成该操作的界面"的前提：V1 只认会话层，应用重启后
 * 队列里的待验收项点进来是一片画布，无从验收。
 *
 * 本页只订阅非计时字段，耗时展示下沉到 SlideToolbar / StageRail 各自订阅 1s ticker，
 * 否则画布会跟着每秒重渲染。
 */

type SidebarTab = "properties" | "sources" | "queue";

const SIDEBAR_TABS: ReadonlyArray<readonly [SidebarTab, string]> = [
  ["properties", "属性"],
  ["sources", "来源"],
  ["queue", "低置信度"],
];

export function SlidePage(): React.JSX.Element {
  const selectedSlideId = useUIStore((s) => s.selectedSlideId);
  const selectedBlockId = useUIStore((s) => s.selectedBlockId);
  const selectBlock = useUIStore((s) => s.selectBlock);
  const openSlide = useUIStore((s) => s.openSlide);
  const backToConsole = useUIStore((s) => s.backToConsole);

  const slides = useDeckStore((s) => s.slides);
  const deckPath = useDeckStore((s) => s.deckPath);
  const refreshSlide = useDeckStore((s) => s.refreshSlide);

  const loadSlide = useSlideStore((s) => s.loadSlide);
  const saveReview = useSlideStore((s) => s.saveReview);
  const updateBlock = useSlideStore((s) => s.updateBlock);
  const markAllReviewed = useSlideStore((s) => s.markAllReviewed);
  const reset = useSlideStore((s) => s.reset);
  const reviewDocument = useSlideStore((s) => s.reviewDocument);
  const sourceImageUrl = useSlideStore((s) => s.sourceImageUrl);
  const cleanPlateUrl = useSlideStore((s) => s.cleanPlateUrl);
  const dirty = useSlideStore((s) => s.dirty);
  const loading = useSlideStore((s) => s.loading);

  // 只取非计时字段：tick 的订阅在 SlideToolbar / StageRail 内部
  const runStatus = useRunStore((s) => s.status);
  const currentSlideId = useRunStore((s) => s.currentSlideId);
  const sessionResults = useRunStore((s) => s.sessionResults);
  const startError = useRunStore((s) => s.startError);
  const runSlide = useRunStore((s) => s.runSlide);
  const clearSessionResult = useRunStore((s) => s.clearSessionResult);

  const slide = useMemo(
    () => slides.find((entry) => entry.slideId === selectedSlideId) ?? null,
    [slides, selectedSlideId],
  );
  const slideId = slide?.slideId ?? null;
  // SlideDetail 已提供绝对路径，renderer 不再与 deckPath 拼接
  const workspacePath = slide?.absWorkspacePath ?? null;

  const sessionResult = slideId === null ? undefined : sessionResults[slideId];
  const acceptGate = useMemo(
    () => (slide === null ? null : deriveAcceptGate(slide, sessionResult)),
    [slide, sessionResult],
  );

  const navigation = useMemo(
    () => adjacentSlides(slides, slideId),
    [slides, slideId],
  );

  // 待办队列在本页只用于「处理下一项」；派生放组件内（selector 返回新对象会引发重渲染循环）
  const nextTodo = useMemo(
    () => nextTodoItem(deriveTodoQueue(slides, sessionResults), slideId),
    [slides, sessionResults, slideId],
  );

  const [viewMode, setViewMode] = useState<SlideViewMode>("canvas");
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("properties");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{
    readonly ok: boolean;
    readonly message: string;
  } | null>(null);

  const canCompare = sourceImageUrl !== null && cleanPlateUrl !== null;
  // 本页正在执行：禁用执行类动作，避免同一页被重复入队跑两遍
  const pageBusy = runStatus !== "idle" && currentSlideId === slideId;

  useEffect(() => {
    if (workspacePath === null) return;
    void loadSlide(workspacePath);
    return () => reset();
  }, [workspacePath, loadSlide, reset]);

  /**
   * 闸门变化时切换视图态。签名含 source，因此"拒绝重跑 → 再次停在同一闸门"也会
   * 重新进入验收布局；用户手动切回画布后签名不变，不会被强行拉回。
   */
  const gateSignature =
    acceptGate === null || slideId === null
      ? null
      : `${slideId}:${acceptGate.stage}:${acceptGate.source}`;
  useEffect(() => {
    if (gateSignature === null) {
      // 闸门消失（已验收或产物失效）：验收布局已无意义，退回画布
      setViewMode((mode) => (mode === "accept" ? "canvas" : mode));
      return;
    }
    setViewMode("accept");
  }, [gateSignature]);

  const blocks = reviewDocument?.blocks ?? [];
  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null;
  const unreviewedCount = countUnreviewed(blocks);

  const handleBlockUpdate = useCallback(
    (blockId: string, patch: Partial<TextReviewBlock>) => {
      updateBlock(blockId, patch);
    },
    [updateBlock],
  );

  const handleSave = useCallback(async (): Promise<void> => {
    try {
      const result = await saveReview();
      setNotice({
        ok: result.valid,
        message: result.valid
          ? "保存成功"
          : `保存完成，但校验有 ${result.errors} 个错误 / ${result.warnings} 个警告`,
      });
    } catch (err) {
      setNotice({
        ok: false,
        message: `保存失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, [saveReview]);

  // handleSave 进依赖，避免 V1 里 Cmd+S 捕获过期闭包（阶段 B 遗留的 lint 报错）
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key === "s") {
        event.preventDefault();
        if (dirty) void handleSave();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [dirty, handleSave]);

  /** 执行统一交给 DeckRunner（单页也走同一串行队列），进度由 run-store 事件驱动 */
  const startRun = useCallback(
    (from?: RunStage) => {
      if (deckPath === null || slideId === null) return;
      setNotice(null);
      void runSlide(deckPath, slideId, from, {
        confirmApi: true,
        confirmUpload: true,
      });
    },
    [deckPath, slideId, runSlide],
  );

  const handleAccept = useCallback(
    async (note: string): Promise<void> => {
      if (workspacePath === null || acceptGate === null || slideId === null) {
        return;
      }
      setSubmitting(true);
      try {
        const api = window.api;
        const result =
          acceptGate.stage === "accept-clean"
            ? await api.slide.acceptClean(workspacePath, { note })
            : await api.slide.acceptPptx(workspacePath, { note });
        // 先清会话层闸门再刷耐久层，否则 deriveAcceptGate 仍会命中已完成的闸门
        clearSessionResult(slideId);
        await refreshSlide(slideId);
        setNotice({
          ok: true,
          message: `验收完成 · ${result.autoCheckSummary}`,
        });
      } catch (err) {
        setNotice({
          ok: false,
          message: `验收失败：${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        setSubmitting(false);
      }
    },
    [workspacePath, acceptGate, slideId, clearSessionResult, refreshSlide],
  );

  /** 拒绝验收 = 从产出该产物的阶段重跑；会话层闸门先清掉，验收布局立即退出 */
  const handleRejectRerun = useCallback(
    (stage: RunStage) => {
      if (slideId === null) return;
      clearSessionResult(slideId);
      setViewMode("canvas");
      startRun(stage);
    },
    [slideId, clearSessionResult, startRun],
  );

  const handleNextTodo = useCallback(() => {
    if (nextTodo === null) return;
    openSlide(nextTodo.slideId);
  }, [nextTodo, openSlide]);

  if (slide === null || workspacePath === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <p className="text-sm font-medium text-muted">
          未选中任何页面，或该页已被移除
        </p>
        <button
          type="button"
          onClick={backToConsole}
          className="rounded-lg border border-hairline bg-canvas px-4 py-2 text-sm text-ink transition active:border-border-strong"
        >
          返回控制台
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <SlideToolbar
        slideId={slide.slideId}
        pageLabel={slide.pageLabel}
        navigation={navigation}
        viewMode={viewMode}
        canCompare={canCompare}
        hasAcceptGate={acceptGate !== null}
        dirty={dirty}
        unreviewedCount={unreviewedCount}
        pageBusy={pageBusy}
        nextTodo={
          nextTodo === null
            ? null
            : { pageLabel: nextTodo.pageLabel, reason: nextTodo.reason }
        }
        onBack={backToConsole}
        onNavigate={openSlide}
        onViewModeChange={setViewMode}
        onSave={() => void handleSave()}
        onMarkAllReviewed={() => markAllReviewed()}
        onRunSlide={() => startRun()}
        onRerunFrom={(stage) => startRun(stage)}
        onNextTodo={handleNextTodo}
      />

      <StageRail
        slide={slide}
        disabled={pageBusy}
        onRerunFrom={(stage) => startRun(stage)}
        sessionError={sessionResult?.error ?? null}
      />

      {(notice !== null || startError !== null) && (
        <div className="flex shrink-0 flex-col gap-1 px-6 pt-3">
          {notice !== null && (
            <p
              className={cn(
                "flex items-center gap-3 rounded-sm px-4 py-2 text-sm font-medium",
                notice.ok
                  ? "bg-success/10 text-success"
                  : "bg-signature-coral/10 text-signature-coral",
              )}
            >
              <span className="min-w-0 flex-1" title={notice.message}>
                {notice.message}
              </span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="shrink-0 rounded-xs px-2 py-0.5 transition active:bg-surface-strong"
              >
                关闭
              </button>
            </p>
          )}
          {startError !== null && (
            <p className="rounded-sm bg-signature-coral/10 px-4 py-2 text-sm font-medium text-signature-coral">
              {startError}
            </p>
          )}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="relative min-w-0 flex-1">
          {loading ? (
            <p className="flex h-full items-center justify-center text-sm font-medium text-muted">
              加载中…
            </p>
          ) : viewMode === "accept" && acceptGate !== null ? (
            <AcceptFlow
              gate={acceptGate}
              sourceImageUrl={sourceImageUrl}
              cleanPlateUrl={cleanPlateUrl}
              submitting={submitting}
              disabled={pageBusy}
              onAccept={(note) => void handleAccept(note)}
              onRejectRerun={handleRejectRerun}
            />
          ) : viewMode === "compare" &&
            sourceImageUrl !== null &&
            cleanPlateUrl !== null ? (
            <div className="flex h-full items-center justify-center overflow-auto bg-surface-strong p-6">
              <div className="w-full max-w-5xl overflow-hidden rounded-md">
                <SliderCompare
                  sourceImageUrl={sourceImageUrl}
                  cleanPlateUrl={cleanPlateUrl}
                />
              </div>
            </div>
          ) : sourceImageUrl !== null ? (
            <ReviewCanvas
              imageUrl={sourceImageUrl}
              blocks={blocks}
              selectedBlockId={selectedBlockId}
              onSelectBlock={selectBlock}
              onUpdateBlock={handleBlockUpdate}
            />
          ) : (
            <p className="flex h-full items-center justify-center text-sm font-medium text-muted">
              暂无源图，请先执行「文字识别」阶段
            </p>
          )}
        </main>

        {/* 验收布局自带右栏清单，此时隐藏复核侧边栏以免出现双侧栏 */}
        {viewMode !== "accept" && (
          <aside className="flex w-80 shrink-0 flex-col border-l border-hairline bg-surface-soft">
            <div className="flex shrink-0 border-b border-hairline">
              {SIDEBAR_TABS.map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  className={cn(
                    "flex-1 py-3 text-sm transition",
                    sidebarTab === tab
                      ? "border-b-2 border-primary font-medium text-ink"
                      : "text-muted active:bg-surface-strong",
                  )}
                  onClick={() => setSidebarTab(tab)}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
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
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

import type { TextReviewBlock } from "@ppt-maker/core";
import type { RunStage } from "@shared/stages";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReviewCanvas } from "@/components/canvas/ReviewCanvas";
import { SliderCompare } from "@/components/compare/SliderCompare";
import { BlockListPanel } from "@/components/review/BlockListPanel";
import { ReviewShortcutBar } from "@/components/review/ReviewShortcutBar";
import { AcceptFlow } from "@/components/slide/AcceptFlow";
import {
  SlideToolbar,
  type SlideViewMode,
} from "@/components/slide/SlideToolbar";
import { StageRail } from "@/components/slide/StageRail";
import { deriveAcceptGate } from "@/lib/accept-gate";
import { orderedReviewBlocks } from "@/lib/review-partition";
import { countUnreviewed } from "@/lib/review-status";
import { adjacentSlides } from "@/lib/slide-nav";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/deck-store";
import { useRunStore } from "@/stores/run-store";
import { useSlideStore } from "@/stores/slide-store";
import { deriveTodoQueue, nextTodoItem } from "@/stores/todo-queue";
import { useUIStore } from "@/stores/ui-store";

/**
 * 文本复核页（原 SlidePage，阶段 C 重构为列表主导）。
 *
 * 主次关系相对 V1 反转：左侧 BlockListPanel 是主操作面（三分区 + 双源 diff +
 * 就地编辑 + 键盘流），画布降级为只读定位标注层。V1 的「画布编辑 + 320px 三标签
 * 侧栏」被整体取代——PRD F-6 实测该结构零使用：8 个拖拽手柄、旋转、低置信度
 * 队列全部未被触发，真实行为是「打开 → 全部标记已复核 → 跑下去」。
 *
 * compare / accept 两个视图态在本阶段原样保留：最终确认页（FinalConfirmPage）
 * 属阶段 D，在它落地前 AcceptFlow 仍是唯一的验收路径，此处不能提前拆掉。
 *
 * 本页只订阅非计时字段，耗时展示下沉到 SlideToolbar / StageRail 各自订阅 1s
 * ticker，否则画布会跟着每秒重渲染。
 */
export function ReviewPage(): React.JSX.Element {
  const selectedSlideId = useUIStore((s) => s.selectedSlideId);
  const selectedBlockId = useUIStore((s) => s.selectedBlockId);
  const selectBlock = useUIStore((s) => s.selectBlock);
  const openSlide = useUIStore((s) => s.openSlide);
  const backToConsole = useUIStore((s) => s.backToConsole);

  const slides = useDeckStore((s) => s.slides);
  const deckPath = useDeckStore((s) => s.deckPath);
  const refreshSlide = useDeckStore((s) => s.refreshSlide);

  const loadSlide = useSlideStore((s) => s.loadSlide);
  const reloadImages = useSlideStore((s) => s.reloadImages);
  const saveReview = useSlideStore((s) => s.saveReview);
  const updateBlock = useSlideStore((s) => s.updateBlock);
  const markBlockReviewed = useSlideStore((s) => s.markBlockReviewed);
  const markBlocksReviewed = useSlideStore((s) => s.markBlocksReviewed);
  const deleteBlock = useSlideStore((s) => s.deleteBlock);
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
   * 本页执行结束（pageBusy 由 true 落回 false）时重载产物图。
   *
   * 闸门走 run-store 事件、图片走 loadSlide 的一次性快照，两条链路不同步：
   * 进页时 clean 尚未产出，跑完后 workspacePath 未变，加载 effect 不会重跑，
   * 于是 accept-clean 闸门已经就位而底板仍是 null。拒绝验收后重跑 clean
   * 拿到新底板，同样依赖这里刷新。
   */
  const prevPageBusy = useRef(false);
  useEffect(() => {
    if (prevPageBusy.current && !pageBusy) void reloadImages();
    prevPageBusy.current = pageBusy;
  }, [pageBusy, reloadImages]);

  /**
   * 闸门变化时切换视图态。签名含 source，因此"拒绝重跑 → 再次停在同一闸门"也会
   * 重新进入验收布局；用户手动切回复核后签名不变，不会被强行拉回。
   */
  const gateSignature =
    acceptGate === null || slideId === null
      ? null
      : `${slideId}:${acceptGate.stage}:${acceptGate.source}`;
  useEffect(() => {
    if (gateSignature === null) {
      // 闸门消失（已验收或产物失效）：验收布局已无意义，退回复核
      setViewMode((mode) => (mode === "accept" ? "canvas" : mode));
      return;
    }
    setViewMode("accept");
  }, [gateSignature]);

  const blocks = useMemo(
    () => reviewDocument?.blocks ?? [],
    [reviewDocument?.blocks],
  );
  const unreviewedCount = countUnreviewed(blocks);

  /**
   * 键盘流需要一个起点：文档就绪后自动选中三分区展平顺序的第一项。
   *
   * 依赖 slideId 而非 blocks，否则每次编辑写回都会把焦点弹回首项。当前项被删除
   * 后 selectedBlockId 会指向不存在的块，此时同样回落到首项。
   */
  useEffect(() => {
    if (blocks.length === 0) return;
    if (
      selectedBlockId !== null &&
      blocks.some((block) => block.id === selectedBlockId)
    ) {
      return;
    }
    const first = orderedReviewBlocks(blocks)[0];
    selectBlock(first?.id ?? null);
  }, [blocks, selectedBlockId, selectBlock]);

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

  // handleSave 进依赖，避免 V1 里 Cmd+S 捕获过期闭包（阶段 B 遗留的 lint 报错）。
  // 列表内的 Tab/↑↓/Enter/⌥1⌥2 由 BlockListPanel 自行处理，此处只留全局保存。
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

  /**
   * 从指定阶段重跑（阶段轨道徽章、工具栏、拒绝验收三个入口共用）。
   *
   * 必须先把该阶段及下游标为 stale 再启动。显式指定起点表达的是「这一步的产物
   * 不合格，重做」，但此时输入指纹一字未变、阶段仍是 completed，run 会按断点续跑
   * 的幂等规则整段跳过，一路滑到下一个人工闸门原地返回——界面上就是点了毫无反应，
   * 点多少次都一样。失效写盘失败则不启动 run，否则又退化成那个空转。
   *
   * 无参的「运行此页」不走这里：它本就是断点续跑，跳过已完成阶段是正确行为。
   */
  const rerunFrom = useCallback(
    (stage: RunStage) => {
      if (slideId === null || workspacePath === null) return;
      void (async (): Promise<void> => {
        try {
          await window.api.slide.invalidateStage(
            workspacePath,
            stage,
            "人工要求从该阶段重跑",
          );
        } catch (err) {
          setNotice({
            ok: false,
            message: `重跑准备失败：${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }
        clearSessionResult(slideId);
        setViewMode("canvas");
        await refreshSlide(slideId);
        startRun(stage);
      })();
    },
    [slideId, workspacePath, clearSessionResult, refreshSlide, startRun],
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
        onRerunFrom={rerunFrom}
        onNextTodo={handleNextTodo}
      />

      <StageRail
        slide={slide}
        disabled={pageBusy}
        onRerunFrom={rerunFrom}
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

      <div className="flex min-h-0 flex-1 flex-col">
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
            onRejectRerun={rerunFrom}
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
        ) : (
          <>
            {/* 列表在左、画布在右：相对 V1 的「画布 + 320px 侧栏」反转主次关系 */}
            <div className="flex min-h-0 flex-1">
              <div className="w-[480px] shrink-0 border-r border-hairline">
                <BlockListPanel
                  blocks={blocks}
                  currentBlockId={selectedBlockId}
                  onSelectBlock={selectBlock}
                  onUpdateBlock={handleBlockUpdate}
                  onMarkReviewed={markBlockReviewed}
                  onMarkBlocksReviewed={markBlocksReviewed}
                  onDeleteBlock={deleteBlock}
                />
              </div>
              <main className="relative min-w-0 flex-1">
                {sourceImageUrl !== null ? (
                  <ReviewCanvas
                    imageUrl={sourceImageUrl}
                    blocks={blocks}
                    currentBlockId={selectedBlockId}
                    onSelectBlock={selectBlock}
                    onUpdateBlock={handleBlockUpdate}
                  />
                ) : (
                  <p className="flex h-full items-center justify-center text-sm font-medium text-muted">
                    暂无源图，请先执行「文字识别」阶段
                  </p>
                )}
              </main>
            </div>
            <ReviewShortcutBar />
          </>
        )}
      </div>
    </div>
  );
}

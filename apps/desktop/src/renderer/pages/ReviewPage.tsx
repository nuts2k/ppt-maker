import type { TextReviewBlock } from "@ppt-maker/core";
import { type RunStage, stageLabel } from "@shared/stages";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReviewCanvas } from "@/components/canvas/ReviewCanvas";
import { BlockListPanel } from "@/components/review/BlockListPanel";
import { ReviewShortcutBar } from "@/components/review/ReviewShortcutBar";
import {
  SlideToolbar,
  type SlideViewMode,
} from "@/components/slide/SlideToolbar";
import { StageRail } from "@/components/slide/StageRail";
import { deriveFinalGate } from "@/lib/accept-gate";
import { orderedReviewBlocks } from "@/lib/review-partition";
import { countUnreviewed } from "@/lib/review-status";
import { adjacentSlides } from "@/lib/slide-nav";
import { cn } from "@/lib/utils";
import { FinalConfirmPage } from "@/pages/FinalConfirmPage";
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
 * 阶段 D 起本页只剩两个视图态：文本复核（列表 + 画布）与最终确认
 * （FinalConfirmPage）——恰好对应链路仅存的两个人工停点。阶段 C 暂留的
 * compare / accept 两态在此撤除：滑块对比降级为最终确认页内的一档，
 * 验收由 FinalConfirmPage 一次写入 accept-clean + accept-pptx 双记录。
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
  const clearLiveStages = useRunStore((s) => s.clearLiveStages);

  const slide = useMemo(
    () => slides.find((entry) => entry.slideId === selectedSlideId) ?? null,
    [slides, selectedSlideId],
  );
  const slideId = slide?.slideId ?? null;
  // SlideDetail 已提供绝对路径，renderer 不再与 deckPath 拼接
  const workspacePath = slide?.absWorkspacePath ?? null;

  const sessionResult = slideId === null ? undefined : sessionResults[slideId];
  const finalGate = useMemo(
    () => (slide === null ? null : deriveFinalGate(slide, sessionResult)),
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

  const [viewMode, setViewMode] = useState<SlideViewMode>("review");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<{
    readonly ok: boolean;
    readonly message: string;
  } | null>(null);

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
   * 于是最终确认闸门已经就位而底板仍是 null——合成预览会因此空着。
   * 「重做底图」重跑 clean 拿到新底板，同样依赖这里刷新。
   */
  const prevPageBusy = useRef(false);
  useEffect(() => {
    if (prevPageBusy.current && !pageBusy) void reloadImages();
    prevPageBusy.current = pageBusy;
  }, [pageBusy, reloadImages]);

  /**
   * 闸门变化时切换视图态。签名含 source，因此"重做底图 → 再次停在最终确认"也会
   * 重新进入确认页；用户手动切回复核后签名不变，不会被强行拉回。
   */
  const gateSignature =
    finalGate === null || slideId === null
      ? null
      : `${slideId}:${finalGate.source}`;
  useEffect(() => {
    if (gateSignature === null) {
      // 闸门消失（已完成或产物失效）：确认页已无意义，退回文本复核
      setViewMode((mode) => (mode === "final" ? "review" : mode));
      return;
    }
    setViewMode("final");
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
      // 保存改动会作废下游产物（main 侧按粒度判定）。作废信息必须告诉用户，
      // 否则界面只说「保存成功」，用户不知道 PPTX 还是旧的、要再点一次「运行此页」。
      const invalidatedNote =
        result.invalidated.length === 0
          ? ""
          : ` · 已作废${result.invalidated
              .map((stage) => stageLabel(stage))
              .join("、")}，点「运行此页」重新生成`;
      setNotice({
        ok: result.valid,
        message: result.valid
          ? `保存成功${invalidatedNote}`
          : `保存完成，但校验有 ${result.errors} 个错误 / ${result.warnings} 个警告${invalidatedNote}`,
      });
      // 待办队列的「需文本复核」判据 pendingTextReview 由 main 侧读 text-blocks.json
      // 算出，只在 page-done / run-done 时刷新（run-bridge.ts）。保存改的正是这个
      // 文件，不在这里补一次刷新，队列就会一直显示上次 run 结束时的旧块数——
      // 2026-07-27 E1 走查实测：page-01 已全部复核完，队列仍报「43 个版式目标文字
      // 待复核」，用户据此以为复核被重置了。
      // 刷新失败不得翻转「保存成功」的结论——文件此时已经写盘了
      if (slideId !== null) {
        // 顺序不可颠倒：deriveStageViews 是「耐久层打底、会话层覆盖」，而 run-done
        // 刻意保留 liveStages。上一轮 run 留在会话层的 completed 会盖住刚写下的
        // stale，表现为「磁盘已作废、轨道一片绿」。必须先清会话层再刷耐久层。
        if (result.invalidated.length > 0) clearLiveStages(slideId);
        await refreshSlide(slideId).catch(() => undefined);
      }
    } catch (err) {
      setNotice({
        ok: false,
        message: `保存失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }, [saveReview, slideId, refreshSlide, clearLiveStages]);

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

  /**
   * 最终确认「完成」：一次写入 accept-clean 与 accept-pptx 双验收记录。
   *
   * 验收后 `report` 仍未跑（`STAGE_DEPENDENCIES` 把它排在 accept-pptx 之后），
   * 由用户点「运行此页」或批量续跑补上，与 design §6 的收尾一致。
   */
  const handleComplete = useCallback(
    async (note: string): Promise<void> => {
      if (workspacePath === null || slideId === null) return;
      setSubmitting(true);
      try {
        const result = await window.api.slide.acceptFinal(workspacePath, {
          note,
        });
        // 先清会话层闸门再刷耐久层，否则 deriveFinalGate 仍会命中已完成的闸门
        clearSessionResult(slideId);
        await refreshSlide(slideId);
        setNotice({
          ok: true,
          message: `已完成本页验收 · ${result.autoCheckSummary}`,
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
    [workspacePath, slideId, clearSessionResult, refreshSlide],
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
        // 会话层留着上一轮的 completed 会盖住刚写下的 stale，见 withoutSlideLiveStages
        clearLiveStages(slideId);
        setViewMode("review");
        await refreshSlide(slideId);
        startRun(stage);
      })();
    },
    [
      slideId,
      workspacePath,
      clearSessionResult,
      clearLiveStages,
      refreshSlide,
      startRun,
    ],
  );

  /**
   * 最终确认页的「回到文本复核」：作废下游产物后切回复核，但**不立即重跑**。
   *
   * 与「重做底图」不同，用户此时还没改任何文字，先跑一遍毫无意义；等他改完保存
   * 再点「运行此页」，断点续跑会从 validate-review 起把改动带到 mask/clean/pptx。
   *
   * 失效点取 `mask` 而非 design §4.3 写的 `review`：要的是「让复核改动能传到下游」，
   * 而失效 review 本身会让续跑从 review 起重做，白白再打一次 assist-review 的付费
   * 调用，并让刚编辑过的文档重走一遍候选合并。mask 是 review 之后第一个持久阶段，
   * 失效它即可连带 clean/pptx/accept-* 全部失效，复核文档本身不受影响。
   */
  const handleBackToReview = useCallback(() => {
    if (slideId === null || workspacePath === null) return;
    void (async (): Promise<void> => {
      try {
        await window.api.slide.invalidateStage(
          workspacePath,
          "mask",
          "人工选择回到文本复核，作废去字底板与 PPTX",
        );
      } catch (err) {
        setNotice({
          ok: false,
          message: `作废下游产物失败：${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      clearSessionResult(slideId);
      // 本路径**不重跑**，没有后续 stage-start 事件来覆盖会话层的陈旧 completed，
      // 不清就会出现「磁盘 stale、轨道一片绿」——E1 走查实测过的表现
      clearLiveStages(slideId);
      setViewMode("review");
      await refreshSlide(slideId);
      setNotice({
        ok: true,
        message: "已作废去字底板与 PPTX；改完复核内容后点「运行此页」重新生成",
      });
    })();
  }, [
    slideId,
    workspacePath,
    clearSessionResult,
    clearLiveStages,
    refreshSlide,
  ]);

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
        hasFinalGate={finalGate !== null}
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
        onRunSlide={() => startRun()}
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
        ) : viewMode === "final" && finalGate !== null ? (
          <FinalConfirmPage
            workspacePath={workspacePath}
            sourceImageUrl={sourceImageUrl}
            cleanPlateUrl={cleanPlateUrl}
            blocks={blocks}
            imageSize={reviewDocument?.image ?? null}
            busy={pageBusy}
            submitting={submitting}
            gateSource={finalGate.source}
            onComplete={(note) => void handleComplete(note)}
            onRedoCleanPlate={() => rerunFrom("clean")}
            onBackToReview={handleBackToReview}
          />
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

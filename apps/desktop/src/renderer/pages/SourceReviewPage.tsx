import {
  ArrowLeft,
  Check,
  CircleX,
  ImageUp,
  LoaderCircle,
  RefreshCw,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, IconButton, Kbd, StatusChip, Textarea } from "@/components/ui";
import {
  firstPendingIndex,
  indexOfSlide,
  nextPendingIndex,
  resolveEntryIndex,
  type SourceReviewEntry,
  selectSourceReviewSlides,
  sourceReviewProgress,
  stepIndex,
} from "@/lib/source-review-nav";
import { startSourceTask } from "@/lib/source-task";
import { SOURCE_KIND_LABELS, sourceAcceptanceText } from "@/lib/source-view";
import { cn } from "@/lib/utils";
import { useDeckStore } from "@/stores/deck-store";
import { useRunStore } from "@/stores/run-store";
import { useSourceTaskStore } from "@/stores/source-task-store";
import { deriveTodoQueue } from "@/stores/todo-queue";
import { useUIStore } from "@/stores/ui-store";

/**
 * 源图审片视图（R7 / E2）—— 批量确认生成图的独立视图。
 *
 * 为什么是第三个视图而不是单页复核里的一档：判断一张生成图好不好必须看大图，
 * 卡片缩略图那点尺寸不足以判断；而停在源图确认的页连 OCR 都还没跑，复核页
 * 后半屏（列表 + 标注画布）全是空面板。
 *
 * ## 可达 ≠ 待办
 *
 * 序列成员取 `selectSourceReviewSlides`，它吃待办队列的 `confirm-source` 组并
 * 并上「可达」页——已确认的生成页仍然进得来（看图、重掷、换源），只是动作区
 * 收起「接受」。判据全部来自 `lib/accept-gate` 的原子函数，本文件不自己看
 * `sourceKind === "generated" && 阶段未完成`。
 *
 * ## 光标存在 ui-store 而不是本地 state
 *
 * 当前页由 `selectedSlideId` 定位。接受一页会刷新耐久层进而重算序列，本地下标
 * 在那一刻的含义会漂——用页 id 定位则天然稳定，视图与卡片直达入口也共用同一个
 * 选中页，不需要额外同步。
 */

/** 缩略图带每格的尺寸与外观。这是图块不是动作按钮，故不套 Button 变体 */
const THUMB_TILE = cn(
  "relative w-24 shrink-0 overflow-hidden rounded-sm border bg-surface-sunken",
  "transition-colors duration-fast",
);

/** 二次点击的复位窗口（E3）：超时或焦点离开动作簇即撤销「已举手」 */
const CONFIRM_RESET_MS = 4000;

interface Notice {
  readonly ok: boolean;
  readonly message: string;
}

export function SourceReviewPage(): React.JSX.Element {
  const selectedSlideId = useUIStore((s) => s.selectedSlideId);
  const selectSlide = useUIStore((s) => s.selectSlide);
  const backToConsole = useUIStore((s) => s.backToConsole);

  const slides = useDeckStore((s) => s.slides);
  const deckPath = useDeckStore((s) => s.deckPath);
  const refreshSlide = useDeckStore((s) => s.refreshSlide);

  const sessionResults = useRunStore((s) => s.sessionResults);
  const runStatus = useRunStore((s) => s.status);
  const runningSlideId = useRunStore((s) => s.currentSlideId);
  const clearSessionResult = useRunStore((s) => s.clearSessionResult);
  const clearLiveStages = useRunStore((s) => s.clearLiveStages);

  // 建页任务在跑时与流水线一样会写 manifest，本视图的三个动作一律禁用
  const sourceTaskRunning = useSourceTaskStore((s) => s.running);

  // 派生放组件内：selector 里返回新数组会让每次 store 变更都触发重渲染
  const entries = useMemo(
    () =>
      selectSourceReviewSlides(slides, deriveTodoQueue(slides, sessionResults)),
    [slides, sessionResults],
  );

  const index = resolveEntryIndex(entries, selectedSlideId);
  const current = index === null ? null : (entries[index] ?? null);
  const progress = sourceReviewProgress(entries);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [armed, setArmed] = useState(false);
  const [note, setNote] = useState("");
  /** 手动刷新令牌：换源与重新生成会换掉磁盘上的源图，路径不变，得显式重拉 */
  const [reloadToken, setReloadToken] = useState(0);

  /*
   * 选中页与序列对齐：不带 slideId 进来（「逐张确认」）时 `resolveEntryIndex`
   * 已经落到了第一个未确认的页，这里把它写回 store，卡片直达与本视图才共用
   * 同一个选中页；换源导致当前页离开序列时同理。
   */
  const currentSlideId = current?.slideId ?? null;
  useEffect(() => {
    if (currentSlideId !== null && currentSlideId !== selectedSlideId) {
      selectSlide(currentSlideId);
    }
  }, [currentSlideId, selectedSlideId, selectSlide]);

  // 切页即撤销「已举手」与上一页的说明草稿：说明是写回规格条目的，串页就是写错页
  // biome-ignore lint/correctness/useExhaustiveDependencies: currentSlideId 是触发器而非被读取的值
  useEffect(() => {
    setArmed(false);
    setNote("");
    setNotice(null);
  }, [currentSlideId]);

  const pageBusy =
    runStatus !== "idle" &&
    currentSlideId !== null &&
    runningSlideId === currentSlideId;
  const busy = submitting || pageBusy || sourceTaskRunning;
  const busyReason = pageBusy
    ? "本页正在执行，先等它跑完"
    : sourceTaskRunning
      ? "建页任务执行中，暂不可改动页面"
      : undefined;

  /* ------------------------------ 大图 ------------------------------ */

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(true);
  const workspacePath = current?.absWorkspacePath ?? null;

  /*
   * `reloadToken` 是**触发器**而非被读取的值：换源与重新生成换掉的是磁盘上的图，
   * 路径一个字都没变，只靠 `workspacePath` 这个 effect 永远不会重跑，界面会一直
   * 停在进页那一刻的快照（state-management.md 的第一条教训就是这个形态）。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: 见上，reloadToken 是刷新触发器
  useEffect(() => {
    if (workspacePath === null) {
      setImageUrl(null);
      setImageLoading(false);
      return;
    }
    let cancelled = false;
    setImageLoading(true);
    void window.api.slide
      .loadImage(workspacePath, "source_image")
      .then((dataUrl) => {
        if (cancelled) return;
        setImageUrl(dataUrl);
        setImageLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setImageUrl(null);
        setImageLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [workspacePath, reloadToken]);

  /* ------------------------------ 导航 ------------------------------ */

  const goTo = useCallback(
    (target: number | null) => {
      if (target === null) return;
      const entry = entries[target];
      if (entry !== undefined) selectSlide(entry.slideId);
    },
    [entries, selectSlide],
  );

  const move = useCallback(
    (delta: number) => {
      if (index === null) return;
      goTo(stepIndex(entries, index, delta));
    },
    [entries, index, goTo],
  );

  /**
   * 接受之后跳下一张未确认的；一张不剩就回控制台。
   *
   * 序列在**刷新后**重算：闭包里的 `entries` 是接受之前的快照，本页在那一份里
   * 还是「未确认」，照它算会原地打转。
   */
  const advanceAfterAccept = useCallback(
    (acceptedSlideId: string) => {
      const freshSlides = useDeckStore.getState().slides;
      const fresh = selectSourceReviewSlides(
        freshSlides,
        deriveTodoQueue(freshSlides, useRunStore.getState().sessionResults),
      );
      const at = indexOfSlide(fresh, acceptedSlideId);
      const next =
        at === null ? firstPendingIndex(fresh) : nextPendingIndex(fresh, at);
      if (next === null) {
        backToConsole();
        return;
      }
      const entry = fresh[next];
      if (entry !== undefined) selectSlide(entry.slideId);
    },
    [backToConsole, selectSlide],
  );

  /* ------------------------------ 动作 ------------------------------ */

  /**
   * 三个动作的收尾一律走这里：会话层两清 + 耐久层刷新 + 图片重拉。
   *
   * 少一样就会出现「界面说的和磁盘不一样」——会话层留着上一轮的 completed 会盖住
   * 刚写下的耐久状态（覆盖式派生），图片不重拉则换过的源图仍是旧的那张。
   *
   * 刷新失败吞掉不上抛：动作本身此时已经落盘了，把刷新的失败报成「确认源图失败」
   * 是假信息；下一次 run 或返回控制台都会重新拉一遍状态。
   */
  const syncAfterMutation = useCallback(
    async (slideId: string): Promise<void> => {
      clearSessionResult(slideId);
      clearLiveStages(slideId);
      await refreshSlide(slideId).catch(() => undefined);
      setReloadToken((token) => token + 1);
    },
    [clearSessionResult, clearLiveStages, refreshSlide],
  );

  const handleAccept = useCallback(() => {
    if (current === null || current.accepted || busy) return;
    const { slideId, absWorkspacePath } = current;
    void (async () => {
      setSubmitting(true);
      try {
        await window.api.slide.acceptSource(absWorkspacePath);
        await syncAfterMutation(slideId);
        advanceAfterAccept(slideId);
      } catch (error) {
        setNotice({
          ok: false,
          message: `确认源图失败：${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        setSubmitting(false);
      }
    })();
  }, [current, busy, syncAfterMutation, advanceAfterAccept]);

  const handleRegenerate = useCallback(() => {
    if (current === null || deckPath === null || busy) return;
    const { slideId, pageLabel, sourceKind } = current;
    const trimmed = note.trim();
    setArmed(false);
    void (async () => {
      setSubmitting(true);
      try {
        const result = await startSourceTask(
          { deckPath, createNew: false },
          {
            kind: "regenerate",
            page: pageLabel,
            // 说明是可选的：不给就是「按现有规格再出一张」，强制填写会丢掉重掷的能力
            ...(trimmed === "" ? {} : { note: trimmed }),
          },
        );
        // null 表示结果被竞态守卫丢弃（期间切了工作区），此时什么都不该做
        if (result === null) return;
        if (!result.accepted) {
          setNotice({ ok: false, message: result.message });
          return;
        }
        setNote("");
        await syncAfterMutation(slideId);
        setNotice({
          ok: true,
          message: [
            trimmed === ""
              ? "已按现有规格重新生成，请确认新图"
              : "已带调整说明重新生成，说明已写回规格条目",
            // 换回生成来源是这次点击的副作用，不说出来用户只能自己去卡片徽标上发现
            sourceKind === "generated" ? null : "这一页的来源已换回「生成」",
          ]
            .filter((part) => part !== null)
            .join("；"),
        });
      } catch (error) {
        setNotice({
          ok: false,
          message: `重新生成失败：${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        setSubmitting(false);
      }
    })();
  }, [current, deckPath, busy, note, syncAfterMutation]);

  /** 换源直接复用既有 IPC：选图与二次确认都在 main 侧的系统对话框里 */
  const handleReplaceSource = useCallback(() => {
    if (current === null || busy) return;
    const { slideId, absWorkspacePath } = current;
    void (async () => {
      setSubmitting(true);
      try {
        const result = await window.api.slide.replaceSource(absWorkspacePath);
        if (!result.replaced) return;
        await syncAfterMutation(slideId);
        setNotice({
          ok: true,
          message: result.requiresAcceptance
            ? "已换源；新源图仍需确认"
            : "已换源；这一页不再需要源图确认",
        });
      } catch (error) {
        setNotice({
          ok: false,
          message: `换源失败：${error instanceof Error ? error.message : String(error)}`,
        });
      } finally {
        setSubmitting(false);
      }
    })();
  }, [current, busy, syncAfterMutation]);

  /* ---------------------------- 二次点击复位 ---------------------------- */

  /*
   * 举手后 4s 无操作自动复位；在说明框里打字算操作，计时因此挂在 `note` 上重启，
   * 否则用户写到一半按钮就自己缩回去了。焦点离开动作簇立即复位（见下方 onBlur）。
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: 见上，note 是重启计时的触发器
  useEffect(() => {
    if (!armed) return;
    const timer = window.setTimeout(() => setArmed(false), CONFIRM_RESET_MS);
    return () => window.clearTimeout(timer);
  }, [armed, note]);

  /*
   * 焦点离开「重新生成」这一簇即复位。挂在两个可交互子元素上而不是外层 div：
   * blur 会冒泡，但静态元素不该带交互处理器（a11y 规则），而按钮与输入框本就是
   * 交互元素。判据仍取整簇——从说明框 Tab 到确认按钮不该把举手撤掉。
   */
  const regenClusterRef = useRef<HTMLDivElement>(null);
  const handleRegenClusterBlur = useCallback((event: React.FocusEvent) => {
    if (!regenClusterRef.current?.contains(event.relatedTarget)) {
      setArmed(false);
    }
  }, []);

  /* ------------------------------ 键盘 ------------------------------ */

  const handleAcceptRef = useRef(handleAccept);
  handleAcceptRef.current = handleAccept;
  const moveRef = useRef(move);
  moveRef.current = move;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const inText = isTextEntry(event.target);

      if (event.key === "Escape") {
        if (inText) {
          // 输入框内 Esc 是「退出这个框」，不是「离开这一页」——
          // 正在写调整说明时把整页收掉，用户写的东西一起没了
          (event.target as HTMLElement).blur();
          setArmed(false);
          return;
        }
        event.preventDefault();
        backToConsole();
        return;
      }

      if (inText) return;

      if (event.key === "Enter") {
        // 焦点在按钮上时 Enter 由浏览器派发 click，这里再接一次就成了两次动作
        if (isActivatable(event.target)) return;
        event.preventDefault();
        handleAcceptRef.current();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveRef.current(-1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        moveRef.current(1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [backToConsole]);

  /* ------------------------------ 渲染 ------------------------------ */

  if (current === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-sm font-medium text-ink">没有需要审片的源图</p>
        <p className="max-w-md text-xs text-ink-secondary">
          这里逐张确认生成出来的源图。用「添加页面 · 内容规格」批量生成之后，
          新页会全部落在这里等你过一遍。
        </p>
        <Button variant="secondary" onClick={backToConsole}>
          返回控制台
        </Button>
      </div>
    );
  }

  const sourceLabel =
    current.sourceKind === null ? null : SOURCE_KIND_LABELS[current.sourceKind];
  /*
   * 「重新生成」按**能不能确定规格条目**开放，不按当前来源是不是 `generated`。
   *
   * 一页从 `generated` 换源成 `imported` 之后，规格条目仍能从它自己的生成快照里
   * 确定（判据在 CLI 的 `resolveRegenerableSpecEntryId`，界面只读结论）。按来源判
   * 会让这一页再也回不到生成来源——A11 明确要求双向。这里重新出图即换源，
   * 来源随之变回 `generated`，源图确认也随之重新欠上一次。
   */
  const canRegenerate = current.regenerableSpecEntryId !== null;
  const acceptanceText = sourceAcceptanceText(current.sourceAcceptance);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-hairline bg-canvas px-6 py-2.5">
        <h1 className="shrink-0 text-lg font-semibold text-ink">源图确认</h1>
        <span className="shrink-0 text-sm tabular-nums text-ink-secondary">
          已确认 {progress.accepted}/{progress.total}
        </span>
        <span className="min-w-0 flex-1" />
        <Button variant="ghost" size="sm" onClick={backToConsole}>
          <ArrowLeft aria-hidden="true" className="size-3.5" />
          返回控制台
          <Kbd>Esc</Kbd>
        </Button>
      </div>

      {notice !== null && (
        <div className="shrink-0 px-6 pt-3">
          <div
            className={cn(
              "flex items-center gap-3 rounded-sm px-4 py-1.5 text-sm",
              notice.ok
                ? "border border-hairline bg-surface text-ink-secondary"
                : "bg-state-failed/10 font-medium text-state-failed",
            )}
          >
            {notice.ok ? (
              <Check aria-hidden="true" className="size-4 shrink-0" />
            ) : (
              <CircleX aria-hidden="true" className="size-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1" title={notice.message}>
              {notice.message}
            </span>
            <IconButton
              size="sm"
              variant="ghost"
              label="关闭提示"
              onClick={() => setNotice(null)}
            >
              <X aria-hidden="true" className="size-4" />
            </IconButton>
          </div>
        </div>
      )}

      {/*
        预览区周边保持无彩：用户要靠这张图判断底板干不干净，旁边任何界面色
        都会污染判断（DESIGN.md Do's）。衬底用下沉面，不加描边不加阴影。
      */}
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-4">
        <div className="flex aspect-video max-h-full w-full items-center justify-center overflow-hidden rounded-lg bg-surface-sunken">
          {imageLoading ? (
            <p
              aria-busy="true"
              className="flex items-center gap-2 text-sm text-ink-muted"
            >
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              加载中…
            </p>
          ) : imageUrl !== null ? (
            <img
              src={imageUrl}
              alt={`${current.pageLabel} 的源图`}
              className="h-full w-full object-contain"
            />
          ) : (
            <p className="text-sm text-ink-muted">读不到这一页的源图</p>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-hairline px-6 py-2.5">
        <div className="flex min-w-0 items-baseline gap-2">
          <span
            className="truncate text-sm font-medium text-ink"
            title={current.pageLabel}
          >
            {current.pageLabel}
          </span>
          {/*
            来源 · 源图确认性质 · 规格条目。
            确认性质是 A10 在界面上的落点：`imported` 页与已人工确认的 `generated` 页
            此前在界面上长得一模一样，看不出哪一张真有人过目。措辞取 core 的同一张表。
          */}
          <span className="shrink-0 text-2xs text-ink-muted">
            {[
              sourceLabel,
              acceptanceText,
              current.specEntryId === null
                ? null
                : `规格条目 ${current.specEntryId}`,
            ]
              .filter((part) => part !== null)
              .join(" · ")}
          </span>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2.5">
          {/*
            已确认页呈现完成态而不是一个看着还能按的「接受」，但重掷与换源照旧——
            可达不等于待办，用户进来多半就是为了再换一张。
          */}
          {current.accepted ? (
            <StatusChip status="completed" label="已确认" />
          ) : (
            <Button
              variant="primary"
              size="sm"
              onClick={handleAccept}
              disabled={busy}
              loading={submitting}
              title={busyReason ?? "确认这一页的源图可用，放行下游"}
            >
              接受
              <Kbd>↵</Kbd>
            </Button>
          )}

          {canRegenerate && (
            /*
              E3 的单张档：二次点击而不是弹原生框——重新生成是本视图的核心高频
              动作，每次弹框会把「逐张过一遍」的效率整个毁掉。举手后展开可选的
              调整说明；焦点离开这一簇立即复位。
            */
            <div ref={regenClusterRef} className="flex items-center gap-2">
              {armed && (
                <Textarea
                  autoFocus
                  rows={1}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  onBlur={handleRegenClusterBlur}
                  placeholder="可选：说明要调整什么（写回规格条目）"
                  className="h-7 w-64 resize-none py-1 text-xs"
                />
              )}
              <Button
                variant={armed ? "danger" : "secondary"}
                size="sm"
                onClick={() => (armed ? handleRegenerate() : setArmed(true))}
                onBlur={handleRegenClusterBlur}
                disabled={busy}
                title={
                  busyReason ??
                  (armed
                    ? "再点一次即调用图像生成（按次付费）"
                    : current.sourceKind === "generated"
                      ? `按规格条目 ${current.regenerableSpecEntryId} 重新出一张图；可先写一句调整说明`
                      : // 当前不是生成来源：这一次点击顺带把来源换回 generated，
                        // 说清楚比让用户事后从卡片徽标发现要好
                        `按规格条目 ${current.regenerableSpecEntryId} 重新出图，这一页的来源会换回「生成」`)
                }
              >
                <RefreshCw aria-hidden="true" className="size-3.5" />
                {armed ? "确认重新生成？" : "重新生成"}
              </Button>
            </div>
          )}

          <Button
            variant="ghost"
            size="sm"
            onClick={handleReplaceSource}
            disabled={busy}
            title={busyReason ?? "改用一张自己的图；选图与确认在系统对话框里"}
          >
            <ImageUp aria-hidden="true" className="size-3.5" />
            换源
          </Button>
        </div>
      </div>

      <ThumbnailStrip
        entries={entries}
        currentIndex={index ?? 0}
        onSelect={goTo}
      />
    </div>
  );
}

/* ------------------------------ 缩略图带 ------------------------------ */

function ThumbnailStrip({
  entries,
  currentIndex,
  onSelect,
}: {
  readonly entries: readonly SourceReviewEntry[];
  readonly currentIndex: number;
  readonly onSelect: (index: number) => void;
}): React.JSX.Element {
  return (
    <ul className="flex shrink-0 items-center gap-2 overflow-x-auto border-t border-hairline bg-canvas px-6 py-2">
      {entries.map((entry, position) => (
        <li key={entry.slideId} className="shrink-0">
          <ThumbnailTile
            entry={entry}
            selected={position === currentIndex}
            onSelect={() => onSelect(position)}
          />
        </li>
      ))}
    </ul>
  );
}

function ThumbnailTile({
  entry,
  selected,
  onSelect,
}: {
  readonly entry: SourceReviewEntry;
  readonly selected: boolean;
  readonly onSelect: () => void;
}): React.JSX.Element {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void window.api.slide
      .loadImage(entry.absWorkspacePath, "source_image")
      .then((dataUrl) => {
        if (!cancelled) setUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [entry.absWorkspacePath]);

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      title={`${entry.pageLabel}${entry.accepted ? " · 已确认" : " · 待确认"}`}
      className={cn(
        THUMB_TILE,
        "aspect-video hover:border-border",
        selected ? "border-border-strong" : "border-hairline",
      )}
    >
      {url !== null ? (
        <img
          src={url}
          alt={entry.pageLabel}
          className="h-full w-full object-contain"
        />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-2xs text-ink-muted">
          {entry.pageLabel}
        </span>
      )}

      {/*
        已确认用中性勾而非绿色：完成是常态，一叠里大多数最终都会打上勾，
        给常态上色就是旧版 9 个绿点的同一个错误。
      */}
      {entry.accepted && (
        <span className="absolute right-0.5 top-0.5 flex size-3.5 items-center justify-center rounded-full bg-canvas">
          <Check aria-hidden="true" className="size-2.5 text-ink-secondary" />
          <span className="sr-only">已确认</span>
        </span>
      )}
    </button>
  );
}

/* ------------------------------ 工具 ------------------------------ */

/** 焦点在可编辑处：这里的按键属于内容，不该被视图快捷键截走 */
function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** 焦点在按钮/链接上：Enter 会由浏览器派发 click，视图不该再接一次 */
function isActivatable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "BUTTON" || tag === "A";
}

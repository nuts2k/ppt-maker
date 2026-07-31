import type { TextReviewBlock } from "@ppt-maker/core";
import { CircleX, ExternalLink, RotateCcw, Undo2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SliderCompare } from "@/components/compare/SliderCompare";
import { CheckSummary } from "@/components/final/CheckSummary";
import { CompositePreview } from "@/components/final/CompositePreview";
import {
  Button,
  SegmentedGroup,
  SegmentedItem,
  StatusChip,
  Textarea,
} from "@/components/ui";
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
 *
 * ## 右栏三段式（2026-07-31 阶段二 8.2 / 8.4 / 8.5）
 *
 * 栏头（结论）— 滚动区（明细与退回动作）— 操作区，三者是 flex 兄弟，各自独立：
 *
 * - **结论不进滚动区**：「本页已验收 / 确认最终产物」是这一屏的答案，要滚才看得见
 *   的结论等于没有结论。
 * - **操作区不再用 sticky 覆盖**：旧写法把 `overflow-y-auto` 放在 aside 上、操作区
 *   `sticky bottom-0`，sticky 元素绘制在流内内容之上，于是右栏说明文字被它盖掉半行
 *   （基线截图实证：「且会再花一次付费调」后半句消失）。改为把滚动限制在中段，
 *   操作区作为兄弟占据自己的高度，**任何内容都不可能被压在它下面**，同时保住
 *   07-30 修出来的「操作恒在手边」。
 *
 * 字号层级 20 / 14 / 12 / 11 一路建到底：标题 → 正文说明 → 辅助解释 → 小节标签。
 */

/** 小节标签，DESIGN.md badge 档（11px / 600）。中文不受 uppercase 影响，故不加 */
const SECTION_LABEL = "text-2xs font-semibold tracking-[0.02em] text-ink-muted";

/** 备注输入框的 id：本页同时只存在一个，用常量即可关联 label */
const NOTE_FIELD_ID = "final-confirm-note";

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
  /**
   * 该页已完成最终确认。
   *
   * 本页对已验收页仍然可达（否则「重做底图」会随页面一起消失，界面上再无重做入口），
   * 但不能原样呈现——`accept-final` 虽是幂等的，一个看着还能按的「完成」会让人
   * 以为这页还没验收。改为呈现已验收状态，只留重做类动作。
   */
  readonly accepted: boolean;
  /** 完成：调用方负责调 slide.acceptFinal 并刷新 */
  readonly onComplete: (note: string) => void;
  /** 重做底图：调用方负责 invalidate(clean) 后重跑 */
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
  accepted,
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
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-sunken">
        {/* 视图切换。R2.6 的保真差异提示写在 CompositePreview 内部（只在预览档成立），
            这里不重复第二遍 */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-hairline bg-canvas px-6 py-3">
          <ViewSwitch
            mode={viewMode}
            onChange={setViewMode}
            canPreview={canPreview}
            canCompare={canCompare}
          />
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-6">
          {viewMode === "preview" ? (
            canPreview ? (
              <div className="w-full max-w-5xl">
                <CompositePreview
                  cleanPlateUrl={cleanPlateUrl}
                  blocks={blocks}
                  imageWidth={imageSize.width}
                  imageHeight={imageSize.height}
                />
              </div>
            ) : (
              <PreviewEmptyState
                message={
                  cleanPlateUrl === null
                    ? "缺少去字底板，无法合成预览"
                    : "缺少页面尺寸信息，无法合成预览"
                }
                hint={
                  cleanPlateUrl === null
                    ? "用右栏「重做底图」重跑 clean 阶段。"
                    : "请确认该页复核产物完整，必要时回到文本复核重跑。"
                }
              />
            )
          ) : canCompare ? (
            <div className="w-full max-w-5xl overflow-hidden rounded-lg border border-hairline">
              <SliderCompare
                sourceImageUrl={sourceImageUrl}
                cleanPlateUrl={cleanPlateUrl}
              />
            </div>
          ) : (
            <PreviewEmptyState
              message="缺少原图或去字底板，无法对比"
              hint="用右栏「重做底图」重跑 clean 阶段。"
            />
          )}
        </div>
      </div>

      <aside className="flex w-96 shrink-0 flex-col border-l border-hairline bg-surface">
        {/* 栏头：这一屏的结论，恒在视口内，不随明细滚动（8.5） */}
        <header className="flex shrink-0 flex-col gap-2 border-b border-hairline px-6 pb-4 pt-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h2 className="text-xl font-semibold text-ink">
              {accepted ? "本页已验收" : "确认最终产物"}
            </h2>
            {/* 完成是常态，走中性档：有颜色 = 要你管，这里没什么要管的 */}
            {accepted && (
              <StatusChip status="completed" label="已完成最终确认" />
            )}
          </div>
          <p className="text-sm leading-relaxed text-ink-secondary">
            {accepted
              ? "该页已写入干净底图与 PPTX 两条验收记录。仍可打开产物复看；若底板本身有问题，用下方「重做底图」重做。"
              : "核对合成预览与去字底板；确认后一次写入干净底图与 PPTX 两条验收记录，该页即完成。不满意时用下方两个动作退回相应环节重做。"}
          </p>
          {!accepted && gateSource === "durable" && (
            <p className="text-xs leading-relaxed text-ink-muted">
              该页在此前的执行中已停在最终确认，状态由工作区恢复。
            </p>
          )}
        </header>

        {/* 滚动区：明细与例外路径。滚动只发生在这一段里 */}
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-6 py-5">
          {/* 自动检查只呈现不拦截（R2.5）：clean 的指标当前没有判定阈值（F-4），
              用它做硬门禁会把人拦在一个自己都不可信的数字后面 */}
          {checksError !== null ? (
            <ErrorNotice message={checksError} />
          ) : (
            <CheckSummary
              key={workspacePath}
              pptx={checks?.pptx ?? null}
              clean={checks?.clean ?? null}
              loading={checksLoading}
            />
          )}

          {/*
            两个退回动作的层级刻意不等：文字/分类不对是绝大多数情形，回到文本复核
            是那条正路；重做底图只在底板本身坏掉时才有用——文本复核内容没改的话，
            重新生成出来的底板通常和现在这张一样，还要再花一次付费调用。
            因此它降一档为 ghost，排在下面。

            8.3：三个动作收敛到同一套按钮词汇（此前是描边按钮 / 蓝色文字链接 /
            实心按钮三种形式并存）。降权用 variant 表达，不再用文字链接——
            文字链接既不像动作，也拿不到统一的六态。

            两者都留在滚动区：它们是例外路径，与常驻手边的「完成」不同档。
          */}
          <section className="flex flex-col gap-2.5">
            <h3 className={SECTION_LABEL}>
              {accepted ? "需要重做？" : "不满意？退回重做"}
            </h3>
            <Button
              variant="secondary"
              onClick={onBackToReview}
              disabled={actionsDisabled}
              title="作废文本复核之后的全部产物，回到复核界面"
              className="w-full"
            >
              <Undo2 aria-hidden="true" className="size-3.5" />
              回到文本复核
            </Button>
            <div className="flex flex-col gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={onRedoCleanPlate}
                disabled={actionsDisabled}
                title="仅在底板本身明显异常时使用：文字残留、容器被改坏。会再次调用付费接口"
                className="self-start"
              >
                <RotateCcw aria-hidden="true" className="size-3.5" />
                重做底图
              </Button>
              {/* break-words：右栏只有 384px，长句必须能断，不得溢出容器 */}
              <p className="break-words text-xs leading-relaxed text-ink-muted">
                只在底板明显异常（文字残留、容器被改坏）时有用。没改过文本复核内容的话，重新生成的底板通常和当前这张一致，且会再花一次付费调用。
              </p>
            </div>
          </section>
        </div>

        {/* 操作区：滚动区的兄弟而非其上的浮层，因此永远不会盖住上面的文字 */}
        <div className="flex shrink-0 flex-col gap-3 border-t border-hairline px-6 pb-6 pt-4">
          {openMessage !== null && <ErrorNotice message={openMessage} />}

          {!accepted && (
            <label htmlFor={NOTE_FIELD_ID} className="flex flex-col gap-1.5">
              <span className={SECTION_LABEL}>备注（可选）</span>
              <Textarea
                id={NOTE_FIELD_ID}
                rows={2}
                value={note}
                disabled={actionsDisabled}
                onChange={(event) => setNote(event.target.value)}
                placeholder="记录验收判断依据，会随两条验收记录写入 manifest"
              />
            </label>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={handleOpenPptx}>
              <ExternalLink aria-hidden="true" className="size-3.5" />
              {"在 PowerPoint 中打开"}
            </Button>
            {/* 已验收时不给「完成」，也不给备注——没有写入去处的输入框是假控件。
                本页唯一的主行动只在「还欠一次确认」时存在。 */}
            {!accepted && (
              <Button
                variant="primary"
                onClick={() => onComplete(note)}
                disabled={busy}
                loading={submitting}
              >
                完成
              </Button>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}

/**
 * 视图切换 —— 与控制台的筛选开关**同一个基座组件**，而不只是「同形」。
 * 一个档位切换不该长得像主按钮。
 */
function ViewSwitch({
  mode,
  onChange,
  canPreview,
  canCompare,
}: {
  readonly mode: FinalViewMode;
  readonly onChange: (next: FinalViewMode) => void;
  readonly canPreview: boolean;
  readonly canCompare: boolean;
}): React.JSX.Element {
  const available: Readonly<Record<FinalViewMode, boolean>> = {
    preview: canPreview,
    compare: canCompare,
  };

  return (
    <SegmentedGroup label="预览视图">
      {(["preview", "compare"] as const).map((value) => (
        <SegmentedItem
          key={value}
          selected={mode === value}
          disabled={!available[value]}
          onClick={() => onChange(value)}
          title={available[value] ? undefined : "缺少所需产物"}
        >
          {VIEW_LABELS[value]}
        </SegmentedItem>
      ))}
    </SegmentedGroup>
  );
}

/** 空态说明当前缺什么、去哪补，不写「暂无内容」 */
function PreviewEmptyState({
  message,
  hint,
}: {
  readonly message: string;
  readonly hint: string;
}): React.JSX.Element {
  return (
    <div className="flex max-w-sm flex-col items-center gap-2 text-center">
      <p className="text-sm font-medium text-ink">{message}</p>
      <p className="text-xs leading-relaxed text-ink-muted">{hint}</p>
    </div>
  );
}

/** 失败必须看得见（静默失败指南）：颜色之外再给图标，不只靠红色承载 */
function ErrorNotice({
  message,
}: {
  readonly message: string;
}): React.JSX.Element {
  return (
    <p className="flex items-start gap-1.5 rounded-sm bg-state-failed/10 px-3 py-2 text-xs font-medium leading-relaxed text-state-failed">
      <CircleX aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0 break-words">{message}</span>
    </p>
  );
}

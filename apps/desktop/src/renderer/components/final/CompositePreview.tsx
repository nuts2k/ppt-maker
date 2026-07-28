import {
  DEFAULT_FONT_FACE,
  PPTX_WIDE_WIDTH_INCHES,
  resolveFontSizePt,
  type TextReviewBlock,
  toAlign,
  toBold,
  toValign,
} from "@ppt-maker/core";
import { useEffect, useMemo, useRef, useState } from "react";

/**
 * 合成预览（PRD R2.1、design §4.3）：clean plate 作背景，其上按 text-blocks 渲染文本层，
 * 让人在桌面端就能看到「最终产物长什么样」，而不必先导出再去 PowerPoint 里翻。
 *
 * ## 与 PPTX 同源，不重写公式
 *
 * 字号（`resolveFontSizePt`）、粗细（`toBold`）、对齐（`toAlign` / `toValign`）全部从
 * `@ppt-maker/core` import——它们与 `apps/cli/src/pptx/synthesize.ts` 是同一份实现。
 * 在这里重算一遍等于开第二份口径，预览过关而导出错位的缺陷会从这个缝里长出来。
 *
 * 选块判据同样照 `selectTextBoxBlocks`（`apps/cli/src/pptx/run.ts`）：只取
 * `classification === "layout_text"`，并按 `zIndex` 升序叠放（`synthesize.ts` 的排序）。
 * 区别只有一处：CLI 侧遇到未复核的 layout_text 会抛错，预览是只读视图，不做门禁——
 * 拦截仍由 pptx 阶段负责。
 *
 * ## 几何：百分比 + 强制 16:9
 *
 * PPTX 把 clean plate 满铺到 13.333×7.5 英寸的 16:9 版面上（`synthesize.ts` 的
 * `addImage`），底板本身未必严格 16:9（真实产物为 1672×940），因此预览容器也固定
 * 16:9 并让底图拉伸填满，块的 `bboxPx / 源图尺寸` 百分比才与 PPT 版面一一对应。
 *
 * 字号是绝对磅值，无法用百分比表达，只能按实测显示宽换算：
 * `pt × (显示宽 / 13.333 英寸 / 72)`。所以显示宽必须实测（ResizeObserver），
 * 写死会让窗口一缩放字号就与版面脱钩。
 */

export interface CompositePreviewProps {
  readonly cleanPlateUrl: string;
  /** 完整块列表，组件内部按 PPTX 的选块判据自行筛选 */
  readonly blocks: readonly TextReviewBlock[];
  /** 源图像素宽（字号换算与横向百分比的基准） */
  readonly imageWidth: number;
  /** 源图像素高（纵向百分比的基准） */
  readonly imageHeight: number;
}

/** 与 `synthesize.ts` 的 colorHex 缺省一致；采样色在 pptx 阶段才写入，预览可能拿到 null */
const DEFAULT_COLOR_HEX = "#333333";

/** DESIGN.md caption 档（14px / 500 / 0.16px） */
const CAPTION = "text-sm font-medium tracking-[0.16px] text-muted";

export function CompositePreview({
  cleanPlateUrl,
  blocks,
  imageWidth,
  imageHeight,
}: CompositePreviewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [displayWidth, setDisplayWidth] = useState(0);

  // 显示宽实测：窗口缩放、侧栏展开都会改变它，磅→像素的比例必须跟着走
  useEffect(() => {
    const node = containerRef.current;
    if (node === null) return;
    const update = (): void => {
      setDisplayWidth(node.getBoundingClientRect().width);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, []);

  const geometryReady = imageWidth > 0 && imageHeight > 0;

  // 照抄 selectTextBoxBlocks + synthesize 的 zIndex 升序
  const textBoxBlocks = useMemo(
    () =>
      [...blocks]
        .filter((block) => block.classification === "layout_text")
        .sort((a, b) => a.zIndex - b.zIndex),
    [blocks],
  );

  // 磅 → 显示像素：1pt = 1/72 英寸，版面宽 13.333 英寸对应容器显示宽
  const ptToPx = displayWidth / PPTX_WIDE_WIDTH_INCHES / 72;

  return (
    <div className="flex w-full flex-col gap-3">
      {/* R2.6：保真差异必须在界面上明示，不能让人拿预览当最终结论 */}
      <p className={CAPTION}>
        预览按 PPT 磅值换算渲染，换行可能与 PowerPoint 略有差异，最终以
        PowerPoint 为准
      </p>

      <div
        ref={containerRef}
        className="relative aspect-[16/9] w-full overflow-hidden rounded-md border border-hairline bg-canvas"
      >
        {/* 底板拉伸满铺 16:9，与 PPTX 的整页背景图一致 */}
        <img
          src={cleanPlateUrl}
          alt="去字底板"
          className="absolute inset-0 block h-full w-full"
          draggable={false}
        />

        {/* 文本层：纯展示，不拦截指针，避免拖选干扰阅读 */}
        {geometryReady && displayWidth > 0 && (
          <div className="pointer-events-none absolute inset-0">
            {textBoxBlocks.map((block) => (
              <PreviewTextBox
                key={block.id}
                block={block}
                imageWidth={imageWidth}
                imageHeight={imageHeight}
                ptToPx={ptToPx}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewTextBox({
  block,
  imageWidth,
  imageHeight,
  ptToPx,
}: {
  readonly block: TextReviewBlock;
  readonly imageWidth: number;
  readonly imageHeight: number;
  readonly ptToPx: number;
}): React.JSX.Element {
  // 与 synthesize.ts 完全相同的取文规则：优先 lines，缺省回退整段 text
  const text = block.lines.length > 0 ? block.lines.join("\n") : block.text;
  const fontSizePx = resolveFontSizePt(block, imageWidth) * ptToPx;
  const align = toAlign(block.style.horizontalAlign);
  const valign = toValign(block.style.verticalAlign);

  return (
    <div
      className="absolute flex"
      style={{
        left: `${(block.bboxPx.x / imageWidth) * 100}%`,
        top: `${(block.bboxPx.y / imageHeight) * 100}%`,
        width: `${(block.bboxPx.width / imageWidth) * 100}%`,
        height: `${(block.bboxPx.height / imageHeight) * 100}%`,
        // PptxGenJS 的 valign 对应文本在框内的垂直分布
        alignItems: valign === "middle" ? "center" : "flex-start",
        // 文本框旋转：PptxGenJS 与 CSS 都以形状中心为轴
        ...(block.rotationDeg === 0
          ? {}
          : { transform: `rotate(${block.rotationDeg}deg)` }),
      }}
    >
      <span
        className="w-full whitespace-pre-wrap break-words"
        style={{
          fontFamily: `"${DEFAULT_FONT_FACE}", sans-serif`,
          fontSize: `${fontSizePx}px`,
          fontWeight: toBold(block.style.fontWeight) ? 700 : 400,
          color: block.style.colorHex ?? DEFAULT_COLOR_HEX,
          textAlign: align,
          // 对应 PptxGenJS 的 lineSpacingMultiple；缺省交给浏览器默认行距
          ...(block.style.lineHeight === null
            ? {}
            : { lineHeight: block.style.lineHeight }),
        }}
      >
        {text}
      </span>
    </div>
  );
}

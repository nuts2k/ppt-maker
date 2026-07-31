import type { CleanPlateChecks, PptxCheckReport } from "@ppt-maker/core";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 自动检查汇总（PRD R2.5、design §4.3）：最终确认页上把机器能查的都摊开，
 * 人只需要判断机器查不了的那部分。
 *
 * ## 全部通过时折叠（2026-07-30 R3）
 *
 * 摊开是有代价的：真机实测本组件在 384px 右栏里占 1416px，是该栏 2089px 内容的
 * 68%，把「在 PowerPoint 中打开」「完成」推到视口外 1083px 处。而**检查全过时
 * 正是明细价值最低的时候**——一份全绿的清单不需要逐条读。所以全过折叠为一行
 * 摘要，点开才展开；存在未通过项则默认展开，失败才是需要看的时候。
 *
 * ## 两组检查的性质截然不同，呈现方式必须区分
 *
 * - **PPTX 六项**（`apps/cli/src/pptx/checks.ts`）有明确判据，passed/failed 即结论，
 *   failed 用 DESIGN.md 签名色 coral 显著呈现。
 * - **clean 四组**（`packages/core/src/clean-contracts.ts`）只是裸指标，`checks.ts`
 *   从未定义过通过阈值。真实数据里残字像素恒为 0、尺寸 ok 恒为 false（PRD F-4），
 *   把它们当成质量结论会双向误导：既会因「残字 0」放过没去干净的底板，也会因
 *   「尺寸不符」吓退本来合格的产物。所以每个数值旁必须标明无阈值、仅供参考。
 *
 * failed 项在这里只是显著，不携带任何「阻止完成」的语义——完成按钮不在本组件内，
 * 是否放行由人决定（R2.5 明确要求失败不阻止完成）。
 */

export interface CheckSummaryProps {
  readonly pptx: PptxCheckReport | null;
  readonly clean: CleanPlateChecks | null;
  readonly loading: boolean;
}

/** 检查 id → 中文标题；未知 id 直接显示 id，不静默丢弃新增检查项 */
const PPTX_CHECK_LABELS: Readonly<Record<string, string>> = {
  "zip-structure": "ZIP 结构",
  "xml-parse": "XML 解析",
  "aspect-ratio": "版面比例",
  "text-content": "文字内容",
  "font-declaration": "字体声明",
  "shape-count": "形状数量",
};

/** DESIGN.md caption 档（14px / 500 / 0.16px） */
const CAPTION = "text-sm font-medium tracking-[0.16px] text-muted";

const SECTION_TITLE = cn(CAPTION, "uppercase");

interface MetricRow {
  readonly label: string;
  readonly value: string;
}

interface MetricGroup {
  readonly title: string;
  readonly rows: readonly MetricRow[];
}

function formatRatio(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatCount(value: number): string {
  return value.toLocaleString("zh-CN");
}

function formatBool(value: boolean): string {
  return value ? "是" : "否";
}

function buildCleanGroups(checks: CleanPlateChecks): readonly MetricGroup[] {
  return [
    {
      title: "尺寸",
      rows: [
        {
          label: "实际尺寸",
          value: `${checks.size.width} × ${checks.size.height}`,
        },
        {
          label: "期望尺寸",
          value: `${checks.size.expectedWidth} × ${checks.size.expectedHeight}`,
        },
        { label: "尺寸一致", value: formatBool(checks.size.ok) },
        { label: "比例为 16:9", value: formatBool(checks.size.aspectRatioOk) },
      ],
    },
    {
      title: "文字残留",
      rows: [
        {
          label: "字形区域像素",
          value: formatCount(checks.textResidue.maskedPixels),
        },
        {
          label: "残留前景像素",
          value: formatCount(checks.textResidue.residualForegroundPixels),
        },
        {
          label: "残留占比",
          value: formatRatio(checks.textResidue.residualRatio),
        },
      ],
    },
    {
      title: "mask 外差异",
      rows: [
        {
          label: "比对像素",
          value: formatCount(checks.outsideMaskDiff.comparedPixels),
        },
        {
          label: "变化像素",
          value: formatCount(checks.outsideMaskDiff.changedPixels),
        },
        {
          label: "变化占比",
          value: formatRatio(checks.outsideMaskDiff.changedRatio),
        },
        {
          label: "平均色差",
          value: checks.outsideMaskDiff.meanDelta.toFixed(2),
        },
        {
          label: "判定阈值",
          value: formatCount(checks.outsideMaskDiff.threshold),
        },
      ],
    },
    {
      title: "容器完整性",
      rows: [
        {
          label: "紧邻环像素",
          value: formatCount(checks.containerRingDiff.ringPixels),
        },
        {
          label: "变化像素",
          value: formatCount(checks.containerRingDiff.changedPixels),
        },
        {
          label: "变化占比",
          value: formatRatio(checks.containerRingDiff.changedRatio),
        },
      ],
    },
  ];
}

export function CheckSummary({
  pptx,
  clean,
  loading,
}: CheckSummaryProps): React.JSX.Element {
  /**
   * 展开态：`null` 表示随数据走，用户点过之后由他的选择接管。
   *
   * 刻意不用 `useState(默认值) + useEffect(同步)`：检查记录是异步读进来的，
   * 初值那一刻 `pptx` 恒为 null，随后用 effect 覆盖就成了「覆盖式派生」——
   * 谁写入谁负责清理，而这里根本不需要写入。取默认值即可，用户的选择优先。
   */
  const [expandOverride, setExpandOverride] = useState<boolean | null>(null);
  // 全部通过才折叠；未通过、无记录、读取中一律摊开
  const allPassed = pptx !== null && pptx.status === "passed";
  const expanded = expandOverride ?? !allPassed;

  if (loading) {
    return (
      <div className="flex flex-col gap-4 rounded-lg bg-surface-soft p-8">
        <h3 className={SECTION_TITLE}>自动检查</h3>
        <p className="text-sm text-muted">正在读取检查记录…</p>
      </div>
    );
  }

  if (pptx === null && clean === null) {
    return (
      <div className="flex flex-col gap-4 rounded-lg bg-surface-soft p-8">
        <h3 className={SECTION_TITLE}>自动检查</h3>
        <p className="text-sm text-muted">
          暂无检查记录——该页尚未生成 PPTX 与去字底板
        </p>
      </div>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpandOverride(true)}
        title="展开自动检查明细"
        className="flex items-center gap-3 rounded-lg bg-surface-soft px-4 py-3 text-left transition active:bg-surface-strong"
      >
        <span className={SECTION_TITLE}>PPTX 自动检查</span>
        <span className="text-sm font-medium text-success">全部通过</span>
        <span aria-hidden="true" className="ml-auto text-sm text-muted">
          ▾
        </span>
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-8 rounded-lg bg-surface-soft p-8">
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className={SECTION_TITLE}>PPTX 自动检查</h3>
          {pptx !== null && (
            <span
              className={cn(
                "text-sm font-medium",
                pptx.status === "passed"
                  ? "text-success"
                  : "text-signature-coral",
              )}
            >
              {pptx.status === "passed" ? "全部通过" : "存在未通过项"}
            </span>
          )}
          {allPassed && (
            <button
              type="button"
              onClick={() => setExpandOverride(false)}
              title="收起自动检查明细"
              className="ml-auto shrink-0 text-sm text-muted transition active:text-ink"
            >
              收起 ▴
            </button>
          )}
        </div>

        {pptx === null ? (
          <p className="text-sm text-muted">暂无 PPTX 检查记录</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pptx.checks.map((check) => {
              const failed = check.status === "failed";
              return (
                <li
                  key={check.id}
                  className={cn(
                    "flex flex-col gap-1 rounded-sm border bg-canvas px-4 py-3",
                    failed ? "border-signature-coral/40" : "border-hairline",
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        failed ? "bg-signature-coral" : "bg-success",
                      )}
                    />
                    <span className="text-sm font-medium text-ink">
                      {PPTX_CHECK_LABELS[check.id] ?? check.id}
                    </span>
                    <span
                      className={cn(
                        "text-sm font-medium",
                        failed ? "text-signature-coral" : "text-muted",
                      )}
                    >
                      {failed ? "未通过" : "通过"}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "pl-4 text-sm leading-relaxed",
                      failed ? "text-signature-coral" : "text-body",
                    )}
                  >
                    {check.message}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h3 className={SECTION_TITLE}>去字底板检查指标</h3>
        {/* PRD F-4：这些指标当前不具判别力，缺了这句提示就会被当成质量结论 */}
        <p className="text-sm leading-relaxed text-muted">
          以下为离线测得的裸指标，当前无判定阈值，仅供参考，不代表底板合格与否。
        </p>

        {clean === null ? (
          <p className="text-sm text-muted">暂无去字底板检查记录</p>
        ) : (
          // 单列：本组件挂在最终确认页 384px 宽的右栏里，两列会把
          // 「2048×1152」这类数值挤到折行
          <div className="grid grid-cols-1 gap-4">
            {buildCleanGroups(clean).map((group) => (
              <div
                key={group.title}
                className="flex flex-col gap-2 rounded-sm border border-hairline bg-canvas px-4 py-3"
              >
                <span className="text-sm font-medium text-ink">
                  {group.title}
                </span>
                <dl className="flex flex-col gap-1">
                  {group.rows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <dt className="text-sm text-muted">{row.label}</dt>
                      <dd className="text-sm tabular-nums text-body">
                        {row.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

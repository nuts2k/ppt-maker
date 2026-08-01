import type { CleanPlateChecks, PptxCheckReport } from "@ppt-maker/core";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import {
  Panel,
  panelVariants,
  SECTION_LABEL,
  StatusChip,
  StatusDot,
} from "@/components/ui";
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
 * - **PPTX 六项**（`apps/cli/src/pptx/checks.ts`）有明确判据，passed/failed 即结论。
 * - **clean 四组**（`packages/core/src/clean-contracts.ts`）只是裸指标，`checks.ts`
 *   从未定义过通过阈值。真实数据里残字像素恒为 0、尺寸 ok 恒为 false（PRD F-4），
 *   把它们当成质量结论会双向误导：既会因「残字 0」放过没去干净的底板，也会因
 *   「尺寸不符」吓退本来合格的产物。所以每个数值旁必须标明无阈值、仅供参考。
 *
 * failed 项在这里只是显著，不携带任何「阻止完成」的语义——完成按钮不在本组件内，
 * 是否放行由人决定（R2.5 明确要求失败不阻止完成）。
 *
 * ## 状态样式一律取自基座
 *
 * 通过 → `completed`（中性）、未通过 → `failed`（校对色 + 方块 + 叉号）。
 * 组件内不得自行拼状态色（DESIGN.md `Components · Status`）：这里若另拼一份，
 * 与阶段轨道、待办队列迟早各说各话。「通过」走中性也是「有颜色 = 要你管」的
 * 直接后果——六项全绿是常态，常态必须安静。
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
      <Panel as="section" className="flex flex-col gap-2 p-4">
        <h3 className={SECTION_LABEL}>自动检查</h3>
        <p className="text-xs text-ink-muted">正在读取检查记录…</p>
      </Panel>
    );
  }

  if (pptx === null && clean === null) {
    return (
      <Panel as="section" className="flex flex-col gap-2 p-4">
        <h3 className={SECTION_LABEL}>自动检查</h3>
        <p className="text-xs leading-relaxed text-ink-muted">
          暂无检查记录——该页尚未生成 PPTX 与去字底板。
        </p>
      </Panel>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpandOverride(true)}
        aria-expanded={false}
        title="展开自动检查明细"
        className={cn(
          panelVariants(),
          "flex items-center gap-2 px-4 py-3 text-left",
          "transition-colors duration-fast hover:bg-surface active:bg-surface-sunken",
        )}
      >
        <span className={SECTION_LABEL}>PPTX 自动检查</span>
        <StatusChip status="completed" label="全部通过" />
        <ChevronDown
          aria-hidden="true"
          className="ml-auto size-4 text-ink-muted"
        />
      </button>
    );
  }

  return (
    <Panel as="section" className="flex flex-col gap-5 p-4">
      <section className="flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <h3 className={SECTION_LABEL}>PPTX 自动检查</h3>
          {pptx !== null && (
            <StatusChip
              status={pptx.status === "passed" ? "completed" : "failed"}
              label={pptx.status === "passed" ? "全部通过" : "存在未通过项"}
            />
          )}
          {allPassed && (
            <button
              type="button"
              onClick={() => setExpandOverride(false)}
              aria-expanded={true}
              title="收起自动检查明细"
              className={cn(
                "ml-auto shrink-0 rounded-sm p-0.5 text-ink-muted",
                "transition-colors duration-fast hover:bg-surface hover:text-ink active:bg-surface-sunken",
              )}
            >
              <ChevronUp aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>

        {pptx === null ? (
          <p className="text-xs text-ink-muted">暂无 PPTX 检查记录</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {pptx.checks.map((check) => {
              const failed = check.status === "failed";
              return (
                <li
                  key={check.id}
                  className={cn(
                    "flex flex-col gap-1 rounded-sm border px-3 py-2",
                    failed
                      ? "border-state-failed/40 bg-state-failed/5"
                      : "border-hairline bg-surface",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <StatusDot status={failed ? "failed" : "completed"} />
                    <span className="text-sm font-medium text-ink">
                      {PPTX_CHECK_LABELS[check.id] ?? check.id}
                    </span>
                    <span
                      className={cn(
                        "ml-auto text-2xs font-semibold",
                        failed ? "text-state-failed" : "text-ink-muted",
                      )}
                    >
                      {failed ? "未通过" : "通过"}
                    </span>
                  </div>
                  {/* break-words：384px 右栏里检查消息常带路径与数值，必须能断 */}
                  <p
                    className={cn(
                      "break-words pl-5 text-xs leading-relaxed",
                      failed ? "text-state-failed" : "text-ink-secondary",
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

      <section className="flex flex-col gap-2.5">
        <h3 className={SECTION_LABEL}>去字底板检查指标</h3>
        {/* PRD F-4：这些指标当前不具判别力，缺了这句提示就会被当成质量结论 */}
        <p className="text-xs leading-relaxed text-ink-muted">
          以下为离线测得的裸指标，当前无判定阈值，仅供参考，不代表底板合格与否。
        </p>

        {clean === null ? (
          <p className="text-xs text-ink-muted">暂无去字底板检查记录</p>
        ) : (
          // 单列：本组件挂在最终确认页 384px 宽的右栏里，两列会把
          // 「2048×1152」这类数值挤到折行
          <div className="flex flex-col gap-2">
            {buildCleanGroups(clean).map((group) => (
              <div
                key={group.title}
                className="flex flex-col gap-1 rounded-sm border border-hairline bg-surface px-3 py-2"
              >
                <span className="text-sm font-medium text-ink">
                  {group.title}
                </span>
                <dl className="flex flex-col gap-0.5">
                  {group.rows.map((row) => (
                    <div
                      key={row.label}
                      className="flex items-baseline justify-between gap-3"
                    >
                      <dt className="text-xs text-ink-muted">{row.label}</dt>
                      <dd
                        data-numeric
                        className="text-xs tabular-nums text-ink-secondary"
                      >
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
    </Panel>
  );
}

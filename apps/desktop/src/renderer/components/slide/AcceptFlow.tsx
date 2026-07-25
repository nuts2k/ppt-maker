import { STAGE_LABELS } from "@shared/stages";
import { useCallback, useMemo, useState } from "react";
import { SliderCompare } from "@/components/compare/SliderCompare";
import {
  type AcceptGate,
  type AcceptStage,
  REJECT_RERUN_STAGES,
} from "@/lib/accept-gate";
import type { RunStage } from "../../../shared/stages.js";

/**
 * 人工验收流程（design.md 3.3 AcceptFlow，PRD F3.5 / F3.6）。
 *
 * 布局：左侧证据区占满剩余宽度（accept-clean 用 SliderCompare 擦除对比，accept-pptx
 * 用产物信息 + 打开确认提示），右侧核查清单卡（`feature-card-tabbed` 规格：
 * surface-soft / rounded-lg / 32px 内距）。
 *
 * 闸门可以来自会话层（本轮刚停在此）或耐久层（重启后 manifest 推导），两者渲染一致——
 * 这正是待办队列"点一次到达能完成该操作的界面"的前提。
 *
 * 清单条目与 CLI `runAcceptClean` / `runAcceptPptx` 的 DEFAULT_CHECKLIST 一一对应。
 * 当前 IPC `AcceptOptions` 只有 acceptedBy / note（阶段 A 定型，本阶段不改 main），
 * 因此清单在 UI 侧强制全勾才允许提交，CLI 侧落库为默认全 true——语义等价，
 * 但逐项落库需要扩展 IPC 契约，列为遗留项。
 */

interface ChecklistEntry {
  /** 与 CLI DEFAULT_CHECKLIST 的键一致，便于后续扩展 IPC 时直接透传 */
  readonly key: string;
  readonly label: string;
}

const CLEAN_CHECKLIST: readonly ChecklistEntry[] = [
  { key: "noTextResidue", label: "文字已完全去除，无残影或重影" },
  { key: "containersIntact", label: "容器/边框等版式元素完整未破坏" },
  { key: "noOutsideEdits", label: "非文字区域未被误改" },
  { key: "sizeCorrect", label: "尺寸与源图一致（16:9）" },
];

const PPTX_CHECKLIST: readonly ChecklistEntry[] = [
  { key: "opensInPowerPoint", label: "已在 PowerPoint for Mac 中打开确认" },
  { key: "aspect16by9", label: "16:9 比例正确" },
  { key: "textEditable", label: "文本框可编辑" },
  { key: "fontMicrosoftYaHei", label: "字体为微软雅黑" },
  { key: "layoutFaithful", label: "版式与源图一致" },
];

const GATE_TITLE: Readonly<Record<AcceptStage, string>> = {
  "accept-clean": "验收干净底图",
  "accept-pptx": "验收 PPTX",
};

const GATE_HINT: Readonly<Record<AcceptStage, string>> = {
  "accept-clean":
    "拖动滑块对比原图与去字底板，确认文字已去净且版式未被破坏后再接受。",
  "accept-pptx":
    "在 PowerPoint for Mac 中打开生成的 PPTX 逐项确认后再接受；拒绝将重新生成。",
};

const BUTTON_PRIMARY =
  "rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-on-primary transition active:bg-primary-active disabled:opacity-40";

const BUTTON_SECONDARY =
  "rounded-lg border border-hairline bg-canvas px-4 py-2.5 text-sm text-ink transition active:border-border-strong disabled:opacity-40";

interface AcceptFlowProps {
  readonly gate: AcceptGate;
  readonly sourceImageUrl: string | null;
  readonly cleanPlateUrl: string | null;
  /** 验收提交中；提交期间禁用全部动作 */
  readonly submitting: boolean;
  /** 本页执行中：验收与重跑都不可用 */
  readonly disabled: boolean;
  readonly onAccept: (note: string) => void;
  readonly onRejectRerun: (stage: RunStage) => void;
}

export function AcceptFlow({
  gate,
  sourceImageUrl,
  cleanPlateUrl,
  submitting,
  disabled,
  onAccept,
  onRejectRerun,
}: AcceptFlowProps): React.JSX.Element {
  const checklist = useMemo(
    () => (gate.stage === "accept-clean" ? CLEAN_CHECKLIST : PPTX_CHECKLIST),
    [gate.stage],
  );

  const [note, setNote] = useState("");
  const [checked, setChecked] = useState<Readonly<Record<string, boolean>>>({});

  const toggle = useCallback((key: string) => {
    setChecked((prev) => ({ ...prev, [key]: prev[key] !== true }));
  }, []);

  const allChecked = checklist.every((entry) => checked[entry.key] === true);
  const actionsDisabled = disabled || submitting;

  return (
    <div className="flex h-full min-h-0">
      <div className="flex min-w-0 flex-1 items-center justify-center overflow-auto bg-surface-strong p-6">
        {gate.stage === "accept-clean" ? (
          sourceImageUrl !== null && cleanPlateUrl !== null ? (
            <div className="w-full max-w-5xl overflow-hidden rounded-md">
              <SliderCompare
                sourceImageUrl={sourceImageUrl}
                cleanPlateUrl={cleanPlateUrl}
              />
            </div>
          ) : (
            <p className="text-sm font-medium text-muted">
              缺少原图或去字底板，无法对比；请先重跑 clean 阶段
            </p>
          )
        ) : (
          <div className="flex max-w-xl flex-col gap-4 rounded-md bg-canvas p-8">
            <h3 className="text-lg font-medium text-ink">PPTX 已生成</h3>
            <p className="text-sm leading-relaxed text-body">
              产物位于该页工作区 <code>stages/pptx/</code> 下。请在 PowerPoint
              for Mac 中打开后逐项核对右侧清单；确认无误再接受，验收记录会写入
              manifest 并可被 CLI <code>deck status</code> 读取。
            </p>
            {cleanPlateUrl !== null && (
              <figure className="flex flex-col gap-2">
                <img
                  src={cleanPlateUrl}
                  alt="该页干净底图"
                  className="w-full rounded-sm border border-hairline"
                />
                <figcaption className="text-sm font-medium text-muted">
                  该页干净底图 —— PPTX 以此为背景，文字为可编辑文本框
                </figcaption>
              </figure>
            )}
          </div>
        )}
      </div>

      <aside className="flex w-96 shrink-0 flex-col gap-6 overflow-y-auto border-l border-hairline bg-surface-soft p-8">
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-ink">
            {GATE_TITLE[gate.stage]}
          </h2>
          <p className="text-sm leading-relaxed text-body">
            {GATE_HINT[gate.stage]}
          </p>
          {gate.source === "durable" && (
            <p className="text-sm font-medium text-muted">
              该页在此前的执行中已停在此闸门，状态由工作区恢复
            </p>
          )}
        </div>

        <ul className="flex flex-col gap-3">
          {checklist.map((entry) => (
            <li key={entry.key}>
              <label className="flex cursor-pointer items-start gap-3 text-sm leading-relaxed text-body">
                <input
                  type="checkbox"
                  checked={checked[entry.key] === true}
                  disabled={actionsDisabled}
                  onChange={() => toggle(entry.key)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-primary"
                />
                <span className="min-w-0">{entry.label}</span>
              </label>
            </li>
          ))}
        </ul>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium text-muted">备注（可选）</span>
          <textarea
            rows={3}
            value={note}
            disabled={actionsDisabled}
            onChange={(event) => setNote(event.target.value)}
            placeholder="记录验收判断依据，会随验收记录写入 manifest"
            className="w-full rounded-sm border border-hairline bg-canvas px-4 py-3 text-sm text-ink placeholder:text-muted focus:border-info-border focus:outline-none disabled:opacity-40"
          />
        </label>

        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => onAccept(note)}
            disabled={actionsDisabled || !allChecked}
            title={allChecked ? undefined : "需逐项确认后才能接受"}
            className={BUTTON_PRIMARY}
          >
            {submitting ? "提交中…" : "接受并继续"}
          </button>

          {/* 拒绝 = 从产出该产物的阶段重跑；clean 提供 mask/clean 两档，越前越彻底 */}
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-muted">
              不通过？从以下阶段重跑
            </span>
            <div className="flex flex-wrap gap-2">
              {REJECT_RERUN_STAGES[gate.stage].map((stage) => (
                <button
                  key={stage}
                  type="button"
                  onClick={() => onRejectRerun(stage)}
                  disabled={actionsDisabled}
                  className={BUTTON_SECONDARY}
                >
                  重跑「{STAGE_LABELS[stage]}」
                </button>
              ))}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

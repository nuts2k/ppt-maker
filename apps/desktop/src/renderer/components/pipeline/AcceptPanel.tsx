import { useCallback, useState } from "react";

interface AcceptPanelProps {
  gate: "accept-clean" | "accept-pptx";
  autoCheckSummary?: string;
  onAccept: (note: string) => void;
  onReject: () => void;
}

const GATE_TITLES: Record<string, string> = {
  "accept-clean": "验收 Clean Plate",
  "accept-pptx": "验收 PPTX",
};

const CLEAN_CHECKLIST = [
  "文字残留已检查",
  "容器完整性已确认",
  "非文字区域未被误改",
];

const PPTX_CHECKLIST = [
  "已在 PowerPoint for Mac 中打开确认",
  "文本框可编辑",
  "字体为微软雅黑",
  "16:9 比例正确",
];

export function AcceptPanel({
  gate,
  autoCheckSummary,
  onAccept,
  onReject,
}: AcceptPanelProps): React.JSX.Element {
  const [note, setNote] = useState("");
  const checklist = gate === "accept-clean" ? CLEAN_CHECKLIST : PPTX_CHECKLIST;
  const [checked, setChecked] = useState<boolean[]>(
    new Array(checklist.length).fill(false),
  );

  const allChecked = checked.every(Boolean);

  const toggleCheck = useCallback((index: number) => {
    setChecked((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  }, []);

  return (
    <div className="rounded-md border border-hairline bg-surface-soft p-4">
      <h3 className="mb-3 text-sm font-medium text-ink">{GATE_TITLES[gate]}</h3>

      {autoCheckSummary && (
        <div className="mb-3 rounded-sm bg-canvas p-2 text-xs text-body">
          自动检查：{autoCheckSummary}
        </div>
      )}

      <div className="mb-3 flex flex-col gap-1.5">
        {checklist.map((item, index) => (
          <label key={item} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked[index] ?? false}
              onChange={() => toggleCheck(index)}
              className="rounded"
            />
            <span className="text-body">{item}</span>
          </label>
        ))}
      </div>

      <textarea
        className="mb-3 w-full rounded-sm border border-hairline bg-canvas px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-info-border focus:outline-none"
        rows={2}
        placeholder="备注（可选）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      <div className="flex gap-2">
        <button
          type="button"
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-40"
          disabled={!allChecked}
          onClick={() => onAccept(note)}
        >
          接受
        </button>
        <button
          type="button"
          className="rounded-lg border border-hairline bg-canvas px-4 py-2 text-sm font-medium text-ink"
          onClick={onReject}
        >
          拒绝
        </button>
      </div>
    </div>
  );
}

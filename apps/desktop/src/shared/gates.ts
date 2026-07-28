/**
 * 人工闸门的展示文案 —— main 落盘的活动日志与 renderer 的即时记录共用同一份。
 *
 * 两侧必须逐字一致：`activity-format.ts` 的即时记录只是执行过程中的临时呈现，
 * 重新 `load()` 后同一条事件会被 main 落盘的版本替换；文案若各写各的，
 * 用户会看到同一件事在刷新前后有两种说法。因此映射只在这里定义一次。
 *
 * 闸门取值来自 CLI 的 `RunFromResult.gate`（`apps/cli/src/slide/run-from.ts`）。
 */

/** 闸门 -> 中文短语；`error` 不在此列（失败走错误文案，不是闸门） */
const GATE_LABELS: Readonly<Record<string, string>> = {
  "human-edit": "停在文本复核门",
  api: "停在 API 调用确认",
  upload: "停在上传确认",
  // manual 现在只对应最终产物确认：accept-clean 已不再单独停顿（design §3.2）
  manual: "停在最终确认",
  "validation-failed": "复核校验未通过",
};

export function gateLabel(gate: string | null): string | null {
  if (gate === null || gate === "error") return null;
  return GATE_LABELS[gate] ?? null;
}

/**
 * 单页执行结束的一行日志正文。
 *
 * 闸门前缀之后接 CLI 原样返回的 message——待复核块数、下一条命令这些细节都在
 * message 里，desktop 侧不重新组织，避免与 CLI 的说法分叉。
 */
export function describePageDone(
  pageLabel: string,
  gate: string | null,
  message: string,
): string {
  const label = gateLabel(gate);
  return label === null
    ? `${pageLabel} · ${message}`
    : `${pageLabel} · ${label}：${message}`;
}

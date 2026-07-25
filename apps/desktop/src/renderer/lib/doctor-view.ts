/**
 * 环境检查（doctor）展示派生 —— 状态 chip、启动提示、导出前警告共用的纯逻辑。
 *
 * PRD F5.1 要求「启动时提示，不阻止打开但导出前警告」，因此把检查项按影响面分成两组：
 *
 * - **关键项**（`CRITICAL_CHECK_IDS`）：平台 / Swift（原生 OCR）/ PowerPoint / 微软雅黑。
 *   任一非 pass 都会让流水线或产物出问题，启动即主动提示一次。
 * - **基线项**：`node` / `pnpm`。这是开发环境基线，打包后的应用里缺失是常态，
 *   只进 chip 明细，不做启动提示——否则每次启动都弹一条与用户无关的警告。
 *
 * 导出另有一组更窄的判据（`EXPORT_CHECK_IDS`）：导出只依赖字体与 PowerPoint，
 * Swift 缺失不影响已完成页的拼装，不该在导出时二次打扰。
 *
 * 与 stage-view / accept-gate 一致使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node NodeNext）解析。
 */

import type { DoctorCheckItem, DoctorReport } from "../../main/ipc/channels.js";

/** 影响流水线执行或产物质量的检查项，非 pass 时启动提示 */
export const CRITICAL_CHECK_IDS: readonly string[] = [
  "platform",
  "swift",
  "powerpoint",
  "font-microsoft-yahei",
];

/** 影响导出产物的检查项，非 pass 时导出前二次确认 */
export const EXPORT_CHECK_IDS: readonly string[] = [
  "powerpoint",
  "font-microsoft-yahei",
];

/** doctor 单项状态 → 状态点颜色（与阶段轨道同一套语义色：coral 失败、mustard 警告） */
export const CHECK_DOT_CLASS: Record<DoctorCheckItem["status"], string> = {
  pass: "bg-success",
  warn: "bg-signature-mustard",
  fail: "bg-signature-coral",
};

export interface DoctorChipView {
  readonly label: string;
  readonly className: string;
}

export interface DoctorNotice {
  /** 组内最坏状态：只要有一项 fail 就按 fail 呈现 */
  readonly level: "fail" | "warn";
  readonly title: string;
  readonly hint: string;
  readonly items: readonly DoctorCheckItem[];
}

/**
 * 顶栏状态 chip。计数覆盖**全部**检查项（含基线项），保证 chip 与下拉明细口径一致；
 * 分级只影响提示时机，不影响这里的诚实计数。
 *
 * @param report doctor 报告；仍在加载时为 null
 * @param failed doctor IPC 调用本身失败——降级为「环境未知」而非隐藏 chip
 */
export function doctorChipView(
  report: DoctorReport | null,
  failed: boolean,
): DoctorChipView | null {
  if (report === null) {
    return failed
      ? { label: "环境未知", className: "bg-surface-strong text-muted" }
      : null;
  }

  const { fail, warn } = report.summary;
  if (fail > 0) {
    return {
      label: `环境异常 ${fail} 项`,
      className: "bg-signature-coral text-on-primary",
    };
  }
  if (warn > 0) {
    return {
      label: `环境警告 ${warn} 项`,
      className: "bg-signature-mustard text-ink",
    };
  }
  return { label: "环境正常", className: "bg-success/10 text-success" };
}

/** 按给定 id 集合筛出未通过项；顺序沿用报告本身，保持与 chip 明细一致 */
function pendingChecks(
  report: DoctorReport,
  ids: readonly string[],
): readonly DoctorCheckItem[] {
  return report.checks.filter(
    (check) => ids.includes(check.id) && check.status !== "pass",
  );
}

function worstLevel(items: readonly DoctorCheckItem[]): "fail" | "warn" {
  return items.some((item) => item.status === "fail") ? "fail" : "warn";
}

/**
 * 启动提示：关键项存在未通过时返回一条提示，否则 null。
 *
 * 提示只陈述事实并给出下一步，**不阻断**任何操作——PRD 明确要求可以照常打开与复核。
 */
export function startupNotice(
  report: DoctorReport | null,
): DoctorNotice | null {
  if (report === null) return null;

  const items = pendingChecks(report, CRITICAL_CHECK_IDS);
  if (items.length === 0) return null;

  const level = worstLevel(items);
  return {
    level,
    title:
      level === "fail"
        ? `环境检查发现 ${items.length} 项异常`
        : `环境检查发现 ${items.length} 项警告`,
    hint: "不影响打开与复核，但相关阶段可能失败；导出前请先处理。",
    items,
  };
}

/**
 * 导出前警告：字体或 PowerPoint 未就绪时返回一条提示，否则 null。
 *
 * 字体缺失不会让 `deck export` 抛错，而是让新生成的占位页在 PowerPoint 里字体回退——
 * 这类「静默降级」必须在导出前显式告知，否则用户拿到文件才发现。
 */
export function exportNotice(report: DoctorReport | null): DoctorNotice | null {
  if (report === null) return null;

  const items = pendingChecks(report, EXPORT_CHECK_IDS);
  if (items.length === 0) return null;

  return {
    level: worstLevel(items),
    title: `${items.length} 项环境检查未通过，仍要导出吗？`,
    hint: "导出的 PPTX 可能出现字体回退，或无法在本机 PowerPoint 中确认效果。",
    items,
  };
}

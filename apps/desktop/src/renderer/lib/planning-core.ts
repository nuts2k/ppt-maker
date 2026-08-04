/**
 * 内容策划工作台中需要跨组件复用、且值得用纯函数上锁的规则。
 *
 * 本文件不触碰 `window`，并保持相对 `.js` 导入，使 renderer 与 NodeNext 下的
 * vitest 能消费同一份实现。
 */

import {
  type ContentSpec,
  diffContentSpec,
  type SpecChangeRecord,
} from "@ppt-maker/core";
import type { SlideDetail } from "../../main/ipc/channels.js";
import type { ConfirmOptions } from "./source-picker-core.js";

/** 编辑草稿是否包含尚未保存的规格变更。 */
export function isDirty(
  saved: ContentSpec | null,
  draft: ContentSpec | null,
): boolean {
  if (draft === null) return false;
  if (saved === null) return true;

  const diff = diffContentSpec(saved, draft);
  return (
    diff.styleChanged ||
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.modified.length > 0 ||
    diff.reordered
  );
}

export interface OutdatedPageClassification {
  readonly drifted: readonly SlideDetail[];
  readonly missing: readonly SlideDetail[];
  /** 非生成来源与已移除页，不参与规格重生成。 */
  readonly notApplicable: readonly SlideDetail[];
}

/**
 * 把页面按规格重生成能力分类。
 *
 * 已同步或尚无漂移状态的生成页不属于任何返回集合；调用方只需要展示必须处理或
 * 明确不适用的页面。
 */
export function classifyOutdatedPages(
  slides: readonly SlideDetail[],
): OutdatedPageClassification {
  const drifted: SlideDetail[] = [];
  const missing: SlideDetail[] = [];
  const notApplicable: SlideDetail[] = [];

  for (const slide of slides) {
    if (slide.sourceKind !== "generated") {
      notApplicable.push(slide);
    } else if (slide.specDrift === "drifted") {
      drifted.push(slide);
    } else if (slide.specDrift === "missing") {
      missing.push(slide);
    }
  }

  return { drifted, missing, notApplicable };
}

/** 批量重生成的付费确认；勾选集合即实际执行集合，因此次数是确切值。 */
export function buildRegenerateBatchConfirm(
  pageLabels: readonly string[],
): ConfirmOptions {
  const count = pageLabels.length;
  return {
    title: "确认批量重生成",
    message: `将调用 ${count} 次图像生成`,
    detail: `将重生成 ${count} 页，按次计费且不可撤销。这些页面的 OCR 复核基准会随规格文字一并更新，生成后每页都需要你逐张重新确认源图。`,
    confirmLabel: `重生成（${count} 页）`,
  };
}

/** 没有任何条目指纹变化的历史记录仍保留，但在界面中降低视觉权重。 */
export function isEmptyChangeRecord(record: SpecChangeRecord): boolean {
  return record.fingerprints.length === 0;
}

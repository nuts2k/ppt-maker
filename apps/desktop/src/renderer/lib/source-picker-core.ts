/**
 * 来源选择界面里**值得上锁的判定**：规格初稿的可读摘要、付费门槛的调用次数与文案。
 *
 * 与 stage-view / source-view 一致使用相对 `.js` 导入且不触碰 `window`，
 * 以便同时被 renderer（vite）与测试（vitest + tsconfig.node，NodeNext）解析——
 * 本项目没有 DOM 测试库，规则只能测在纯函数产物上。
 *
 * 这里**不做**任何来源侧的业务判定：16:9 容差、页码范围解析、`requiresSourceAcceptance`
 * 一律在 CLI / core，桌面端写第二份就是同一条规则两套实现。
 */

import type { ContentSpec, ContentSpecEntry } from "@ppt-maker/core";

/** 来源选择的三档，与 core 的 `SlideSourceKind` 一一对应 */
export type SourceKindOption = "imported" | "extracted" | "generated";

/**
 * 选择界面里的档位名，说的是**你要拿什么进来**（图片目录 / PDF 文档 / 内容规格）。
 *
 * 与 `source-view.ts` 的 `SOURCE_KIND_LABELS`（导入 / 抽取 / 生成）刻意不同源：
 * 那张表说的是**这一页是怎么来的**，长在卡片角上。同一个枚举的两种说法各有其位，
 * 合并成一张表会让其中一处读起来别扭（卡片上写「PDF 文档」、选择器里写「抽取」）。
 */
export const SOURCE_OPTION_LABELS: Readonly<Record<SourceKindOption, string>> =
  {
    imported: "图片目录",
    extracted: "PDF 文档",
    generated: "内容规格",
  };

export interface SpecPageSummary {
  readonly specEntryId: string;
  readonly pageType: string;
  /** 一行可读标题，用于让用户在出图前认出这是哪一页 */
  readonly title: string;
}

/**
 * 规格条目的一行标题。
 *
 * 取第一组的第一条文字——规格里「标题只是单条目分组」，没有专门的标题字段。
 * 逐级兜底到分组标签与页型：**不返回空串**，否则初稿预览里会出现一行只有页型的
 * 空条目，用户无从判断该不该为它付一次图像生成的钱。
 */
export function specEntryTitle(entry: ContentSpecEntry): string {
  for (const group of entry.textGroups) {
    const item = group.items.find((text) => text.trim().length > 0);
    if (item !== undefined) return item;
    if (group.label.trim().length > 0) return group.label;
  }
  return entry.pageType;
}

/** 初稿预览：条目数与逐页标题。用户据此决定是否发起 N 次付费调用 */
export function summarizeSpec(spec: ContentSpec): readonly SpecPageSummary[] {
  return spec.entries.map((entry) => ({
    specEntryId: entry.specEntryId,
    pageType: entry.pageType,
    title: specEntryTitle(entry),
  }));
}

/**
 * 批量生成会发起多少次图像调用。
 *
 * 一条目一次，与 CLI `runDeckGenerate` 的逐条目执行一致。它只是**告知用户的量级**，
 * 不参与任何执行判定——真正跑几次由 CLI 侧的跳过/复用规则决定，
 * 桌面端不在这里替它算「哪些能跳过」，那会变成同一条规则的第二份实现。
 */
export function generationCallCount(spec: ContentSpec): number {
  return spec.entries.length;
}

export interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  readonly detail: string;
  readonly confirmLabel: string;
}

/**
 * 批量生成的原生确认框文案（E3）。
 *
 * 必须写明**次数**与**不可撤销**：生成按次付费，一个只说「确定要生成吗」的框
 * 等于没有门槛——用户点它时并不知道自己批准了多少钱。
 *
 * 次数一律取得到：规格文件读不出来（坏 JSON、不符 schema）时**不走这里**，
 * 调用方如实报错并停下，而不是退回一个不写数字的兜底文案——那样用户会以为
 * 门槛正常，实际上批准的是一次读都没读明白的支出。
 *
 * ## 为什么一律写「最多」，不分新建与追加
 *
 * `runDeckGenerate` 先与 deck 既有页对账，已生成且条目匹配的会被跳过，所以
 * `callCount` 本质是**上限**。「新建时没有既有页、可以写确切值」听着成立，实际
 * 不成立：新 deck 的落点是「来源文件同级 + 日期后缀」，同一天对同一份规格再点
 * 一次新建会**落到同一个已存在的目录上**，于是对账照样生效。
 *
 * 桌面端也**不替 CLI 算「哪些能跳过」**——那是同一条对账规则的第二份实现，
 * 迟早与它漂移。能确定的只有「不会超过这么多」，就只说这么多。
 */
export function buildGenerateConfirm(callCount: number): ConfirmOptions {
  return {
    title: "确认批量生成",
    message: `将调用最多 ${callCount} 次图像生成`,
    detail: `规格共 ${callCount} 条；已生成且未改动的条目会被跳过，因此实际次数可能更少。按次计费且不可撤销，生成后每页都需要你逐张确认源图。`,
    confirmLabel: `生成（最多 ${callCount} 页）`,
  };
}

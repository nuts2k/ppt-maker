import { z } from "zod";
import { SHA256_PATTERN } from "./constants.js";

/**
 * 页面来源：「这一页的图从哪来」这一独立维度（M5 父任务 design §2）。
 *
 * 按 `kind` 判别联合，每个分支只装该来源真正拥有的溯源信息，不做「所有字段可空」的大宽表。
 * 三个分支共有 `recordedAt` 与 `attemptId`——后者把来源锚定到具体一次 `init` attempt，
 * 使换源历史通过既有 `attempts` 数组天然可追溯，无需另建历史结构。
 *
 * 刻意**不带** `schemaVersion`：它不是独立可寻址的记录（不像资产有 id、attempt 有 id），
 * 而是 manifest 的一个属性，随 manifest 自身的 schemaVersion 走。
 */
export const SlideSourceKindSchema = z.enum([
  "imported",
  "extracted",
  "generated",
]);

export const ImportedSourceSchema = z.object({
  kind: z.literal("imported"),
  /** 仅溯源用，不参与任何校验或路径解析 */
  originalFileName: z.string().min(1),
  recordedAt: z.string().datetime(),
  attemptId: z.string().min(1),
});

export const ExtractedSourceSchema = z.object({
  kind: z.literal("extracted"),
  documentName: z.string().min(1),
  /** 同一份文档重抽时可比对 */
  documentSha256: z.string().regex(SHA256_PATTERN),
  /** 1-based */
  pageNumber: z.number().int().min(1),
  /** D1：矢量文本层探测结果。一律位图化，此处只记录可提取性供界面提示 */
  hasExtractableText: z.boolean(),
  rendererId: z.string().min(1),
  /** 渲染器版本，保证同一页可复现 */
  rendererVersion: z.string().min(1),
  renderDpi: z.number().int().positive(),
  recordedAt: z.string().datetime(),
  attemptId: z.string().min(1),
});

export const GeneratedSourceSchema = z.object({
  kind: z.literal("generated"),
  /** 内容规格中该页条目 id，一经分配不得变更 */
  specEntryId: z.string().min(1),
  /**
   * 生成时该【条目】的指纹，不是整份规格文件的指纹。
   * 整份文件级指纹会让改一页污染全 deck 的漂移判断（父任务 A13 的直接判据）。
   */
  specEntrySha256: z.string().regex(SHA256_PATTERN),
  providerId: z.string().min(1),
  model: z.string().min(1),
  promptVersion: z.string().min(1),
  /** 提示词全文另存为资产，此处只放指纹 */
  promptSha256: z.string().regex(SHA256_PATTERN),
  parameters: z.record(z.string(), z.unknown()),
  recordedAt: z.string().datetime(),
  attemptId: z.string().min(1),
});

/**
 * 成本与用量**不重复存放**于此：耗时、用量、请求 id、原始响应属于 `ProviderCallRecord`
 * 的职责，`GeneratedSource` 只持有 `attemptId` 关联过去，避免两处成本数据分叉。
 */
export const SlideSourceSchema = z.discriminatedUnion("kind", [
  ImportedSourceSchema,
  ExtractedSourceSchema,
  GeneratedSourceSchema,
]);

export type SlideSourceKind = z.infer<typeof SlideSourceKindSchema>;
export type ImportedSource = z.infer<typeof ImportedSourceSchema>;
export type ExtractedSource = z.infer<typeof ExtractedSourceSchema>;
export type GeneratedSource = z.infer<typeof GeneratedSourceSchema>;
export type SlideSource = z.infer<typeof SlideSourceSchema>;

/**
 * 该来源的源图是否需要人工确认才能进入下游（D6）。
 *
 * 生成图重来一次的概率高，不确认就跑完整条链路等于把算力和人工复核浪费在一张
 * 迟早要换掉的图上；导入与抽取的图是用户自己选进来的，视作已确认。
 *
 * **单点定义**：CLI、桌面端与后续子任务一律调用本函数，不各写各的 `kind === "generated"`，
 * 否则来源规则会在四个地方各漂移一次。
 */
export function requiresSourceAcceptance(source: SlideSource): boolean {
  return source.kind === "generated";
}

/**
 * 调用方能提供的来源信息：`attemptId` 与 `recordedAt` 由建立工作区 / 换源的过程填，
 * 调用方拿不到也不该猜（attempt id 是工作区内部递增的）。
 */
export type SlideSourceDraft =
  | Omit<ImportedSource, "attemptId" | "recordedAt">
  | Omit<ExtractedSource, "attemptId" | "recordedAt">
  | Omit<GeneratedSource, "attemptId" | "recordedAt">;

export function materializeSource(
  draft: SlideSourceDraft,
  attemptId: string,
  recordedAt: string,
): SlideSource {
  return { ...draft, attemptId, recordedAt };
}

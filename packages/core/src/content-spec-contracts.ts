import { z } from "zod";
import { SCHEMA_VERSION } from "./constants.js";

/**
 * 内容规格（M5 子任务③ 定稿，冻结为 M5 生成侧与 M6 策划侧之间的唯一接口）。
 *
 * 放在 core 而不是 CLI：它是跨里程碑契约，M6 策划侧与桌面端都要读它，
 * CLI 不该是唯一持有者。
 *
 * **带 `schemaVersion`**，这与 `SlideSource` 刻意不带并不矛盾：`SlideSource` 是
 * manifest 的一个属性、随宿主的版本走，而 `content-spec.json` 是独立可寻址文件，
 * M6 极可能扩展它，需要自己的版本轴。
 */

/**
 * deck 级风格约定（E1）：配色、字体气质、版式与图形语言。
 *
 * 它拼进**每一页**的提示词，因此改它意味着所有已生成图都过时了——
 * 这正是条目指纹要覆盖 style 的原因（见 `specViewFingerprintValues`）。
 */
export const ContentSpecStyleSchema = z.object({
  description: z.string().min(1),
});

/**
 * 页面上真实出现的一条文字。
 *
 * **不得含换行**：所有 items 展平后逐行写入该页 `reference_text`，
 * `attachReferenceCandidates` 按纯文本逐行消费，内嵌换行会把一条文字拆成两个候选。
 */
const ContentSpecTextItemSchema = z
  .string()
  .min(1)
  .refine(
    (value) => !value.includes("\n") && !value.includes("\r"),
    "页面文字不得包含换行：展平后每条恰好占 reference_text 一行",
  );

/**
 * 一组同角色的页面文字（E2）。
 *
 * 分组而非扁平列表，是为了让**每条文字只出现一次**：复杂页一页 15+ 条文字，
 * 靠「这 6 个是流程阶段」「这 3 个是支撑层」的分组语境才说得清版式。
 * 扁平列表丢掉这层信息后，用户为修好版式必然把文字重写进 `visualIntent`，
 * 造成两处各存一份、不一致时无机制报错的隐式分叉。
 *
 * 标题只是「单条目分组」，不设专门字段。
 */
export const ContentSpecTextGroupSchema = z.object({
  label: z.string().min(1),
  items: z.array(ContentSpecTextItemSchema),
});

export const ContentSpecEntrySchema = z.object({
  /** 一经分配不得变更；增删条目不得影响其它条目的 id */
  specEntryId: z.string().min(1),
  /**
   * cover / content / transition / architecture / timeline …
   *
   * 自由字符串而非枚举：枚举会让 M6 策划侧撞上「我要的页型不在枚举里」。
   */
  pageType: z.string().min(1),
  /** 页面实际文字，展平即该页 `reference_text` */
  textGroups: z.array(ContentSpecTextGroupSchema),
  /**
   * 版式与视觉意图，**只进提示词，绝不进 `reference_text`**。
   *
   * 「左侧放架构图」这类文字若混进参考文案，会整条落入
   * `unmatchedReferenceCandidates`，在复核界面表现为一堆假的「漏识别文字」。
   */
  visualIntent: z.string(),
  /**
   * 重生成时附的调整说明，**机械追加**（D7 禁止让模型改写规格）。
   *
   * 全部累积、全部进提示词（E4）：调整在用户心智里本就是累积的，
   * 只用最后一条会制造更常见的困惑；清理靠用户直接编辑规格文件。
   * 「只增不改」由写入路径保证，schema 不做限制。
   */
  revisionNotes: z.array(z.string().min(1)),
});

export const ContentSpecSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    specId: z.string().min(1),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    style: ContentSpecStyleSchema,
    entries: z.array(ContentSpecEntrySchema),
  })
  .superRefine((spec, context) => {
    const seen = new Set<string>();
    for (const entry of spec.entries) {
      if (seen.has(entry.specEntryId)) {
        context.addIssue({
          code: "custom",
          message: `条目 ID 重复：${entry.specEntryId}`,
          path: ["entries"],
        });
      }
      seen.add(entry.specEntryId);
    }
  });

/**
 * 落进 slide 工作区 `content_spec` 资产的**合并视图**，不是裸条目。
 *
 * 让「资产内容」与「指纹覆盖范围」完全一致：指纹算的就是这份视图，
 * 两者因此不可能分叉。
 */
export const ContentSpecViewSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  style: ContentSpecStyleSchema,
  entry: ContentSpecEntrySchema,
});

export type ContentSpecStyle = z.infer<typeof ContentSpecStyleSchema>;
export type ContentSpecTextGroup = z.infer<typeof ContentSpecTextGroupSchema>;
export type ContentSpecEntry = z.infer<typeof ContentSpecEntrySchema>;
export type ContentSpec = z.infer<typeof ContentSpecSchema>;
export type ContentSpecView = z.infer<typeof ContentSpecViewSchema>;

/**
 * 「该页生成时的完整规格视图」的稳定字段投影——指纹口径的**唯一来源**。
 *
 * 返回的是待哈希的字符串序列而非 sha 本身：core 保持零运行时依赖（渲染进程也
 * import 它，不能拉进 `node:crypto`）。CLI 侧的 `specViewFingerprint` 把它喂给
 * 既有的 `sha256Values`（长度前缀式稳定哈希），桌面端要算同一个指纹时同样
 * import 本函数，口径不会各写一遍。
 *
 * **显式列字段，不做通用 canonical JSON**，三个理由：
 * 1. 用户重排 JSON 键不改变指纹（canonical JSON 也能做到）；
 * 2. 顺带保证「新增字段必须显式决定是否进指纹」，不会因为加了个字段就静默
 *    改变所有历史页的漂移判断；
 * 3. 与仓库既有指纹做法（`inputFingerprint`）同构。
 *
 * 前缀标签避免不同结构拼出同一串：`{label:"a", items:["b"]}` 与
 * `{label:"a b", items:[]}` 不会碰撞。
 *
 * **覆盖 `style` 是有意的**：风格段变了，所有已生成图确实都过时了，只算条目会
 * 漏报这种漂移。这不违反父任务 A13——A13 约束的是「改**条目**只影响该页」。
 */
export function specViewFingerprintValues(
  style: ContentSpecStyle,
  entry: ContentSpecEntry,
): string[] {
  return [
    `style:${style.description}`,
    `entryId:${entry.specEntryId}`,
    `pageType:${entry.pageType}`,
    ...entry.textGroups.flatMap((group) => [
      `group:${group.label}`,
      ...group.items.map((item) => `item:${item}`),
    ]),
    `intent:${entry.visualIntent}`,
    ...entry.revisionNotes.map((note) => `note:${note}`),
  ];
}

/** 该条目的全部页面文字，展平为逐行文本——即该页 `reference_text` 的内容（R3） */
export function flattenSpecEntryTexts(entry: ContentSpecEntry): string[] {
  return entry.textGroups.flatMap((group) => group.items);
}

/**
 * 规格初稿的模型输出形状（E5）。
 *
 * 与 `ContentSpecSchema` 分开是**必要的**，不是图省事：
 * - `specId` / `createdAt` / `specEntryId` 不该由模型编造，由写入方分配；
 * - Structured Outputs 的 JSON Schema 不接受 `minLength` / 自定义 refine，
 *   带约束的 schema 直接喂 `zodTextFormat` 会被 API 拒绝。
 *
 * 模型输出经 `materializeContentSpec` 补齐后再走 `ContentSpecSchema.parse`，
 * 约束一条不少。
 */
export const ContentSpecDraftSchema = z.object({
  style: z.object({ description: z.string() }),
  entries: z.array(
    z.object({
      pageType: z.string(),
      textGroups: z.array(
        z.object({ label: z.string(), items: z.array(z.string()) }),
      ),
      visualIntent: z.string(),
    }),
  ),
});

export type ContentSpecDraft = z.infer<typeof ContentSpecDraftSchema>;

export function formatSpecEntryId(index: number): string {
  return `entry-${String(index).padStart(3, "0")}`;
}

/**
 * 把模型初稿补齐为合法规格：分配顺序条目 id、`revisionNotes` 置空、盖时间戳。
 *
 * 模型的分页**不具约束力**——输出是文件、可任意编辑（E5）。
 */
export function materializeContentSpec(
  draft: ContentSpecDraft,
  options: { readonly specId: string; readonly now: string },
): ContentSpec {
  return ContentSpecSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    specId: options.specId,
    createdAt: options.now,
    updatedAt: options.now,
    style: draft.style,
    entries: draft.entries.map((entry, index) => ({
      specEntryId: formatSpecEntryId(index + 1),
      pageType: entry.pageType,
      textGroups: entry.textGroups,
      visualIntent: entry.visualIntent,
      revisionNotes: [],
    })),
  });
}

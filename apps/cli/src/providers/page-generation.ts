// 内容规格驱动的页面图生成（M5 子任务③ design §3.2）。
//
// 只做两件事：把「deck 级风格段 + 该条目」拼成提示词，以及把 core 的指纹投影
// 喂给既有 `sha256Values`。真正的调用走 `providers/openai-image.ts` 里已存在的
// `generatePageImage()`——那个函数 M2 起就在，此前全仓无调用点，本任务接入它，
// 不另写一份调用封装。
import type { ContentSpecEntry, ContentSpecStyle } from "@ppt-maker/core";
import { specViewFingerprintValues } from "@ppt-maker/core";
import { sha256Values } from "../slide/workspace.js";

/** 随提示词骨架变更递增；进 `GeneratedSource.promptVersion` 与 `ProviderCallRecord` */
export const PAGE_GENERATION_PROMPT_VERSION = "m5-generate-v2";

/**
 * 「该页生成时的完整规格视图」的指纹（design §2.3）。
 *
 * 口径的字段投影在 core 的 `specViewFingerprintValues`（core 零运行时依赖、
 * 渲染进程也 import 它，不能拉进 `node:crypto`），这里只补上哈希那一步，
 * 用的是仓库既有的长度前缀式稳定哈希，与 `inputFingerprint` 同构。
 */
export function specViewFingerprint(
  style: ContentSpecStyle,
  entry: ContentSpecEntry,
): string {
  return sha256Values(specViewFingerprintValues(style, entry));
}

/**
 * 沿用 M2 已验证有效的写法：英文骨架 + 中文文字内嵌引号（25 页实证）。
 *
 * 与 M2 的差别只在**文字不再埋在整段提示词里**——它们来自结构化的 `textGroups`，
 * 因此同一批文字既能进提示词又能展平成 `reference_text`，两处不可能分叉。
 */
export function buildPageGenerationPrompt(
  style: ContentSpecStyle,
  entry: ContentSpecEntry,
): string {
  const lines: string[] = [
    "Design a 16:9 widescreen presentation slide in Chinese.",
    `Overall deck style: ${style.description}`,
    `Page type: ${entry.pageType}`,
  ];

  if (entry.textGroups.length > 0) {
    lines.push("Texts that must appear on the page, grouped by role:");
    for (const group of entry.textGroups) {
      const items = group.items.map((item) => `'${item}'`).join(", ");
      lines.push(`- ${group.label}: ${items}`);
    }
  }

  if (entry.visualIntent.length > 0) {
    lines.push(`Visual intent: ${entry.visualIntent}`);
  }

  if (entry.revisionNotes.length > 0) {
    // E4：全部累积、全部进提示词。矛盾是少数，且提示词中后出现的指令权重本就更高，
    // 引导语把这一点写明；只用最后一条会制造更常见的困惑（「标题大一点」之后说
    // 「配色改深蓝」是两者都要）。
    lines.push(
      "Revision notes (listed in chronological order, later ones take precedence):",
    );
    for (const [index, note] of entry.revisionNotes.entries()) {
      lines.push(`${index + 1}. ${note}`);
    }
  }

  lines.push(
    "Rendering quality constraints:",
    "- Render as if producing a 4K (3840×2160) high-fidelity output. Every element must be crisp and detailed at that resolution, even though the output canvas may be smaller.",
    "- All text must be rendered at a legible, presentation-appropriate size. The smallest text on the slide must be no smaller than 14pt equivalent. Do NOT render tiny, decorative, or watermark-sized text anywhere.",
    "- All text must appear razor-sharp with clean edges — no blur, anti-aliasing artifacts, or fuzzy strokes. Treat text clarity as the highest priority.",
    "- Use Microsoft YaHei font. Render every listed text exactly as written. Do not add, translate, paraphrase, or omit any text.",
  );
  return lines.join("\n");
}

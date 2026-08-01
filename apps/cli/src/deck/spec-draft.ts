// `deck spec-draft`：由一段构思文本一次性产出内容规格初稿（M5 子任务③ R8 / E5）。
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ContentSpec,
  ContentSpecSchema,
  FoundationError,
  materializeContentSpec,
} from "@ppt-maker/core";
import {
  draftContentSpec,
  type OpenAiSpecDraftParser,
} from "../providers/openai-spec-draft.js";
import { writeJsonAtomic } from "../slide/workspace.js";

export interface DeckSpecDraftOptions {
  readonly fromPath: string;
  readonly outputPath: string;
  readonly confirmApi: boolean;
  readonly parseResponse?: OpenAiSpecDraftParser;
}

export interface DeckSpecDraftResult {
  readonly outputPath: string;
  readonly spec: ContentSpec;
  readonly requestId: string;
  readonly model: string;
}

/**
 * 模型分页 + 逐页扩写，一次调用，**无对话**（E5）。
 *
 * 与 M6 的边界是「一次性、无对话」，不是「模型能决定多少事」：若用户还得自己分页
 * 并写好每页文字，模型只剩转 JSON，「避免全手写」就没兑现。输出是文件、可任意编辑，
 * 模型的分页**不具约束力**。
 */
export async function runDeckSpecDraft(
  options: DeckSpecDraftOptions,
): Promise<DeckSpecDraftResult> {
  if (!options.confirmApi) {
    throw new FoundationError(
      "API_CONFIRMATION_REQUIRED",
      "生成内容规格初稿会把构思文本发送到 OpenAI，必须显式传入 --confirm-api",
    );
  }

  const sourceText = await readFile(resolve(options.fromPath), "utf8");
  if (sourceText.trim().length === 0) {
    throw new FoundationError("INVALID_INPUT", "构思文本为空", {
      path: options.fromPath,
    });
  }

  const analysis = await draftContentSpec({
    sourceText,
    ...(options.parseResponse === undefined
      ? {}
      : { parseResponse: options.parseResponse }),
  });

  // 条目 id、specId 与时间戳由写入方分配，不让模型编造——id 一经分配不得变更，
  // 交给模型意味着重新生成初稿就会换一套 id。
  const spec = materializeContentSpec(analysis.draft, {
    specId: randomUUID(),
    now: new Date().toISOString(),
  });

  const outputPath = resolve(options.outputPath);
  await writeJsonAtomic(outputPath, ContentSpecSchema.parse(spec));
  return {
    outputPath,
    spec,
    requestId: analysis.requestId,
    model: analysis.model,
  };
}

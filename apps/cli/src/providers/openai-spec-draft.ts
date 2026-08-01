// 内容规格初稿生成 Provider（M5 子任务③ design §7）。
// 照 `openai-text-assist.ts` 的既有模式：Responses API + zodTextFormat 结构化输出，
// 一次调用、无对话、无多轮（E5 与 M6 的边界就在这里）。
import {
  type ContentSpecDraft,
  ContentSpecDraftSchema,
  FoundationError,
} from "@ppt-maker/core";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

export const OPENAI_SPEC_DRAFT_MODEL = "gpt-5.6-luna";
export const SPEC_DRAFT_PROMPT_VERSION = "m5-spec-draft-v1";
export const SPEC_DRAFT_ENDPOINT = "/v1/responses";

function buildPrompt(sourceText: string): string {
  return [
    "你在把一段自由文本的构思或大纲，转成一份 16:9 演示文稿的内容规格。",
    "输出要求：",
    "1. 先给整份 deck 一段风格约定（style.description）：配色倾向、字体气质、版式密度、图形语言。它会拼进每一页的生图提示词，因此要具体、可执行，不要空话。",
    "2. 再按内容自行分页，每页给出：",
    "   - pageType：页型标签，自由取值（如 cover / agenda / content / architecture / timeline / summary）。",
    "   - textGroups：这一页上**真实出现的文字**，按角色分组。label 是这组文字的角色（如 标题 / 副标题 / 要点 / 流程阶段 / 支撑层），items 是逐条文字。",
    "   - visualIntent：版式与视觉意图（如「左侧三层架构图，右侧说明」）。",
    "关键约束：",
    "- 每条文字只能出现在 textGroups 里一次，**绝不要把页面文字重复写进 visualIntent**；visualIntent 只描述怎么排、长什么样。",
    "- textGroups 的每条文字不得包含换行，一条就是页面上的一行/一个标签。",
    "- 标题就是一个只有一条 item 的分组，不要另设字段。",
    "- 忠于原文的信息，不要杜撰数据、机构名或结论；原文没说的宁可留空。",
    "- 用中文写页面文字与视觉意图。",
    "以下是构思原文：",
    sourceText,
  ].join("\n");
}

export function buildSpecDraftRequest(sourceText: string) {
  return {
    model: OPENAI_SPEC_DRAFT_MODEL,
    store: false,
    input: [{ role: "user" as const, content: buildPrompt(sourceText) }],
    text: {
      format: zodTextFormat(ContentSpecDraftSchema, "content_spec_draft"),
    },
  };
}

export type SpecDraftRequest = ReturnType<typeof buildSpecDraftRequest>;

export interface OpenAiSpecDraftResponse {
  readonly id: string;
  readonly model: string;
  readonly outputParsed: unknown;
  readonly usage: unknown;
}

export type OpenAiSpecDraftParser = (
  request: SpecDraftRequest,
) => Promise<OpenAiSpecDraftResponse>;

async function createDefaultParser(): Promise<OpenAiSpecDraftParser> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new FoundationError(
      "MISSING_DEPENDENCY",
      "缺少 OPENAI_API_KEY，无法生成内容规格初稿",
    );
  }
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
  return async (request) => {
    const response = await client.responses.parse(request);
    return {
      id: response.id,
      model: response.model,
      outputParsed: response.output_parsed,
      usage: response.usage,
    };
  };
}

export interface SpecDraftAnalysis {
  readonly requestId: string;
  readonly model: string;
  readonly usage: unknown;
  readonly draft: ContentSpecDraft;
}

export async function draftContentSpec(options: {
  readonly sourceText: string;
  readonly parseResponse?: OpenAiSpecDraftParser;
}): Promise<SpecDraftAnalysis> {
  const request = buildSpecDraftRequest(options.sourceText);
  const parseResponse = options.parseResponse ?? (await createDefaultParser());
  const response = await parseResponse(request);
  // 外部响应先经运行时校验，不用类型断言绕过：模型可能 refusal 或输出空解析，
  // 那时不得把自由文本当作规格。
  const parsed = ContentSpecDraftSchema.safeParse(response.outputParsed);
  if (!parsed.success) {
    throw new FoundationError(
      "INVALID_PROVIDER_RESPONSE",
      "内容规格初稿未返回符合 Schema 的结果",
      { requestId: response.id, issues: parsed.error.issues },
    );
  }
  return {
    requestId: response.id,
    model: response.model,
    usage: response.usage,
    draft: parsed.data,
  };
}

import {
  FoundationError,
  type TextAssistResult,
  TextAssistResultSchema,
  type TextReviewDocument,
} from "@ppt-maker/core";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

export const OPENAI_TEXT_ASSIST_MODEL = "gpt-5.6-luna";
export const TEXT_ASSIST_PROMPT_VERSION = "m1-text-assist-v1";

export interface TextAssistOptions {
  readonly document: TextReviewDocument;
  readonly referenceText: string | null;
  readonly parseResponse?: OpenAiTextAssistResponseParser;
}

export interface OpenAiTextAssistResponse {
  readonly id: string;
  readonly model: string;
  readonly outputParsed: unknown;
  readonly usage: unknown;
  readonly rawResponse: unknown;
}

export type OpenAiTextAssistResponseParser = (
  request: TextAssistRequest,
) => Promise<OpenAiTextAssistResponse>;

export interface OpenAiTextAssistAnalysis {
  readonly request: TextAssistRequest;
  readonly requestId: string;
  readonly model: string;
  readonly usage: unknown;
  readonly result: TextAssistResult;
  readonly rawResponse: unknown;
}

function buildPrompt(
  document: TextReviewDocument,
  referenceText: string | null,
): string {
  const blocks = document.blocks.map((b) => ({
    id: b.id,
    text: b.text,
    bboxPx: b.bboxPx,
    confidence: b.sources[0]?.confidence ?? null,
  }));
  return [
    "你正在校正一张 16:9 演示文稿页面的 OCR 识别结果。",
    "对每个文字块：1) 修正 OCR 误差（错别字、乱码、多余标点、缺字）；2) 判断分类。",
    "分类规则：",
    "- layout_text：标题、副标题、正文、列表、图注、解释性标签、标注框文字。",
    "- object_integrated_symbol：图标/象形图标签（如 ERP、WMS）、图表/仪表/UI 标记、产品包装符号、编号徽章（如 01、02）、作为视觉对象的数字。",
    "- uncertain：无法确定归属时使用，必须附带 classification_uncertain 风险。",
    "分类依据是视觉和语义角色，不是字符类别。",
    "不确定时必须输出 uncertain，不得猜测。",
    `OCR 文字块（含 bbox 空间位置）：${JSON.stringify(blocks)}`,
    `原始文案参考（可能不准确或不完整）：${referenceText ?? "未提供"}`,
  ].join("\n");
}

export function buildTextAssistRequest(input: {
  readonly document: TextReviewDocument;
  readonly referenceText: string | null;
}) {
  return {
    model: OPENAI_TEXT_ASSIST_MODEL,
    store: false,
    input: [
      {
        role: "user" as const,
        content: buildPrompt(input.document, input.referenceText),
      },
    ],
    text: {
      format: zodTextFormat(TextAssistResultSchema, "slide_text_assist"),
    },
  };
}

export type TextAssistRequest = ReturnType<typeof buildTextAssistRequest>;

async function createDefaultParser(): Promise<OpenAiTextAssistResponseParser> {
  const resolvedApiKey = process.env.OPENAI_API_KEY;
  if (resolvedApiKey === undefined || resolvedApiKey.trim().length === 0) {
    throw new FoundationError(
      "MISSING_DEPENDENCY",
      "缺少 OPENAI_API_KEY，无法运行 AI 辅助复核",
    );
  }
  const client = new OpenAI({
    apiKey: resolvedApiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
  return async (request) => {
    const response = await client.responses.parse(request);
    return {
      id: response.id,
      model: response.model,
      outputParsed: response.output_parsed,
      usage: response.usage,
      rawResponse: response,
    };
  };
}

export async function assistReviewText(
  options: TextAssistOptions,
): Promise<OpenAiTextAssistAnalysis> {
  const request = buildTextAssistRequest({
    document: options.document,
    referenceText: options.referenceText,
  });
  const parseResponse = options.parseResponse ?? (await createDefaultParser());
  const response = await parseResponse(request);
  const parsed = TextAssistResultSchema.safeParse(response.outputParsed);
  if (!parsed.success) {
    throw new FoundationError(
      "INVALID_PROVIDER_RESPONSE",
      "AI 辅助复核未返回符合 Schema 的结果",
      {
        requestId: response.id,
        issues: parsed.error.issues,
      },
    );
  }
  return {
    request,
    requestId: response.id,
    model: response.model,
    usage: response.usage,
    result: parsed.data,
    rawResponse: response.rawResponse,
  };
}

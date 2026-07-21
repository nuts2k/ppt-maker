import { readFile } from "node:fs/promises";
import {
  FoundationError,
  type OcrProbeResponse,
  type VisionAnalysisResult,
  VisionAnalysisResultSchema,
} from "@ppt-maker/core";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

export const OPENAI_VISION_MODEL = "gpt-5.6-sol";
export const VISION_ANALYSIS_PROMPT_VERSION = "m1-vision-analysis-v1";

export interface AnalyzeSlideVisionOptions {
  readonly imagePath: string;
  readonly imageMimeType: "image/png" | "image/jpeg";
  readonly ocr: OcrProbeResponse;
  readonly referenceText: string | null;
  readonly parseResponse?: OpenAiVisionResponseParser;
}

export interface OpenAiVisionResponse {
  readonly id: string;
  readonly model: string;
  readonly outputParsed: unknown;
  readonly usage: unknown;
  readonly rawResponse: unknown;
}

export type OpenAiVisionResponseParser = (
  request: VisionAnalysisRequest,
) => Promise<OpenAiVisionResponse>;

export interface OpenAiVisionAnalysis {
  readonly request: VisionAnalysisRequest;
  readonly requestId: string;
  readonly model: string;
  readonly usage: unknown;
  readonly result: VisionAnalysisResult;
  readonly rawResponse: unknown;
}

function buildPrompt(
  ocr: OcrProbeResponse,
  referenceText: string | null,
): string {
  return [
    "你正在分析一张完整的 16:9 演示文稿页面图片。",
    "识别所有独立版式文字，并区分对象内符号。分类依据是视觉和语义角色，不是字符类别。",
    "重点补充离线 OCR 可能遗漏的文字、旋转角度、艺术字边界、换行、样式和前景颜色。",
    "对象内数字、缩写、货币、百分号、UI/图表/包装标记通常属于 object_integrated_symbol。",
    "不确定时必须输出 uncertain 和对应风险，不得为了填满 Schema 编造文字。",
    `离线 OCR 候选：${JSON.stringify(ocr)}`,
    `原始文案参考（可能不准确或不完整）：${referenceText ?? "未提供"}`,
  ].join("\n");
}

export function buildVisionAnalysisRequest(input: {
  readonly imageDataUrl: string;
  readonly ocr: OcrProbeResponse;
  readonly referenceText: string | null;
}) {
  return {
    model: OPENAI_VISION_MODEL,
    store: false,
    reasoning: { effort: "high" as const },
    input: [
      {
        role: "user" as const,
        content: [
          {
            type: "input_text" as const,
            text: buildPrompt(input.ocr, input.referenceText),
          },
          {
            type: "input_image" as const,
            image_url: input.imageDataUrl,
            detail: "original" as const,
          },
        ],
      },
    ],
    text: {
      format: zodTextFormat(
        VisionAnalysisResultSchema,
        "slide_visual_analysis",
      ),
    },
  };
}

export type VisionAnalysisRequest = ReturnType<
  typeof buildVisionAnalysisRequest
>;

async function createDefaultParser(): Promise<OpenAiVisionResponseParser> {
  const resolvedApiKey = process.env.OPENAI_API_KEY;
  if (resolvedApiKey === undefined || resolvedApiKey.trim().length === 0) {
    throw new FoundationError(
      "MISSING_DEPENDENCY",
      "缺少 OPENAI_API_KEY，无法运行显式云端视觉分析",
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

export async function analyzeSlideVision(
  options: AnalyzeSlideVisionOptions,
): Promise<OpenAiVisionAnalysis> {
  const image = await readFile(options.imagePath);
  const request = buildVisionAnalysisRequest({
    imageDataUrl: `data:${options.imageMimeType};base64,${image.toString("base64")}`,
    ocr: options.ocr,
    referenceText: options.referenceText,
  });
  const parseResponse = options.parseResponse ?? (await createDefaultParser());
  const response = await parseResponse(request);
  const parsed = VisionAnalysisResultSchema.safeParse(response.outputParsed);
  if (!parsed.success) {
    throw new FoundationError(
      "INVALID_PROVIDER_RESPONSE",
      "OpenAI 视觉分析未返回符合 Schema 的结果，可能为 refusal 或不完整响应",
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

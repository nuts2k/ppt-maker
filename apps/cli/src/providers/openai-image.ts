// gpt-image-2 clean plate Provider（implement.md 第 5 节）。
// 确立 Image API images.edit 的固定档位、版本化去字提示词，并封装一次编辑调用。
// API Key 只从环境读取，绝不落盘；真实调用由 `slide clean --confirm-upload` 显式触发。
import { createReadStream } from "node:fs";
import {
  FoundationError,
  PPTX_WIDE_HEIGHT_INCHES,
  PPTX_WIDE_WIDTH_INCHES,
} from "@ppt-maker/core";
import OpenAI, { type Uploadable } from "openai";

// design 第 5 节固定档位：POST /v1/images/edits、gpt-image-2、2048x1152、high、png。
export const OPENAI_IMAGE_MODEL = "gpt-image-2";
export const CLEAN_PLATE_QUALITY = "high";
export const CLEAN_PLATE_OUTPUT_FORMAT = "png";
export const CLEAN_PLATE_PROMPT_VERSION = "m1-clean-plate-v1";

// 版本化去字规则提示词，核心为用户确认的两段规则（prd R6 / design §10）：
// 只移除独立版式文字字形；保留全部容器与对象内符号，不简化图标、不改构图。
export const CLEAN_PLATE_PROMPT = [
  "你在编辑一张 16:9 演示文稿页面。任务是移除页面上独立的版式文字，得到干净的背景底板。",
  "规则一（只移除独立版式文字字形）：只擦除标题、副标题、正文、列表、图注、解释性标签、标注框等版式文字的可见笔画，并把其原位置修复成与周围一致的背景、容器填充或渐变。",
  "规则二（保留容器与对象内符号）：完整保留标题栏、卡片、徽章、按钮、边框、阴影、渐变等文字承载容器的填充、边框、阴影、尺寸、位置与形状；不得移除或简化对象内的数字、缩写、货币符号、百分号、图标/图表/仪表/UI/包装上的标记等视觉细节。",
  "不要改变页面构图、图标、箭头、图表、插画、颜色与渐变；不要新增文字或图形；容器内文字被移除后容器本身必须保持完整。",
  "仅在半透明 mask 指示的区域移除文字字形，其余区域保持原样。",
].join("\n");

// clean plate 目标像素尺寸，供上游按 16:9 校验实际请求尺寸。
export const CLEAN_PLATE_WIDTH = 2048;
export const CLEAN_PLATE_HEIGHT = 1152;

// 实际上线的 size 字符串从像素常量派生，确保与 16:9 断言用的数字不可能分叉。
export const CLEAN_PLATE_SIZE = `${CLEAN_PLATE_WIDTH}x${CLEAN_PLATE_HEIGHT}`;

export interface CleanPlateEditInput {
  // 源图与 mask 均以 SDK Uploadable 形式提交（Node 侧常用 fs.createReadStream）。
  readonly image: Uploadable;
  // 带 alpha 的 PNG mask：完全透明区域指示待编辑位置，须与源图同尺寸。
  readonly mask: Uploadable;
  readonly prompt: string;
}

// 构造 images.edit 的非流式请求参数，固定 design 约定档位。
export function buildCleanPlateEditParams(
  input: CleanPlateEditInput,
): OpenAI.Images.ImageEditParamsNonStreaming {
  return {
    model: OPENAI_IMAGE_MODEL,
    image: input.image,
    mask: input.mask,
    prompt: input.prompt,
    // SDK 的 size 类型为 `(string & {}) | 具名档位 | 'auto' | null`，2048x1152 不在具名档位中，
    // 仅经 `(string & {})` 收口可赋值但无字面量级校验；因此固定在常量并由上游按像素尺寸断言，
    // 不在调用点散写字符串，避免拼写错误静默通过类型检查。
    size: CLEAN_PLATE_SIZE,
    quality: CLEAN_PLATE_QUALITY,
    output_format: CLEAN_PLATE_OUTPUT_FORMAT,
    // M1 不设置 input_fidelity：gpt-image-2 自动以高保真方式处理输入图片。
    n: 1,
    stream: false,
  };
}

export interface CleanPlateResult {
  readonly b64Png: string;
  readonly usage: OpenAI.Images.ImagesResponse.Usage | null;
}

// 从 images.edit 响应提取 base64 PNG 与用量；gpt-image-2 始终返回 base64。
export function extractCleanPlateResult(
  response: OpenAI.Images.ImagesResponse,
): CleanPlateResult {
  const b64Png = response.data?.[0]?.b64_json;
  if (b64Png === undefined) {
    throw new FoundationError(
      "INVALID_PROVIDER_RESPONSE",
      "gpt-image-2 未返回 base64 图片数据",
    );
  }
  return { b64Png, usage: response.usage ?? null };
}

export interface OpenAiImageEditOutcome {
  readonly response: OpenAI.Images.ImagesResponse;
  readonly requestId: string | null;
}

export type OpenAiImageEditor = (
  params: OpenAI.Images.ImageEditParamsNonStreaming,
) => Promise<OpenAiImageEditOutcome>;

// 默认调用 seam：仅在显式触发的 clean plate 阶段构造；API Key 只从环境读取，不落盘。
export async function createDefaultImageEditor(): Promise<OpenAiImageEditor> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new FoundationError(
      "MISSING_DEPENDENCY",
      "缺少 OPENAI_API_KEY，无法运行 gpt-image-2 clean plate",
    );
  }
  const client = new OpenAI({ apiKey });
  return async (params) => {
    const { data, request_id } = await client.images
      .edit(params)
      .withResponse();
    return { response: data, requestId: request_id };
  };
}

export interface CleanPlateEditOptions {
  readonly imagePath: string;
  readonly maskPath: string;
  readonly prompt?: string;
  readonly edit?: OpenAiImageEditor;
}

export interface CleanPlateEditOutcome {
  readonly b64Png: string;
  readonly usage: OpenAI.Images.ImagesResponse.Usage | null;
  readonly requestId: string | null;
  readonly rawResponse: unknown;
}

// 封装一次 clean plate 编辑：以源图 + mask 文件流提交固定档位请求并提取结果。
export async function runCleanPlateEdit(
  options: CleanPlateEditOptions,
): Promise<CleanPlateEditOutcome> {
  const editor = options.edit ?? (await createDefaultImageEditor());
  const params = buildCleanPlateEditParams({
    image: createReadStream(options.imagePath),
    mask: createReadStream(options.maskPath),
    prompt: options.prompt ?? CLEAN_PLATE_PROMPT,
  });
  const outcome = await editor(params);
  const { b64Png, usage } = extractCleanPlateResult(outcome.response);
  return {
    b64Png,
    usage,
    requestId: outcome.requestId,
    rawResponse: outcome.response,
  };
}

// clean plate 固定输出 2048x1152，与 PPTX wide 16:9（13.333×7.5 英寸）同比例。
export function cleanPlateMatchesWideRatio(): boolean {
  const imageRatio = CLEAN_PLATE_WIDTH / CLEAN_PLATE_HEIGHT;
  const slideRatio = PPTX_WIDE_WIDTH_INCHES / PPTX_WIDE_HEIGHT_INCHES;
  return Math.abs(imageRatio - slideRatio) / slideRatio < 0.005;
}

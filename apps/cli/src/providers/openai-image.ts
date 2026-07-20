// gpt-image-2 clean plate 的类型契约骨架（implement.md 第 1 节验证项）。
// 本文件仅确立 Image API images.edit 的请求/响应类型契约与固定档位常量，
// 不发真实请求；完整的 `slide clean` 阶段、--confirm-upload、Provider 记录、
// 质量检查与重试属 implement.md 第 5 节，届时在此骨架上补齐。
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

export type OpenAiImageEditor = (
  params: OpenAI.Images.ImageEditParamsNonStreaming,
) => Promise<OpenAI.Images.ImagesResponse>;

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
  return (params) => client.images.edit(params);
}

// clean plate 固定输出 2048x1152，与 PPTX wide 16:9（13.333×7.5 英寸）同比例。
export function cleanPlateMatchesWideRatio(): boolean {
  const imageRatio = CLEAN_PLATE_WIDTH / CLEAN_PLATE_HEIGHT;
  const slideRatio = PPTX_WIDE_WIDTH_INCHES / PPTX_WIDE_HEIGHT_INCHES;
  return Math.abs(imageRatio - slideRatio) / slideRatio < 0.005;
}

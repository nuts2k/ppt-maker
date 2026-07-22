// gpt-image-2 clean plate Provider（implement.md 第 5 节）。
// 确立 Image API images.edit 的固定档位、版本化去字提示词，并封装一次编辑调用。
// API Key 只从环境读取，绝不落盘；真实调用由 `slide clean --confirm-upload` 显式触发。
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
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
export const CLEAN_PLATE_PROMPT_VERSION = "m1-clean-plate-v4";

// 版本化去字规则提示词，核心为用户确认的两段规则（prd R6 / design §10）：
// 只移除独立版式文字字形；保留全部容器与对象内符号，不简化图标、不改构图。
export const CLEAN_PLATE_PROMPT = [
  "你在编辑一张 16:9 演示文稿页面。任务是擦除 mask 透明区域内的文字，生成干净的背景底板。",
  "在 mask 透明区域内：彻底擦除所有可见的文字笔画，把文字原位置修复成与周围完全一致的背景、容器填充或渐变。无论文字大小，修复区域必须与周围背景无缝融合，不得出现灰色条状占位、色块或任何可见修补痕迹。",
  "在 mask 不透明区域：保持原样不做任何修改，包括其中的文字、图标、图表和所有视觉元素。",
  "修复约束：文字被擦除后其承载容器（标题栏、卡片、按钮、边框、阴影等）必须保持完整。不改变页面构图、图标、箭头、图表、插画、颜色与渐变。不新增任何文字或图形。",
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
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
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
  const [imageFile, maskFile] = await Promise.all([
    readFile(options.imagePath).then(
      (buf) =>
        new File([buf], basename(options.imagePath), { type: "image/png" }),
    ),
    readFile(options.maskPath).then(
      (buf) =>
        new File([buf], basename(options.maskPath), { type: "image/png" }),
    ),
  ]);
  const params = buildCleanPlateEditParams({
    image: imageFile,
    mask: maskFile,
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

// --- 图片生成接口（M2 评测集页面生成） ---

export interface ImageGenerationResult {
  readonly b64Png: string;
  readonly usage: OpenAI.Images.ImagesResponse.Usage | null;
  readonly requestId: string | null;
  readonly rawResponse: unknown;
}

export type OpenAiImageGenerator = (
  params: OpenAI.Images.ImageGenerateParamsNonStreaming,
) => Promise<{ response: OpenAI.Images.ImagesResponse; requestId: string | null }>;

export async function createDefaultImageGenerator(): Promise<OpenAiImageGenerator> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new FoundationError(
      "MISSING_DEPENDENCY",
      "缺少 OPENAI_API_KEY，无法运行 gpt-image-2 图片生成",
    );
  }
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
  return async (params) => {
    const { data, request_id } = await client.images
      .generate(params)
      .withResponse();
    return { response: data, requestId: request_id };
  };
}

export interface GeneratePageImageOptions {
  readonly prompt: string;
  readonly generate?: OpenAiImageGenerator;
}

export async function generatePageImage(
  options: GeneratePageImageOptions,
): Promise<ImageGenerationResult> {
  const generator =
    options.generate ?? (await createDefaultImageGenerator());
  const params: OpenAI.Images.ImageGenerateParamsNonStreaming = {
    model: OPENAI_IMAGE_MODEL,
    prompt: options.prompt,
    size: CLEAN_PLATE_SIZE,
    quality: CLEAN_PLATE_QUALITY,
    output_format: CLEAN_PLATE_OUTPUT_FORMAT,
    n: 1,
    stream: false,
  };
  const outcome = await generator(params);
  const b64Png = outcome.response.data?.[0]?.b64_json;
  if (b64Png === undefined) {
    throw new FoundationError(
      "INVALID_PROVIDER_RESPONSE",
      "gpt-image-2 未返回 base64 图片数据",
    );
  }
  return {
    b64Png,
    usage: outcome.response.usage ?? null,
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

// `deck generate` / `deck regenerate` 两个测试文件共用的夹具。
// 放在非 *.test.ts 文件里：从测试文件 import 会把它的 describe 一并带进来重复执行。
import { chmod, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentSpec, ContentSpecEntry } from "@ppt-maker/core";
import type OpenAI from "openai";
import sharp from "sharp";
import type { OpenAiImageGenerator } from "../src/providers/openai-image.js";

/**
 * 网关**不返回请求的尺寸**：请求 2048x1152 实得 1672×941，高度还在 940/941 间浮动过
 * （RK1 实证，`research/rk1/CONCLUSION.md`）。fake 生成器必须复刻这个行为，
 * 否则「资产尺寸 == 请求参数」这种错误写法在测试里恰好也对。
 */
export const GATEWAY_WIDTH = 1672;
export const GATEWAY_HEIGHT = 941;

function fixturePath(): string {
  return fileURLToPath(
    new URL("../../../fixtures/single-slide/complex-page.png", import.meta.url),
  );
}

export async function fakePageImage(
  width = GATEWAY_WIDTH,
  height = GATEWAY_HEIGHT,
): Promise<Buffer> {
  return sharp(fixturePath())
    .resize(width, height, { fit: "fill" })
    .png()
    .toBuffer();
}

export function fakeGenerator(
  buffer: Buffer,
  requestId = "req_generate_fake",
): OpenAiImageGenerator {
  return async () => ({
    response: {
      created: 0,
      data: [{ b64_json: buffer.toString("base64") }],
      usage: {
        input_tokens: 12,
        output_tokens: 1158,
        total_tokens: 1170,
        input_tokens_details: { image_tokens: 0, text_tokens: 12 },
      },
    } as OpenAI.Images.ImagesResponse,
    requestId,
  });
}

export function buildSpec(overrides: Partial<ContentSpec> = {}): ContentSpec {
  return {
    schemaVersion: 1,
    specId: "spec-test",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    style: { description: "深蓝主色、无衬线中文、大留白" },
    entries: [
      {
        specEntryId: "entry-001",
        pageType: "cover",
        textGroups: [
          { label: "标题", items: ["全球营收概览"] },
          { label: "副标题", items: ["2026 年度回顾"] },
        ],
        visualIntent: "居中大标题，底部渐变分隔线",
        revisionNotes: [],
      },
      {
        specEntryId: "entry-002",
        pageType: "content",
        textGroups: [{ label: "要点", items: ["增长稳健", "成本可控"] }],
        visualIntent: "左文右图两栏",
        revisionNotes: [],
      },
    ],
    ...overrides,
  };
}

export async function writeSpecFile(
  directory: string,
  spec: ContentSpec,
): Promise<string> {
  const path = join(directory, "content-spec.json");
  await writeFile(path, `${JSON.stringify(spec, null, 2)}\n`, "utf8");
  return path;
}

export async function createFakeVisionBinary(
  directory: string,
  fileName: string,
  text: string,
): Promise<string> {
  const path = join(directory, fileName);
  const response = {
    schemaVersion: 1,
    provider: "apple-vision",
    image: { width: GATEWAY_WIDTH, height: GATEWAY_HEIGHT },
    blocks: [
      {
        id: "title",
        text,
        bboxPx: { x: 99, y: 46, width: 321, height: 56 },
        confidence: 0.95,
        rotationDeg: null,
        glyphHints: [],
      },
    ],
  };
  await writeFile(
    path,
    `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(
      JSON.stringify(response),
    )});\n`,
    "utf8",
  );
  await chmod(path, 0o755);
  return path;
}

/** 索引取条目并断言存在——测试里不用 `!`，缺了要当场报错而不是静默 undefined */
export function entryAt(spec: ContentSpec, index: number): ContentSpecEntry {
  const entry = spec.entries[index];
  if (entry === undefined) {
    throw new Error(`测试夹具缺少条目 ${index}`);
  }
  return entry;
}

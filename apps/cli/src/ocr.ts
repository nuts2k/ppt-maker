import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { type OcrProbeResponse, OcrProbeResponseSchema } from "@ppt-maker/core";
import { assertWideImage } from "./image.js";

const execFileAsync = promisify(execFile);

export function defaultVisionBinary(cwd = process.cwd()): string {
  return resolve(cwd, "native/macos-vision-ocr/.build/macos-vision-ocr");
}

export async function runVisionOcr(
  imagePath: string,
  binaryPath = defaultVisionBinary(),
): Promise<OcrProbeResponse> {
  await assertWideImage(imagePath);
  await access(binaryPath).catch(() => {
    throw new Error(
      `Apple Vision 探针尚未构建：${binaryPath}，请先运行 pnpm build:vision`,
    );
  });

  const { stdout } = await execFileAsync(binaryPath, [resolve(imagePath)], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  const raw = JSON.parse(stdout);
  // Vision 偶尔返回微小负坐标（文字靠近页面边缘），clamp 到 0。
  if (Array.isArray(raw.blocks)) {
    for (const block of raw.blocks) {
      if (block.bboxPx) {
        if (typeof block.bboxPx.x === "number" && block.bboxPx.x < 0)
          block.bboxPx.x = 0;
        if (typeof block.bboxPx.y === "number" && block.bboxPx.y < 0)
          block.bboxPx.y = 0;
      }
    }
  }
  return OcrProbeResponseSchema.parse(raw);
}

export async function writeOcrResult(
  result: OcrProbeResponse,
  outputPath: string,
): Promise<void> {
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(
    resolve(outputPath),
    `${JSON.stringify(result, null, 2)}\n`,
    "utf8",
  );
}

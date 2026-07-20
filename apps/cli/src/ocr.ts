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

  return OcrProbeResponseSchema.parse(JSON.parse(stdout));
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

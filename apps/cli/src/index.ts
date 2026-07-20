#!/usr/bin/env node
import { resolve } from "node:path";
import { Command } from "commander";
import {
  assertPptxFontReady,
  collectSystemDoctorReport,
  formatDoctorReport,
} from "./doctor.js";
import { readImageMetadata } from "./image.js";
import { runVisionOcr, writeOcrResult } from "./ocr.js";
import { createPptxProbe } from "./pptx.js";

const program = new Command();

program
  .name("ppt-maker")
  .description("PPT Maker M0 技术基线 CLI")
  .version("0.0.0");

program
  .command("doctor")
  .description("检查本机开发与 PowerPoint 环境")
  .option("--json", "输出结构化 JSON")
  .action((options: { json?: boolean }) => {
    const report = collectSystemDoctorReport();
    process.stdout.write(
      options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${formatDoctorReport(report)}\n`,
    );
    if (report.summary.fail > 0) {
      process.exitCode = 1;
    }
  });

const probe = program.command("probe").description("运行 M0 技术探针");

probe
  .command("image")
  .argument("<image>", "PNG/JPEG 图片")
  .description("读取图片元数据并验证 16:9")
  .action(async (image: string) => {
    const metadata = await readImageMetadata(resolve(image));
    process.stdout.write(`${JSON.stringify(metadata, null, 2)}\n`);
    if (!metadata.aspectRatio.valid) {
      process.exitCode = 1;
    }
  });

probe
  .command("ocr")
  .argument("<image>", "待识别图片")
  .option("-o, --output <path>", "保存 JSON 结果")
  .option("--binary <path>", "Apple Vision 探针二进制路径")
  .description("使用 macOS Apple Vision 进行离线 OCR")
  .action(
    async (image: string, options: { output?: string; binary?: string }) => {
      const result = await runVisionOcr(resolve(image), options.binary);
      if (options.output) {
        await writeOcrResult(result, options.output);
        process.stdout.write(`${resolve(options.output)}\n`);
        return;
      }
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    },
  );

probe
  .command("pptx")
  .argument("<image>", "16:9 背景图片")
  .requiredOption("-o, --output <path>", "输出 PPTX 文件")
  .option("--font-face <name>", "显式覆盖字体，仅用于基线实验")
  .description("生成背景图 + 原生文本框的 16:9 PPTX")
  .action(
    async (image: string, options: { output: string; fontFace?: string }) => {
      assertPptxFontReady(collectSystemDoctorReport(), options.fontFace);
      const probeOptions = {
        imagePath: resolve(image),
        outputPath: resolve(options.output),
        ...(options.fontFace === undefined
          ? {}
          : { fontFace: options.fontFace }),
      };
      const output = await createPptxProbe(probeOptions);
      process.stdout.write(`${output}\n`);
    },
  );

program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`错误：${message}\n`);
  process.exitCode = 1;
});

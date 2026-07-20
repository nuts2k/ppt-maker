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
import { OPENAI_VISION_MODEL } from "./providers/openai-vision.js";
import { runSlideAnalyze } from "./slide/analyze.js";
import { runSlideOcr } from "./slide/ocr.js";
import { createSlideWorkspace } from "./slide/workspace.js";

const program = new Command();

program.name("ppt-maker").description("PPT Maker CLI").version("0.0.0");

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

const slide = program
  .command("slide")
  .description("运行单页可编辑 PPTX 流水线");

slide
  .command("init")
  .argument("<image>", "16:9 PNG/JPEG 源图")
  .requiredOption("--workspace <path>", "新建页面工作区")
  .option("--reference <path>", "可选原始文案参考")
  .description("校验输入并创建可重放的单页工作区")
  .action(
    async (
      image: string,
      options: { workspace: string; reference?: string },
    ) => {
      const workspace = await createSlideWorkspace({
        imagePath: resolve(image),
        workspacePath: resolve(options.workspace),
        ...(options.reference === undefined
          ? {}
          : { referencePath: resolve(options.reference) }),
      });
      process.stdout.write(`${workspace.path}\n`);
    },
  );

slide
  .command("ocr")
  .argument("<workspace>", "页面工作区")
  .option("--binary <path>", "Apple Vision 二进制路径")
  .description("在工作区中运行离线 Apple Vision OCR")
  .action(async (workspace: string, options: { binary?: string }) => {
    const result = await runSlideOcr({
      workspacePath: resolve(workspace),
      ...(options.binary === undefined
        ? {}
        : { binaryPath: resolve(options.binary) }),
    });
    process.stdout.write(`${result.outputPath}\n`);
  });

slide
  .command("analyze")
  .argument("<workspace>", "页面工作区")
  .option("--confirm-upload", "确认上传完整页面到 OpenAI")
  .description("显式调用 OpenAI 视觉理解补充旋转、漏字与分类候选")
  .action(async (workspace: string, options: { confirmUpload?: boolean }) => {
    const result = await runSlideAnalyze({
      workspacePath: resolve(workspace),
      confirmUpload: options.confirmUpload === true,
      onBeforeUpload: (notice) => {
        process.stderr.write(
          `即将上传到 ${OPENAI_VISION_MODEL}：${notice.sentAssets
            .map((asset) => `${asset.path} (${asset.sha256})`)
            .join(", ")}\n`,
        );
      },
    });
    process.stdout.write(`${result.outputPath}\n`);
  });

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

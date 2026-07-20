#!/usr/bin/env node
import { resolve } from "node:path";
import { Command } from "commander";
import { runAcceptClean } from "./clean/accept.js";
import { runSlideClean } from "./clean/run.js";
import {
  assertPptxFontReady,
  collectSystemDoctorReport,
  formatDoctorReport,
} from "./doctor.js";
import { readImageMetadata } from "./image.js";
import { runSlideMask } from "./mask/run.js";
import { runVisionOcr, writeOcrResult } from "./ocr.js";
import { runAcceptPptx } from "./pptx/accept.js";
import { runSlidePptx } from "./pptx/run.js";
import { createPptxProbe } from "./pptx.js";
import { OPENAI_IMAGE_MODEL } from "./providers/openai-image.js";
import { OPENAI_VISION_MODEL } from "./providers/openai-vision.js";
import { formatSlideReport, runSlideReport } from "./report/run.js";
import { runSlideAnalyze } from "./slide/analyze.js";
import { runSlideOcr } from "./slide/ocr.js";
import { runSlideReview } from "./slide/review.js";
import { runSlideRunFrom } from "./slide/run-from.js";
import { runSlideValidateReview } from "./slide/validate-review.js";
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

slide
  .command("review")
  .argument("<workspace>", "页面工作区")
  .description(
    "离线合并 OCR、视觉与参考文案候选，生成可编辑的 text-blocks.json",
  )
  .action(async (workspace: string) => {
    const result = await runSlideReview({
      workspacePath: resolve(workspace),
    });
    process.stdout.write(`${result.outputPath}\n`);
  });

slide
  .command("validate-review")
  .argument("<workspace>", "页面工作区")
  .description("离线校验人工编辑后的 text-blocks.json，违规时非零退出")
  .action(async (workspace: string) => {
    const { reportPath, report } = await runSlideValidateReview({
      workspacePath: resolve(workspace),
    });
    for (const violation of report.violations) {
      process.stderr.write(
        `[${violation.severity}] ${violation.blockId ?? "文档"} ${violation.field}：${violation.message} (${violation.code})\n`,
      );
    }
    process.stdout.write(`${reportPath}\n`);
    process.stdout.write(
      `校验${report.status === "passed" ? "通过" : "未通过"}：错误 ${report.summary.errors}，警告 ${report.summary.warnings}\n`,
    );
    if (report.status !== "passed") {
      process.exitCode = 1;
    }
  });

slide
  .command("mask")
  .argument("<workspace>", "页面工作区")
  .description("离线从已复核结构化文字块派生字形 mask、预览与覆盖率统计")
  .action(async (workspace: string) => {
    const result = await runSlideMask({ workspacePath: resolve(workspace) });
    process.stdout.write(`${result.maskPath}\n`);
    process.stdout.write(
      `掩盖像素 ${result.totalMaskedPixels}${result.reused ? "（复用）" : ""}\n`,
    );
  });

slide
  .command("clean")
  .argument("<workspace>", "页面工作区")
  .option("--confirm-upload", "确认上传源图与 mask 到 OpenAI gpt-image-2")
  .description("显式调用 gpt-image-2 生成 clean plate 底板并计算离线检查产物")
  .action(async (workspace: string, options: { confirmUpload?: boolean }) => {
    const result = await runSlideClean({
      workspacePath: resolve(workspace),
      confirmUpload: options.confirmUpload === true,
      onBeforeUpload: (notice) => {
        process.stderr.write(
          `即将上传到 ${OPENAI_IMAGE_MODEL}：${notice.sentAssets
            .map((asset) => `${asset.path} (${asset.sha256})`)
            .join(", ")}\n`,
        );
      },
    });
    process.stdout.write(`${result.cleanPath}\n`);
  });

slide
  .command("accept-clean")
  .argument("<workspace>", "页面工作区")
  .option("--by <name>", "接受者标识")
  .option("--note <text>", "接受备注")
  .description("记录 clean plate 人工接受；上游变化后接受记录自动 stale")
  .action(
    async (workspace: string, options: { by?: string; note?: string }) => {
      const result = await runAcceptClean({
        workspacePath: resolve(workspace),
        ...(options.by === undefined ? {} : { acceptedBy: options.by }),
        ...(options.note === undefined ? {} : { note: options.note }),
      });
      process.stderr.write(`当前自动检查：${result.autoCheckSummary}\n`);
      process.stdout.write(`${result.acceptedPath}\n`);
    },
  );

slide
  .command("pptx")
  .argument("<workspace>", "页面工作区")
  .option("--font-face <name>", "显式备用字体，仅在微软雅黑不可用时记录偏离")
  .description("用已接受 clean plate 与已复核文字块合成 16:9 可编辑 PPTX")
  .action(async (workspace: string, options: { fontFace?: string }) => {
    const result = await runSlidePptx({
      workspacePath: resolve(workspace),
      ...(options.fontFace === undefined ? {} : { fontFace: options.fontFace }),
    });
    process.stdout.write(`${result.pptxPath}\n`);
    process.stdout.write(`自动检查：${result.checkStatus}\n`);
    if (result.checkStatus !== "passed") {
      process.exitCode = 1;
    }
  });

slide
  .command("accept-pptx")
  .argument("<workspace>", "页面工作区")
  .option("--by <name>", "接受者标识")
  .option("--note <text>", "PowerPoint for Mac 人工检查备注")
  .description("记录 PowerPoint for Mac 人工检查结果；上游变化后自动 stale")
  .action(
    async (workspace: string, options: { by?: string; note?: string }) => {
      const result = await runAcceptPptx({
        workspacePath: resolve(workspace),
        ...(options.by === undefined ? {} : { acceptedBy: options.by }),
        ...(options.note === undefined ? {} : { note: options.note }),
      });
      process.stderr.write(`${result.autoCheckSummary}\n`);
      process.stdout.write(`${result.acceptedPath}\n`);
    },
  );

slide
  .command("report")
  .argument("<workspace>", "页面工作区")
  .option("--json", "输出结构化 JSON")
  .description(
    "分阶段汇总内容/分类/mask/clean/PPTX 自动检查、人工接受与复核耗时",
  )
  .action(async (workspace: string, options: { json?: boolean }) => {
    const { reportPath, report } = await runSlideReport({
      workspacePath: resolve(workspace),
    });
    process.stdout.write(
      options.json
        ? `${JSON.stringify(report, null, 2)}\n`
        : `${formatSlideReport(report)}\n${reportPath}\n`,
    );
    if (report.overallStatus !== "complete") {
      process.exitCode = 1;
    }
  });

slide
  .command("run")
  .argument("<workspace>", "页面工作区")
  .requiredOption("--from <stage>", "从指定阶段起执行本地阶段")
  .description("按 DAG 顺序执行本地阶段，遇上传门和人工门停止并提示下一步")
  .action(async (workspace: string, options: { from: string }) => {
    const result = await runSlideRunFrom(options.from, {
      workspacePath: resolve(workspace),
    });
    process.stdout.write(
      `已执行：${result.executed.length > 0 ? result.executed.join(" → ") : "（无）"}\n`,
    );
    process.stdout.write(`${result.message}\n`);
    if (result.nextCommand !== null) {
      process.stdout.write(`下一步：${result.nextCommand}\n`);
    }
    if (result.gate === "error" || result.gate === "validation-failed") {
      process.exitCode = 1;
    }
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

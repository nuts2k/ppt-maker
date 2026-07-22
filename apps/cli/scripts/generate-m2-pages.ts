import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../../../");
const PROMPTS_PATH = resolve(
  PROJECT_ROOT,
  ".trellis/tasks/07-21-evaluation-suite/research/page-prompts.json",
);
const OUTPUT_DIR = resolve(PROJECT_ROOT, "artifacts/m2-pages");

interface PagePrompt {
  readonly pageNumber: number;
  readonly pageType: string;
  readonly title: string;
  readonly contentDescription: string;
  readonly prompt: string;
}

interface GenerationRecord {
  readonly pageNumber: number;
  readonly title: string;
  readonly pageType: string;
  readonly outputPath: string;
  readonly model: string;
  readonly size: string;
  readonly quality: string;
  readonly requestId: string | null;
  readonly usage: unknown;
  readonly durationMs: number;
  readonly generatedAt: string;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim().length === 0) {
    console.error("缺少 OPENAI_API_KEY");
    process.exit(1);
  }

  const startArg = process.argv[2];
  const startFrom = startArg ? Number.parseInt(startArg, 10) : 1;

  const prompts: PagePrompt[] = JSON.parse(
    await readFile(PROMPTS_PATH, "utf8"),
  );
  console.log(`加载 ${prompts.length} 条提示词，从第 ${startFrom} 页开始生成`);

  await mkdir(OUTPUT_DIR, { recursive: true });

  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });

  const records: GenerationRecord[] = [];
  const recordsPath = resolve(OUTPUT_DIR, "generation-records.json");

  if (existsSync(recordsPath)) {
    const existing = JSON.parse(await readFile(recordsPath, "utf8"));
    records.push(...existing);
  }

  for (const page of prompts) {
    if (page.pageNumber < startFrom) continue;

    const outputPath = resolve(
      OUTPUT_DIR,
      `page-${String(page.pageNumber).padStart(2, "0")}.png`,
    );

    if (existsSync(outputPath)) {
      console.log(
        `第 ${page.pageNumber} 页已存在，跳过: ${page.title}`,
      );
      continue;
    }

    console.log(
      `生成第 ${page.pageNumber}/${prompts.length} 页: ${page.title} (${page.pageType})`,
    );

    const startTime = Date.now();
    try {
      const { data, request_id } = await client.images
        .generate({
          model: "gpt-image-2",
          prompt: page.prompt,
          size: "2048x1152" as Parameters<typeof client.images.generate>[0]["size"],
          quality: "high",
          output_format: "png",
          n: 1,
          stream: false,
        })
        .withResponse();

      const b64 = data.data?.[0]?.b64_json;
      if (!b64) {
        console.error(`  第 ${page.pageNumber} 页未返回图片数据`);
        continue;
      }

      const pngBuffer = Buffer.from(b64, "base64");
      await writeFile(outputPath, pngBuffer);

      const record: GenerationRecord = {
        pageNumber: page.pageNumber,
        title: page.title,
        pageType: page.pageType,
        outputPath: `page-${String(page.pageNumber).padStart(2, "0")}.png`,
        model: "gpt-image-2",
        size: "2048x1152",
        quality: "high",
        requestId: request_id,
        usage: data.usage ?? null,
        durationMs: Date.now() - startTime,
        generatedAt: new Date().toISOString(),
      };
      records.push(record);

      await writeFile(recordsPath, JSON.stringify(records, null, 2));

      console.log(
        `  完成 (${record.durationMs}ms, requestId: ${request_id ?? "N/A"})`,
      );
    } catch (err) {
      const durationMs = Date.now() - startTime;
      console.error(
        `  第 ${page.pageNumber} 页生成失败 (${durationMs}ms):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  console.log(`\n生成完毕，共 ${records.length} 条记录，输出目录: ${OUTPUT_DIR}`);
}

main().catch((err) => {
  console.error("脚本执行失败:", err);
  process.exit(1);
});

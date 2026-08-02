// RK1 实证：gpt-image-2 的 images.generate 能否直出 16:9。
// 一次运行 = 一次真实云调用（计费）。size 由命令行第一个参数指定，默认 2048x1152。
// 结论落盘到同目录 result-<size>.json 与 out-<size>.png，不改动仓库任何产品代码。
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "../../../../..");

// openai 只装在 apps/cli 下（pnpm workspace），脚本不在其目录内，故显式从那里解析。
const requireFromCli = createRequire(join(REPO, "apps/cli/package.json"));
const openaiModule = requireFromCli("openai");
const OpenAI = openaiModule.default ?? openaiModule;

// 只从 .env 读，绝不落盘密钥，也不打印其内容。
function loadEnv() {
  const text = readFileSync(join(REPO, ".env"), "utf8");
  const env = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

// 从 PNG 的 IHDR 直接读实际像素，避免「请求被接受但返回尺寸不符」被漏掉。
function readPngSize(buf) {
  const sig = buf.subarray(0, 8).toString("hex");
  if (sig !== "89504e470d0a1a0a") return { error: `非 PNG，头部=${sig}` };
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const size = process.argv[2] ?? "2048x1152";
const env = loadEnv();
const client = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseURL: env.OPENAI_BASE_URL || undefined,
});

// 提示词刻意简单：本次验的是尺寸能力，不是画面质量。
const prompt =
  "一张 16:9 演示文稿页面：纯深蓝背景，正中一个白色圆形，无任何文字。";

const params = {
  model: "gpt-image-2",
  prompt,
  size,
  quality: "high",
  output_format: "png",
  n: 1,
  stream: false,
};

const startedAt = Date.now();
const record = {
  probedAt: new Date().toISOString(),
  baseUrl: env.OPENAI_BASE_URL || "https://api.openai.com/v1（官方默认）",
  request: { ...params, prompt: `<${prompt.length} 字符>` },
};

try {
  const { data, request_id } = await client.images
    .generate(params)
    .withResponse();
  record.elapsedMs = Date.now() - startedAt;
  record.ok = true;
  record.requestId = request_id ?? null;
  record.usage = data.usage ?? null;
  record.responseSizeField = data.size ?? null;

  const b64 = data.data?.[0]?.b64_json;
  const url = data.data?.[0]?.url;
  if (b64 !== undefined) {
    const buf = Buffer.from(b64, "base64");
    writeFileSync(join(HERE, `out-${size}.png`), buf);
    record.actualPixels = readPngSize(buf);
    record.deliveryMode = "b64_json";
  } else if (url !== undefined) {
    // 网关可能只回 URL 而非 base64——这本身就是要记下的差异。
    const res = await fetch(url);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(join(HERE, `out-${size}.png`), buf);
    record.actualPixels = readPngSize(buf);
    record.deliveryMode = "url";
  } else {
    record.ok = false;
    record.failure = "响应里既无 b64_json 也无 url";
  }
} catch (error) {
  record.elapsedMs = Date.now() - startedAt;
  record.ok = false;
  record.error = {
    name: error?.name ?? null,
    status: error?.status ?? null,
    message: error?.message ?? String(error),
    // 服务端返回的原始错误体是判断「谁拒绝了这个 size」的关键证据。
    body: error?.error ?? null,
    requestId: error?.requestID ?? null,
  };
}

writeFileSync(
  join(HERE, `result-${size}.json`),
  `${JSON.stringify(record, null, 2)}\n`,
);
console.log(JSON.stringify(record, null, 2));

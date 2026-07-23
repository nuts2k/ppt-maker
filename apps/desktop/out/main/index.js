import "dotenv/config";
import { resolve, dirname, join, basename, relative, isAbsolute } from "node:path";
import { ipcMain, dialog, app, BrowserWindow } from "electron";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, mkdtemp, copyFile, rename, rm, writeFile, stat, readdir, access } from "node:fs/promises";
import { assertWideAspectRatio, validateWideAspectRatio, SlideWorkspaceManifestSchema, SlideWorkspaceConfigSchema, FoundationError, SCHEMA_VERSION, createInitialStageStates, DeckManifestSchema, DEFAULT_FONT_FACE, DoctorReportSchema, SUPPORTED_NODE_MAJOR, SUPPORTED_PNPM_MAJOR, PPTX_WIDE_HEIGHT_INCHES, PPTX_WIDE_WIDTH_INCHES, pixelsToPptxBox, assertStageDependenciesCompleted, TextReviewDocumentSchema, isStageReusable, PptxCheckReportSchema, invalidateStageAndDownstream, PptxSynthesisRecordSchema, ArtifactAcceptanceSchema, DeckExportRecordSchema, SLIDE_STAGE_ORDER, CleanAttemptRecordSchema, ProviderCallRecordSchema, OcrProbeResponseSchema, MASK_ALGORITHM_VERSION, maskInvalidationProjection, MaskRecordSchema, TextReviewValidationReportSchema, SlideReportSchema, TextAssistResultSchema, TEXT_MERGE_ALGORITHM_VERSION, mergeTextBlockCandidates, validateTextReviewDocument, REVIEW_VALIDATION_RULES_VERSION } from "@ppt-maker/core";
import { imageSize } from "image-size";
import { execFileSync, execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { arch, platform } from "node:os";
import JSZip from "jszip";
import sharp from "sharp";
import * as PptxGenJSModule from "pptxgenjs";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { promisify } from "node:util";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
async function readImageMetadata(path) {
  const buffer = await readFile(path);
  const dimensions = imageSize(buffer);
  if (!dimensions.width || !dimensions.height || !dimensions.type) {
    throw new Error(`无法读取图片尺寸或格式：${path}`);
  }
  const metadata = {
    path,
    type: dimensions.type,
    width: dimensions.width,
    height: dimensions.height,
    aspectRatio: validateWideAspectRatio({
      width: dimensions.width,
      height: dimensions.height
    })
  };
  return metadata;
}
async function assertWideImage(path) {
  const metadata = await readImageMetadata(path);
  assertWideAspectRatio(metadata);
  return metadata;
}
async function sha256File(path) {
  const hash = createHash("sha256");
  const handle = await readFile(path);
  hash.update(handle);
  return hash.digest("hex");
}
function sha256Values(values) {
  const hash = createHash("sha256");
  for (const value of values) {
    hash.update(String(Buffer.byteLength(value)), "utf8");
    hash.update(":", "utf8");
    hash.update(value, "utf8");
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}
async function writeJsonAtomic(path, value) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}
`, {
      encoding: "utf8",
      flag: "wx"
    });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => void 0);
    throw error;
  }
}
async function writeBufferAtomic(path, buffer) {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${randomUUID()}`;
  try {
    await writeFile(temporary, buffer, { flag: "wx" });
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => void 0);
    throw error;
  }
}
function resolveWorkspacePath(workspacePath, relativePath) {
  const workspace = resolve(workspacePath);
  const target = resolve(workspace, relativePath);
  const fromWorkspace = relative(workspace, target);
  if (fromWorkspace === "" || fromWorkspace === ".." || fromWorkspace.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new FoundationError(
      "PATH_OUTSIDE_WORKSPACE",
      `路径不在工作区内：${relativePath}`,
      { relativePath }
    );
  }
  return target;
}
function normalizeImageFormat(type) {
  if (type === "png" || type === "jpg" || type === "jpeg") {
    return type;
  }
  throw new FoundationError(
    "INVALID_WORKSPACE",
    `slide init 只支持 PNG/JPEG，收到：${type}`,
    { imageType: type }
  );
}
async function createWorkspaceAsset(path, asset) {
  const file = await stat(path);
  return {
    ...asset,
    sha256: await sha256File(path),
    byteSize: file.size
  };
}
function isAlreadyExistsError$1(error) {
  return error instanceof Error && "code" in error && (error.code === "EEXIST" || error.code === "ENOTEMPTY");
}
function isMissingError$1(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
async function assertWorkspaceDoesNotExist(path) {
  try {
    await stat(path);
  } catch (error) {
    if (isMissingError$1(error)) {
      return;
    }
    throw error;
  }
  throw new FoundationError(
    "WORKSPACE_ALREADY_EXISTS",
    `工作区已存在，拒绝覆盖：${path}`,
    { workspacePath: path }
  );
}
async function createSlideWorkspace(options) {
  const imagePath = resolve(options.imagePath);
  const workspacePath = resolve(options.workspacePath);
  const referencePath = options.referencePath === void 0 ? void 0 : resolve(options.referencePath);
  const metadata = await assertWideImage(imagePath);
  const imageFormat = normalizeImageFormat(metadata.type);
  const parent = dirname(workspacePath);
  await mkdir(parent, { recursive: true });
  await assertWorkspaceDoesNotExist(workspacePath);
  const temporaryWorkspace = await mkdtemp(
    join(parent, `.${basename(workspacePath)}.tmp-`)
  );
  try {
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    const slideId = randomUUID();
    const attemptId = "init-001";
    const sourceRelativePath = `inputs/source.${imageFormat}`;
    const sourceTarget = resolveWorkspacePath(
      temporaryWorkspace,
      sourceRelativePath
    );
    await mkdir(dirname(sourceTarget), { recursive: true });
    await copyFile(imagePath, sourceTarget);
    const sourceAsset = await createWorkspaceAsset(sourceTarget, {
      schemaVersion: SCHEMA_VERSION,
      id: "asset-source-image",
      path: sourceRelativePath,
      role: "source_image",
      createdAt,
      producedBy: "init",
      attemptId,
      image: {
        width: metadata.width,
        height: metadata.height,
        format: imageFormat
      }
    });
    let referenceAsset = null;
    if (referencePath !== void 0) {
      const referenceRelativePath = "inputs/reference.txt";
      const referenceTarget = resolveWorkspacePath(
        temporaryWorkspace,
        referenceRelativePath
      );
      await copyFile(referencePath, referenceTarget);
      referenceAsset = await createWorkspaceAsset(referenceTarget, {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-reference-text",
        path: referenceRelativePath,
        role: "reference_text",
        createdAt,
        producedBy: "init",
        attemptId,
        image: null
      });
    }
    const inputFingerprint = sha256Values([
      sourceAsset.sha256,
      referenceAsset?.sha256 ?? "no-reference",
      "workspace-version:1"
    ]);
    const initAttempt = {
      schemaVersion: SCHEMA_VERSION,
      id: attemptId,
      stage: "init",
      number: 1,
      status: "completed",
      inputFingerprint,
      startedAt: createdAt,
      endedAt: createdAt,
      provider: "ppt-maker-cli",
      providerVersion: "0.0.0",
      assetIds: [
        sourceAsset.id,
        ...referenceAsset === null ? [] : [referenceAsset.id]
      ],
      error: null
    };
    const config = {
      schemaVersion: SCHEMA_VERSION,
      slideId,
      aspectRatio: "16:9",
      fontFace: "Microsoft YaHei",
      cloudCalls: "explicit_only",
      sourceImagePath: sourceAsset.path,
      referenceTextPath: referenceAsset?.path ?? null
    };
    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      workspaceVersion: 1,
      slideId,
      createdAt,
      updatedAt: createdAt,
      configPath: "config.json",
      sourceImageAssetId: sourceAsset.id,
      referenceTextAssetId: referenceAsset?.id ?? null,
      assets: [
        sourceAsset,
        ...referenceAsset === null ? [] : [referenceAsset]
      ],
      stages: createInitialStageStates(attemptId, inputFingerprint),
      attempts: [initAttempt]
    };
    await writeJsonAtomic(
      resolveWorkspacePath(temporaryWorkspace, "config.json"),
      SlideWorkspaceConfigSchema.parse(config)
    );
    await writeJsonAtomic(
      resolveWorkspacePath(temporaryWorkspace, "manifest.json"),
      SlideWorkspaceManifestSchema.parse(manifest)
    );
    try {
      await assertWorkspaceDoesNotExist(workspacePath);
      await rename(temporaryWorkspace, workspacePath);
    } catch (error) {
      if (isAlreadyExistsError$1(error)) {
        throw new FoundationError(
          "WORKSPACE_ALREADY_EXISTS",
          `工作区已存在，拒绝覆盖：${workspacePath}`,
          { workspacePath }
        );
      }
      throw error;
    }
    return { path: workspacePath, manifest, config };
  } catch (error) {
    await rm(temporaryWorkspace, { recursive: true, force: true }).catch(
      () => void 0
    );
    throw error;
  }
}
async function loadSlideWorkspace(workspacePath) {
  const path = resolve(workspacePath);
  const manifest = SlideWorkspaceManifestSchema.parse(
    JSON.parse(
      await readFile(resolveWorkspacePath(path, "manifest.json"), "utf8")
    )
  );
  const config = SlideWorkspaceConfigSchema.parse(
    JSON.parse(
      await readFile(resolveWorkspacePath(path, manifest.configPath), "utf8")
    )
  );
  if (manifest.slideId !== config.slideId) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "manifest.json 与 config.json 的 slideId 不一致",
      { manifestSlideId: manifest.slideId, configSlideId: config.slideId }
    );
  }
  return { path, manifest, config };
}
async function writeWorkspaceManifest(workspacePath, manifest) {
  await writeJsonAtomic(
    resolveWorkspacePath(workspacePath, "manifest.json"),
    SlideWorkspaceManifestSchema.parse(manifest)
  );
}
async function assertWorkspaceAssetIntegrity(workspacePath, asset) {
  const path = resolveWorkspacePath(workspacePath, asset.path);
  const file = await stat(path);
  const sha256 = await sha256File(path);
  if (file.size !== asset.byteSize || sha256 !== asset.sha256) {
    throw new FoundationError(
      "ASSET_INTEGRITY_MISMATCH",
      `工作区资产完整性校验失败：${asset.path}`,
      {
        assetId: asset.id,
        expectedSha256: asset.sha256,
        actualSha256: sha256,
        expectedByteSize: asset.byteSize,
        actualByteSize: file.size
      }
    );
  }
}
const IMAGE_EXTENSIONS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg"]);
function resolveDeckPath(deckPath, relativePath) {
  const deck = resolve(deckPath);
  const target = resolve(deck, relativePath);
  const fromDeck = relative(deck, target);
  if (fromDeck === "" || fromDeck === ".." || fromDeck.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)) {
    throw new FoundationError(
      "PATH_OUTSIDE_WORKSPACE",
      `路径不在 deck 工作区内：${relativePath}`,
      { relativePath }
    );
  }
  return target;
}
function isMissingError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
function isAlreadyExistsError(error) {
  return error instanceof Error && "code" in error && (error.code === "EEXIST" || error.code === "ENOTEMPTY");
}
async function assertDeckDoesNotExist(path) {
  try {
    await stat(path);
  } catch (error) {
    if (isMissingError(error)) {
      return;
    }
    throw error;
  }
  throw new FoundationError(
    "WORKSPACE_EXISTS",
    `deck 工作区已存在，拒绝覆盖：${path}`,
    { workspacePath: path }
  );
}
async function scanImageFiles(imagesDir) {
  const entries = await readdir(imagesDir, { withFileTypes: true });
  const images = entries.filter((entry) => entry.isFile()).map((entry) => entry.name).filter((name) => {
    const dot = name.lastIndexOf(".");
    if (dot < 0) {
      return false;
    }
    return IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase());
  });
  images.sort((a, b) => a.localeCompare(b));
  return images;
}
function formatPageNumber$1(index, total) {
  const width = total > 99 ? 3 : 2;
  return String(index).padStart(width, "0");
}
async function createDeckWorkspace(options) {
  const imagesDir = resolve(options.imagesDir);
  const workspacePath = resolve(options.workspacePath);
  const name = options.name ?? basename(workspacePath);
  const imageNames = await scanImageFiles(imagesDir);
  if (imageNames.length === 0) {
    throw new FoundationError(
      "INVALID_INPUT",
      "源图目录中未找到 PNG 或 JPEG 文件",
      { imagesDir }
    );
  }
  const parent = dirname(workspacePath);
  await mkdir(parent, { recursive: true });
  await assertDeckDoesNotExist(workspacePath);
  const temporaryWorkspace = await mkdtemp(
    join(parent, `.${basename(workspacePath)}.tmp-`)
  );
  try {
    await mkdir(resolveDeckPath(temporaryWorkspace, "slides"), {
      recursive: true
    });
    const createdAt = (/* @__PURE__ */ new Date()).toISOString();
    const deckId = randomUUID();
    const slides = [];
    for (const [index, sourceImageName] of imageNames.entries()) {
      const pageNumber = formatPageNumber$1(index + 1, imageNames.length);
      const slideRelativePath = `slides/page-${pageNumber}`;
      const slideWorkspacePath = resolveDeckPath(
        temporaryWorkspace,
        slideRelativePath
      );
      const created = await createSlideWorkspace({
        imagePath: join(imagesDir, sourceImageName),
        workspacePath: slideWorkspacePath
      });
      slides.push({
        slideId: created.manifest.slideId,
        workspacePath: slideRelativePath,
        sourceImageName,
        addedAt: createdAt,
        removedAt: null
      });
    }
    const manifest = {
      schemaVersion: SCHEMA_VERSION,
      deckVersion: 1,
      deckId,
      name,
      createdAt,
      updatedAt: createdAt,
      aspectRatio: "16:9",
      fontFace: "Microsoft YaHei",
      cloudCalls: "explicit_only",
      slides,
      exports: []
    };
    await writeJsonAtomic(
      resolveDeckPath(temporaryWorkspace, "deck-manifest.json"),
      DeckManifestSchema.parse(manifest)
    );
    try {
      await assertDeckDoesNotExist(workspacePath);
      await rename(temporaryWorkspace, workspacePath);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        throw new FoundationError(
          "WORKSPACE_EXISTS",
          `deck 工作区已存在，拒绝覆盖：${workspacePath}`,
          { workspacePath }
        );
      }
      throw error;
    }
    return { path: workspacePath, manifest };
  } catch (error) {
    await rm(temporaryWorkspace, { recursive: true, force: true }).catch(
      () => void 0
    );
    throw error;
  }
}
async function loadDeckWorkspace(workspacePath) {
  const path = resolve(workspacePath);
  const manifest = DeckManifestSchema.parse(
    JSON.parse(
      await readFile(resolveDeckPath(path, "deck-manifest.json"), "utf8")
    )
  );
  return { path, manifest };
}
async function writeDeckManifest(deckPath, manifest) {
  await writeJsonAtomic(
    resolveDeckPath(deckPath, "deck-manifest.json"),
    DeckManifestSchema.parse(manifest)
  );
}
const PAGE_PATTERN = /^slides\/page-(\d+)$/;
function nextPageNumber(slides) {
  let max = 0;
  for (const slide of slides) {
    const match = PAGE_PATTERN.exec(slide.workspacePath);
    if (match?.[1] === void 0) {
      continue;
    }
    const value = Number.parseInt(match[1], 10);
    if (value > max) {
      max = value;
    }
  }
  return max + 1;
}
function formatPageNumber(value) {
  const width = value > 99 ? 3 : 2;
  return String(value).padStart(width, "0");
}
async function addSlideToDeck(options) {
  const { path, manifest } = await loadDeckWorkspace(options.deckPath);
  const pageNumber = formatPageNumber(nextPageNumber(manifest.slides));
  const pageLabel = `page-${pageNumber}`;
  const slideRelativePath = `slides/${pageLabel}`;
  const created = await createSlideWorkspace({
    imagePath: options.imagePath,
    workspacePath: resolveDeckPath(path, slideRelativePath)
  });
  const addedAt = (/* @__PURE__ */ new Date()).toISOString();
  const entry = {
    slideId: created.manifest.slideId,
    workspacePath: slideRelativePath,
    sourceImageName: basename(options.imagePath),
    addedAt,
    removedAt: null
  };
  await writeDeckManifest(path, {
    ...manifest,
    slides: [...manifest.slides, entry],
    updatedAt: addedAt
  });
  return {
    slideId: created.manifest.slideId,
    workspacePath: slideRelativePath,
    pageLabel
  };
}
const POWERPOINT_PATH = "/Applications/Microsoft PowerPoint.app";
const POWERPOINT_FONT_PATHS = [
  `${POWERPOINT_PATH}/Contents/Resources/DFonts/msyh.ttc`,
  `${POWERPOINT_PATH}/Contents/Resources/DFonts/msyhbd.ttc`,
  `${POWERPOINT_PATH}/Contents/Resources/DFonts/msyhl.ttc`
];
function major(version) {
  const match = version.match(/v?(\d+)/);
  return match ? Number(match[1]) : null;
}
function commandCheck(dependencies, id, label, command, args, expectedMajor) {
  try {
    const output = dependencies.run(command, args).trim();
    const actualMajor = expectedMajor === void 0 ? null : major(output);
    if (expectedMajor !== void 0 && actualMajor !== expectedMajor) {
      return {
        id,
        label,
        status: "warn",
        message: `检测到 ${output || "未知版本"}，项目基线要求主版本 ${expectedMajor}`,
        details: { output, expectedMajor }
      };
    }
    return {
      id,
      label,
      status: "pass",
      message: output || "可用"
    };
  } catch (error) {
    return {
      id,
      label,
      status: "fail",
      message: `${label} 不可用`,
      details: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
function collectDoctorReport(dependencies) {
  const checks = [];
  const nodeMajor = major(dependencies.nodeVersion);
  checks.push({
    id: "node",
    label: "Node.js",
    status: nodeMajor === SUPPORTED_NODE_MAJOR ? "pass" : "warn",
    message: nodeMajor === SUPPORTED_NODE_MAJOR ? `${dependencies.nodeVersion} 符合 Node.js ${SUPPORTED_NODE_MAJOR} LTS 基线` : `${dependencies.nodeVersion} 偏离 Node.js ${SUPPORTED_NODE_MAJOR} LTS 基线`,
    details: { expectedMajor: SUPPORTED_NODE_MAJOR, actualMajor: nodeMajor }
  });
  checks.push(
    commandCheck(
      dependencies,
      "pnpm",
      "pnpm",
      "pnpm",
      ["--version"],
      SUPPORTED_PNPM_MAJOR
    )
  );
  checks.push({
    id: "platform",
    label: "运行平台",
    status: dependencies.platform === "darwin" ? "pass" : "fail",
    message: dependencies.platform === "darwin" ? `macOS / ${dependencies.arch}` : `首期只支持 macOS，当前为 ${dependencies.platform} / ${dependencies.arch}`
  });
  checks.push(
    commandCheck(dependencies, "swift", "Swift", "xcrun", [
      "swift",
      "--version"
    ])
  );
  const powerpointInstalled = dependencies.exists(POWERPOINT_PATH);
  checks.push({
    id: "powerpoint",
    label: "Microsoft PowerPoint",
    status: powerpointInstalled ? "pass" : "fail",
    message: powerpointInstalled ? `${POWERPOINT_PATH} 已安装` : `${POWERPOINT_PATH} 不存在`
  });
  const powerpointFontPath = POWERPOINT_FONT_PATHS.find(
    (path) => dependencies.exists(path)
  );
  checks.push({
    id: "font-microsoft-yahei",
    label: DEFAULT_FONT_FACE,
    status: powerpointFontPath ? "pass" : "fail",
    message: powerpointFontPath ? `PowerPoint 内置字体可用：${powerpointFontPath}` : "未发现 PowerPoint 内置微软雅黑；导出前必须显式安装或配置备用字体",
    details: powerpointFontPath ? { source: "powerpoint-bundle", path: powerpointFontPath } : void 0
  });
  const summary = checks.reduce(
    (counts, check) => {
      counts[check.status] += 1;
      return counts;
    },
    { pass: 0, warn: 0, fail: 0 }
  );
  return DoctorReportSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: dependencies.now().toISOString(),
    checks,
    summary
  });
}
function collectSystemDoctorReport() {
  return collectDoctorReport({
    nodeVersion: process.version,
    platform: platform(),
    arch: arch(),
    exists: existsSync,
    run: (command, args) => execFileSync(command, [...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }),
    now: () => /* @__PURE__ */ new Date()
  });
}
function assertPptxFontReady(report, explicitFontFace) {
  if (explicitFontFace !== void 0) {
    return;
  }
  const fontCheck = report.checks.find(
    (check) => check.id === "font-microsoft-yahei"
  );
  if (fontCheck?.status !== "pass") {
    throw new FoundationError(
      "MISSING_DEPENDENCY",
      `${DEFAULT_FONT_FACE} 不可用；请安装字体或通过 --font-face 显式指定备用字体`,
      { check: fontCheck ?? null }
    );
  }
}
const WIDE_RATIO = 16 / 9;
function countMatches(haystack, pattern) {
  return haystack.match(pattern)?.length ?? 0;
}
function unescapeXml(s) {
  return s.replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&apos;", "'").replaceAll("&quot;", '"');
}
async function checkPptx(input) {
  const checks = [];
  const zip = await JSZip.loadAsync(input.pptxBuffer);
  const contentTypes = zip.file("[Content_Types].xml");
  const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");
  const slideXml = await zip.file("ppt/slides/slide1.xml")?.async("string");
  const zipOk = contentTypes !== null && presentationXml !== void 0 && slideXml !== void 0;
  checks.push({
    id: "zip-structure",
    status: zipOk ? "passed" : "failed",
    message: zipOk ? "包含 [Content_Types].xml、presentation.xml 与 slide1.xml" : "PPTX ZIP 结构缺少必要 OOXML 部件"
  });
  const xmlOk = (presentationXml?.includes("<p:presentation") ?? false) && (slideXml?.startsWith("<?xml") ?? false) && (slideXml?.includes("<p:sld") ?? false);
  checks.push({
    id: "xml-parse",
    status: xmlOk ? "passed" : "failed",
    message: xmlOk ? "slide/presentation XML 结构有效" : "XML 根元素缺失"
  });
  const sldSz = presentationXml?.match(
    /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/u
  );
  const widthEmu = sldSz ? Number(sldSz[1]) : 0;
  const heightEmu = sldSz ? Number(sldSz[2]) : 0;
  const aspectRatioOk = heightEmu > 0 && Math.abs(widthEmu / heightEmu - WIDE_RATIO) < 0.01;
  checks.push({
    id: "aspect-ratio",
    status: aspectRatioOk ? "passed" : "failed",
    message: aspectRatioOk ? "版面为 16:9" : `版面比例不符：${widthEmu}x${heightEmu} EMU`,
    details: { widthEmu, heightEmu }
  });
  const slideText = slideXml ?? "";
  const runTexts = [...slideText.matchAll(/<a:t>([^<]*)<\/a:t>/gu)].map((match) => unescapeXml(match[1] ?? "")).join("\n");
  const missingTexts = [];
  for (const expected of input.expectedTexts) {
    const lines = expected.split("\n").filter((line) => line.trim().length > 0);
    const present = lines.every((line) => runTexts.includes(line));
    if (!present) {
      missingTexts.push(expected);
    }
  }
  checks.push({
    id: "text-content",
    status: missingTexts.length === 0 ? "passed" : "failed",
    message: missingTexts.length === 0 ? "全部目标文字内容存在于原生文本层" : `缺失目标文字：${missingTexts.length} 项`,
    details: { missingTexts }
  });
  const fontDeclared = input.expectedTextBoxes === 0 || slideText.includes(`typeface="${input.fontFace}"`);
  checks.push({
    id: "font-declaration",
    status: fontDeclared ? "passed" : "failed",
    message: fontDeclared ? `字体声明为 ${input.fontFace}` : `未声明字体 ${input.fontFace}`
  });
  const images = countMatches(slideText, /<p:pic>/gu);
  const textBoxes = countMatches(slideText, /<p:sp>/gu);
  const shapesOk = images === 1 && textBoxes === input.expectedTextBoxes;
  checks.push({
    id: "shape-count",
    status: shapesOk ? "passed" : "failed",
    message: shapesOk ? `背景图 1 + 文本框 ${textBoxes}` : `形状数量不符：图片 ${images}，文本框 ${textBoxes}（期望 ${input.expectedTextBoxes}）`,
    details: { images, textBoxes, expectedTextBoxes: input.expectedTextBoxes }
  });
  const status = checks.every((check) => check.status === "passed") ? "passed" : "failed";
  return {
    schemaVersion: SCHEMA_VERSION,
    status,
    checks,
    layout: { widthEmu, heightEmu, aspectRatioOk },
    shapes: {
      images,
      textBoxes,
      expectedTextBoxes: input.expectedTextBoxes
    },
    fontFace: input.fontFace,
    fontDeclared,
    missingTexts
  };
}
async function sampleBlockColors(input) {
  const colors = /* @__PURE__ */ new Map();
  const needsSampling = input.blocks.filter(
    (b) => b.style.colorHex === null && b.includeInMask
  );
  if (needsSampling.length === 0) return colors;
  const sourceImage = sharp(input.sourcePath);
  const maskImage = sharp(input.maskPath);
  const sourceMeta = await sourceImage.metadata();
  const maskMeta = await maskImage.metadata();
  if (!sourceMeta.width || !sourceMeta.height) return colors;
  if (!maskMeta.width || !maskMeta.height) return colors;
  for (const block of needsSampling) {
    const hex = await sampleBlockColor(
      input.sourcePath,
      input.maskPath,
      block.bboxPx,
      sourceMeta.width,
      sourceMeta.height,
      maskMeta.width,
      maskMeta.height
    );
    if (hex !== null) {
      colors.set(block.id, hex);
    }
  }
  return colors;
}
async function sampleBlockColor(sourcePath, maskPath, bbox, srcW, srcH, maskW, maskH) {
  const left = Math.max(0, Math.round(bbox.x));
  const top = Math.max(0, Math.round(bbox.y));
  const width = Math.min(Math.round(bbox.width), srcW - left);
  const height = Math.min(Math.round(bbox.height), srcH - top);
  if (width <= 0 || height <= 0) return null;
  const maskLeft = Math.max(0, Math.round(bbox.x / srcW * maskW));
  const maskTop = Math.max(0, Math.round(bbox.y / srcH * maskH));
  const maskWidth = Math.min(
    Math.round(bbox.width / srcW * maskW),
    maskW - maskLeft
  );
  const maskHeight = Math.min(
    Math.round(bbox.height / srcH * maskH),
    maskH - maskTop
  );
  if (maskWidth <= 0 || maskHeight <= 0) return null;
  const [srcRegion, maskRegion] = await Promise.all([
    sharp(sourcePath).extract({ left, top, width, height }).resize(maskWidth, maskHeight, { fit: "fill" }).ensureAlpha().raw().toBuffer(),
    sharp(maskPath).extract({
      left: maskLeft,
      top: maskTop,
      width: maskWidth,
      height: maskHeight
    }).ensureAlpha().raw().toBuffer()
  ]);
  const pixelCount = maskWidth * maskHeight;
  const bgHistogram = /* @__PURE__ */ new Map();
  for (let i = 0; i < pixelCount; i++) {
    const maskAlpha = maskRegion[i * 4 + 3];
    if (maskAlpha === void 0 || maskAlpha === 0) continue;
    const r2 = srcRegion[i * 4] ?? 0;
    const g2 = srcRegion[i * 4 + 1] ?? 0;
    const b2 = srcRegion[i * 4 + 2] ?? 0;
    const key = r2 >> 4 << 8 | g2 >> 4 << 4 | b2 >> 4;
    bgHistogram.set(key, (bgHistogram.get(key) ?? 0) + 1);
  }
  let bgR = -1;
  let bgG = -1;
  let bgB = -1;
  if (bgHistogram.size > 0) {
    let bestKey = 0;
    let bestCount = -1;
    for (const [key, count] of bgHistogram) {
      if (count > bestCount) {
        bestCount = count;
        bestKey = key;
      }
    }
    bgR = (bestKey >> 8 & 15) * 16 + 8;
    bgG = (bestKey >> 4 & 15) * 16 + 8;
    bgB = (bestKey & 15) * 16 + 8;
  }
  const BG_DIST_SQ = 30 * 30;
  const rValues = [];
  const gValues = [];
  const bValues = [];
  for (let i = 0; i < pixelCount; i++) {
    const maskAlpha = maskRegion[i * 4 + 3];
    if (maskAlpha === void 0 || maskAlpha > 0) continue;
    const r2 = srcRegion[i * 4];
    const g2 = srcRegion[i * 4 + 1];
    const b2 = srcRegion[i * 4 + 2];
    if (r2 === void 0 || g2 === void 0 || b2 === void 0) continue;
    if (bgR >= 0) {
      const dr = r2 - bgR;
      const dg = g2 - bgG;
      const db = b2 - bgB;
      if (dr * dr + dg * dg + db * db < BG_DIST_SQ) continue;
    }
    rValues.push(r2);
    gValues.push(g2);
    bValues.push(b2);
  }
  if (rValues.length < 3) return null;
  const median = (arr) => {
    arr.sort((a2, b3) => a2 - b3);
    const mid = Math.floor(arr.length / 2);
    const a = arr[mid - 1] ?? 0;
    const b2 = arr[mid] ?? 0;
    return arr.length % 2 === 0 ? a + b2 >> 1 : b2;
  };
  const r = median(rValues);
  const g = median(gValues);
  const b = median(bValues);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
const PptxGenJS$1 = PptxGenJSModule.default;
function fontSizePtFromPx(fontSizePx, imageWidth) {
  return fontSizePx * 72 * PPTX_WIDE_WIDTH_INCHES / imageWidth;
}
function resolveFontSizePt(block, imageWidth) {
  if (block.style.fontSizePx !== null) {
    return fontSizePtFromPx(block.style.fontSizePx, imageWidth);
  }
  const lineCount = Math.max(1, block.lines.length);
  const estimatedPx = block.bboxPx.height / lineCount * 0.65;
  return fontSizePtFromPx(estimatedPx, imageWidth);
}
function toBold(weight) {
  return weight === "semibold" || weight === "bold";
}
function toAlign(align) {
  return align ?? "left";
}
function toValign(align) {
  return align === "middle" ? "middle" : "top";
}
function normalizeRotation(rotationDeg) {
  const wrapped = rotationDeg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}
async function synthesizePptx(input) {
  const outputPath = resolve(input.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  const pptx = new PptxGenJS$1();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "PPT Maker";
  pptx.subject = "M1 single slide";
  pptx.title = "PPT Maker M1 Slide";
  pptx.company = "PPT Maker";
  pptx.lang = "zh-CN";
  const slide = pptx.addSlide();
  slide.addImage({
    path: resolve(input.cleanPlatePath),
    x: 0,
    y: 0,
    w: PPTX_WIDE_WIDTH_INCHES,
    h: PPTX_WIDE_HEIGHT_INCHES
  });
  const image = { width: input.imageWidth, height: input.imageHeight };
  const ordered = [...input.blocks].sort((a, b) => a.zIndex - b.zIndex);
  const textContents = [];
  for (const block of ordered) {
    const box = pixelsToPptxBox(block.bboxPx, image);
    const text = block.lines.length > 0 ? block.lines.join("\n") : block.text;
    textContents.push(text);
    const rotate = normalizeRotation(block.rotationDeg);
    const options = {
      x: box.x,
      y: box.y,
      w: box.width,
      h: box.height,
      fontFace: input.fontFace,
      fontSize: resolveFontSizePt(block, input.imageWidth),
      color: (block.style.colorHex ?? "#333333").replace("#", "").toUpperCase(),
      bold: toBold(block.style.fontWeight),
      align: toAlign(block.style.horizontalAlign),
      valign: toValign(block.style.verticalAlign),
      margin: 0,
      ...rotate === 0 ? {} : { rotate },
      ...block.style.lineHeight === null ? {} : { lineSpacingMultiple: block.style.lineHeight }
    };
    slide.addText(text, options);
  }
  await pptx.writeFile({ fileName: outputPath });
  return {
    outputPath,
    textContents,
    textBoxCount: ordered.length,
    fontFace: input.fontFace
  };
}
const REVIEW_OUTPUT_PATH$6 = "stages/review/text-blocks.json";
const PPTX_PATH = "stages/pptx/slide.pptx";
const CHECK_PATH = "stages/pptx/check.json";
const RECORD_PATH$1 = "stages/pptx/record.json";
const PPTX_SYNTHESIS_VERSION = "pptx-synthesis-v7";
function replaceStageState$7(states, replacement) {
  return states.map(
    (state) => state.stage === replacement.stage ? replacement : state
  );
}
function replaceAttempt$5(attempts, replacement) {
  return attempts.map(
    (attempt) => attempt.id === replacement.id ? replacement : attempt
  );
}
function findAssetById$3(manifest, assetId) {
  const asset = manifest.assets.find((candidate) => candidate.id === assetId);
  if (asset === void 0) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      `manifest 未引用有效资产：${assetId}`,
      { assetId }
    );
  }
  return asset;
}
function stageError$3(error) {
  if (error instanceof FoundationError) {
    return {
      code: error.code,
      message: error.message,
      ...error.details === void 0 ? {} : { details: error.details }
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : String(error)
  };
}
function selectTextBoxBlocks(blocks) {
  const unreviewed = blocks.filter(
    (block) => block.classification === "layout_text" && block.reviewStatus === "unreviewed"
  );
  if (unreviewed.length > 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "存在未复核的版式目标文字，无法导出 PPTX",
      { blockIds: unreviewed.map((block) => block.id) }
    );
  }
  return blocks.filter((block) => block.classification === "layout_text");
}
async function assertAcceptedCleanPlate(workspacePath, manifest) {
  const acceptState = manifest.stages.find(
    (state) => state.stage === "accept-clean"
  );
  if (acceptState?.status !== "completed") {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "clean plate 未接受或接受记录已 stale，无法导出 PPTX",
      { acceptCleanStatus: acceptState?.status ?? "missing" }
    );
  }
  const acceptanceAsset = manifest.assets.find(
    (asset) => asset.role === "clean_acceptance"
  );
  if (acceptanceAsset === void 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "缺少 clean plate 接受记录"
    );
  }
  await assertWorkspaceAssetIntegrity(workspacePath, acceptanceAsset);
  const acceptance = ArtifactAcceptanceSchema.parse(
    JSON.parse(
      await readFile(
        resolveWorkspacePath(workspacePath, acceptanceAsset.path),
        "utf8"
      )
    )
  );
  const cleanAsset = manifest.assets.find(
    (asset) => asset.id === acceptance.artifactAssetId
  );
  if (cleanAsset === void 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "接受记录引用的 clean plate 产物不存在"
    );
  }
  await assertWorkspaceAssetIntegrity(workspacePath, cleanAsset);
  if (acceptance.artifactSha256 !== cleanAsset.sha256) {
    throw new FoundationError(
      "ASSET_INTEGRITY_MISMATCH",
      "clean plate 接受记录的哈希与当前产物不一致"
    );
  }
  return cleanAsset;
}
async function runSlidePptx(options) {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "pptx");
  const fontFace = options.fontFace ?? DEFAULT_FONT_FACE;
  const fontFallback = fontFace !== DEFAULT_FONT_FACE;
  const report = options.doctorReport ?? collectSystemDoctorReport();
  assertPptxFontReady(report, options.fontFace);
  const source = findAssetById$3(
    workspace.manifest,
    workspace.manifest.sourceImageAssetId
  );
  await assertWorkspaceAssetIntegrity(workspace.path, source);
  if (source.image === null) {
    throw new FoundationError("INVALID_WORKSPACE", "源图资产缺少尺寸元数据");
  }
  const cleanAsset = await assertAcceptedCleanPlate(
    workspace.path,
    workspace.manifest
  );
  const reviewPath = resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH$6);
  const reviewDocumentSha256 = await sha256File(reviewPath);
  const document = TextReviewDocumentSchema.parse(
    JSON.parse(await readFile(reviewPath, "utf8"))
  );
  const boxBlocks = selectTextBoxBlocks(document.blocks);
  const inputFingerprint = sha256Values([
    cleanAsset.sha256,
    reviewDocumentSha256,
    fontFace,
    PPTX_SYNTHESIS_VERSION
  ]);
  const previousState = workspace.manifest.stages.find(
    (state) => state.stage === "pptx"
  );
  if (previousState === void 0) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 pptx 阶段状态");
  }
  if (isStageReusable(previousState, inputFingerprint) && previousState.lastSuccessfulAttemptId !== null) {
    const pptxAsset = workspace.manifest.assets.find(
      (asset) => asset.role === "pptx"
    );
    const checkAsset = workspace.manifest.assets.find(
      (asset) => asset.role === "pptx_check"
    );
    if (pptxAsset !== void 0 && checkAsset !== void 0) {
      await assertWorkspaceAssetIntegrity(workspace.path, pptxAsset);
      const check = PptxCheckReportSchema.parse(
        JSON.parse(
          await readFile(
            resolveWorkspacePath(workspace.path, checkAsset.path),
            "utf8"
          )
        )
      );
      return {
        pptxPath: resolveWorkspacePath(workspace.path, pptxAsset.path),
        attemptId: previousState.lastSuccessfulAttemptId,
        reused: true,
        checkStatus: check.status
      };
    }
  }
  const attemptNumber = workspace.manifest.attempts.filter((attempt) => attempt.stage === "pptx").length + 1;
  const attemptId = `pptx-${String(attemptNumber).padStart(3, "0")}`;
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const invalidatedStates = previousState.completedInputFingerprint !== null && previousState.completedInputFingerprint !== inputFingerprint ? invalidateStageAndDownstream(
    workspace.manifest.stages,
    "pptx",
    "pptx 输入指纹变化",
    startedAt
  ) : workspace.manifest.stages;
  const invalidatedState = invalidatedStates.find(
    (state) => state.stage === "pptx"
  );
  if (invalidatedState === void 0) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 pptx 阶段状态");
  }
  const runningAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "pptx",
    number: attemptNumber,
    status: "running",
    inputFingerprint,
    startedAt,
    endedAt: null,
    provider: "ppt-maker-cli",
    providerVersion: PPTX_SYNTHESIS_VERSION,
    assetIds: [],
    error: null
  };
  const runningState = {
    ...invalidatedState,
    status: "running",
    latestAttemptId: attemptId,
    invalidatedAt: null,
    invalidationReason: null
  };
  const runningManifest = {
    ...workspace.manifest,
    updatedAt: startedAt,
    stages: replaceStageState$7(invalidatedStates, runningState),
    attempts: [...workspace.manifest.attempts, runningAttempt]
  };
  await writeWorkspaceManifest(workspace.path, runningManifest);
  try {
    const sourcePath = resolveWorkspacePath(workspace.path, source.path);
    const maskPath = resolveWorkspacePath(
      workspace.path,
      "stages/mask/mask.png"
    );
    const sampledColors = await sampleBlockColors({
      sourcePath,
      maskPath,
      blocks: boxBlocks,
      imageWidth: source.image.width,
      imageHeight: source.image.height
    });
    const coloredBlocks = boxBlocks.map((block) => {
      const hex = sampledColors.get(block.id);
      if (hex === void 0 || block.style.colorHex !== null) return block;
      return { ...block, style: { ...block.style, colorHex: hex } };
    });
    const pptxPath = resolveWorkspacePath(workspace.path, PPTX_PATH);
    const synthesis = await synthesizePptx({
      cleanPlatePath: resolveWorkspacePath(workspace.path, cleanAsset.path),
      outputPath: pptxPath,
      blocks: coloredBlocks,
      imageWidth: source.image.width,
      imageHeight: source.image.height,
      fontFace
    });
    const pptxBuffer = await readFile(pptxPath);
    const check = PptxCheckReportSchema.parse(
      await checkPptx({
        pptxBuffer,
        expectedTexts: synthesis.textContents,
        fontFace,
        expectedTextBoxes: synthesis.textBoxCount
      })
    );
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, CHECK_PATH),
      check
    );
    const endedAt = (/* @__PURE__ */ new Date()).toISOString();
    const pptxAsset = await createWorkspaceAsset(pptxPath, {
      schemaVersion: SCHEMA_VERSION,
      id: "asset-pptx",
      path: PPTX_PATH,
      role: "pptx",
      createdAt: endedAt,
      producedBy: "pptx",
      attemptId,
      image: null
    });
    const checkAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, CHECK_PATH),
      {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-pptx-check",
        path: CHECK_PATH,
        role: "pptx_check",
        createdAt: endedAt,
        producedBy: "pptx",
        attemptId,
        image: null
      }
    );
    const record = PptxSynthesisRecordSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      attemptId,
      cleanPlateSha256: cleanAsset.sha256,
      reviewDocumentSha256,
      fontFace,
      fontFallback,
      textBoxCount: synthesis.textBoxCount,
      resultSha256: pptxAsset.sha256,
      checkSha256: checkAsset.sha256,
      checkStatus: check.status
    });
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, RECORD_PATH$1),
      record
    );
    const recordAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, RECORD_PATH$1),
      {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-pptx-record",
        path: RECORD_PATH$1,
        role: "pptx_record",
        createdAt: endedAt,
        producedBy: "pptx",
        attemptId,
        image: null
      }
    );
    const newAssets = [pptxAsset, checkAsset, recordAsset];
    const newAssetIds = new Set(newAssets.map((asset) => asset.id));
    const completedAttempt = {
      ...runningAttempt,
      status: "completed",
      endedAt,
      assetIds: newAssets.map((asset) => asset.id)
    };
    const completedState = {
      ...runningState,
      status: "completed",
      lastSuccessfulAttemptId: attemptId,
      completedInputFingerprint: inputFingerprint
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      assets: [
        ...runningManifest.assets.filter((asset) => !newAssetIds.has(asset.id)),
        ...newAssets
      ],
      stages: replaceStageState$7(runningManifest.stages, completedState),
      attempts: replaceAttempt$5(runningManifest.attempts, completedAttempt)
    });
    return {
      pptxPath,
      attemptId,
      reused: false,
      checkStatus: check.status
    };
  } catch (error) {
    const endedAt = (/* @__PURE__ */ new Date()).toISOString();
    const failedAttempt = {
      ...runningAttempt,
      status: "failed",
      endedAt,
      error: stageError$3(error)
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      stages: replaceStageState$7(runningManifest.stages, {
        ...runningState,
        status: "failed"
      }),
      attempts: replaceAttempt$5(runningManifest.attempts, failedAttempt)
    });
    throw error;
  }
}
const PptxGenJS = PptxGenJSModule.default;
const PLACEHOLDER_LABEL = "待完成";
function addNativeSlide(pptx, input, fontFace) {
  const slide = pptx.addSlide();
  slide.addImage({
    path: resolve(input.cleanPlatePath ?? input.sourcePath),
    x: 0,
    y: 0,
    w: PPTX_WIDE_WIDTH_INCHES,
    h: PPTX_WIDE_HEIGHT_INCHES
  });
  const image = { width: input.imageWidth, height: input.imageHeight };
  const ordered = [...input.blocks ?? []].sort((a, b) => a.zIndex - b.zIndex);
  for (const block of ordered) {
    const box = pixelsToPptxBox(block.bboxPx, image);
    const text = block.lines.length > 0 ? block.lines.join("\n") : block.text;
    const rotate = normalizeRotation(block.rotationDeg);
    const options = {
      x: box.x,
      y: box.y,
      w: box.width,
      h: box.height,
      fontFace,
      fontSize: resolveFontSizePt(block, input.imageWidth),
      color: (block.style.colorHex ?? "#333333").replace("#", "").toUpperCase(),
      bold: toBold(block.style.fontWeight),
      align: toAlign(block.style.horizontalAlign),
      valign: toValign(block.style.verticalAlign),
      margin: 0,
      ...rotate === 0 ? {} : { rotate },
      ...block.style.lineHeight === null ? {} : { lineSpacingMultiple: block.style.lineHeight }
    };
    slide.addText(text, options);
  }
}
function addPlaceholderSlide(pptx, input, fontFace) {
  const slide = pptx.addSlide();
  slide.addImage({
    path: resolve(input.sourcePath),
    x: 0,
    y: 0,
    w: PPTX_WIDE_WIDTH_INCHES,
    h: PPTX_WIDE_HEIGHT_INCHES
  });
  const labelWidth = 6;
  const labelHeight = 1.5;
  slide.addText(PLACEHOLDER_LABEL, {
    x: (PPTX_WIDE_WIDTH_INCHES - labelWidth) / 2,
    y: (PPTX_WIDE_HEIGHT_INCHES - labelHeight) / 2,
    w: labelWidth,
    h: labelHeight,
    fontFace,
    fontSize: 36,
    color: "000000",
    bold: true,
    align: "center",
    valign: "middle",
    margin: 0,
    fill: { color: "FFFFFF", transparency: 30 }
  });
}
async function synthesizeDeckPptx(input) {
  const outputPath = resolve(input.outputPath);
  await mkdir(dirname(outputPath), { recursive: true });
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "PPT Maker";
  pptx.subject = input.deckName;
  pptx.title = input.deckName;
  pptx.company = "PPT Maker";
  pptx.lang = "zh-CN";
  let nativeSlides = 0;
  let placeholderSlides = 0;
  for (const slide of input.slides) {
    if (slide.type === "native") {
      addNativeSlide(pptx, slide, input.fontFace);
      nativeSlides += 1;
    } else {
      addPlaceholderSlide(pptx, slide, input.fontFace);
      placeholderSlides += 1;
    }
  }
  await pptx.writeFile({ fileName: outputPath });
  return {
    outputPath,
    totalSlides: input.slides.length,
    nativeSlides,
    placeholderSlides
  };
}
const REVIEW_OUTPUT_PATH$5 = "stages/review/text-blocks.json";
const MASK_PATH$1 = "stages/mask/mask.png";
function isAcceptPptxCompleted(stages) {
  return stages.some(
    (state) => state.stage === "accept-pptx" && state.status === "completed"
  );
}
async function buildNativeSlide(slideWorkspacePath, pageLabel) {
  const workspace = await loadSlideWorkspace(slideWorkspacePath);
  const source = workspace.manifest.assets.find(
    (asset) => asset.id === workspace.manifest.sourceImageAssetId
  );
  if (source === void 0 || source.image === null) {
    throw new FoundationError("INVALID_WORKSPACE", "源图资产缺少尺寸元数据", {
      pageLabel
    });
  }
  await assertWorkspaceAssetIntegrity(workspace.path, source);
  const cleanAsset = await assertAcceptedCleanPlate(
    workspace.path,
    workspace.manifest
  );
  const reviewPath = resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH$5);
  const document = TextReviewDocumentSchema.parse(
    JSON.parse(await readFile(reviewPath, "utf8"))
  );
  const boxBlocks = selectTextBoxBlocks(document.blocks);
  const sourcePath = resolveWorkspacePath(workspace.path, source.path);
  const sampledColors = await sampleBlockColors({
    sourcePath,
    maskPath: resolveWorkspacePath(workspace.path, MASK_PATH$1),
    blocks: boxBlocks,
    imageWidth: source.image.width,
    imageHeight: source.image.height
  });
  const coloredBlocks = boxBlocks.map((block) => {
    const hex = sampledColors.get(block.id);
    if (hex === void 0 || block.style.colorHex !== null) return block;
    return { ...block, style: { ...block.style, colorHex: hex } };
  });
  return {
    type: "native",
    cleanPlatePath: resolveWorkspacePath(workspace.path, cleanAsset.path),
    blocks: coloredBlocks,
    imageWidth: source.image.width,
    imageHeight: source.image.height,
    sourcePath,
    pageLabel
  };
}
async function buildPlaceholderSlide(slideWorkspacePath, pageLabel) {
  const workspace = await loadSlideWorkspace(slideWorkspacePath);
  const source = workspace.manifest.assets.find(
    (asset) => asset.id === workspace.manifest.sourceImageAssetId
  );
  if (source === void 0) {
    throw new FoundationError("INVALID_WORKSPACE", "缺少源图资产", {
      pageLabel
    });
  }
  const width = source.image?.width ?? 0;
  const height = source.image?.height ?? 0;
  return {
    type: "placeholder",
    imageWidth: width,
    imageHeight: height,
    sourcePath: resolveWorkspacePath(workspace.path, source.path),
    pageLabel
  };
}
async function exportDeckPptx(options) {
  const deck = await loadDeckWorkspace(options.deckPath);
  const activeSlides = deck.manifest.slides.filter(
    (slide) => slide.removedAt === null
  );
  const fontFace = options.fontFace ?? DEFAULT_FONT_FACE;
  const prepared = [];
  for (const entry of activeSlides) {
    const slideWorkspacePath = resolveDeckPath(deck.path, entry.workspacePath);
    const workspace = await loadSlideWorkspace(slideWorkspacePath);
    const completed = isAcceptPptxCompleted(workspace.manifest.stages);
    const pageLabel = entry.workspacePath.split("/").pop() ?? entry.slideId;
    prepared.push({ entry, completed, slideWorkspacePath, pageLabel });
  }
  if (options.strict === true) {
    const incomplete = prepared.filter((item) => !item.completed).map((item) => item.pageLabel);
    if (incomplete.length > 0) {
      throw new FoundationError(
        "INVALID_STAGE_STATE",
        "strict 模式要求所有页完成 accept-pptx，仍有未完成页",
        { incomplete }
      );
    }
  }
  const slides = [];
  for (const item of prepared) {
    if (item.completed) {
      slides.push(
        await buildNativeSlide(item.slideWorkspacePath, item.pageLabel)
      );
    } else {
      slides.push(
        await buildPlaceholderSlide(item.slideWorkspacePath, item.pageLabel)
      );
    }
  }
  const outputPath = isAbsolute(options.outputPath) ? resolve(options.outputPath) : resolveDeckPath(deck.path, options.outputPath);
  const synthesis = await synthesizeDeckPptx({
    slides,
    outputPath,
    fontFace,
    deckName: deck.manifest.name
  });
  const outputSha256 = await sha256File(outputPath);
  const exportedAt = (/* @__PURE__ */ new Date()).toISOString();
  const exportId = `deck-export-${String(deck.manifest.exports.length + 1).padStart(3, "0")}`;
  const relativeOutput = relative(deck.path, outputPath).split("\\").join("/");
  const recordOutputPath = relativeOutput === "" || relativeOutput.split("/").includes("..") ? basename(outputPath) : relativeOutput;
  const record = DeckExportRecordSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: exportId,
    exportedAt,
    outputPath: recordOutputPath,
    outputSha256,
    totalSlides: synthesis.totalSlides,
    nativeSlides: synthesis.nativeSlides,
    placeholderSlides: synthesis.placeholderSlides,
    strict: options.strict === true
  });
  const nextManifest = {
    ...deck.manifest,
    updatedAt: exportedAt,
    exports: [...deck.manifest.exports, record]
  };
  await writeDeckManifest(deck.path, nextManifest);
  return {
    outputPath,
    totalSlides: synthesis.totalSlides,
    nativeSlides: synthesis.nativeSlides,
    placeholderSlides: synthesis.placeholderSlides,
    exportId
  };
}
function normalizePageLabel(pageLabel) {
  return pageLabel.startsWith("slides/") ? pageLabel : `slides/${pageLabel}`;
}
async function removeSlideFromDeck(options) {
  const { path, manifest } = await loadDeckWorkspace(options.deckPath);
  const workspacePath = normalizePageLabel(options.pageLabel);
  const target = manifest.slides.find(
    (slide) => slide.workspacePath === workspacePath
  );
  if (target === void 0) {
    throw new FoundationError("INVALID_INPUT", `未找到页面：${workspacePath}`, {
      workspacePath
    });
  }
  if (target.removedAt !== null) {
    throw new FoundationError(
      "INVALID_INPUT",
      `页面已被移除：${workspacePath}`,
      { workspacePath, removedAt: target.removedAt }
    );
  }
  const removedAt = (/* @__PURE__ */ new Date()).toISOString();
  await writeDeckManifest(path, {
    ...manifest,
    slides: manifest.slides.map(
      (slide) => slide.workspacePath === workspacePath ? { ...slide, removedAt } : slide
    ),
    updatedAt: removedAt
  });
  return {
    slideId: target.slideId,
    workspacePath,
    removedAt
  };
}
const FAILURE_STATUSES = /* @__PURE__ */ new Set(["failed", "interrupted", "stale"]);
SLIDE_STAGE_ORDER.indexOf("accept-pptx");
function computeProgress(stages) {
  const byStage = new Map(stages.map((state) => [state.stage, state]));
  let currentStage = "init";
  for (const stage of SLIDE_STAGE_ORDER) {
    if (byStage.get(stage)?.status === "completed") {
      currentStage = stage;
    }
  }
  const currentIndex = SLIDE_STAGE_ORDER.indexOf(currentStage);
  const nextStage = SLIDE_STAGE_ORDER[currentIndex + 1];
  const nextStatus = nextStage === void 0 ? void 0 : byStage.get(nextStage)?.status;
  const stageStatus2 = nextStatus !== void 0 && FAILURE_STATUSES.has(nextStatus) ? nextStatus : byStage.get(currentStage)?.status ?? "completed";
  return {
    currentStage,
    stageStatus: stageStatus2,
    acceptPptxCompleted: byStage.get("accept-pptx")?.status === "completed"
  };
}
async function deckStatus(deckPath) {
  const deck = await loadDeckWorkspace(deckPath);
  const slides = [];
  let completed = 0;
  let notStarted = 0;
  let inProgress = 0;
  let removed = 0;
  for (const entry of deck.manifest.slides) {
    if (entry.removedAt !== null) {
      removed += 1;
      slides.push({
        slideId: entry.slideId,
        workspacePath: entry.workspacePath,
        sourceImageName: entry.sourceImageName,
        currentStage: "init",
        stageStatus: "removed",
        removed: true
      });
      continue;
    }
    const workspace = await loadSlideWorkspace(
      resolveDeckPath(deck.path, entry.workspacePath)
    );
    const progress = computeProgress(workspace.manifest.stages);
    slides.push({
      slideId: entry.slideId,
      workspacePath: entry.workspacePath,
      sourceImageName: entry.sourceImageName,
      currentStage: progress.currentStage,
      stageStatus: progress.stageStatus,
      removed: false
    });
    if (progress.acceptPptxCompleted) {
      completed += 1;
    } else if (progress.currentStage === "init") {
      notStarted += 1;
    } else {
      inProgress += 1;
    }
  }
  const total = deck.manifest.slides.length;
  const active = total - removed;
  return {
    name: deck.manifest.name,
    deckId: deck.manifest.deckId,
    slides,
    summary: {
      total,
      active,
      removed,
      completed,
      inProgress,
      notStarted
    }
  };
}
async function buildDeckStatus(deckPath) {
  const status = await deckStatus(resolve(deckPath));
  return {
    deckPath,
    name: status.name,
    deckId: status.deckId,
    slides: status.slides,
    summary: status.summary
  };
}
function registerDeckHandlers(_mainWindow) {
  ipcMain.handle(
    "deck:open",
    async (_event, path) => {
      return buildDeckStatus(path);
    }
  );
  ipcMain.handle(
    "deck:create",
    async (_event, imagesDir, workspacePath, name) => {
      const result = await createDeckWorkspace({
        imagesDir: resolve(imagesDir),
        workspacePath: resolve(workspacePath),
        ...name ? { name } : {}
      });
      return buildDeckStatus(result.path);
    }
  );
  ipcMain.handle(
    "deck:status",
    async (_event, path) => {
      return buildDeckStatus(path);
    }
  );
  ipcMain.handle(
    "deck:export",
    async (_event, deckPath, outputPath, strict) => {
      const result = await exportDeckPptx({
        deckPath: resolve(deckPath),
        outputPath,
        ...strict === true ? { strict: true } : {}
      });
      return {
        outputPath: result.outputPath,
        totalSlides: result.totalSlides,
        nativeSlides: result.nativeSlides,
        placeholderSlides: result.placeholderSlides
      };
    }
  );
  ipcMain.handle(
    "deck:add-slide",
    async (_event, deckPath, imagePath) => {
      const result = await addSlideToDeck({
        deckPath: resolve(deckPath),
        imagePath: resolve(imagePath)
      });
      return { pageLabel: result.pageLabel, slideId: result.slideId };
    }
  );
  ipcMain.handle(
    "deck:remove-slide",
    async (_event, deckPath, pageLabel) => {
      await removeSlideFromDeck({
        deckPath: resolve(deckPath),
        pageLabel
      });
    }
  );
}
const ACCEPTED_PATH$1 = "stages/clean/accepted.json";
const ACCEPTANCE_ASSET_ID$1 = "asset-clean-acceptance";
const DEFAULT_CHECKLIST$1 = {
  noTextResidue: true,
  containersIntact: true,
  noOutsideEdits: true,
  sizeCorrect: true
};
function replaceStageState$6(states, replacement) {
  return states.map(
    (state) => state.stage === replacement.stage ? replacement : state
  );
}
async function runAcceptClean(options) {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "accept-clean");
  const cleanState = workspace.manifest.stages.find(
    (state) => state.stage === "clean"
  );
  if (cleanState?.status !== "completed" || cleanState.lastSuccessfulAttemptId === null || cleanState.completedInputFingerprint === null) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "接受 clean plate 前必须存在成功且未失效的 clean 产物"
    );
  }
  const cleanAsset = workspace.manifest.assets.find(
    (asset) => asset.role === "clean_plate" && asset.attemptId === cleanState.lastSuccessfulAttemptId
  );
  if (cleanAsset === void 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "未找到当前 clean 尝试的产物资产"
    );
  }
  await assertWorkspaceAssetIntegrity(workspace.path, cleanAsset);
  const recordAsset = workspace.manifest.assets.find(
    (asset) => asset.role === "clean_record" && asset.attemptId === cleanState.lastSuccessfulAttemptId
  );
  let autoCheckSummary = "无自动检查记录";
  if (recordAsset !== void 0) {
    const record = CleanAttemptRecordSchema.parse(
      JSON.parse(
        await readFile(
          resolveWorkspacePath(workspace.path, recordAsset.path),
          "utf8"
        )
      )
    );
    autoCheckSummary = `尺寸${record.checks.size.ok ? "OK" : "异常"}，文字残留 ${record.checks.textResidue.residualForegroundPixels} 像素，mask 外改动率 ${record.checks.outsideMaskDiff.changedRatio.toFixed(4)}，容器环改动率 ${record.checks.containerRingDiff.changedRatio.toFixed(4)}`;
  }
  const acceptanceNumber = workspace.manifest.attempts.filter(
    (attempt2) => attempt2.stage === "accept-clean"
  ).length + 1;
  const acceptanceId = `accept-clean-${String(acceptanceNumber).padStart(3, "0")}`;
  const acceptedAt = (/* @__PURE__ */ new Date()).toISOString();
  const acceptance = {
    schemaVersion: SCHEMA_VERSION,
    id: acceptanceId,
    stage: "accept-clean",
    artifactAssetId: cleanAsset.id,
    artifactSha256: cleanAsset.sha256,
    // 绑定 clean 阶段输入指纹：mask/复核/源图变化会使 clean 重跑并让本接受记录随阶段 stale。
    upstreamFingerprint: cleanState.completedInputFingerprint,
    acceptedAt,
    acceptedBy: options.acceptedBy ?? "developer",
    note: options.note ?? "",
    checklist: options.checklist ?? DEFAULT_CHECKLIST$1
  };
  const acceptedPath = resolveWorkspacePath(workspace.path, ACCEPTED_PATH$1);
  await writeJsonAtomic(
    acceptedPath,
    ArtifactAcceptanceSchema.parse(acceptance)
  );
  const acceptanceAsset = await createWorkspaceAsset(acceptedPath, {
    schemaVersion: SCHEMA_VERSION,
    id: ACCEPTANCE_ASSET_ID$1,
    path: ACCEPTED_PATH$1,
    role: "clean_acceptance",
    createdAt: acceptedAt,
    producedBy: "accept-clean",
    attemptId: acceptanceId,
    image: null
  });
  const attempt = {
    schemaVersion: SCHEMA_VERSION,
    id: acceptanceId,
    stage: "accept-clean",
    number: acceptanceNumber,
    status: "completed",
    inputFingerprint: cleanState.completedInputFingerprint,
    startedAt: acceptedAt,
    endedAt: acceptedAt,
    provider: "developer",
    providerVersion: acceptance.acceptedBy,
    assetIds: [acceptanceAsset.id],
    error: null
  };
  const acceptState = workspace.manifest.stages.find(
    (state) => state.stage === "accept-clean"
  );
  if (acceptState === void 0) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 accept-clean 阶段状态"
    );
  }
  const completedState = {
    ...acceptState,
    status: "completed",
    latestAttemptId: acceptanceId,
    lastSuccessfulAttemptId: acceptanceId,
    completedInputFingerprint: cleanState.completedInputFingerprint,
    invalidatedAt: null,
    invalidationReason: null
  };
  const nextManifest = {
    ...workspace.manifest,
    updatedAt: acceptedAt,
    assets: [
      ...workspace.manifest.assets.filter(
        (asset) => asset.id !== ACCEPTANCE_ASSET_ID$1
      ),
      acceptanceAsset
    ],
    stages: replaceStageState$6(workspace.manifest.stages, completedState),
    attempts: [...workspace.manifest.attempts, attempt]
  };
  await writeWorkspaceManifest(workspace.path, nextManifest);
  return {
    acceptedPath,
    acceptanceId,
    artifactSha256: cleanAsset.sha256,
    autoCheckSummary
  };
}
const ACCEPTED_PATH = "stages/pptx/accepted.json";
const ACCEPTANCE_ASSET_ID = "asset-pptx-acceptance";
const DEFAULT_CHECKLIST = {
  opensInPowerPoint: true,
  aspect16by9: true,
  textEditable: true,
  fontMicrosoftYaHei: true,
  layoutFaithful: true
};
function replaceStageState$5(states, replacement) {
  return states.map(
    (state) => state.stage === replacement.stage ? replacement : state
  );
}
async function runAcceptPptx(options) {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "accept-pptx");
  const pptxState = workspace.manifest.stages.find(
    (state) => state.stage === "pptx"
  );
  if (pptxState?.status !== "completed" || pptxState.lastSuccessfulAttemptId === null || pptxState.completedInputFingerprint === null) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "接受 PPTX 前必须存在成功且未失效的 pptx 产物"
    );
  }
  const pptxAsset = workspace.manifest.assets.find(
    (asset) => asset.role === "pptx" && asset.attemptId === pptxState.lastSuccessfulAttemptId
  );
  if (pptxAsset === void 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "未找到当前 pptx 尝试的产物资产"
    );
  }
  await assertWorkspaceAssetIntegrity(workspace.path, pptxAsset);
  const checkAsset = workspace.manifest.assets.find(
    (asset) => asset.role === "pptx_check" && asset.attemptId === pptxState.lastSuccessfulAttemptId
  );
  let autoCheckSummary = "无自动检查记录";
  if (checkAsset !== void 0) {
    const check = PptxCheckReportSchema.parse(
      JSON.parse(
        await readFile(
          resolveWorkspacePath(workspace.path, checkAsset.path),
          "utf8"
        )
      )
    );
    const failed = check.checks.filter((item) => item.status === "failed");
    autoCheckSummary = `自动检查 ${check.status}，形状 图${check.shapes.images}/文本框${check.shapes.textBoxes}${failed.length > 0 ? `，失败项：${failed.map((item) => item.id).join(",")}` : ""}`;
  }
  const acceptanceNumber = workspace.manifest.attempts.filter(
    (attempt2) => attempt2.stage === "accept-pptx"
  ).length + 1;
  const acceptanceId = `accept-pptx-${String(acceptanceNumber).padStart(3, "0")}`;
  const acceptedAt = (/* @__PURE__ */ new Date()).toISOString();
  const acceptance = {
    schemaVersion: SCHEMA_VERSION,
    id: acceptanceId,
    stage: "accept-pptx",
    artifactAssetId: pptxAsset.id,
    artifactSha256: pptxAsset.sha256,
    upstreamFingerprint: pptxState.completedInputFingerprint,
    acceptedAt,
    acceptedBy: options.acceptedBy ?? "developer",
    note: options.note ?? "",
    checklist: options.checklist ?? DEFAULT_CHECKLIST
  };
  const acceptedPath = resolveWorkspacePath(workspace.path, ACCEPTED_PATH);
  await writeJsonAtomic(
    acceptedPath,
    ArtifactAcceptanceSchema.parse(acceptance)
  );
  const acceptanceAsset = await createWorkspaceAsset(acceptedPath, {
    schemaVersion: SCHEMA_VERSION,
    id: ACCEPTANCE_ASSET_ID,
    path: ACCEPTED_PATH,
    role: "pptx_acceptance",
    createdAt: acceptedAt,
    producedBy: "accept-pptx",
    attemptId: acceptanceId,
    image: null
  });
  const attempt = {
    schemaVersion: SCHEMA_VERSION,
    id: acceptanceId,
    stage: "accept-pptx",
    number: acceptanceNumber,
    status: "completed",
    inputFingerprint: pptxState.completedInputFingerprint,
    startedAt: acceptedAt,
    endedAt: acceptedAt,
    provider: "developer",
    providerVersion: acceptance.acceptedBy,
    assetIds: [acceptanceAsset.id],
    error: null
  };
  const acceptState = workspace.manifest.stages.find(
    (state) => state.stage === "accept-pptx"
  );
  if (acceptState === void 0) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 accept-pptx 阶段状态"
    );
  }
  const completedState = {
    ...acceptState,
    status: "completed",
    latestAttemptId: acceptanceId,
    lastSuccessfulAttemptId: acceptanceId,
    completedInputFingerprint: pptxState.completedInputFingerprint,
    invalidatedAt: null,
    invalidationReason: null
  };
  const nextManifest = {
    ...workspace.manifest,
    updatedAt: acceptedAt,
    assets: [
      ...workspace.manifest.assets.filter(
        (asset) => asset.id !== ACCEPTANCE_ASSET_ID
      ),
      acceptanceAsset
    ],
    stages: replaceStageState$5(workspace.manifest.stages, completedState),
    attempts: [...workspace.manifest.attempts, attempt]
  };
  await writeWorkspaceManifest(workspace.path, nextManifest);
  return {
    acceptedPath,
    acceptanceId,
    artifactSha256: pptxAsset.sha256,
    autoCheckSummary
  };
}
const OPENAI_IMAGE_MODEL = "gpt-image-2";
const CLEAN_PLATE_QUALITY = "high";
const CLEAN_PLATE_OUTPUT_FORMAT = "png";
const CLEAN_PLATE_PROMPT_VERSION = "m1-clean-plate-v4";
const CLEAN_PLATE_PROMPT = [
  "你在编辑一张 16:9 演示文稿页面。任务是擦除 mask 透明区域内的文字，生成干净的背景底板。",
  "在 mask 透明区域内：彻底擦除所有可见的文字笔画，把文字原位置修复成与周围完全一致的背景、容器填充或渐变。无论文字大小，修复区域必须与周围背景无缝融合，不得出现灰色条状占位、色块或任何可见修补痕迹。",
  "在 mask 不透明区域：保持原样不做任何修改，包括其中的文字、图标、图表和所有视觉元素。",
  "修复约束：文字被擦除后其承载容器（标题栏、卡片、按钮、边框、阴影等）必须保持完整。不改变页面构图、图标、箭头、图表、插画、颜色与渐变。不新增任何文字或图形。"
].join("\n");
const CLEAN_PLATE_WIDTH = 2048;
const CLEAN_PLATE_HEIGHT = 1152;
const CLEAN_PLATE_SIZE = `${CLEAN_PLATE_WIDTH}x${CLEAN_PLATE_HEIGHT}`;
function buildCleanPlateEditParams(input) {
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
    stream: false
  };
}
function extractCleanPlateResult(response) {
  const b64Png = response.data?.[0]?.b64_json;
  if (b64Png === void 0) {
    throw new FoundationError(
      "INVALID_PROVIDER_RESPONSE",
      "gpt-image-2 未返回 base64 图片数据"
    );
  }
  return { b64Png, usage: response.usage ?? null };
}
async function createDefaultImageEditor() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === void 0 || apiKey.trim().length === 0) {
    throw new FoundationError(
      "MISSING_DEPENDENCY",
      "缺少 OPENAI_API_KEY，无法运行 gpt-image-2 clean plate"
    );
  }
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || void 0
  });
  return async (params) => {
    const { data, request_id } = await client.images.edit(params).withResponse();
    return { response: data, requestId: request_id };
  };
}
async function runCleanPlateEdit(options) {
  const editor = options.edit ?? await createDefaultImageEditor();
  const [imageFile, maskFile] = await Promise.all([
    readFile(options.imagePath).then(
      (buf) => new File([buf], basename(options.imagePath), { type: "image/png" })
    ),
    readFile(options.maskPath).then(
      (buf) => new File([buf], basename(options.maskPath), { type: "image/png" })
    )
  ]);
  const params = buildCleanPlateEditParams({
    image: imageFile,
    mask: maskFile,
    prompt: options.prompt ?? CLEAN_PLATE_PROMPT
  });
  const outcome = await editor(params);
  const { b64Png, usage } = extractCleanPlateResult(outcome.response);
  return {
    b64Png,
    usage,
    requestId: outcome.requestId,
    rawResponse: outcome.response
  };
}
const DEFAULT_GLYPH_HINT_MARGIN_PX = 6;
function hexToRgb(hex) {
  const match = /^#([a-f0-9]{6})$/iu.exec(hex.trim());
  if (match === null) {
    throw new Error(`非法颜色值：${hex}`);
  }
  const value = Number.parseInt(match[1] ?? "0", 16);
  return [value >> 16 & 255, value >> 8 & 255, value & 255];
}
function colorDistanceSq(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return dr * dr + dg * dg + db * db;
}
function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === void 0 || b === void 0) {
      continue;
    }
    const intersect = a.y > y !== b.y > y && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x;
    if (intersect) {
      inside = !inside;
    }
  }
  return inside;
}
function rasterizeRegion(width, height, bbox, quad) {
  const region = new Uint8Array(width * height);
  const minX = Math.max(0, Math.floor(bbox.x));
  const minY = Math.max(0, Math.floor(bbox.y));
  const maxX = Math.min(width, Math.ceil(bbox.x + bbox.width));
  const maxY = Math.min(height, Math.ceil(bbox.y + bbox.height));
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      if (quad === null || pointInPolygon(x + 0.5, y + 0.5, quad)) {
        region[y * width + x] = 1;
      }
    }
  }
  return region;
}
function estimateBackgroundColor(image, region) {
  const histogram = /* @__PURE__ */ new Map();
  const { data, width, height } = image;
  for (let i = 0; i < width * height; i += 1) {
    if (region[i] === 0) {
      continue;
    }
    const offset = i * 4;
    const key = (data[offset] ?? 0) >> 4 << 8 | (data[offset + 1] ?? 0) >> 4 << 4 | (data[offset + 2] ?? 0) >> 4;
    histogram.set(key, (histogram.get(key) ?? 0) + 1);
  }
  let bestKey = 0;
  let bestCount = -1;
  for (const [key, count] of histogram) {
    if (count > bestCount) {
      bestCount = count;
      bestKey = key;
    }
  }
  const r = (bestKey >> 8 & 15) * 16 + 8;
  const g = (bestKey >> 4 & 15) * 16 + 8;
  const b = (bestKey & 15) * 16 + 8;
  return [r, g, b];
}
function buildForegroundMask(image, region, foregroundColors, colorTolerance) {
  const { data, width, height } = image;
  const mask = new Uint8Array(width * height);
  const toleranceSq = colorTolerance * colorTolerance;
  const background = foregroundColors.length === 0 ? estimateBackgroundColor(image, region) : null;
  for (let i = 0; i < width * height; i += 1) {
    if (region[i] === 0) {
      continue;
    }
    const offset = i * 4;
    const r = data[offset] ?? 0;
    const g = data[offset + 1] ?? 0;
    const b = data[offset + 2] ?? 0;
    if (background !== null) {
      if (colorDistanceSq(r, g, b, background[0], background[1], background[2]) > toleranceSq) {
        mask[i] = 1;
      }
      continue;
    }
    for (const [cr, cg, cb] of foregroundColors) {
      if (colorDistanceSq(r, g, b, cr, cg, cb) <= toleranceSq) {
        mask[i] = 1;
        break;
      }
    }
  }
  return mask;
}
function toGrayscale(image) {
  const { data, width, height } = image;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    gray[i] = 0.299 * (data[offset] ?? 0) + 0.587 * (data[offset + 1] ?? 0) + 0.114 * (data[offset + 2] ?? 0);
  }
  return gray;
}
function sobelEdgeMask(image, region, threshold01) {
  const { width, height } = image;
  const gray = toGrayscale(image);
  const mask = new Uint8Array(width * height);
  const maxMagnitude = 4 * 255 * Math.SQRT2;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      if (region[i] === 0) {
        continue;
      }
      const tl = gray[i - width - 1] ?? 0;
      const tc = gray[i - width] ?? 0;
      const tr = gray[i - width + 1] ?? 0;
      const ml = gray[i - 1] ?? 0;
      const mr = gray[i + 1] ?? 0;
      const bl = gray[i + width - 1] ?? 0;
      const bc = gray[i + width] ?? 0;
      const br = gray[i + width + 1] ?? 0;
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const magnitude = Math.sqrt(gx * gx + gy * gy) / maxMagnitude;
      if (magnitude >= threshold01) {
        mask[i] = 1;
      }
    }
  }
  return mask;
}
function connectedComponents(mask, width, height) {
  const parent = new Int32Array(width * height).fill(-1);
  const find = (node) => {
    let root = node;
    while (parent[root] !== root) {
      root = parent[root] ?? root;
    }
    let current = node;
    while (parent[current] !== root) {
      const next = parent[current] ?? root;
      parent[current] = root;
      current = next;
    }
    return root;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) {
      parent[Math.max(rootA, rootB)] = Math.min(rootA, rootB);
    }
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      if (mask[i] === 0) {
        continue;
      }
      parent[i] = i;
      for (const [dx, dy] of [
        [-1, 0],
        [-1, -1],
        [0, -1],
        [1, -1]
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
          continue;
        }
        const ni = ny * width + nx;
        if (mask[ni] === 1) {
          union(i, ni);
        }
      }
    }
  }
  const labels = new Int32Array(width * height).fill(-1);
  const sizeByRoot = /* @__PURE__ */ new Map();
  for (let i = 0; i < width * height; i += 1) {
    if (mask[i] === 0) {
      continue;
    }
    const root = find(i);
    labels[i] = root;
    sizeByRoot.set(root, (sizeByRoot.get(root) ?? 0) + 1);
  }
  return {
    labels,
    sizes: [...sizeByRoot.values()],
    count: sizeByRoot.size
  };
}
function filterSmallComponents(mask, width, height, minAreaPx) {
  if (minAreaPx <= 1) {
    return mask.slice();
  }
  const { labels } = connectedComponents(mask, width, height);
  const sizeByRoot = /* @__PURE__ */ new Map();
  for (let i = 0; i < labels.length; i += 1) {
    const root = labels[i] ?? -1;
    if (root >= 0) {
      sizeByRoot.set(root, (sizeByRoot.get(root) ?? 0) + 1);
    }
  }
  const result = new Uint8Array(width * height);
  for (let i = 0; i < labels.length; i += 1) {
    const root = labels[i] ?? -1;
    if (root >= 0 && (sizeByRoot.get(root) ?? 0) >= minAreaPx) {
      result[i] = 1;
    }
  }
  return result;
}
function dilate(mask, width, height, radius) {
  if (radius <= 0) {
    return mask.slice();
  }
  const r = Math.round(radius);
  const offsets = [];
  for (let dy = -r; dy <= r; dy += 1) {
    for (let dx = -r; dx <= r; dx += 1) {
      if (dx * dx + dy * dy <= radius * radius) {
        offsets.push([dx, dy]);
      }
    }
  }
  const result = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[y * width + x] === 0) {
        continue;
      }
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height) {
          result[ny * width + nx] = 1;
        }
      }
    }
  }
  return result;
}
function applyExcludePolygons(mask, width, height, bbox, excludePolygons) {
  if (excludePolygons.length === 0) {
    return;
  }
  const minX = Math.max(0, Math.floor(bbox.x));
  const minY = Math.max(0, Math.floor(bbox.y));
  const maxX = Math.min(width, Math.ceil(bbox.x + bbox.width));
  const maxY = Math.min(height, Math.ceil(bbox.y + bbox.height));
  for (let y = minY; y < maxY; y += 1) {
    for (let x = minX; x < maxX; x += 1) {
      const i = y * width + x;
      if (mask[i] === 0) {
        continue;
      }
      for (const polygon of excludePolygons) {
        if (pointInPolygon(x + 0.5, y + 0.5, polygon)) {
          mask[i] = 0;
          break;
        }
      }
    }
  }
}
function rasterizeGlyphHintRegion(width, height, quads, marginPx) {
  const base = new Uint8Array(width * height);
  for (const quad of quads) {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of quad) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const x0 = Math.max(0, Math.floor(minX));
    const y0 = Math.max(0, Math.floor(minY));
    const x1 = Math.min(width, Math.ceil(maxX));
    const y1 = Math.min(height, Math.ceil(maxY));
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        if (pointInPolygon(x + 0.5, y + 0.5, quad)) {
          base[y * width + x] = 1;
        }
      }
    }
  }
  return dilate(base, width, height, marginPx);
}
function segmentBlockGlyphs(image, params) {
  const { width, height } = image;
  const region = rasterizeRegion(width, height, params.bbox, params.quad);
  if (params.glyphHintQuads !== void 0 && params.glyphHintQuads.length > 0) {
    const hintRegion = rasterizeGlyphHintRegion(
      width,
      height,
      params.glyphHintQuads,
      params.glyphHintMarginPx ?? DEFAULT_GLYPH_HINT_MARGIN_PX
    );
    for (let i = 0; i < region.length; i += 1) {
      if (hintRegion[i] === 0) {
        region[i] = 0;
      }
    }
  }
  const colorMask = buildForegroundMask(
    image,
    region,
    params.foregroundColors,
    params.colorTolerance
  );
  if (params.edgeThreshold < 1) {
    const edges = sobelEdgeMask(image, region, params.edgeThreshold);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = y * width + x;
        if (edges[i] === 0 || colorMask[i] === 1) {
          continue;
        }
        for (const [dx, dy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1]
        ]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < width && ny < height && colorMask[ny * width + nx] === 1) {
            colorMask[i] = 1;
            break;
          }
        }
      }
    }
  }
  applyExcludePolygons(
    colorMask,
    width,
    height,
    params.bbox,
    params.excludePolygons
  );
  const filtered = filterSmallComponents(
    colorMask,
    width,
    height,
    params.minComponentAreaPx
  );
  const dilated = dilate(filtered, width, height, params.dilationRadiusPx);
  applyExcludePolygons(
    dilated,
    width,
    height,
    params.bbox,
    params.excludePolygons
  );
  return dilated;
}
function countMasked(mask) {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] === 1) {
      count += 1;
    }
  }
  return count;
}
function unionInto(target, source) {
  for (let i = 0; i < target.length; i += 1) {
    if (source[i] === 1) {
      target[i] = 1;
    }
  }
}
const OUTSIDE_DIFF_THRESHOLD = 24;
const CONTAINER_RING_RADIUS_PX = 8;
async function decodeRgba(input) {
  const decoded = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return {
    data: decoded.data,
    width: decoded.info.width,
    height: decoded.info.height
  };
}
function pixelDelta(a, b, index) {
  const offset = index * 4;
  const dr = Math.abs((a.data[offset] ?? 0) - (b.data[offset] ?? 0));
  const dg = Math.abs((a.data[offset + 1] ?? 0) - (b.data[offset + 1] ?? 0));
  const db = Math.abs((a.data[offset + 2] ?? 0) - (b.data[offset + 2] ?? 0));
  return Math.max(dr, dg, db);
}
async function computeCleanPlateChecks(input) {
  const source = await decodeRgba(input.sourcePath);
  const width = source.width;
  const height = source.height;
  const cleanMeta = await sharp(input.cleanBuffer).metadata();
  const resultWidth = cleanMeta.width ?? 0;
  const resultHeight = cleanMeta.height ?? 0;
  const aspectRatioOk = resultHeight > 0 && Math.abs(
    resultWidth / resultHeight - input.expectedWidth / input.expectedHeight
  ) < 0.01;
  const cleanResizedBuffer = await sharp(input.cleanBuffer).resize(width, height, { fit: "fill" }).ensureAlpha().raw().toBuffer();
  const clean = { data: cleanResizedBuffer, width, height };
  const maskImage = await decodeRgba(input.maskPath);
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    if ((maskImage.data[i * 4 + 3] ?? 255) === 0) {
      mask[i] = 1;
    }
  }
  const maskedPixels = countMasked(mask);
  let residualForegroundPixels = 0;
  for (const block of input.maskBlocks) {
    if (block.maskParams.foregroundColors.length === 0) {
      continue;
    }
    const region = rasterizeRegion(
      width,
      height,
      block.bboxPx,
      block.quadPx
    );
    const foreground = buildForegroundMask(
      clean,
      region,
      block.maskParams.foregroundColors.map(hexToRgb),
      block.maskParams.colorTolerance
    );
    for (let i = 0; i < width * height; i += 1) {
      if (foreground[i] === 1 && mask[i] === 1) {
        residualForegroundPixels += 1;
      }
    }
  }
  const ring = dilate(mask, width, height, CONTAINER_RING_RADIUS_PX);
  for (let i = 0; i < width * height; i += 1) {
    ring[i] = ring[i] === 1 && mask[i] === 0 ? 1 : 0;
  }
  let comparedPixels = 0;
  let changedPixels = 0;
  let deltaSum = 0;
  let ringPixels = 0;
  let ringChanged = 0;
  const diff = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    const offset = i * 4;
    diff[offset] = source.data[offset] ?? 0;
    diff[offset + 1] = source.data[offset + 1] ?? 0;
    diff[offset + 2] = source.data[offset + 2] ?? 0;
    diff[offset + 3] = 255;
    if (mask[i] === 1) {
      continue;
    }
    const delta = pixelDelta(source, clean, i);
    comparedPixels += 1;
    deltaSum += delta;
    if (delta > OUTSIDE_DIFF_THRESHOLD) {
      changedPixels += 1;
      diff[offset] = 255;
      diff[offset + 1] = 0;
      diff[offset + 2] = 0;
    }
    if (ring[i] === 1) {
      ringPixels += 1;
      if (delta > OUTSIDE_DIFF_THRESHOLD) {
        ringChanged += 1;
      }
    }
  }
  const diffPng = await sharp(diff, { raw: { width, height, channels: 4 } }).png().toBuffer();
  const checks = {
    size: {
      width: resultWidth,
      height: resultHeight,
      expectedWidth: input.expectedWidth,
      expectedHeight: input.expectedHeight,
      ok: resultWidth === input.expectedWidth && resultHeight === input.expectedHeight,
      aspectRatioOk
    },
    textResidue: {
      maskedPixels,
      residualForegroundPixels,
      residualRatio: maskedPixels === 0 ? 0 : residualForegroundPixels / maskedPixels
    },
    outsideMaskDiff: {
      comparedPixels,
      changedPixels,
      changedRatio: comparedPixels === 0 ? 0 : changedPixels / comparedPixels,
      meanDelta: comparedPixels === 0 ? 0 : deltaSum / comparedPixels,
      threshold: OUTSIDE_DIFF_THRESHOLD
    },
    containerRingDiff: {
      ringPixels,
      changedPixels: ringChanged,
      changedRatio: ringPixels === 0 ? 0 : ringChanged / ringPixels
    }
  };
  return { checks, diffPng };
}
const REVIEW_OUTPUT_PATH$4 = "stages/review/text-blocks.json";
function replaceStageState$4(states, replacement) {
  return states.map(
    (state) => state.stage === replacement.stage ? replacement : state
  );
}
function replaceAttempt$4(attempts, replacement) {
  return attempts.map(
    (attempt) => attempt.id === replacement.id ? replacement : attempt
  );
}
function findAssetById$2(manifest, assetId) {
  const asset = manifest.assets.find((candidate) => candidate.id === assetId);
  if (asset === void 0) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      `manifest 未引用有效资产：${assetId}`,
      { assetId }
    );
  }
  return asset;
}
function findRoleAsset(manifest, role) {
  const asset = manifest.assets.find((candidate) => candidate.role === role);
  if (asset === void 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      `运行 clean 前缺少必要产物：${role}`,
      { role }
    );
  }
  return asset;
}
function asRecord$1(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}
function redactApiKey$1(message) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === void 0 || apiKey.length === 0) {
    return message;
  }
  return message.split(apiKey).join("[REDACTED]");
}
function errorRecord$1(error) {
  if (error instanceof FoundationError) {
    return { code: error.code, message: redactApiKey$1(error.message) };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: redactApiKey$1(
      error instanceof Error ? error.message : String(error)
    )
  };
}
async function readReusableResult$1(workspacePath, manifest, attemptId) {
  const asset = manifest.assets.find(
    (candidate) => candidate.role === "clean_plate" && candidate.attemptId === attemptId
  );
  if (asset === void 0) {
    return null;
  }
  await assertWorkspaceAssetIntegrity(workspacePath, asset);
  return {
    cleanPath: resolveWorkspacePath(workspacePath, asset.path),
    attemptId,
    reused: true
  };
}
async function runSlideClean(options) {
  if (!options.confirmUpload) {
    throw new FoundationError(
      "UPLOAD_CONFIRMATION_REQUIRED",
      "clean plate 会上传源图与 mask，必须显式传入 --confirm-upload"
    );
  }
  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "clean");
  const source = findAssetById$2(
    workspace.manifest,
    workspace.manifest.sourceImageAssetId
  );
  const maskAsset = findRoleAsset(workspace.manifest, "mask");
  const maskRecordAsset = findRoleAsset(workspace.manifest, "mask_record");
  for (const asset of [source, maskAsset, maskRecordAsset]) {
    await assertWorkspaceAssetIntegrity(workspace.path, asset);
  }
  const reviewPath = resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH$4);
  const reviewDocumentSha256 = await sha256File(reviewPath);
  const document = TextReviewDocumentSchema.parse(
    JSON.parse(await readFile(reviewPath, "utf8"))
  );
  const maskBlocks = document.blocks.filter((block) => block.includeInMask);
  const sentAssets = [source, maskAsset].map((asset) => ({
    path: asset.path,
    sha256: asset.sha256
  }));
  const inputFingerprint = sha256Values([
    source.sha256,
    maskAsset.sha256,
    OPENAI_IMAGE_MODEL,
    CLEAN_PLATE_PROMPT_VERSION,
    CLEAN_PLATE_SIZE,
    CLEAN_PLATE_QUALITY,
    CLEAN_PLATE_OUTPUT_FORMAT
  ]);
  const previousState = workspace.manifest.stages.find(
    (state) => state.stage === "clean"
  );
  if (previousState === void 0) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 clean 阶段状态");
  }
  if (isStageReusable(previousState, inputFingerprint) && previousState.lastSuccessfulAttemptId !== null) {
    const reusable = await readReusableResult$1(
      workspace.path,
      workspace.manifest,
      previousState.lastSuccessfulAttemptId
    );
    if (reusable !== null) {
      return reusable;
    }
  }
  options.onBeforeUpload?.({ model: OPENAI_IMAGE_MODEL, sentAssets });
  const attemptNumber = workspace.manifest.attempts.filter((attempt) => attempt.stage === "clean").length + 1;
  const attemptId = `clean-${String(attemptNumber).padStart(3, "0")}`;
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const invalidatedStates = previousState.completedInputFingerprint !== null && previousState.completedInputFingerprint !== inputFingerprint ? invalidateStageAndDownstream(
    workspace.manifest.stages,
    "clean",
    "clean 输入指纹变化",
    startedAt
  ) : workspace.manifest.stages;
  const invalidatedState = invalidatedStates.find(
    (state) => state.stage === "clean"
  );
  if (invalidatedState === void 0) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 clean 阶段状态");
  }
  const runningAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "clean",
    number: attemptNumber,
    status: "running",
    inputFingerprint,
    startedAt,
    endedAt: null,
    provider: "openai",
    providerVersion: "openai-node@6.48.0",
    assetIds: [],
    error: null
  };
  const runningState = {
    ...invalidatedState,
    status: "running",
    latestAttemptId: attemptId,
    invalidatedAt: null,
    invalidationReason: null
  };
  const runningManifest = {
    ...workspace.manifest,
    updatedAt: startedAt,
    stages: replaceStageState$4(invalidatedStates, runningState),
    attempts: [...workspace.manifest.attempts, runningAttempt]
  };
  await writeWorkspaceManifest(workspace.path, runningManifest);
  const directory = `stages/clean/${attemptId}`;
  const resultPath = `${directory}/result.png`;
  const diffPath = `${directory}/diff.png`;
  const providerRecordPath = `${directory}/provider.json`;
  const rawResponsePath = `${directory}/raw-response.json`;
  const recordPath = `${directory}/record.json`;
  const sourcePath = resolveWorkspacePath(workspace.path, source.path);
  const maskPath = resolveWorkspacePath(workspace.path, maskAsset.path);
  try {
    const outcome = await runCleanPlateEdit({
      imagePath: sourcePath,
      maskPath,
      ...options.edit === void 0 ? {} : { edit: options.edit }
    });
    const endedAt = (/* @__PURE__ */ new Date()).toISOString();
    const resultBuffer = Buffer.from(outcome.b64Png, "base64");
    await writeBufferAtomic(
      resolveWorkspacePath(workspace.path, resultPath),
      resultBuffer
    );
    const { checks, diffPng } = await computeCleanPlateChecks({
      sourcePath,
      cleanBuffer: resultBuffer,
      maskPath,
      maskBlocks,
      expectedWidth: CLEAN_PLATE_WIDTH,
      expectedHeight: CLEAN_PLATE_HEIGHT
    });
    await writeBufferAtomic(
      resolveWorkspacePath(workspace.path, diffPath),
      diffPng
    );
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, rawResponsePath),
      outcome.rawResponse
    );
    const resultAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, resultPath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-result`,
        path: resultPath,
        role: "clean_plate",
        createdAt: endedAt,
        producedBy: "clean",
        attemptId,
        image: {
          width: CLEAN_PLATE_WIDTH,
          height: CLEAN_PLATE_HEIGHT,
          format: "png"
        }
      }
    );
    const diffAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, diffPath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-diff`,
        path: diffPath,
        role: "clean_check",
        createdAt: endedAt,
        producedBy: "clean",
        attemptId,
        image: null
      }
    );
    const rawResponseAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, rawResponsePath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-raw-response`,
        path: rawResponsePath,
        role: "provider_response",
        createdAt: endedAt,
        producedBy: "clean",
        attemptId,
        image: null
      }
    );
    const providerRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: `provider-${attemptId}`,
      stage: "clean",
      provider: "openai",
      endpoint: "/v1/images/edits",
      model: OPENAI_IMAGE_MODEL,
      parameters: {
        size: CLEAN_PLATE_SIZE,
        quality: CLEAN_PLATE_QUALITY,
        output_format: CLEAN_PLATE_OUTPUT_FORMAT
      },
      promptVersion: CLEAN_PLATE_PROMPT_VERSION,
      sentAssets,
      requestId: outcome.requestId,
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      usage: asRecord$1(outcome.usage),
      error: null,
      rawResponsePath,
      rawResponseSha256: rawResponseAsset.sha256,
      parsedResponsePath: resultPath,
      parsedResponseSha256: resultAsset.sha256
    };
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, providerRecordPath),
      ProviderCallRecordSchema.parse(providerRecord)
    );
    const providerRecordAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, providerRecordPath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-provider-record`,
        path: providerRecordPath,
        role: "provider_record",
        createdAt: endedAt,
        producedBy: "clean",
        attemptId,
        image: null
      }
    );
    const attemptRecord = {
      schemaVersion: SCHEMA_VERSION,
      attemptId,
      model: OPENAI_IMAGE_MODEL,
      promptVersion: CLEAN_PLATE_PROMPT_VERSION,
      size: CLEAN_PLATE_SIZE,
      quality: CLEAN_PLATE_QUALITY,
      outputFormat: CLEAN_PLATE_OUTPUT_FORMAT,
      sourceImageSha256: source.sha256,
      maskSha256: maskAsset.sha256,
      reviewDocumentSha256,
      resultSha256: resultAsset.sha256,
      requestId: outcome.requestId,
      usage: asRecord$1(outcome.usage),
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      checks
    };
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, recordPath),
      CleanAttemptRecordSchema.parse(attemptRecord)
    );
    const recordAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, recordPath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-record`,
        path: recordPath,
        role: "clean_record",
        createdAt: endedAt,
        producedBy: "clean",
        attemptId,
        image: null
      }
    );
    const assets = [
      resultAsset,
      diffAsset,
      rawResponseAsset,
      providerRecordAsset,
      recordAsset
    ];
    const completedAttempt = {
      ...runningAttempt,
      status: "completed",
      endedAt,
      assetIds: assets.map((asset) => asset.id)
    };
    const completedState = {
      ...runningState,
      status: "completed",
      lastSuccessfulAttemptId: attemptId,
      completedInputFingerprint: inputFingerprint
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      assets: [...runningManifest.assets, ...assets],
      stages: replaceStageState$4(runningManifest.stages, completedState),
      attempts: replaceAttempt$4(runningManifest.attempts, completedAttempt)
    });
    return {
      cleanPath: resolveWorkspacePath(workspace.path, resultPath),
      attemptId,
      reused: false
    };
  } catch (error) {
    const endedAt = (/* @__PURE__ */ new Date()).toISOString();
    const providerError = errorRecord$1(error);
    const providerRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: `provider-${attemptId}`,
      stage: "clean",
      provider: "openai",
      endpoint: "/v1/images/edits",
      model: OPENAI_IMAGE_MODEL,
      parameters: {
        size: CLEAN_PLATE_SIZE,
        quality: CLEAN_PLATE_QUALITY,
        output_format: CLEAN_PLATE_OUTPUT_FORMAT
      },
      promptVersion: CLEAN_PLATE_PROMPT_VERSION,
      sentAssets,
      requestId: null,
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      usage: null,
      error: providerError,
      rawResponsePath: null,
      rawResponseSha256: null,
      parsedResponsePath: null,
      parsedResponseSha256: null
    };
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, providerRecordPath),
      ProviderCallRecordSchema.parse(providerRecord)
    );
    const providerAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, providerRecordPath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-provider-record`,
        path: providerRecordPath,
        role: "provider_record",
        createdAt: endedAt,
        producedBy: "clean",
        attemptId,
        image: null
      }
    );
    const failedAttempt = {
      ...runningAttempt,
      status: "failed",
      endedAt,
      assetIds: [providerAsset.id],
      error: providerError
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      assets: [...runningManifest.assets, providerAsset],
      stages: replaceStageState$4(runningManifest.stages, {
        ...runningState,
        status: "failed"
      }),
      attempts: replaceAttempt$4(runningManifest.attempts, failedAttempt)
    });
    throw error;
  }
}
const REVIEW_OUTPUT_PATH$3 = "stages/review/text-blocks.json";
const MASK_PATH = "stages/mask/mask.png";
const PREVIEW_PATH = "stages/mask/preview.png";
const OVERLAY_PATH = "stages/mask/overlay.png";
const RECORD_PATH = "stages/mask/record.json";
function replaceStageState$3(states, replacement) {
  return states.map(
    (state) => state.stage === replacement.stage ? replacement : state
  );
}
function replaceAttempt$3(attempts, replacement) {
  return attempts.map(
    (attempt) => attempt.id === replacement.id ? replacement : attempt
  );
}
function findAssetById$1(manifest, assetId) {
  const asset = manifest.assets.find((candidate) => candidate.id === assetId);
  if (asset === void 0) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      `manifest 未引用有效资产：${assetId}`,
      { assetId }
    );
  }
  return asset;
}
function stageError$2(error) {
  if (error instanceof FoundationError) {
    return {
      code: error.code,
      message: error.message,
      ...error.details === void 0 ? {} : { details: error.details }
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : String(error)
  };
}
async function assertReviewValidated(workspacePath, manifest, reviewDocumentSha256) {
  const validationAsset = manifest.assets.find(
    (asset) => asset.role === "review_validation"
  );
  if (validationAsset === void 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 mask 前必须先通过 validate-review"
    );
  }
  await assertWorkspaceAssetIntegrity(workspacePath, validationAsset);
  const report = TextReviewValidationReportSchema.parse(
    JSON.parse(
      await readFile(
        resolveWorkspacePath(workspacePath, validationAsset.path),
        "utf8"
      )
    )
  );
  if (report.status !== "passed") {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "validate-review 未通过，无法运行 mask",
      { status: report.status }
    );
  }
  if (report.documentSha256 !== reviewDocumentSha256) {
    throw new FoundationError(
      "ASSET_INTEGRITY_MISMATCH",
      "text-blocks.json 在校验后已改动，请重新运行 validate-review",
      {
        validatedSha256: report.documentSha256,
        currentSha256: reviewDocumentSha256
      }
    );
  }
}
function assertMaskBlocksConfirmed(blocks) {
  const unconfirmed = blocks.filter(
    (block) => block.reviewStatus === "unreviewed"
  );
  if (unconfirmed.length > 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "存在未复核却参与 mask 的文字块，mask 只覆盖已确认目标文字",
      { blockIds: unconfirmed.map((block) => block.id) }
    );
  }
  const nonLayout = blocks.filter(
    (block) => block.classification !== "layout_text"
  );
  if (nonLayout.length > 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "只有版式目标文字可参与 mask",
      { blockIds: nonLayout.map((block) => block.id) }
    );
  }
}
function bboxesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}
function collectGlyphHintQuads(ocr, block) {
  const quads = [];
  for (const ocrBlock of ocr.blocks) {
    if (!bboxesOverlap(ocrBlock.bboxPx, block.bboxPx)) {
      continue;
    }
    for (const hint of ocrBlock.glyphHints) {
      quads.push(hint.quadPx.map((point) => ({ x: point.x, y: point.y })));
    }
  }
  return quads;
}
function toSegmentationParams(block, glyphHintQuads) {
  return {
    bbox: block.bboxPx,
    quad: block.quadPx,
    foregroundColors: block.maskParams.foregroundColors.map(hexToRgb),
    colorTolerance: block.maskParams.colorTolerance,
    edgeThreshold: block.maskParams.edgeThreshold,
    minComponentAreaPx: block.maskParams.minComponentAreaPx,
    dilationRadiusPx: block.maskParams.dilationRadiusPx,
    excludePolygons: block.maskParams.excludePolygons,
    glyphHintQuads
  };
}
function encodeAlphaMask(mask, width, height) {
  const buffer = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    buffer[i * 4 + 3] = mask[i] === 1 ? 0 : 255;
  }
  return sharp(buffer, { raw: { width, height, channels: 4 } }).png().toBuffer();
}
function encodePreview(mask, width, height) {
  const buffer = Buffer.alloc(width * height);
  for (let i = 0; i < width * height; i += 1) {
    buffer[i] = mask[i] === 1 ? 255 : 0;
  }
  return sharp(buffer, { raw: { width, height, channels: 1 } }).png().toBuffer();
}
async function encodeOverlay(sourcePath, mask, width, height) {
  const layer = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    if (mask[i] === 1) {
      layer[i * 4] = 255;
      layer[i * 4 + 3] = 150;
    }
  }
  const layerPng = await sharp(layer, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return sharp(sourcePath).ensureAlpha().composite([{ input: layerPng, blend: "over" }]).png().toBuffer();
}
async function runSlideMask(options) {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "mask");
  const source = findAssetById$1(
    workspace.manifest,
    workspace.manifest.sourceImageAssetId
  );
  await assertWorkspaceAssetIntegrity(workspace.path, source);
  const reviewPath = resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH$3);
  const reviewDocumentSha256 = await sha256File(reviewPath);
  await assertReviewValidated(
    workspace.path,
    workspace.manifest,
    reviewDocumentSha256
  );
  const validationAsset = findAssetById$1(
    workspace.manifest,
    workspace.manifest.assets.find(
      (asset) => asset.role === "review_validation"
    )?.id ?? "asset-review-validation"
  );
  const document = TextReviewDocumentSchema.parse(
    JSON.parse(await readFile(reviewPath, "utf8"))
  );
  const maskBlocks = document.blocks.filter((block) => block.includeInMask);
  assertMaskBlocksConfirmed(maskBlocks);
  const ocrState = workspace.manifest.stages.find(
    (state) => state.stage === "ocr"
  );
  const ocrAsset = workspace.manifest.assets.find(
    (asset) => asset.role === "ocr_result" && asset.attemptId === ocrState?.lastSuccessfulAttemptId
  );
  if (ocrAsset === void 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 mask 前必须存在成功的 OCR 产物"
    );
  }
  await assertWorkspaceAssetIntegrity(workspace.path, ocrAsset);
  const ocr = OcrProbeResponseSchema.parse(
    JSON.parse(
      await readFile(
        resolveWorkspacePath(workspace.path, ocrAsset.path),
        "utf8"
      )
    )
  );
  const inputFingerprint = sha256Values([
    source.sha256,
    maskInvalidationProjection(document),
    ocrAsset.sha256,
    MASK_ALGORITHM_VERSION
  ]);
  const previousState = workspace.manifest.stages.find(
    (state) => state.stage === "mask"
  );
  if (previousState === void 0) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 mask 阶段状态");
  }
  if (isStageReusable(previousState, inputFingerprint) && previousState.lastSuccessfulAttemptId !== null) {
    const maskAsset = workspace.manifest.assets.find(
      (asset) => asset.role === "mask"
    );
    if (maskAsset !== void 0) {
      await assertWorkspaceAssetIntegrity(workspace.path, maskAsset);
      const record = workspace.manifest.assets.find(
        (asset) => asset.role === "mask_record"
      );
      const totalMaskedPixels = record === void 0 ? 0 : MaskRecordSchema.parse(
        JSON.parse(
          await readFile(
            resolveWorkspacePath(workspace.path, record.path),
            "utf8"
          )
        )
      ).totals.maskedPixels;
      return {
        maskPath: resolveWorkspacePath(workspace.path, maskAsset.path),
        attemptId: previousState.lastSuccessfulAttemptId,
        reused: true,
        totalMaskedPixels
      };
    }
  }
  const attemptNumber = workspace.manifest.attempts.filter((attempt) => attempt.stage === "mask").length + 1;
  const attemptId = `mask-${String(attemptNumber).padStart(3, "0")}`;
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const invalidatedStates = previousState.completedInputFingerprint !== null && previousState.completedInputFingerprint !== inputFingerprint ? invalidateStageAndDownstream(
    workspace.manifest.stages,
    "mask",
    "mask 输入指纹变化",
    startedAt
  ) : workspace.manifest.stages;
  const invalidatedMaskState = invalidatedStates.find(
    (state) => state.stage === "mask"
  );
  if (invalidatedMaskState === void 0) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 mask 阶段状态");
  }
  const runningAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "mask",
    number: attemptNumber,
    status: "running",
    inputFingerprint,
    startedAt,
    endedAt: null,
    provider: "ppt-maker-cli",
    providerVersion: MASK_ALGORITHM_VERSION,
    assetIds: [],
    error: null
  };
  const runningState = {
    ...invalidatedMaskState,
    status: "running",
    latestAttemptId: attemptId,
    invalidatedAt: null,
    invalidationReason: null
  };
  const runningManifest = {
    ...workspace.manifest,
    updatedAt: startedAt,
    stages: replaceStageState$3(invalidatedStates, runningState),
    attempts: [...workspace.manifest.attempts, runningAttempt]
  };
  await writeWorkspaceManifest(workspace.path, runningManifest);
  try {
    const sourcePath = resolveWorkspacePath(workspace.path, source.path);
    const decoded = await sharp(sourcePath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const width = decoded.info.width;
    const height = decoded.info.height;
    const image = { data: decoded.data, width, height };
    const fullMask = new Uint8Array(width * height);
    const coverage = [];
    for (const block of maskBlocks) {
      const blockMask = segmentBlockGlyphs(
        image,
        toSegmentationParams(block, collectGlyphHintQuads(ocr, block))
      );
      const maskedPixels = countMasked(blockMask);
      unionInto(fullMask, blockMask);
      const bboxAreaPx = Math.round(block.bboxPx.width * block.bboxPx.height);
      coverage.push({
        blockId: block.id,
        maskedPixels,
        bboxAreaPx,
        coverageRatio: bboxAreaPx === 0 ? 0 : maskedPixels / bboxAreaPx
      });
    }
    const totalMaskedPixels = countMasked(fullMask);
    const [maskPng, previewPng, overlayPng] = await Promise.all([
      encodeAlphaMask(fullMask, width, height),
      encodePreview(fullMask, width, height),
      encodeOverlay(sourcePath, fullMask, width, height)
    ]);
    await writeBufferAtomic(
      resolveWorkspacePath(workspace.path, MASK_PATH),
      maskPng
    );
    await writeBufferAtomic(
      resolveWorkspacePath(workspace.path, PREVIEW_PATH),
      previewPng
    );
    await writeBufferAtomic(
      resolveWorkspacePath(workspace.path, OVERLAY_PATH),
      overlayPng
    );
    const [maskAsset, previewAsset, overlayAsset] = await Promise.all([
      createWorkspaceAsset(resolveWorkspacePath(workspace.path, MASK_PATH), {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-mask",
        path: MASK_PATH,
        role: "mask",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        producedBy: "mask",
        attemptId,
        image: { width, height, format: "png" }
      }),
      createWorkspaceAsset(resolveWorkspacePath(workspace.path, PREVIEW_PATH), {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-mask-preview",
        path: PREVIEW_PATH,
        role: "mask_preview",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        producedBy: "mask",
        attemptId,
        image: { width, height, format: "png" }
      }),
      createWorkspaceAsset(resolveWorkspacePath(workspace.path, OVERLAY_PATH), {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-mask-overlay",
        path: OVERLAY_PATH,
        role: "mask_overlay",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        producedBy: "mask",
        attemptId,
        image: { width, height, format: "png" }
      })
    ]);
    const record = MaskRecordSchema.parse({
      schemaVersion: SCHEMA_VERSION,
      algorithmVersion: MASK_ALGORITHM_VERSION,
      image: { width, height },
      sourceImageSha256: source.sha256,
      reviewDocumentSha256,
      reviewValidationSha256: validationAsset.sha256,
      maskedBlockIds: maskBlocks.map((block) => block.id),
      blocks: coverage,
      totals: {
        maskedPixels: totalMaskedPixels,
        maskedBlockCount: maskBlocks.length
      },
      outputs: {
        maskSha256: maskAsset.sha256,
        previewSha256: previewAsset.sha256,
        overlaySha256: overlayAsset.sha256
      }
    });
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, RECORD_PATH),
      record
    );
    const recordAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, RECORD_PATH),
      {
        schemaVersion: SCHEMA_VERSION,
        id: "asset-mask-record",
        path: RECORD_PATH,
        role: "mask_record",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        producedBy: "mask",
        attemptId,
        image: null
      }
    );
    const newAssets = [maskAsset, previewAsset, overlayAsset, recordAsset];
    const newAssetIds = new Set(newAssets.map((asset) => asset.id));
    const endedAt = (/* @__PURE__ */ new Date()).toISOString();
    const completedAttempt = {
      ...runningAttempt,
      status: "completed",
      endedAt,
      assetIds: newAssets.map((asset) => asset.id)
    };
    const completedState = {
      ...runningState,
      status: "completed",
      lastSuccessfulAttemptId: attemptId,
      completedInputFingerprint: inputFingerprint
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      assets: [
        ...runningManifest.assets.filter((asset) => !newAssetIds.has(asset.id)),
        ...newAssets
      ],
      stages: replaceStageState$3(runningManifest.stages, completedState),
      attempts: replaceAttempt$3(runningManifest.attempts, completedAttempt)
    });
    return {
      maskPath: resolveWorkspacePath(workspace.path, MASK_PATH),
      attemptId,
      reused: false,
      totalMaskedPixels
    };
  } catch (error) {
    const endedAt = (/* @__PURE__ */ new Date()).toISOString();
    const failedAttempt = {
      ...runningAttempt,
      status: "failed",
      endedAt,
      error: stageError$2(error)
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      stages: replaceStageState$3(runningManifest.stages, {
        ...runningState,
        status: "failed"
      }),
      attempts: replaceAttempt$3(runningManifest.attempts, failedAttempt)
    });
    throw error;
  }
}
const REVIEW_OUTPUT_PATH$2 = "stages/review/text-blocks.json";
const REPORT_PATH = "stages/report/report.json";
const REPORT_ASSET_ID = "asset-report";
function stageStatus(manifest, stage) {
  return manifest.stages.find((state) => state.stage === stage)?.status ?? "missing";
}
async function readJsonAsset(workspacePath, asset, parse) {
  if (asset === void 0) {
    return null;
  }
  return parse(
    JSON.parse(
      await readFile(resolveWorkspacePath(workspacePath, asset.path), "utf8")
    )
  );
}
async function runSlideReport(options) {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  const manifest = workspace.manifest;
  const review = TextReviewDocumentSchema.parse(
    JSON.parse(
      await readFile(
        resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH$2),
        "utf8"
      ).catch(() => "null")
    ) ?? {
      schemaVersion: SCHEMA_VERSION,
      slideId: manifest.slideId,
      image: { width: 1, height: 1 },
      generatedAt: manifest.createdAt,
      reviewStartedAt: null,
      blocks: [],
      unmatchedReferenceCandidates: []
    }
  );
  const ocrAsset = manifest.assets.find((asset2) => asset2.role === "ocr_result");
  const ocr = await readJsonAsset(
    workspace.path,
    ocrAsset,
    (value) => z_ocr(value)
  );
  const maskRecord = await readJsonAsset(
    workspace.path,
    manifest.assets.find((asset2) => asset2.role === "mask_record"),
    (value) => MaskRecordSchema.parse(value)
  );
  const cleanRecord = await readJsonAsset(
    workspace.path,
    manifest.assets.find((asset2) => asset2.role === "clean_record"),
    (value) => CleanAttemptRecordSchema.parse(value)
  );
  const cleanAcceptance = await readJsonAsset(
    workspace.path,
    manifest.assets.find((asset2) => asset2.role === "clean_acceptance"),
    (value) => ArtifactAcceptanceSchema.parse(value)
  );
  const pptxCheck = await readJsonAsset(
    workspace.path,
    manifest.assets.find((asset2) => asset2.role === "pptx_check"),
    (value) => PptxCheckReportSchema.parse(value)
  );
  const pptxAcceptance = await readJsonAsset(
    workspace.path,
    manifest.assets.find((asset2) => asset2.role === "pptx_acceptance"),
    (value) => ArtifactAcceptanceSchema.parse(value)
  );
  const providerCalls = [];
  for (const asset2 of manifest.assets.filter(
    (candidate) => candidate.role === "provider_record"
  )) {
    const record = await readJsonAsset(
      workspace.path,
      asset2,
      (value) => ProviderCallRecordSchema.parse(value)
    );
    if (record !== null && record.error === null) {
      providerCalls.push({
        stage: record.stage,
        model: record.model,
        requestId: record.requestId,
        durationMs: record.durationMs,
        usage: record.usage
      });
    }
  }
  const layoutText = review.blocks.filter(
    (block) => block.classification === "layout_text"
  );
  const reviewedLayoutText = layoutText.filter(
    (block) => block.reviewStatus !== "unreviewed"
  );
  const objectSymbol = review.blocks.filter(
    (block) => block.classification === "object_integrated_symbol"
  ).length;
  const uncertain = review.blocks.filter(
    (block) => block.classification === "uncertain"
  ).length;
  const cleanAcceptStale = stageStatus(manifest, "accept-clean") !== "completed";
  const pptxAcceptStale = stageStatus(manifest, "accept-pptx") !== "completed";
  const pptxAcceptedAt = pptxAcceptance?.acceptedAt ?? null;
  const reviewStartedAt = review.reviewStartedAt;
  const reviewToPptxAcceptMs = reviewStartedAt !== null && pptxAcceptedAt !== null && !pptxAcceptStale ? Math.max(0, Date.parse(pptxAcceptedAt) - Date.parse(reviewStartedAt)) : null;
  const overallComplete = stageStatus(manifest, "accept-pptx") === "completed" && stageStatus(manifest, "accept-clean") === "completed" && pptxCheck?.status === "passed" && layoutText.length > 0 && reviewedLayoutText.length === layoutText.length;
  const report = SlideReportSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    slideId: manifest.slideId,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    overallStatus: overallComplete ? "complete" : "incomplete",
    stages: manifest.stages.map((state) => ({
      stage: state.stage,
      status: state.status
    })),
    discovery: {
      ocrBlockCount: ocr?.blocks.length ?? 0,
      reviewBlockCount: review.blocks.length,
      reviewedLayoutTextCount: reviewedLayoutText.length,
      unreviewedLayoutTextCount: layoutText.length - reviewedLayoutText.length
    },
    classification: {
      layoutText: layoutText.length,
      objectIntegratedSymbol: objectSymbol,
      uncertain
    },
    mask: maskRecord === null ? null : {
      maskedBlockCount: maskRecord.totals.maskedBlockCount,
      maskedPixels: maskRecord.totals.maskedPixels
    },
    autoChecks: {
      cleanPlate: cleanRecord?.checks ?? null,
      pptx: pptxCheck === null ? null : {
        status: pptxCheck.status,
        checks: pptxCheck.checks.map((check) => ({
          id: check.id,
          status: check.status,
          message: check.message
        }))
      }
    },
    manualAcceptance: {
      cleanPlate: cleanAcceptance === null ? null : {
        acceptedBy: cleanAcceptance.acceptedBy,
        acceptedAt: cleanAcceptance.acceptedAt,
        stale: cleanAcceptStale
      },
      pptx: pptxAcceptance === null ? null : {
        acceptedBy: pptxAcceptance.acceptedBy,
        acceptedAt: pptxAcceptance.acceptedAt,
        stale: pptxAcceptStale
      }
    },
    providerCalls,
    manualReview: {
      reviewStartedAt,
      cleanAcceptedAt: cleanAcceptance?.acceptedAt ?? null,
      pptxAcceptedAt,
      reviewToPptxAcceptMs
    }
  });
  const reportPath = resolveWorkspacePath(workspace.path, REPORT_PATH);
  await writeJsonAtomic(reportPath, report);
  const asset = await createWorkspaceAsset(reportPath, {
    schemaVersion: SCHEMA_VERSION,
    id: REPORT_ASSET_ID,
    path: REPORT_PATH,
    role: "report",
    createdAt: report.generatedAt,
    producedBy: "report",
    attemptId: "report-001",
    image: null
  });
  await writeWorkspaceManifest(workspace.path, {
    ...manifest,
    updatedAt: report.generatedAt,
    assets: [
      ...manifest.assets.filter(
        (candidate) => candidate.id !== REPORT_ASSET_ID
      ),
      asset
    ]
  });
  return { reportPath, report };
}
function z_ocr(value) {
  if (value !== null && typeof value === "object" && "blocks" in value && Array.isArray(value.blocks)) {
    return { blocks: value.blocks };
  }
  throw new FoundationError("INVALID_WORKSPACE", "OCR 产物结构无效");
}
const OPENAI_TEXT_ASSIST_MODEL = "gpt-5.6-luna";
const TEXT_ASSIST_PROMPT_VERSION = "m1-text-assist-v2";
function buildPrompt(document, referenceText) {
  const blocks = document.blocks.map((b) => ({
    id: b.id,
    text: b.text,
    bboxPx: b.bboxPx,
    confidence: b.sources[0]?.confidence ?? null
  }));
  return [
    "你正在校正一张 16:9 演示文稿页面的 OCR 识别结果。",
    "对每个文字块：1) 修正 OCR 误差（错别字、乱码、多余标点、缺字）；2) 判断分类。",
    "分类规则：",
    "- layout_text：页面上独立传达信息的文字，包括标题、副标题、正文、列表、图注、解释性标签、标注框文字、流程图/架构图中的节点名称和标注、独立出现的系统或模块名称、独立出现的英文缩写和数字。判断标准是该文字是否独立承担说明或标注功能。",
    "- object_integrated_symbol：与视觉对象融为一体、作为对象纹理或细节存在的符号，例如嵌入图标内部不可分离的微小字母、装饰性象形符号、产品包装上与图形融合的标记。判断标准是去掉该符号后图标/对象的视觉完整性是否被破坏。",
    "- uncertain：无法确定归属时使用，必须附带 classification_uncertain 风险。",
    "关键原则：分类依据是该文字在页面中的视觉和语义角色，不是字符类别。英文缩写、数字、短词既可能是 layout_text 也可能是 object_integrated_symbol，必须根据上下文判断。独立出现在节点、标签、标注中的文字（无论中英文、无论长短）通常是 layout_text。",
    "不确定时必须输出 uncertain，不得猜测。",
    `OCR 文字块（含 bbox 空间位置）：${JSON.stringify(blocks)}`,
    `原始文案参考（可能不准确或不完整）：${referenceText ?? "未提供"}`
  ].join("\n");
}
function buildTextAssistRequest(input) {
  return {
    model: OPENAI_TEXT_ASSIST_MODEL,
    store: false,
    input: [
      {
        role: "user",
        content: buildPrompt(input.document, input.referenceText)
      }
    ],
    text: {
      format: zodTextFormat(TextAssistResultSchema, "slide_text_assist")
    }
  };
}
async function createDefaultParser() {
  const resolvedApiKey = process.env.OPENAI_API_KEY;
  if (resolvedApiKey === void 0 || resolvedApiKey.trim().length === 0) {
    throw new FoundationError(
      "MISSING_DEPENDENCY",
      "缺少 OPENAI_API_KEY，无法运行 AI 辅助复核"
    );
  }
  const client = new OpenAI({
    apiKey: resolvedApiKey,
    baseURL: process.env.OPENAI_BASE_URL || void 0
  });
  return async (request) => {
    const response = await client.responses.parse(request);
    return {
      id: response.id,
      model: response.model,
      outputParsed: response.output_parsed,
      usage: response.usage,
      rawResponse: response
    };
  };
}
async function assistReviewText(options) {
  const request = buildTextAssistRequest({
    document: options.document,
    referenceText: options.referenceText
  });
  const parseResponse = options.parseResponse ?? await createDefaultParser();
  const response = await parseResponse(request);
  const parsed = TextAssistResultSchema.safeParse(response.outputParsed);
  if (!parsed.success) {
    throw new FoundationError(
      "INVALID_PROVIDER_RESPONSE",
      "AI 辅助复核未返回符合 Schema 的结果",
      {
        requestId: response.id,
        issues: parsed.error.issues
      }
    );
  }
  return {
    request,
    requestId: response.id,
    model: response.model,
    usage: response.usage,
    result: parsed.data,
    rawResponse: response.rawResponse
  };
}
const REVIEW_PATH = "stages/review/text-blocks.json";
function replaceStageState$2(states, replacement) {
  return states.map(
    (state) => state.stage === replacement.stage ? replacement : state
  );
}
function replaceAttempt$2(attempts, replacement) {
  return attempts.map(
    (attempt) => attempt.id === replacement.id ? replacement : attempt
  );
}
function redactApiKey(message) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === void 0 || apiKey.length === 0) {
    return message;
  }
  return message.split(apiKey).join("[REDACTED]");
}
function errorRecord(error) {
  if (error instanceof FoundationError) {
    return { code: error.code, message: redactApiKey(error.message) };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: redactApiKey(
      error instanceof Error ? error.message : String(error)
    )
  };
}
function asRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}
function isHumanTouched(block) {
  return block.updatedAt !== null || block.sources.some((source) => source.kind === "manual");
}
function applyAssistResult(documentJson, result) {
  const blocks = documentJson.blocks;
  const resultMap = new Map(result.blocks.map((b) => [b.blockId, b]));
  let autoReviewed = 0;
  let remainingUnreviewed = 0;
  for (const block of blocks) {
    if (isHumanTouched(block)) {
      continue;
    }
    const assist = resultMap.get(block.id);
    if (assist === void 0) {
      remainingUnreviewed += 1;
      continue;
    }
    const hasRisk = assist.risks.length > 0;
    const isConfident = !hasRisk && assist.classification !== "uncertain";
    block.text = assist.correctedText;
    block.lines = [assist.correctedText];
    const existingSources = block.sources;
    const hasAssistSource = existingSources.some(
      (s) => s.kind === "ai_text_assist"
    );
    if (!hasAssistSource) {
      existingSources.push({
        kind: "ai_text_assist",
        provider: "openai-text-assist",
        text: assist.correctedText,
        confidence: null
      });
    }
    if (isConfident) {
      block.classification = assist.classification;
      block.includeInMask = assist.classification === "layout_text";
      block.reviewStatus = "reviewed";
      autoReviewed += 1;
    } else {
      block.classification = assist.classification;
      block.includeInMask = assist.classification === "layout_text";
      remainingUnreviewed += 1;
    }
  }
  return { autoReviewed, remainingUnreviewed };
}
async function runAssistReview(options) {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  assertStageDependenciesCompleted(workspace.manifest.stages, "assist-review");
  const reviewState = workspace.manifest.stages.find(
    (state) => state.stage === "review"
  );
  if (reviewState?.status !== "completed") {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 assist-review 前必须先完成 review 阶段"
    );
  }
  const reviewAsset = workspace.manifest.assets.find(
    (asset) => asset.role === "text_review" && asset.attemptId === reviewState.lastSuccessfulAttemptId
  );
  if (reviewAsset === void 0) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 assist-review 前必须存在成功的 review 产物"
    );
  }
  await assertWorkspaceAssetIntegrity(workspace.path, reviewAsset);
  const referenceAsset = workspace.manifest.referenceTextAssetId === null ? null : workspace.manifest.assets.find(
    (asset) => asset.id === workspace.manifest.referenceTextAssetId
  ) ?? null;
  const inputFingerprint = sha256Values([
    reviewAsset.sha256,
    referenceAsset?.sha256 ?? "no-reference",
    OPENAI_TEXT_ASSIST_MODEL,
    TEXT_ASSIST_PROMPT_VERSION
  ]);
  const previousState = workspace.manifest.stages.find(
    (state) => state.stage === "assist-review"
  );
  if (previousState === void 0) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 assist-review 阶段状态"
    );
  }
  if (isStageReusable(previousState, inputFingerprint) && previousState.lastSuccessfulAttemptId !== null) {
    const outputPath = resolveWorkspacePath(workspace.path, REVIEW_PATH);
    const doc = TextReviewDocumentSchema.parse(
      JSON.parse(await readFile(outputPath, "utf8"))
    );
    const autoReviewed = doc.blocks.filter(
      (b) => b.reviewStatus === "reviewed" && b.sources.some((s) => s.kind === "ai_text_assist")
    ).length;
    const remainingUnreviewed = doc.blocks.filter(
      (b) => b.reviewStatus === "unreviewed"
    ).length;
    return {
      outputPath,
      attemptId: previousState.lastSuccessfulAttemptId,
      reused: true,
      autoReviewed,
      remainingUnreviewed
    };
  }
  const reviewContent = await readFile(
    resolveWorkspacePath(workspace.path, REVIEW_PATH),
    "utf8"
  );
  const document = TextReviewDocumentSchema.parse(JSON.parse(reviewContent));
  const referenceText = referenceAsset === null ? null : await readFile(
    resolveWorkspacePath(workspace.path, referenceAsset.path),
    "utf8"
  );
  const attemptNumber = workspace.manifest.attempts.filter(
    (attempt) => attempt.stage === "assist-review"
  ).length + 1;
  const attemptId = `assist-review-${String(attemptNumber).padStart(3, "0")}`;
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const invalidatedStates = previousState.completedInputFingerprint !== null && previousState.completedInputFingerprint !== inputFingerprint ? invalidateStageAndDownstream(
    workspace.manifest.stages,
    "assist-review",
    "assist-review 输入指纹变化",
    startedAt
  ) : workspace.manifest.stages;
  const invalidatedState = invalidatedStates.find(
    (state) => state.stage === "assist-review"
  );
  if (invalidatedState === void 0) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 assist-review 阶段状态"
    );
  }
  const runningAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "assist-review",
    number: attemptNumber,
    status: "running",
    inputFingerprint,
    startedAt,
    endedAt: null,
    provider: "openai",
    providerVersion: "openai-node@latest",
    assetIds: [],
    error: null
  };
  const runningState = {
    ...invalidatedState,
    status: "running",
    latestAttemptId: attemptId,
    invalidatedAt: null,
    invalidationReason: null
  };
  const runningManifest = {
    ...workspace.manifest,
    updatedAt: startedAt,
    stages: replaceStageState$2(invalidatedStates, runningState),
    attempts: [...workspace.manifest.attempts, runningAttempt]
  };
  await writeWorkspaceManifest(workspace.path, runningManifest);
  const attemptDirectory = `stages/assist-review/${attemptId}`;
  const providerRecordPath = `${attemptDirectory}/provider.json`;
  const aiResultPath = `${attemptDirectory}/result.json`;
  const rawResponsePath = `${attemptDirectory}/raw-response.json`;
  try {
    const analysis = await assistReviewText({
      document,
      referenceText,
      ...options.parseResponse === void 0 ? {} : { parseResponse: options.parseResponse }
    });
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, aiResultPath),
      analysis.result
    );
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, rawResponsePath),
      analysis.rawResponse
    );
    const documentJson = JSON.parse(reviewContent);
    const { autoReviewed, remainingUnreviewed } = applyAssistResult(
      documentJson,
      analysis.result
    );
    const updatedDocument = TextReviewDocumentSchema.parse(documentJson);
    const outputPath = resolveWorkspacePath(workspace.path, REVIEW_PATH);
    await writeJsonAtomic(outputPath, updatedDocument);
    const endedAt = (/* @__PURE__ */ new Date()).toISOString();
    const [reviewAssetNew, aiResultAsset, rawResponseAsset] = await Promise.all(
      [
        createWorkspaceAsset(outputPath, {
          schemaVersion: SCHEMA_VERSION,
          id: `asset-${attemptId}-text-review`,
          path: REVIEW_PATH,
          role: "text_review",
          createdAt: endedAt,
          producedBy: "assist-review",
          attemptId,
          image: null
        }),
        createWorkspaceAsset(
          resolveWorkspacePath(workspace.path, aiResultPath),
          {
            schemaVersion: SCHEMA_VERSION,
            id: `asset-${attemptId}-ai-result`,
            path: aiResultPath,
            role: "assist_review_result",
            createdAt: endedAt,
            producedBy: "assist-review",
            attemptId,
            image: null
          }
        ),
        createWorkspaceAsset(
          resolveWorkspacePath(workspace.path, rawResponsePath),
          {
            schemaVersion: SCHEMA_VERSION,
            id: `asset-${attemptId}-raw-response`,
            path: rawResponsePath,
            role: "provider_response",
            createdAt: endedAt,
            producedBy: "assist-review",
            attemptId,
            image: null
          }
        )
      ]
    );
    const providerRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: `provider-${attemptId}`,
      stage: "assist-review",
      provider: "openai",
      endpoint: "/v1/responses",
      model: OPENAI_TEXT_ASSIST_MODEL,
      parameters: { store: false },
      promptVersion: TEXT_ASSIST_PROMPT_VERSION,
      sentAssets: [{ path: REVIEW_PATH, sha256: reviewAsset.sha256 }],
      requestId: analysis.requestId,
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      usage: asRecord(analysis.usage),
      error: null,
      rawResponsePath,
      rawResponseSha256: rawResponseAsset.sha256,
      parsedResponsePath: aiResultPath,
      parsedResponseSha256: aiResultAsset.sha256
    };
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, providerRecordPath),
      ProviderCallRecordSchema.parse(providerRecord)
    );
    const providerRecordAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, providerRecordPath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-provider-record`,
        path: providerRecordPath,
        role: "provider_record",
        createdAt: endedAt,
        producedBy: "assist-review",
        attemptId,
        image: null
      }
    );
    const assets = [
      reviewAssetNew,
      aiResultAsset,
      rawResponseAsset,
      providerRecordAsset
    ];
    const completedAttempt = {
      ...runningAttempt,
      status: "completed",
      endedAt,
      assetIds: assets.map((asset) => asset.id)
    };
    const completedState = {
      ...runningState,
      status: "completed",
      lastSuccessfulAttemptId: attemptId,
      completedInputFingerprint: inputFingerprint
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      assets: [...runningManifest.assets, ...assets],
      stages: replaceStageState$2(runningManifest.stages, completedState),
      attempts: replaceAttempt$2(runningManifest.attempts, completedAttempt)
    });
    return {
      outputPath,
      attemptId,
      reused: false,
      autoReviewed,
      remainingUnreviewed
    };
  } catch (error) {
    const endedAt = (/* @__PURE__ */ new Date()).toISOString();
    const providerError = errorRecord(error);
    const providerRecord = {
      schemaVersion: SCHEMA_VERSION,
      id: `provider-${attemptId}`,
      stage: "assist-review",
      provider: "openai",
      endpoint: "/v1/responses",
      model: OPENAI_TEXT_ASSIST_MODEL,
      parameters: { store: false },
      promptVersion: TEXT_ASSIST_PROMPT_VERSION,
      sentAssets: [{ path: REVIEW_PATH, sha256: reviewAsset.sha256 }],
      requestId: null,
      startedAt,
      endedAt,
      durationMs: Date.parse(endedAt) - Date.parse(startedAt),
      usage: null,
      error: providerError,
      rawResponsePath: null,
      rawResponseSha256: null,
      parsedResponsePath: null,
      parsedResponseSha256: null
    };
    await writeJsonAtomic(
      resolveWorkspacePath(workspace.path, providerRecordPath),
      ProviderCallRecordSchema.parse(providerRecord)
    );
    const providerAsset = await createWorkspaceAsset(
      resolveWorkspacePath(workspace.path, providerRecordPath),
      {
        schemaVersion: SCHEMA_VERSION,
        id: `asset-${attemptId}-provider-record`,
        path: providerRecordPath,
        role: "provider_record",
        createdAt: endedAt,
        producedBy: "assist-review",
        attemptId,
        image: null
      }
    );
    const failedAttempt = {
      ...runningAttempt,
      status: "failed",
      endedAt,
      assetIds: [providerAsset.id],
      error: providerError
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      assets: [...runningManifest.assets, providerAsset],
      stages: replaceStageState$2(runningManifest.stages, {
        ...runningState,
        status: "failed"
      }),
      attempts: replaceAttempt$2(runningManifest.attempts, failedAttempt)
    });
    throw error;
  }
}
const execFileAsync = promisify(execFile);
function defaultVisionBinary(cwd = process.cwd()) {
  return resolve(cwd, "native/macos-vision-ocr/.build/macos-vision-ocr");
}
async function runVisionOcr(imagePath, binaryPath = defaultVisionBinary()) {
  await assertWideImage(imagePath);
  await access(binaryPath).catch(() => {
    throw new Error(
      `Apple Vision 探针尚未构建：${binaryPath}，请先运行 pnpm build:vision`
    );
  });
  const { stdout } = await execFileAsync(binaryPath, [resolve(imagePath)], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  const raw = JSON.parse(stdout);
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
function replaceStageState$1(states, replacement) {
  return states.map(
    (state) => state.stage === replacement.stage ? replacement : state
  );
}
function replaceAttempt$1(attempts, replacement) {
  return attempts.map(
    (attempt) => attempt.id === replacement.id ? replacement : attempt
  );
}
function findSourceAsset$1(manifest) {
  const source = manifest.assets.find(
    (asset) => asset.id === manifest.sourceImageAssetId
  );
  if (source === void 0) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "manifest 未引用有效源图资产",
      { sourceImageAssetId: manifest.sourceImageAssetId }
    );
  }
  return source;
}
function findOcrOutput(manifest, attemptId) {
  return manifest.assets.find(
    (asset) => asset.role === "ocr_result" && asset.attemptId === attemptId
  );
}
function stageError$1(error) {
  if (error instanceof FoundationError) {
    return {
      code: error.code,
      message: error.message,
      ...error.details === void 0 ? {} : { details: error.details }
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : String(error)
  };
}
async function readReusableResult(workspacePath, manifest, attemptId) {
  const asset = findOcrOutput(manifest, attemptId);
  if (asset === void 0) {
    return null;
  }
  await assertWorkspaceAssetIntegrity(workspacePath, asset);
  const outputPath = resolveWorkspacePath(workspacePath, asset.path);
  OcrProbeResponseSchema.parse(JSON.parse(await readFile(outputPath, "utf8")));
  return { outputPath, attemptId, reused: true };
}
async function runSlideOcr(options) {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  const source = findSourceAsset$1(workspace.manifest);
  await assertWorkspaceAssetIntegrity(workspace.path, source);
  assertStageDependenciesCompleted(workspace.manifest.stages, "ocr");
  const binaryPath = resolve(
    options.binaryPath ?? defaultVisionBinary(process.cwd())
  );
  const binaryFingerprint = await sha256File(binaryPath).catch(
    () => `unavailable:${binaryPath}`
  );
  const inputFingerprint = sha256Values([
    source.sha256,
    binaryFingerprint,
    "apple-vision-ocr-schema:2"
  ]);
  const previousState = workspace.manifest.stages.find(
    (state) => state.stage === "ocr"
  );
  if (previousState === void 0) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 ocr 阶段状态");
  }
  if (isStageReusable(previousState, inputFingerprint) && previousState.lastSuccessfulAttemptId !== null) {
    const reusable = await readReusableResult(
      workspace.path,
      workspace.manifest,
      previousState.lastSuccessfulAttemptId
    );
    if (reusable !== null) {
      return reusable;
    }
  }
  const attemptNumber = workspace.manifest.attempts.filter((attempt) => attempt.stage === "ocr").length + 1;
  const attemptId = `ocr-${String(attemptNumber).padStart(3, "0")}`;
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const invalidatedStates = previousState.completedInputFingerprint !== null && previousState.completedInputFingerprint !== inputFingerprint ? invalidateStageAndDownstream(
    workspace.manifest.stages,
    "ocr",
    "OCR 输入指纹变化",
    startedAt
  ) : workspace.manifest.stages;
  const invalidatedOcrState = invalidatedStates.find(
    (state) => state.stage === "ocr"
  );
  if (invalidatedOcrState === void 0) {
    throw new FoundationError("INVALID_WORKSPACE", "工作区缺少 ocr 阶段状态");
  }
  const runningAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "ocr",
    number: attemptNumber,
    status: "running",
    inputFingerprint,
    startedAt,
    endedAt: null,
    provider: "apple-vision",
    providerVersion: binaryFingerprint,
    assetIds: [],
    error: null
  };
  const runningState = {
    ...invalidatedOcrState,
    status: "running",
    latestAttemptId: attemptId,
    invalidatedAt: null,
    invalidationReason: null
  };
  const runningManifest = {
    ...workspace.manifest,
    updatedAt: startedAt,
    stages: replaceStageState$1(invalidatedStates, runningState),
    attempts: [...workspace.manifest.attempts, runningAttempt]
  };
  await writeWorkspaceManifest(workspace.path, runningManifest);
  try {
    const sourcePath = resolveWorkspacePath(workspace.path, source.path);
    const result = await runVisionOcr(sourcePath, binaryPath);
    const outputRelativePath = `stages/ocr/${attemptId}/result.json`;
    const outputPath = resolveWorkspacePath(workspace.path, outputRelativePath);
    await writeJsonAtomic(outputPath, result);
    const asset = await createWorkspaceAsset(outputPath, {
      schemaVersion: SCHEMA_VERSION,
      id: `asset-${attemptId}-result`,
      path: outputRelativePath,
      role: "ocr_result",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      producedBy: "ocr",
      attemptId,
      image: null
    });
    const endedAt = (/* @__PURE__ */ new Date()).toISOString();
    const completedAttempt = {
      ...runningAttempt,
      status: "completed",
      endedAt,
      assetIds: [asset.id]
    };
    const completedState = {
      ...runningState,
      status: "completed",
      lastSuccessfulAttemptId: attemptId,
      completedInputFingerprint: inputFingerprint
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      assets: [...runningManifest.assets, asset],
      stages: replaceStageState$1(runningManifest.stages, completedState),
      attempts: replaceAttempt$1(runningManifest.attempts, completedAttempt)
    });
    return { outputPath, attemptId, reused: false };
  } catch (error) {
    const endedAt = (/* @__PURE__ */ new Date()).toISOString();
    const failedAttempt = {
      ...runningAttempt,
      status: "failed",
      endedAt,
      error: stageError$1(error)
    };
    const failedState = {
      ...runningState,
      status: "failed"
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      stages: replaceStageState$1(runningManifest.stages, failedState),
      attempts: replaceAttempt$1(runningManifest.attempts, failedAttempt)
    });
    throw error;
  }
}
const REVIEW_OUTPUT_PATH$1 = "stages/review/text-blocks.json";
function computeReviewInputFingerprint(input) {
  return sha256Values([
    input.ocrSha256,
    input.referenceSha256 ?? "no-reference",
    TEXT_MERGE_ALGORITHM_VERSION
  ]);
}
function replaceStageState(states, replacement) {
  return states.map(
    (state) => state.stage === replacement.stage ? replacement : state
  );
}
function replaceAttempt(attempts, replacement) {
  return attempts.map(
    (attempt) => attempt.id === replacement.id ? replacement : attempt
  );
}
function findAssetById(manifest, assetId) {
  const asset = manifest.assets.find((candidate) => candidate.id === assetId);
  if (asset === void 0) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      `manifest 未引用有效资产：${assetId}`,
      { assetId }
    );
  }
  return asset;
}
function findLastSuccessfulAsset(manifest, stage, role) {
  const state = manifest.stages.find((candidate) => candidate.stage === stage);
  if (state === void 0 || state.lastSuccessfulAttemptId === null) {
    return null;
  }
  return manifest.assets.find(
    (asset) => asset.attemptId === state.lastSuccessfulAttemptId && asset.role === role
  ) ?? null;
}
function stageError(error) {
  if (error instanceof FoundationError) {
    return {
      code: error.code,
      message: error.message,
      ...error.details === void 0 ? {} : { details: error.details }
    };
  }
  return {
    code: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : String(error)
  };
}
async function readExistingReview(workspacePath) {
  const path = resolveWorkspacePath(workspacePath, REVIEW_OUTPUT_PATH$1);
  let content;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const parsed = TextReviewDocumentSchema.safeParse(JSON.parse(content));
  if (!parsed.success) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      `${REVIEW_OUTPUT_PATH$1} 校验失败，请先修复该文件再重跑 review`,
      { issues: parsed.error.issues }
    );
  }
  return parsed.data;
}
async function runSlideReview(options) {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  const ocrState = workspace.manifest.stages.find(
    (state) => state.stage === "ocr"
  );
  if (ocrState?.status !== "completed") {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 review 前必须先完成 ocr 阶段",
      { ocrStatus: ocrState?.status ?? "missing" }
    );
  }
  const ocrAsset = findLastSuccessfulAsset(
    workspace.manifest,
    "ocr",
    "ocr_result"
  );
  if (ocrAsset === null) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 review 前必须存在成功且有效的 OCR 产物"
    );
  }
  const referenceAsset = workspace.manifest.referenceTextAssetId === null ? null : findAssetById(
    workspace.manifest,
    workspace.manifest.referenceTextAssetId
  );
  for (const asset of [ocrAsset, referenceAsset]) {
    if (asset !== null) {
      await assertWorkspaceAssetIntegrity(workspace.path, asset);
    }
  }
  const inputFingerprint = computeReviewInputFingerprint({
    ocrSha256: ocrAsset.sha256,
    referenceSha256: referenceAsset?.sha256 ?? null
  });
  const previousState = workspace.manifest.stages.find(
    (state) => state.stage === "review"
  );
  if (previousState === void 0) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 review 阶段状态"
    );
  }
  if (isStageReusable(previousState, inputFingerprint) && previousState.lastSuccessfulAttemptId !== null) {
    const existing2 = await readExistingReview(workspace.path).catch(() => null);
    if (existing2 !== null) {
      return {
        outputPath: resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH$1),
        attemptId: previousState.lastSuccessfulAttemptId,
        reused: true
      };
    }
  }
  const ocr = OcrProbeResponseSchema.parse(
    JSON.parse(
      await readFile(
        resolveWorkspacePath(workspace.path, ocrAsset.path),
        "utf8"
      )
    )
  );
  const referenceText = referenceAsset === null ? null : await readFile(
    resolveWorkspacePath(workspace.path, referenceAsset.path),
    "utf8"
  );
  const existing = await readExistingReview(workspace.path);
  const attemptNumber = workspace.manifest.attempts.filter((attempt) => attempt.stage === "review").length + 1;
  const attemptId = `review-${String(attemptNumber).padStart(3, "0")}`;
  const startedAt = (/* @__PURE__ */ new Date()).toISOString();
  const invalidatedStates = previousState.completedInputFingerprint !== null && previousState.completedInputFingerprint !== inputFingerprint ? invalidateStageAndDownstream(
    workspace.manifest.stages,
    "review",
    "review 输入指纹变化",
    startedAt
  ) : workspace.manifest.stages;
  const invalidatedReviewState = invalidatedStates.find(
    (state) => state.stage === "review"
  );
  if (invalidatedReviewState === void 0) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "工作区缺少 review 阶段状态"
    );
  }
  const runningAttempt = {
    schemaVersion: SCHEMA_VERSION,
    id: attemptId,
    stage: "review",
    number: attemptNumber,
    status: "running",
    inputFingerprint,
    startedAt,
    endedAt: null,
    provider: "ppt-maker-cli",
    providerVersion: TEXT_MERGE_ALGORITHM_VERSION,
    assetIds: [],
    error: null
  };
  const runningState = {
    ...invalidatedReviewState,
    status: "running",
    latestAttemptId: attemptId,
    invalidatedAt: null,
    invalidationReason: null
  };
  const runningManifest = {
    ...workspace.manifest,
    updatedAt: startedAt,
    stages: replaceStageState(invalidatedStates, runningState),
    attempts: [...workspace.manifest.attempts, runningAttempt]
  };
  await writeWorkspaceManifest(workspace.path, runningManifest);
  try {
    const document = mergeTextBlockCandidates({
      slideId: workspace.manifest.slideId,
      image: {
        width: ocr.image.width,
        height: ocr.image.height
      },
      ocr,
      analysis: null,
      referenceText,
      existing,
      now: startedAt
    });
    const outputPath = resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH$1);
    await writeJsonAtomic(outputPath, TextReviewDocumentSchema.parse(document));
    const asset = await createWorkspaceAsset(outputPath, {
      schemaVersion: SCHEMA_VERSION,
      id: `asset-${attemptId}-text-review`,
      path: REVIEW_OUTPUT_PATH$1,
      role: "text_review",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      producedBy: "review",
      attemptId,
      image: null
    });
    const endedAt = (/* @__PURE__ */ new Date()).toISOString();
    const completedAttempt = {
      ...runningAttempt,
      status: "completed",
      endedAt,
      assetIds: [asset.id]
    };
    const completedState = {
      ...runningState,
      status: "completed",
      lastSuccessfulAttemptId: attemptId,
      completedInputFingerprint: inputFingerprint
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      assets: [...runningManifest.assets, asset],
      stages: replaceStageState(runningManifest.stages, completedState),
      attempts: replaceAttempt(runningManifest.attempts, completedAttempt)
    });
    return { outputPath, attemptId, reused: false };
  } catch (error) {
    const endedAt = (/* @__PURE__ */ new Date()).toISOString();
    const failedAttempt = {
      ...runningAttempt,
      status: "failed",
      endedAt,
      error: stageError(error)
    };
    await writeWorkspaceManifest(workspace.path, {
      ...runningManifest,
      updatedAt: endedAt,
      stages: replaceStageState(runningManifest.stages, {
        ...runningState,
        status: "failed"
      }),
      attempts: replaceAttempt(runningManifest.attempts, failedAttempt)
    });
    throw error;
  }
}
const REVIEW_OUTPUT_PATH = "stages/review/text-blocks.json";
const VALIDATION_OUTPUT_PATH = "stages/review/validation.json";
const VALIDATION_ASSET_ID = "asset-review-validation";
function findSourceAsset(manifest) {
  const asset = manifest.assets.find(
    (candidate) => candidate.id === manifest.sourceImageAssetId
  );
  if (asset === void 0) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "manifest 未引用有效源图资产",
      { sourceImageAssetId: manifest.sourceImageAssetId }
    );
  }
  return asset;
}
async function runSlideValidateReview(options) {
  const workspace = await loadSlideWorkspace(options.workspacePath);
  const reviewState = workspace.manifest.stages.find(
    (state) => state.stage === "review"
  );
  if (reviewState?.status !== "completed" || reviewState.lastSuccessfulAttemptId === null) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      "运行 validate-review 前必须先完成 review 生成 text-blocks.json",
      { reviewStatus: reviewState?.status ?? "missing" }
    );
  }
  const reviewPath = resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH);
  let content;
  try {
    content = await readFile(reviewPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new FoundationError(
        "INVALID_STAGE_STATE",
        `未找到复核文件：${REVIEW_OUTPUT_PATH}`
      );
    }
    throw error;
  }
  const documentSha256 = await sha256File(reviewPath);
  const source = findSourceAsset(workspace.manifest);
  if (source.image === null) {
    throw new FoundationError(
      "INVALID_WORKSPACE",
      "源图资产缺少尺寸元数据，无法校验坐标"
    );
  }
  const violations = [];
  let parsedJson;
  try {
    parsedJson = JSON.parse(content);
  } catch (error) {
    violations.push({
      blockId: null,
      field: "document",
      code: "JSON_PARSE_ERROR",
      message: error instanceof Error ? error.message : String(error),
      severity: "error"
    });
  }
  if (violations.length === 0) {
    const parsed = TextReviewDocumentSchema.safeParse(parsedJson);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        violations.push({
          blockId: null,
          field: issue.path.length === 0 ? "document" : issue.path.join("."),
          code: "SCHEMA_INVALID",
          message: issue.message,
          severity: "error"
        });
      }
    } else {
      if (parsed.data.slideId !== workspace.manifest.slideId) {
        violations.push({
          blockId: null,
          field: "slideId",
          code: "SLIDE_ID_MISMATCH",
          message: "text-blocks.json 的 slideId 与工作区不一致",
          severity: "error"
        });
      }
      violations.push(
        ...validateTextReviewDocument(parsed.data, {
          image: { width: source.image.width, height: source.image.height }
        })
      );
    }
  }
  const errors = violations.filter(
    (violation) => violation.severity === "error"
  ).length;
  const warnings = violations.length - errors;
  const report = TextReviewValidationReportSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    slideId: workspace.manifest.slideId,
    rulesVersion: REVIEW_VALIDATION_RULES_VERSION,
    status: errors === 0 ? "passed" : "failed",
    checkedAt: (/* @__PURE__ */ new Date()).toISOString(),
    documentSha256,
    violations,
    summary: { errors, warnings }
  });
  const reportPath = resolveWorkspacePath(
    workspace.path,
    VALIDATION_OUTPUT_PATH
  );
  await writeJsonAtomic(reportPath, report);
  const asset = await createWorkspaceAsset(reportPath, {
    schemaVersion: SCHEMA_VERSION,
    id: VALIDATION_ASSET_ID,
    path: VALIDATION_OUTPUT_PATH,
    role: "review_validation",
    createdAt: report.checkedAt,
    producedBy: "review",
    attemptId: reviewState.lastSuccessfulAttemptId,
    image: null
  });
  await writeWorkspaceManifest(workspace.path, {
    ...workspace.manifest,
    updatedAt: report.checkedAt,
    assets: [
      ...workspace.manifest.assets.filter(
        (candidate) => candidate.id !== VALIDATION_ASSET_ID
      ),
      asset
    ]
  });
  return { reportPath, report };
}
const RUN_SEQUENCE = [
  "ocr",
  "review",
  "assist-review",
  "validate-review",
  "mask",
  "clean",
  "accept-clean",
  "pptx",
  "accept-pptx",
  "report"
];
function stageState(manifest, stage) {
  return manifest.stages.find((state) => state.stage === stage);
}
async function runSlideRunFrom(from, options) {
  const startIndex = RUN_SEQUENCE.indexOf(from);
  if (startIndex === -1) {
    throw new FoundationError(
      "INVALID_STAGE_STATE",
      `run --from 不支持的阶段：${from}`,
      { supported: RUN_SEQUENCE }
    );
  }
  const executed = [];
  for (let i = startIndex; i < RUN_SEQUENCE.length; i += 1) {
    const stage = RUN_SEQUENCE[i];
    if (stage === void 0) {
      continue;
    }
    const workspace = await loadSlideWorkspace(options.workspacePath);
    try {
      if (stage === "ocr") {
        await runSlideOcr({ workspacePath: options.workspacePath });
        executed.push(stage);
      } else if (stage === "review") {
        await runSlideReview({ workspacePath: options.workspacePath });
        executed.push(stage);
      } else if (stage === "assist-review") {
        if (stageState(workspace.manifest, "assist-review")?.status !== "completed") {
          if (options.confirmApi === true) {
            await runAssistReview({
              workspacePath: options.workspacePath,
              confirmApi: true
            });
            executed.push("assist-review");
          } else {
            return {
              executed,
              stoppedAt: "assist-review",
              gate: "api",
              nextCommand: `ppt-maker slide assist-review --confirm-api ${options.workspacePath}`,
              message: "AI 辅助复核需显式调用 API，run 不会自动触发；完成后可继续 run --from validate-review"
            };
          }
        }
      } else if (stage === "validate-review") {
        const { report } = await runSlideValidateReview({
          workspacePath: options.workspacePath
        });
        executed.push(stage);
        if (report.status !== "passed") {
          return {
            executed,
            stoppedAt: "validate-review",
            gate: "validation-failed",
            nextCommand: `ppt-maker slide validate-review ${options.workspacePath}`,
            message: `复核校验未通过（错误 ${report.summary.errors}），请修复 text-blocks.json 后重试`
          };
        }
      } else if (stage === "mask") {
        await runSlideMask({ workspacePath: options.workspacePath });
        executed.push(stage);
      } else if (stage === "pptx") {
        await runSlidePptx({ workspacePath: options.workspacePath });
        executed.push(stage);
      } else if (stage === "report") {
        await runSlideReport({ workspacePath: options.workspacePath });
        executed.push(stage);
      } else if (stage === "clean") {
        if (stageState(workspace.manifest, "clean")?.status !== "completed") {
          if (options.confirmUpload === true) {
            await runSlideClean({
              workspacePath: options.workspacePath,
              confirmUpload: true
            });
            executed.push("clean");
          } else {
            return {
              executed,
              stoppedAt: "clean",
              gate: "upload",
              nextCommand: `ppt-maker slide clean --confirm-upload ${options.workspacePath}`,
              message: "clean plate 需显式上传源图与 mask，run 不会自动上传"
            };
          }
        }
      } else if (stage === "accept-clean" || stage === "accept-pptx") {
        if (stageState(workspace.manifest, stage)?.status !== "completed") {
          const command = stage === "accept-clean" ? `ppt-maker slide accept-clean ${options.workspacePath}` : `ppt-maker slide accept-pptx ${options.workspacePath}`;
          return {
            executed,
            stoppedAt: stage,
            gate: "manual",
            nextCommand: command,
            message: stage === "accept-clean" ? "请人工核对 clean plate 后运行 accept-clean" : "请在 PowerPoint for Mac 检查后运行 accept-pptx"
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        executed,
        stoppedAt: stage,
        gate: "error",
        nextCommand: null,
        message: `阶段 ${stage} 无法自动执行：${message}`
      };
    }
  }
  return {
    executed,
    stoppedAt: null,
    gate: null,
    nextCommand: null,
    message: "已执行到 report，流水线完成"
  };
}
function registerSlideHandlers(_mainWindow) {
  ipcMain.handle(
    "slide:load-review",
    async (_event, workspacePath) => {
      const ws = resolve(workspacePath);
      const reviewPath = join(ws, "review", "text-blocks.json");
      try {
        const raw = await readFile(reviewPath, "utf-8");
        return TextReviewDocumentSchema.parse(JSON.parse(raw));
      } catch {
        return null;
      }
    }
  );
  ipcMain.handle(
    "slide:save-review",
    async (_event, workspacePath, document) => {
      const ws = resolve(workspacePath);
      const parsed = TextReviewDocumentSchema.parse(document);
      const reviewPath = join(ws, "review", "text-blocks.json");
      const { writeFile: writeFile2 } = await import("node:fs/promises");
      await writeFile2(reviewPath, JSON.stringify(parsed, null, 2), "utf-8");
      const workspace = await loadSlideWorkspace(ws);
      const sourceImage = workspace.manifest.assets.find(
        (a) => a.role === "source_image"
      );
      const violations = validateTextReviewDocument(parsed, {
        image: sourceImage?.image ?? parsed.image
      });
      const errors = violations.filter((v) => v.severity === "error").length;
      const warnings = violations.filter(
        (v) => v.severity === "warning"
      ).length;
      return { valid: errors === 0, errors, warnings };
    }
  );
  ipcMain.handle(
    "slide:run",
    async (_event, workspacePath, from, opts) => {
      const result = await runSlideRunFrom(from, {
        workspacePath: resolve(workspacePath),
        ...opts?.confirmApi === true ? { confirmApi: true } : {},
        ...opts?.confirmUpload === true ? { confirmUpload: true } : {}
      });
      return {
        executed: result.executed,
        gate: result.gate,
        message: result.message,
        nextCommand: result.nextCommand
      };
    }
  );
  ipcMain.handle(
    "slide:accept-clean",
    async (_event, workspacePath, opts) => {
      const result = await runAcceptClean({
        workspacePath: resolve(workspacePath),
        ...opts?.acceptedBy ? { acceptedBy: opts.acceptedBy } : {},
        ...opts?.note ? { note: opts.note } : {}
      });
      return {
        acceptedPath: result.acceptedPath,
        autoCheckSummary: result.autoCheckSummary
      };
    }
  );
  ipcMain.handle(
    "slide:accept-pptx",
    async (_event, workspacePath, opts) => {
      const result = await runAcceptPptx({
        workspacePath: resolve(workspacePath),
        ...opts?.acceptedBy ? { acceptedBy: opts.acceptedBy } : {},
        ...opts?.note ? { note: opts.note } : {}
      });
      return {
        acceptedPath: result.acceptedPath,
        autoCheckSummary: result.autoCheckSummary
      };
    }
  );
  ipcMain.handle(
    "slide:load-image",
    async (_event, workspacePath, role) => {
      const ws = resolve(workspacePath);
      const workspace = await loadSlideWorkspace(ws);
      const asset = workspace.manifest.assets.find((a) => a.role === role);
      if (!asset) return null;
      const imagePath = join(ws, asset.path);
      try {
        const buffer = await readFile(imagePath);
        const ext = asset.image?.format ?? "png";
        return `data:image/${ext};base64,${buffer.toString("base64")}`;
      } catch {
        return null;
      }
    }
  );
}
function registerSystemHandlers(_mainWindow) {
  ipcMain.handle("system:doctor", () => {
    const report = collectSystemDoctorReport();
    return {
      checks: report.checks.map((c) => ({
        id: c.id,
        label: c.label,
        status: c.status,
        message: c.message
      })),
      summary: report.summary
    };
  });
  ipcMain.handle(
    "system:select-directory",
    async () => {
      const result = await dialog.showOpenDialog({
        properties: ["openDirectory"]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0] ?? null;
    }
  );
  ipcMain.handle(
    "system:select-file",
    async (_event, filters) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: filters ?? [
          { name: "图片", extensions: ["png", "jpg", "jpeg"] }
        ]
      });
      if (result.canceled || result.filePaths.length === 0) {
        return null;
      }
      return result.filePaths[0] ?? null;
    }
  );
  ipcMain.handle(
    "system:save-file-dialog",
    async (_event, defaultName) => {
      const result = await dialog.showSaveDialog({
        defaultPath: defaultName,
        filters: [{ name: "PowerPoint", extensions: ["pptx"] }]
      });
      if (result.canceled || !result.filePath) {
        return null;
      }
      return result.filePath;
    }
  );
}
function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  registerSystemHandlers();
  registerDeckHandlers();
  registerSlideHandlers();
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl) {
    mainWindow.loadURL(rendererUrl);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return mainWindow;
}
app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

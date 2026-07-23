import { readFile } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import {
  DEFAULT_FONT_FACE,
  type DeckExportRecord,
  DeckExportRecordSchema,
  type DeckManifest,
  FoundationError,
  SCHEMA_VERSION,
  TextReviewDocumentSchema,
} from "@ppt-maker/core";
import { assertAcceptedCleanPlate, selectTextBoxBlocks } from "../pptx/run.js";
import { sampleBlockColors } from "../pptx/sample-color.js";
import {
  type DeckSlideInput,
  synthesizeDeckPptx,
} from "../pptx/synthesize-deck.js";
import {
  assertWorkspaceAssetIntegrity,
  loadSlideWorkspace,
  resolveWorkspacePath,
  sha256File,
} from "../slide/workspace.js";
import {
  loadDeckWorkspace,
  resolveDeckPath,
  writeDeckManifest,
} from "./workspace.js";

const REVIEW_OUTPUT_PATH = "stages/review/text-blocks.json";
const MASK_PATH = "stages/mask/mask.png";

export interface ExportDeckOptions {
  readonly deckPath: string;
  readonly outputPath: string;
  readonly strict?: boolean;
  readonly fontFace?: string;
}

export interface ExportDeckResult {
  readonly outputPath: string;
  readonly totalSlides: number;
  readonly nativeSlides: number;
  readonly placeholderSlides: number;
  readonly exportId: string;
}

function isAcceptPptxCompleted(
  stages: readonly { stage: string; status: string }[],
): boolean {
  return stages.some(
    (state) => state.stage === "accept-pptx" && state.status === "completed",
  );
}

async function buildNativeSlide(
  slideWorkspacePath: string,
  pageLabel: string,
): Promise<DeckSlideInput> {
  const workspace = await loadSlideWorkspace(slideWorkspacePath);
  const source = workspace.manifest.assets.find(
    (asset) => asset.id === workspace.manifest.sourceImageAssetId,
  );
  if (source === undefined || source.image === null) {
    throw new FoundationError("INVALID_WORKSPACE", "源图资产缺少尺寸元数据", {
      pageLabel,
    });
  }
  await assertWorkspaceAssetIntegrity(workspace.path, source);
  const cleanAsset = await assertAcceptedCleanPlate(
    workspace.path,
    workspace.manifest,
  );

  const reviewPath = resolveWorkspacePath(workspace.path, REVIEW_OUTPUT_PATH);
  const document = TextReviewDocumentSchema.parse(
    JSON.parse(await readFile(reviewPath, "utf8")),
  );
  const boxBlocks = selectTextBoxBlocks(document.blocks);

  const sourcePath = resolveWorkspacePath(workspace.path, source.path);
  const sampledColors = await sampleBlockColors({
    sourcePath,
    maskPath: resolveWorkspacePath(workspace.path, MASK_PATH),
    blocks: boxBlocks,
    imageWidth: source.image.width,
    imageHeight: source.image.height,
  });
  const coloredBlocks = boxBlocks.map((block) => {
    const hex = sampledColors.get(block.id);
    if (hex === undefined || block.style.colorHex !== null) return block;
    return { ...block, style: { ...block.style, colorHex: hex } };
  });

  return {
    type: "native",
    cleanPlatePath: resolveWorkspacePath(workspace.path, cleanAsset.path),
    blocks: coloredBlocks,
    imageWidth: source.image.width,
    imageHeight: source.image.height,
    sourcePath,
    pageLabel,
  };
}

async function buildPlaceholderSlide(
  slideWorkspacePath: string,
  pageLabel: string,
): Promise<DeckSlideInput> {
  const workspace = await loadSlideWorkspace(slideWorkspacePath);
  const source = workspace.manifest.assets.find(
    (asset) => asset.id === workspace.manifest.sourceImageAssetId,
  );
  if (source === undefined) {
    throw new FoundationError("INVALID_WORKSPACE", "缺少源图资产", {
      pageLabel,
    });
  }
  const width = source.image?.width ?? 0;
  const height = source.image?.height ?? 0;
  return {
    type: "placeholder",
    imageWidth: width,
    imageHeight: height,
    sourcePath: resolveWorkspacePath(workspace.path, source.path),
    pageLabel,
  };
}

export async function exportDeckPptx(
  options: ExportDeckOptions,
): Promise<ExportDeckResult> {
  const deck = await loadDeckWorkspace(options.deckPath);
  const activeSlides = deck.manifest.slides.filter(
    (slide) => slide.removedAt === null,
  );
  const fontFace = options.fontFace ?? DEFAULT_FONT_FACE;

  const prepared: Array<{
    entry: (typeof activeSlides)[number];
    completed: boolean;
    slideWorkspacePath: string;
    pageLabel: string;
  }> = [];
  for (const entry of activeSlides) {
    const slideWorkspacePath = resolveDeckPath(deck.path, entry.workspacePath);
    const workspace = await loadSlideWorkspace(slideWorkspacePath);
    const completed = isAcceptPptxCompleted(workspace.manifest.stages);
    const pageLabel = entry.workspacePath.split("/").pop() ?? entry.slideId;
    prepared.push({ entry, completed, slideWorkspacePath, pageLabel });
  }

  if (options.strict === true) {
    const incomplete = prepared
      .filter((item) => !item.completed)
      .map((item) => item.pageLabel);
    if (incomplete.length > 0) {
      throw new FoundationError(
        "INVALID_STAGE_STATE",
        "strict 模式要求所有页完成 accept-pptx，仍有未完成页",
        { incomplete },
      );
    }
  }

  const slides: DeckSlideInput[] = [];
  for (const item of prepared) {
    if (item.completed) {
      slides.push(
        await buildNativeSlide(item.slideWorkspacePath, item.pageLabel),
      );
    } else {
      slides.push(
        await buildPlaceholderSlide(item.slideWorkspacePath, item.pageLabel),
      );
    }
  }

  const outputPath = isAbsolute(options.outputPath)
    ? resolve(options.outputPath)
    : resolveDeckPath(deck.path, options.outputPath);

  const synthesis = await synthesizeDeckPptx({
    slides,
    outputPath,
    fontFace,
    deckName: deck.manifest.name,
  });

  const outputSha256 = await sha256File(outputPath);
  const exportedAt = new Date().toISOString();
  const exportId = `deck-export-${String(deck.manifest.exports.length + 1).padStart(3, "0")}`;
  const relativeOutput = relative(deck.path, outputPath).split("\\").join("/");
  const recordOutputPath =
    relativeOutput === "" || relativeOutput.split("/").includes("..")
      ? basename(outputPath)
      : relativeOutput;
  const record: DeckExportRecord = DeckExportRecordSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    id: exportId,
    exportedAt,
    outputPath: recordOutputPath,
    outputSha256,
    totalSlides: synthesis.totalSlides,
    nativeSlides: synthesis.nativeSlides,
    placeholderSlides: synthesis.placeholderSlides,
    strict: options.strict === true,
  });

  const nextManifest: DeckManifest = {
    ...deck.manifest,
    updatedAt: exportedAt,
    exports: [...deck.manifest.exports, record],
  };
  await writeDeckManifest(deck.path, nextManifest);

  return {
    outputPath,
    totalSlides: synthesis.totalSlides,
    nativeSlides: synthesis.nativeSlides,
    placeholderSlides: synthesis.placeholderSlides,
    exportId,
  };
}

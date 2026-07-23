import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  type DeckManifest,
  DeckManifestSchema,
  type DeckSlideEntry,
  FoundationError,
  SCHEMA_VERSION,
} from "@ppt-maker/core";
import { createSlideWorkspace, writeJsonAtomic } from "../slide/workspace.js";

export interface CreateDeckWorkspaceOptions {
  readonly imagesDir: string;
  readonly workspacePath: string;
  readonly name?: string;
}

export interface LoadedDeckWorkspace {
  readonly path: string;
  readonly manifest: DeckManifest;
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg"]);

export function resolveDeckPath(
  deckPath: string,
  relativePath: string,
): string {
  const deck = resolve(deckPath);
  const target = resolve(deck, relativePath);
  const fromDeck = relative(deck, target);
  if (
    fromDeck === "" ||
    fromDeck === ".." ||
    fromDeck.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new FoundationError(
      "PATH_OUTSIDE_WORKSPACE",
      `路径不在 deck 工作区内：${relativePath}`,
      { relativePath },
    );
  }
  return target;
}

function isMissingError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "EEXIST" || error.code === "ENOTEMPTY")
  );
}

async function assertDeckDoesNotExist(path: string): Promise<void> {
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
    { workspacePath: path },
  );
}

async function scanImageFiles(imagesDir: string): Promise<string[]> {
  const entries = await readdir(imagesDir, { withFileTypes: true });
  const images = entries
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => {
      const dot = name.lastIndexOf(".");
      if (dot < 0) {
        return false;
      }
      return IMAGE_EXTENSIONS.has(name.slice(dot).toLowerCase());
    });
  images.sort((a, b) => a.localeCompare(b));
  return images;
}

function formatPageNumber(index: number, total: number): string {
  const width = total > 99 ? 3 : 2;
  return String(index).padStart(width, "0");
}

export async function createDeckWorkspace(
  options: CreateDeckWorkspaceOptions,
): Promise<LoadedDeckWorkspace> {
  const imagesDir = resolve(options.imagesDir);
  const workspacePath = resolve(options.workspacePath);
  const name = options.name ?? basename(workspacePath);

  const imageNames = await scanImageFiles(imagesDir);
  if (imageNames.length === 0) {
    throw new FoundationError(
      "INVALID_INPUT",
      "源图目录中未找到 PNG 或 JPEG 文件",
      { imagesDir },
    );
  }

  const parent = dirname(workspacePath);
  await mkdir(parent, { recursive: true });
  await assertDeckDoesNotExist(workspacePath);
  const temporaryWorkspace = await mkdtemp(
    join(parent, `.${basename(workspacePath)}.tmp-`),
  );

  try {
    await mkdir(resolveDeckPath(temporaryWorkspace, "slides"), {
      recursive: true,
    });

    const createdAt = new Date().toISOString();
    const deckId = randomUUID();
    const slides: DeckSlideEntry[] = [];

    for (const [index, sourceImageName] of imageNames.entries()) {
      const pageNumber = formatPageNumber(index + 1, imageNames.length);
      const slideRelativePath = `slides/page-${pageNumber}`;
      const slideWorkspacePath = resolveDeckPath(
        temporaryWorkspace,
        slideRelativePath,
      );
      const created = await createSlideWorkspace({
        imagePath: join(imagesDir, sourceImageName),
        workspacePath: slideWorkspacePath,
      });
      slides.push({
        slideId: created.manifest.slideId,
        workspacePath: slideRelativePath,
        sourceImageName,
        addedAt: createdAt,
        removedAt: null,
      });
    }

    const manifest: DeckManifest = {
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
      exports: [],
    };

    await writeJsonAtomic(
      resolveDeckPath(temporaryWorkspace, "deck-manifest.json"),
      DeckManifestSchema.parse(manifest),
    );

    try {
      await assertDeckDoesNotExist(workspacePath);
      await rename(temporaryWorkspace, workspacePath);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        throw new FoundationError(
          "WORKSPACE_EXISTS",
          `deck 工作区已存在，拒绝覆盖：${workspacePath}`,
          { workspacePath },
        );
      }
      throw error;
    }

    return { path: workspacePath, manifest };
  } catch (error) {
    await rm(temporaryWorkspace, { recursive: true, force: true }).catch(
      () => undefined,
    );
    throw error;
  }
}

export async function loadDeckWorkspace(
  workspacePath: string,
): Promise<LoadedDeckWorkspace> {
  const path = resolve(workspacePath);
  const manifest = DeckManifestSchema.parse(
    JSON.parse(
      await readFile(resolveDeckPath(path, "deck-manifest.json"), "utf8"),
    ),
  );
  return { path, manifest };
}

export async function writeDeckManifest(
  deckPath: string,
  manifest: DeckManifest,
): Promise<void> {
  await writeJsonAtomic(
    resolveDeckPath(deckPath, "deck-manifest.json"),
    DeckManifestSchema.parse(manifest),
  );
}

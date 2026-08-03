// deck 内容规格的读写、漂移检测与增删对账（M5 子任务③ design §2.4 §5）。
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type ContentSpec,
  type ContentSpecEntry,
  ContentSpecSchema,
  type DeckSlideEntry,
  FoundationError,
  type SlideWorkspaceManifest,
} from "@ppt-maker/core";
import { specViewFingerprint } from "../providers/page-generation.js";
import { loadSlideWorkspace, writeJsonAtomic } from "../slide/workspace.js";
import { type LoadedDeckWorkspace, resolveDeckPath } from "./workspace.js";

/**
 * 规格在 deck 内的约定路径。
 *
 * 规格文件**复制进 deck** 成为权威副本，而不是由 `DeckManifest` 存一个外部指针：
 * deck 是自包含可重放工作区（M1 起的核心设计），指向外部文件会破坏它；且漂移检测
 * 要比较「deck 内规格的当前指纹」与「生成时快照指纹」，规格须在 deck 内才有稳定归属。
 *
 * 不进 `DeckManifest`：那份 manifest 目前只描述页面集合与导出记录，塞进规格指针会让它
 * 同时承担两种职责，且规格文件缺失时会变成悬空引用。约定路径没有这个问题——
 * 文件在不在，`stat` 一次即知。
 */
export const DECK_CONTENT_SPEC_PATH = "content-spec.json";

function parseSpec(value: unknown, sourcePath: string): ContentSpec {
  const parsed = ContentSpecSchema.safeParse(value);
  if (!parsed.success) {
    throw new FoundationError(
      "INVALID_INPUT",
      `内容规格校验失败：${sourcePath}`,
      {
        path: sourcePath,
        issues: parsed.error.issues,
      },
    );
  }
  return parsed.data;
}

/** 读外部规格文件（`deck generate --spec` 的入参） */
export async function readContentSpecFile(path: string): Promise<ContentSpec> {
  const absolute = resolve(path);
  return parseSpec(JSON.parse(await readFile(absolute, "utf8")), absolute);
}

/** deck 内的权威规格；不存在时返回 null（既有 deck 从未跑过 generate） */
export async function loadDeckContentSpec(
  deckPath: string,
): Promise<ContentSpec | null> {
  const path = resolveDeckPath(deckPath, DECK_CONTENT_SPEC_PATH);
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  return parseSpec(JSON.parse(content), path);
}

/**
 * **唯一合法调用方是 `spec-edit.ts` 的 `applySpecChange`**（M6 子任务① design §4）。
 *
 * 变更日志靠写入路径**捎带**落盘。任何新的直接调用都会绕过日志，而漏记的表现是
 * 「历史里没有这次改动」——一种事后无法察觉、也无法补救的静默损坏：规格确实变了，
 * 回看与回滚却都找不到它。要改规格请调 `applySpecChange`，不要在这里开第二条路。
 */
export async function writeDeckContentSpec(
  deckPath: string,
  spec: ContentSpec,
): Promise<void> {
  await writeJsonAtomic(
    resolveDeckPath(deckPath, DECK_CONTENT_SPEC_PATH),
    ContentSpecSchema.parse(spec),
  );
}

/** 一页 generated 的规格锚点；非 generated 页不产生此结构 */
export interface GeneratedPageRef {
  readonly entry: DeckSlideEntry;
  readonly pageLabel: string;
  readonly specEntryId: string;
  readonly specEntrySha256: string;
  readonly manifest: SlideWorkspaceManifest;
}

/**
 * 扫描 deck 里全部 `source.kind === "generated"` 的活跃页。
 *
 * **只认 generated**：同 deck 内的 `imported` / `extracted` 页没有 `specEntryId`，
 * 它们既不算失联也不算新增，完全不参与对账——否则往混合 deck 跑一次
 * `deck generate`，所有导入页与抽取页都会被报成「失联」（父任务 A2 的直接前提）。
 */
export async function collectGeneratedPages(
  deck: LoadedDeckWorkspace,
): Promise<GeneratedPageRef[]> {
  const pages: GeneratedPageRef[] = [];
  for (const entry of deck.manifest.slides) {
    if (entry.removedAt !== null) {
      continue;
    }
    const workspace = await loadSlideWorkspace(
      resolveDeckPath(deck.path, entry.workspacePath),
    );
    const source = workspace.manifest.source;
    if (source.kind !== "generated") {
      continue;
    }
    pages.push({
      entry,
      pageLabel: entry.workspacePath.replace(/^slides\//u, ""),
      specEntryId: source.specEntryId,
      specEntrySha256: source.specEntrySha256,
      manifest: workspace.manifest,
    });
  }
  return pages;
}

export interface SpecDriftItem {
  readonly pageLabel: string;
  readonly specEntryId: string;
  readonly recordedSha256: string;
  readonly currentSha256: string;
}

export interface SpecReconciliation {
  /** 规格里有、deck 里还没建页的条目——`deck generate` 只自动补这些（E3） */
  readonly newEntries: ContentSpecEntry[];
  /** deck 里有页、规格里已无对应条目：**只报告不动手**，删页须显式 `deck remove-slide` */
  readonly missingPages: GeneratedPageRef[];
  /** 规格视图指纹与生成时快照不一致：只读派生，不改变任何阶段状态（父任务 A13） */
  readonly drifted: SpecDriftItem[];
}

/**
 * 按 `specEntryId` 对账，报告【新增 / 失联 / 漂移】三类差异。
 *
 * 只补生成缺失页、不做双向同步（E3）：双向同步会让「删错一行规格」静默销毁一页的
 * 完整工作量（含已验收产物），且页序插入会动到已有页目录名。
 */
export function reconcileDeckSpec(
  spec: ContentSpec,
  pages: readonly GeneratedPageRef[],
): SpecReconciliation {
  const byEntryId = new Map(pages.map((page) => [page.specEntryId, page]));
  const entryIds = new Set(spec.entries.map((entry) => entry.specEntryId));

  const newEntries = spec.entries.filter(
    (entry) => !byEntryId.has(entry.specEntryId),
  );
  const missingPages = pages.filter((page) => !entryIds.has(page.specEntryId));

  const drifted: SpecDriftItem[] = [];
  for (const entry of spec.entries) {
    const page = byEntryId.get(entry.specEntryId);
    if (page === undefined) {
      continue;
    }
    const currentSha256 = specViewFingerprint(spec.style, entry);
    if (currentSha256 !== page.specEntrySha256) {
      drifted.push({
        pageLabel: page.pageLabel,
        specEntryId: page.specEntryId,
        recordedSha256: page.specEntrySha256,
        currentSha256,
      });
    }
  }

  return { newEntries, missingPages, drifted };
}

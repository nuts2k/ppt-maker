import { constants, type Dirent, type Stats } from "node:fs";
import {
  appendFile,
  copyFile,
  mkdir,
  readdir,
  readFile,
  stat,
  unlink,
} from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import {
  FoundationError,
  type PlanningMaterialEntry,
  PlanningMaterialEntrySchema,
  type PlanningSessionRecord,
  PlanningSessionRecordSchema,
  type SpecChangeRecord,
  SpecChangeRecordSchema,
} from "@ppt-maker/core";
import { resolveDeckPath } from "./workspace.js";

/**
 * 策划旁路存储：`<deck>/planning/` 下的追加式 jsonl。
 *
 * 三条纪律照搬 `apps/desktop/src/main/activity-log.ts`——串行尾巴队列、写失败只记
 * stderr、读取时坏行跳过。理由相同：日志是**旁路数据**，整个 `planning/` 目录可删，
 * 删后只失去回看与回滚能力，不允许它反过来阻断规格保存。
 *
 * **只有追加 / 导入等写路径才建目录，读路径绝不创建任何文件或目录**。这是父任务硬验收 A6
 * （旧格式 deck 被只读命令打开后目录内容零变化）的直接依赖点。
 */

export const DECK_PLANNING_DIR = "planning";
export const DECK_SPEC_HISTORY_PATH = "planning/spec-history.jsonl";
export const DECK_PLANNING_SESSION_PATH = "planning/session.jsonl";
export const DECK_PLANNING_MATERIALS_DIR = "planning/materials";

/**
 * 串行化追加写，**按 deck 分键**：同一 deck 严格串行，避免同进程内并发 appendFile
 * 交错写出坏行；不同 deck 互不阻塞。
 */
const tails = new Map<string, Promise<unknown>>();

function enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = tails.get(key) ?? Promise.resolve();
  // 会话是必要证据，写失败会 reject；失败不能毒死同一 deck 后续的队列。
  const next = previous.then(task, task);
  tails.set(key, next);
  const cleanup = () => {
    // 队尾跑完且没有后来者时清理，避免 Map 随 deck 数无限增长
    if (tails.get(key) === next) {
      tails.delete(key);
    }
  };
  void next.then(cleanup, cleanup);
  return next;
}

/**
 * 追加一条规格变更记录。
 *
 * 写盘失败只记录到 stderr，**绝不 reject、绝不上抛**——统一写入入口的第 5 步失败
 * 不得回滚已经落盘的规格。但「写没写成」要如实告诉调用方：`applySpecChange` 要据此
 * 给出 `historyWritten`，全吞异常只返回 `Promise<void>` 会让调用方永远拿不到信号，
 * 变成一个恒真的假信号（见 silent-failure-thinking-guide）。
 */
export function appendSpecChangeRecord(
  deckPath: string,
  record: SpecChangeRecord,
): Promise<boolean> {
  return enqueue(resolve(deckPath), async () => {
    try {
      await mkdir(resolveDeckPath(deckPath, DECK_PLANNING_DIR), {
        recursive: true,
      });
      await appendFile(
        resolveDeckPath(deckPath, DECK_SPEC_HISTORY_PATH),
        `${JSON.stringify(record)}\n`,
        "utf8",
      );
      return true;
    } catch (error) {
      console.error("[spec-history] 写入失败", error);
      return false;
    }
  });
}

export interface ListSpecChangeRecordsOptions {
  readonly limit?: number;
}

/**
 * 倒序返回最近 limit 条变更记录；文件不存在返回空数组。
 *
 * 坏行跳过：`JSON.parse` 与 `SpecChangeRecordSchema.safeParse` 双层保护，任一失败
 * 即静默丢弃该行，不因单行损坏丢掉整个文件。
 *
 * **只吞「这条路径上没有文件」，其余读取错误照抛**（与 `loadDeckContentSpec` 同源）。
 * 裸 `catch { return [] }` 会把「没有历史」和「历史读不出来」变成同一个结果：
 * 权限不对（`EACCES`）或路径被占成目录（`EISDIR`）时，界面照样说
 * 「无记录（文件不存在或为空）」，而磁盘上那些记录一直都在——查不出来的静默损坏。
 *
 * `ENOTDIR`（`planning` 被占成同名普通文件）与 `ENOENT` 归为一类：两者都意味着
 * 这条路径上不存在也不可能存在历史文件，「还没有历史」是对它们的如实描述。
 */
const ABSENT_CODES = new Set(["ENOENT", "ENOTDIR"]);

function hasErrorCode(error: unknown, codes: ReadonlySet<string>): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    codes.has(error.code)
  );
}

export async function listSpecChangeRecords(
  deckPath: string,
  options: ListSpecChangeRecordsOptions = {},
): Promise<SpecChangeRecord[]> {
  let raw: string;
  try {
    raw = await readFile(
      resolveDeckPath(deckPath, DECK_SPEC_HISTORY_PATH),
      "utf8",
    );
  } catch (error) {
    if (hasErrorCode(error, ABSENT_CODES)) {
      return [];
    }
    throw error;
  }

  const records: SpecChangeRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue; // 损坏行
    }
    const result = SpecChangeRecordSchema.safeParse(parsed);
    if (!result.success) {
      continue; // 结构不符的行
    }
    records.push(result.data);
  }

  records.reverse();
  return options.limit === undefined
    ? records
    : records.slice(0, options.limit);
}

/**
 * 一次追加一轮会话记录。
 *
 * 与规格历史不同，会话是提案交给界面前必须存在的过程证据，因此写失败必须上抛。
 * 同一轮的多行先完整校验，再由一次 appendFile 写入，不能逐行追加出半轮状态。
 */
export async function appendPlanningSessionRecords(
  deckPath: string,
  records: readonly PlanningSessionRecord[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  const validated = records.map((record) =>
    PlanningSessionRecordSchema.parse(record),
  );
  const payload = `${validated.map((record) => JSON.stringify(record)).join("\n")}\n`;

  await enqueue(resolve(deckPath), async () => {
    await mkdir(resolveDeckPath(deckPath, DECK_PLANNING_DIR), {
      recursive: true,
    });
    await appendFile(
      resolveDeckPath(deckPath, DECK_PLANNING_SESSION_PATH),
      payload,
      "utf8",
    );
  });
}

/** 按写入顺序读取会话；缺文件为空，坏 JSON 与不合契约的单行均跳过。 */
export async function listPlanningSessionRecords(
  deckPath: string,
): Promise<PlanningSessionRecord[]> {
  let raw: string;
  try {
    raw = await readFile(
      resolveDeckPath(deckPath, DECK_PLANNING_SESSION_PATH),
      "utf8",
    );
  } catch (error) {
    if (hasErrorCode(error, ABSENT_CODES)) {
      return [];
    }
    throw error;
  }

  const records: PlanningSessionRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const result = PlanningSessionRecordSchema.safeParse(parsed);
    if (result.success) {
      records.push(result.data);
    }
  }
  return records;
}

const MATERIAL_EXTENSIONS = new Set([".md", ".txt"]);
const MATERIALS_ABSENT_CODES = new Set(["ENOENT"]);
const ALREADY_EXISTS_CODES = new Set(["EEXIST"]);

function compareNames(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

function resolveMaterialPath(deckPath: string, name: string): string {
  const materialsDir = resolveDeckPath(deckPath, DECK_PLANNING_MATERIALS_DIR);
  const target = resolve(materialsDir, name);
  const fromMaterials = relative(materialsDir, target);
  if (
    name !== basename(name) ||
    fromMaterials === "" ||
    fromMaterials === ".." ||
    fromMaterials.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`)
  ) {
    throw new FoundationError(
      "PATH_OUTSIDE_WORKSPACE",
      `材料路径不在 deck 的 materials 目录内：${name}`,
      { name },
    );
  }
  return target;
}

/** 只列出 materials/ 直属的 Markdown / 纯文本文件，按文件名确定排序。 */
export async function listPlanningMaterials(
  deckPath: string,
): Promise<PlanningMaterialEntry[]> {
  const materialsDir = resolveDeckPath(deckPath, DECK_PLANNING_MATERIALS_DIR);
  let entries: Dirent[];
  try {
    entries = await readdir(materialsDir, { withFileTypes: true });
  } catch (error) {
    if (hasErrorCode(error, MATERIALS_ABSENT_CODES)) {
      return [];
    }
    throw error;
  }

  const names = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        MATERIAL_EXTENSIONS.has(extname(entry.name).toLowerCase()),
    )
    .map((entry) => entry.name)
    .sort(compareNames);

  const materials: PlanningMaterialEntry[] = [];
  for (const name of names) {
    let metadata: Stats;
    try {
      metadata = await stat(resolveMaterialPath(deckPath, name));
    } catch (error) {
      throw planningMaterialReadError(name, error);
    }
    materials.push(
      PlanningMaterialEntrySchema.parse({ name, sizeBytes: metadata.size }),
    );
  }
  return materials;
}

function materialCandidateName(sourceName: string, attempt: number): string {
  if (attempt === 1) {
    return sourceName;
  }
  const extension = extname(sourceName);
  return `${sourceName.slice(0, -extension.length)}-${String(attempt)}${extension}`;
}

/** 复制一份材料到 deck；同名时追加稳定数字后缀，绝不覆盖现有副本。 */
export async function importPlanningMaterial(
  deckPath: string,
  sourcePath: string,
): Promise<PlanningMaterialEntry> {
  const source = resolve(sourcePath);
  const sourceName = basename(source);
  if (!MATERIAL_EXTENSIONS.has(extname(sourceName).toLowerCase())) {
    throw new FoundationError(
      "INVALID_INPUT",
      "策划材料只支持 .md 或 .txt 文件",
      { sourcePath },
    );
  }

  return enqueue(resolve(deckPath), async () => {
    await mkdir(resolveDeckPath(deckPath, DECK_PLANNING_MATERIALS_DIR), {
      recursive: true,
    });

    let attempt = 1;
    while (true) {
      const name = materialCandidateName(sourceName, attempt);
      const target = resolveMaterialPath(deckPath, name);
      try {
        await copyFile(source, target, constants.COPYFILE_EXCL);
        const metadata = await stat(target);
        return PlanningMaterialEntrySchema.parse({
          name,
          sizeBytes: metadata.size,
        });
      } catch (error) {
        if (hasErrorCode(error, ALREADY_EXISTS_CODES)) {
          attempt += 1;
          continue;
        }
        throw error;
      }
    }
  });
}

/** 只移除当前材料清单中的 deck 副本；用户选择的原始文件从不触碰。 */
export async function removePlanningMaterial(
  deckPath: string,
  name: string,
): Promise<void> {
  // 先做路径校验，不能让 `../session.jsonl` 借清单查询前的路径解析越界。
  const target = resolveMaterialPath(deckPath, name);
  await enqueue(resolve(deckPath), async () => {
    const materials = await listPlanningMaterials(deckPath);
    if (!materials.some((material) => material.name === name)) {
      throw new FoundationError("INVALID_INPUT", `策划材料不存在：${name}`, {
        name,
      });
    }
    await unlink(target);
  });
}

function errorCode(error: unknown): string | null {
  return error instanceof Error &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

function planningMaterialReadError(
  materialName: string,
  error: unknown,
): FoundationError {
  return new FoundationError(
    "INVALID_WORKSPACE",
    `读取策划材料失败：${materialName}`,
    { materialName, code: errorCode(error) },
  );
}

/**
 * 每次调用都重新读取当前材料，按稳定清单拼成「文件名 + 正文」上下文。
 * 任一材料读取失败即阻止本轮调用，并在稳定错误中指名材料，绝不静默少喂一份。
 */
export async function buildPlanningMaterialsContext(
  deckPath: string,
): Promise<string> {
  const materials = await listPlanningMaterials(deckPath);
  const sections: string[] = [];
  for (const material of materials) {
    let content: string;
    try {
      content = await readFile(
        resolveMaterialPath(deckPath, material.name),
        "utf8",
      );
    } catch (error) {
      throw planningMaterialReadError(material.name, error);
    }
    sections.push(`## 材料：${material.name}\n\n${content}`);
  }
  return sections.join("\n\n");
}

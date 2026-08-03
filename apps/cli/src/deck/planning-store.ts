import { appendFile, mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { type SpecChangeRecord, SpecChangeRecordSchema } from "@ppt-maker/core";
import { resolveDeckPath } from "./workspace.js";

/**
 * 策划旁路存储：`<deck>/planning/` 下的追加式 jsonl。
 *
 * 三条纪律照搬 `apps/desktop/src/main/activity-log.ts`——串行尾巴队列、写失败只记
 * stderr、读取时坏行跳过。理由相同：日志是**旁路数据**，整个 `planning/` 目录可删，
 * 删后只失去回看与回滚能力，不允许它反过来阻断规格保存。
 *
 * **只有 append 才建目录，读路径绝不创建任何文件或目录**。这是父任务硬验收 A6
 * （旧格式 deck 被只读命令打开后目录内容零变化）的直接依赖点。
 */

export const DECK_PLANNING_DIR = "planning";
export const DECK_SPEC_HISTORY_PATH = "planning/spec-history.jsonl";

/**
 * 串行化追加写，**按 deck 分键**：同一 deck 严格串行，避免同进程内并发 appendFile
 * 交错写出坏行；不同 deck 互不阻塞。
 */
const tails = new Map<string, Promise<boolean>>();

function enqueue(key: string, task: () => Promise<boolean>): Promise<boolean> {
  const previous = tails.get(key) ?? Promise.resolve(true);
  const next = previous.then(task);
  tails.set(key, next);
  void next.then(() => {
    // 队尾跑完且没有后来者时清理，避免 Map 随 deck 数无限增长
    if (tails.get(key) === next) {
      tails.delete(key);
    }
  });
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
    if (
      error instanceof Error &&
      "code" in error &&
      typeof error.code === "string" &&
      ABSENT_CODES.has(error.code)
    ) {
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

import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ActivityRecord } from "./ipc/channels.js";

/**
 * 活动日志：按 deckId 追加写 jsonl。
 *
 * 落盘位置在 Electron userData 下，**不写 deck 工作区**（PRD D4）——
 * 该文件为纯附加日志，删除不影响任何功能，也不参与 CLI 双向兼容契约。
 */
export class ActivityLog {
  private readonly baseDir: string;
  /** 串行化追加写，避免同一进程内并发 appendFile 交错 */
  private tail: Promise<void> = Promise.resolve();

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  private filePath(deckId: string): string {
    return join(this.baseDir, `${sanitizeDeckId(deckId)}.jsonl`);
  }

  /**
   * 追加一条记录。写盘失败只记录到 stderr，绝不向上抛——
   * 日志是旁路能力，不允许影响流水线执行。
   */
  append(deckId: string, record: ActivityRecord): Promise<void> {
    this.tail = this.tail.then(async () => {
      try {
        await mkdir(this.baseDir, { recursive: true });
        await appendFile(
          this.filePath(deckId),
          `${JSON.stringify(record)}\n`,
          "utf-8",
        );
      } catch (error) {
        console.error("[activity-log] 写入失败", error);
      }
    });
    return this.tail;
  }

  /** 倒序返回最近 limit 条；坏行跳过，不因单行损坏丢掉整个文件 */
  async list(deckId: string, limit = 200): Promise<ActivityRecord[]> {
    let raw: string;
    try {
      raw = await readFile(this.filePath(deckId), "utf-8");
    } catch {
      return [];
    }

    const records: ActivityRecord[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        records.push(JSON.parse(trimmed) as ActivityRecord);
      } catch {
        // 忽略损坏行
      }
    }

    records.reverse();
    return records.slice(0, limit);
  }
}

/** deckId 直接作为文件名，防御性去掉路径分隔符 */
function sanitizeDeckId(deckId: string): string {
  return deckId.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export function buildActivityRecord(
  input: Omit<ActivityRecord, "at"> & { at?: string },
): ActivityRecord {
  return {
    at: input.at ?? new Date().toISOString(),
    kind: input.kind,
    slideId: input.slideId,
    pageLabel: input.pageLabel,
    stage: input.stage,
    result: input.result,
    durationMs: input.durationMs,
    detail: input.detail,
  };
}

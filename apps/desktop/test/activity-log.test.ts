import { appendFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ActivityLog, buildActivityRecord } from "../src/main/activity-log.js";
import type { ActivityRecord } from "../src/main/ipc/channels.js";

async function makeLog(): Promise<{ log: ActivityLog; dir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "activity-log-"));
  return { log: new ActivityLog(dir), dir };
}

function record(detail: string): ActivityRecord {
  return buildActivityRecord({
    kind: "stage-complete",
    slideId: "slide-1",
    pageLabel: "page-01",
    stage: "ocr",
    result: "success",
    durationMs: 1200,
    detail,
  });
}

describe("ActivityLog", () => {
  it("目录不存在时自动创建并写入", async () => {
    const { log, dir } = await makeLog();
    const nested = new ActivityLog(join(dir, "a", "b"));
    await nested.append("deck-1", record("首条"));
    expect(await nested.list("deck-1")).toHaveLength(1);
    expect(log).toBeDefined();
  });

  it("倒序返回记录", async () => {
    const { log } = await makeLog();
    await log.append("deck-1", record("第一条"));
    await log.append("deck-1", record("第二条"));
    await log.append("deck-1", record("第三条"));

    const listed = await log.list("deck-1");
    expect(listed.map((r) => r.detail)).toEqual(["第三条", "第二条", "第一条"]);
  });

  it("按 limit 截断", async () => {
    const { log } = await makeLog();
    for (let i = 0; i < 5; i += 1) {
      await log.append("deck-1", record(`第 ${i} 条`));
    }
    expect(await log.list("deck-1", 2)).toHaveLength(2);
  });

  it("按 deckId 分文件，互不串扰", async () => {
    const { log } = await makeLog();
    await log.append("deck-1", record("属于 deck-1"));
    await log.append("deck-2", record("属于 deck-2"));

    expect((await log.list("deck-1")).map((r) => r.detail)).toEqual([
      "属于 deck-1",
    ]);
    expect((await log.list("deck-2")).map((r) => r.detail)).toEqual([
      "属于 deck-2",
    ]);
  });

  it("文件不存在时返回空数组而非抛错", async () => {
    const { log } = await makeLog();
    expect(await log.list("never-written")).toEqual([]);
  });

  it("跳过损坏行，不丢弃整个文件", async () => {
    const { log, dir } = await makeLog();
    await log.append("deck-1", record("完好记录"));
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "deck-1.jsonl"), "{ 这不是 JSON\n", "utf-8");
    await log.append("deck-1", record("损坏行之后的记录"));

    const listed = await log.list("deck-1");
    expect(listed.map((r) => r.detail)).toEqual([
      "损坏行之后的记录",
      "完好记录",
    ]);
  });

  it("并发追加串行化，不交错也不丢条目", async () => {
    const { log } = await makeLog();
    await Promise.all(
      Array.from({ length: 20 }, (_unused, i) =>
        log.append("deck-1", record(`并发 ${i}`)),
      ),
    );

    const listed = await log.list("deck-1", 100);
    expect(listed).toHaveLength(20);
    expect(new Set(listed.map((r) => r.detail)).size).toBe(20);
  });

  it("deckId 中的路径分隔符被消解，不写出工作目录", async () => {
    const { log } = await makeLog();
    await log.append("../../escape", record("越界尝试"));
    expect(await log.list("../../escape")).toHaveLength(1);
  });

  it("buildActivityRecord 自动补时间戳", () => {
    const built = buildActivityRecord({
      kind: "run-start",
      slideId: null,
      pageLabel: null,
      stage: null,
      result: "info",
      durationMs: null,
      detail: "开始",
    });
    expect(Number.isNaN(Date.parse(built.at))).toBe(false);
  });
});

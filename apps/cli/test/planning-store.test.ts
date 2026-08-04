import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlanningSessionRecord, SpecChangeRecord } from "@ppt-maker/core";
import { describe, expect, it, vi } from "vitest";
import {
  appendPlanningSessionRecords,
  appendSpecChangeRecord,
  buildPlanningMaterialsContext,
  DECK_PLANNING_DIR,
  DECK_PLANNING_MATERIALS_DIR,
  DECK_PLANNING_SESSION_PATH,
  DECK_SPEC_HISTORY_PATH,
  importPlanningMaterial,
  listPlanningMaterials,
  listPlanningSessionRecords,
  listSpecChangeRecords,
  removePlanningMaterial,
} from "../src/deck/planning-store.js";

async function createDeckDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ppt-maker-planning-store-"));
}

function makeRecord(
  recordId: string,
  overrides: Partial<SpecChangeRecord> = {},
): SpecChangeRecord {
  return {
    v: 1,
    recordId,
    at: "2026-08-02T10:00:00.000Z",
    origin: "manual",
    summary: `变更 ${recordId}`,
    styleBefore: { description: "旧风格" },
    styleAfter: { description: "新风格" },
    entriesBefore: [],
    entriesAfter: [
      {
        specEntryId: "entry-001",
        index: 0,
        value: {
          specEntryId: "entry-001",
          pageType: "cover",
          textGroups: [{ label: "标题", items: ["第一页"] }],
          visualIntent: "居中大标题",
          revisionNotes: [],
        },
      },
    ],
    fingerprints: [
      { specEntryId: "entry-001", before: null, after: "sha-after" },
    ],
    conversationRef: null,
    rollbackOf: null,
    ...overrides,
  };
}

function makeMessage(
  messageId: string,
  text = `消息 ${messageId}`,
): PlanningSessionRecord {
  return {
    v: 1,
    kind: "message",
    messageId,
    at: "2026-08-04T10:00:00.000Z",
    role: messageId.startsWith("user") ? "user" : "assistant",
    text,
    proposal: null,
    dimensions: null,
    requestId: null,
    model: null,
  };
}

describe("planning-store", () => {
  it("成功写入返回 true", async () => {
    const deckPath = await createDeckDir();
    await expect(
      appendSpecChangeRecord(deckPath, makeRecord("r-1")),
    ).resolves.toBe(true);
  });

  it("追加多条后按倒序读回，limit 生效", async () => {
    const deckPath = await createDeckDir();
    for (const id of ["r-1", "r-2", "r-3"]) {
      await appendSpecChangeRecord(deckPath, makeRecord(id));
    }

    const all = await listSpecChangeRecords(deckPath);
    expect(all.map((record) => record.recordId)).toEqual(["r-3", "r-2", "r-1"]);

    const limited = await listSpecChangeRecords(deckPath, { limit: 2 });
    expect(limited.map((record) => record.recordId)).toEqual(["r-3", "r-2"]);
  });

  it("坏 JSON 行与结构不符的行都被跳过，其余记录照常读出", async () => {
    const deckPath = await createDeckDir();
    await appendSpecChangeRecord(deckPath, makeRecord("good-1"));

    const historyPath = join(deckPath, DECK_SPEC_HISTORY_PATH);
    // 一行无法 JSON.parse，一行是合法 JSON 但结构不符 schema
    await appendFile(historyPath, "{ 这不是 JSON\n", "utf8");
    await appendFile(
      historyPath,
      `${JSON.stringify({ v: 1, recordId: "bad-shape" })}\n`,
      "utf8",
    );
    // 空行也不该干扰
    await appendFile(historyPath, "\n", "utf8");

    await appendSpecChangeRecord(deckPath, makeRecord("good-2"));

    const records = await listSpecChangeRecords(deckPath);
    expect(records.map((record) => record.recordId)).toEqual([
      "good-2",
      "good-1",
    ]);
  });

  it("文件不存在返回空数组，且读路径不创建 planning/ 目录", async () => {
    const deckPath = await createDeckDir();
    const before = await readdir(deckPath);

    expect(await listSpecChangeRecords(deckPath)).toEqual([]);
    expect(await listSpecChangeRecords(deckPath, { limit: 5 })).toEqual([]);

    const after = await readdir(deckPath);
    expect(after).toEqual(before);
    expect(after).not.toContain(DECK_PLANNING_DIR);
  });

  it("已有 planning/ 但历史文件缺失时，读路径同样不创建文件", async () => {
    const deckPath = await createDeckDir();
    await appendSpecChangeRecord(deckPath, makeRecord("r-1"));
    await rm(join(deckPath, DECK_SPEC_HISTORY_PATH));

    expect(await listSpecChangeRecords(deckPath)).toEqual([]);
    expect(await readdir(join(deckPath, DECK_PLANNING_DIR))).toEqual([]);
  });

  it("读不出来 ≠ 没有历史：非 ENOENT 的读取错误照抛，不伪装成空清单", async () => {
    // 裸 `catch { return [] }` 会让「权限不对 / 路径被占成目录」与「压根没有历史」
    // 长得一模一样，界面照样说「无记录（文件不存在或为空）」——查不出来的静默损坏。
    const deckPath = await createDeckDir();
    await mkdir(join(deckPath, DECK_SPEC_HISTORY_PATH), { recursive: true });

    await expect(listSpecChangeRecords(deckPath)).rejects.toMatchObject({
      code: "EISDIR",
    });
  });

  it("写入失败不抛：planning 被占成同名普通文件时如实返回 false", async () => {
    const deckPath = await createDeckDir();
    await writeFile(join(deckPath, DECK_PLANNING_DIR), "占位", "utf8");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      appendSpecChangeRecord(deckPath, makeRecord("r-1")),
    ).resolves.toBe(false);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
    // 失败后后续写入仍可继续排队，不会因为一次失败卡死队列
    await expect(listSpecChangeRecords(deckPath)).resolves.toEqual([]);
  });

  it("同一 deck 并发追加 20 条，行数正好 20 且每行可解析", async () => {
    const deckPath = await createDeckDir();
    await Promise.all(
      Array.from({ length: 20 }, (_unused, index) =>
        appendSpecChangeRecord(deckPath, makeRecord(`r-${String(index)}`)),
      ),
    );

    const raw = await readFile(join(deckPath, DECK_SPEC_HISTORY_PATH), "utf8");
    const lines = raw.split("\n").filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(20);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }

    const records = await listSpecChangeRecords(deckPath);
    expect(records).toHaveLength(20);
    // 顺序断言是「队列真的生效」的判据：行数在没有队列时也可能碰巧对
    // （小于 PIPE_BUF 的 O_APPEND 写不易交错），但调用顺序会乱
    expect(records.map((record) => record.recordId)).toEqual(
      Array.from({ length: 20 }, (_unused, index) => `r-${String(19 - index)}`),
    );
  });

  it("不同 deck 的追加互不干扰", async () => {
    const deckA = await createDeckDir();
    const deckB = await createDeckDir();

    await Promise.all([
      appendSpecChangeRecord(deckA, makeRecord("a-1")),
      appendSpecChangeRecord(deckB, makeRecord("b-1")),
      appendSpecChangeRecord(deckA, makeRecord("a-2")),
    ]);

    expect(
      (await listSpecChangeRecords(deckA)).map((record) => record.recordId),
    ).toEqual(["a-2", "a-1"]);
    expect(
      (await listSpecChangeRecords(deckB)).map((record) => record.recordId),
    ).toEqual(["b-1"]);
  });

  it("一轮会话以多行按原顺序追加，坏行跳过", async () => {
    const deckPath = await createDeckDir();
    await appendPlanningSessionRecords(deckPath, [
      makeMessage("user-1"),
      makeMessage("assistant-1"),
    ]);
    const sessionPath = join(deckPath, DECK_PLANNING_SESSION_PATH);
    await appendFile(sessionPath, "{坏 JSON\n", "utf8");
    await appendFile(sessionPath, `${JSON.stringify({ v: 1 })}\n`, "utf8");
    await appendPlanningSessionRecords(deckPath, [makeMessage("user-2")]);

    expect(
      (await listPlanningSessionRecords(deckPath)).map(
        (record) => record.kind === "message" && record.messageId,
      ),
    ).toEqual(["user-1", "assistant-1", "user-2"]);

    const lines = (await readFile(sessionPath, "utf8"))
      .split("\n")
      .filter((line) => line.trim() !== "");
    expect(lines.slice(0, 2).map((line) => JSON.parse(line))).toEqual([
      makeMessage("user-1"),
      makeMessage("assistant-1"),
    ]);
  });

  it("会话缺失和空批次都返回空，读与空写均不创建 planning/", async () => {
    const deckPath = await createDeckDir();
    const before = await readdir(deckPath);

    expect(await listPlanningSessionRecords(deckPath)).toEqual([]);
    await appendPlanningSessionRecords(deckPath, []);

    expect(await readdir(deckPath)).toEqual(before);
    expect(before).not.toContain(DECK_PLANNING_DIR);
  });

  it("同 deck 的并发会话轮次不交错，失败后队列仍可继续", async () => {
    const deckPath = await createDeckDir();
    await Promise.all(
      Array.from({ length: 10 }, (_unused, index) =>
        appendPlanningSessionRecords(deckPath, [
          makeMessage(`user-${String(index)}`),
          makeMessage(`assistant-${String(index)}`),
        ]),
      ),
    );
    const records = await listPlanningSessionRecords(deckPath);
    expect(
      records.map((record) => record.kind === "message" && record.messageId),
    ).toEqual(
      Array.from({ length: 10 }, (_unused, index) => [
        `user-${String(index)}`,
        `assistant-${String(index)}`,
      ]).flat(),
    );

    const blockedDeck = await createDeckDir();
    await mkdir(join(blockedDeck, DECK_PLANNING_SESSION_PATH), {
      recursive: true,
    });
    const failed = appendPlanningSessionRecords(blockedDeck, [
      makeMessage("user-fail"),
    ]);
    const continued = appendSpecChangeRecord(
      blockedDeck,
      makeRecord("after-failure"),
    );
    await expect(failed).rejects.toMatchObject({ code: "EISDIR" });
    await expect(continued).resolves.toBe(true);
  });

  it("会话文件读不出来时明确抛错，不伪装为空会话", async () => {
    const deckPath = await createDeckDir();
    await mkdir(join(deckPath, DECK_PLANNING_SESSION_PATH), {
      recursive: true,
    });

    await expect(listPlanningSessionRecords(deckPath)).rejects.toMatchObject({
      code: "EISDIR",
    });
  });

  it("材料缺失为空且不创建目录，不支持的扩展名在写盘前拒绝", async () => {
    const deckPath = await createDeckDir();
    const source = join(await createDeckDir(), "notes.json");
    await writeFile(source, "{}", "utf8");

    expect(await listPlanningMaterials(deckPath)).toEqual([]);
    expect(await buildPlanningMaterialsContext(deckPath)).toBe("");
    await expect(
      importPlanningMaterial(deckPath, source),
    ).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(await readdir(deckPath)).not.toContain(DECK_PLANNING_DIR);
  });

  it("导入只复制 md/txt，重名使用后缀且清单稳定排序，不改原文件", async () => {
    const deckPath = await createDeckDir();
    const sourceA = await createDeckDir();
    const sourceB = await createDeckDir();
    const briefA = join(sourceA, "brief.md");
    const briefB = join(sourceB, "brief.md");
    const notes = join(sourceA, "Notes.TXT");
    await writeFile(briefA, "第一份", "utf8");
    await writeFile(briefB, "第二份更长", "utf8");
    await writeFile(notes, "备注", "utf8");

    expect(await importPlanningMaterial(deckPath, briefA)).toEqual({
      name: "brief.md",
      sizeBytes: Buffer.byteLength("第一份"),
    });
    expect(await importPlanningMaterial(deckPath, briefB)).toEqual({
      name: "brief-2.md",
      sizeBytes: Buffer.byteLength("第二份更长"),
    });
    await importPlanningMaterial(deckPath, notes);

    expect(
      (await listPlanningMaterials(deckPath)).map((item) => item.name),
    ).toEqual(["Notes.TXT", "brief-2.md", "brief.md"]);
    expect(await readFile(briefA, "utf8")).toBe("第一份");
    expect(await readFile(briefB, "utf8")).toBe("第二份更长");
  });

  it("并发导入同名材料也不覆盖，移除只删 deck 副本且拒绝越界", async () => {
    const deckPath = await createDeckDir();
    const sourceDir = await createDeckDir();
    const source = join(sourceDir, "shared.txt");
    await writeFile(source, "长期背景", "utf8");

    const imported = await Promise.all(
      Array.from({ length: 4 }, () => importPlanningMaterial(deckPath, source)),
    );
    expect(imported.map((item) => item.name)).toEqual([
      "shared.txt",
      "shared-2.txt",
      "shared-3.txt",
      "shared-4.txt",
    ]);

    const outside = join(deckPath, "outside.txt");
    await writeFile(outside, "不可删除", "utf8");
    await expect(
      removePlanningMaterial(deckPath, "../outside.txt"),
    ).rejects.toMatchObject({ code: "PATH_OUTSIDE_WORKSPACE" });
    expect(await readFile(outside, "utf8")).toBe("不可删除");
    await expect(
      removePlanningMaterial(deckPath, "missing.txt"),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });

    await removePlanningMaterial(deckPath, "shared.txt");
    expect(await readFile(source, "utf8")).toBe("长期背景");
    expect(
      (await listPlanningMaterials(deckPath)).map((item) => item.name),
    ).not.toContain("shared.txt");
  });

  it("材料上下文按文件名稳定拼接，每次重读且读取失败指名文件", async () => {
    const deckPath = await createDeckDir();
    const sourceDir = await createDeckDir();
    const sourceB = join(sourceDir, "b.md");
    const sourceA = join(sourceDir, "a.txt");
    await writeFile(sourceB, "B 初版", "utf8");
    await writeFile(sourceA, "A 正文", "utf8");
    await importPlanningMaterial(deckPath, sourceB);
    await importPlanningMaterial(deckPath, sourceA);

    expect(await buildPlanningMaterialsContext(deckPath)).toBe(
      "## 材料：a.txt\n\nA 正文\n\n## 材料：b.md\n\nB 初版",
    );
    const copiedB = join(deckPath, DECK_PLANNING_MATERIALS_DIR, "b.md");
    await writeFile(copiedB, "B 新版", "utf8");
    expect(await buildPlanningMaterialsContext(deckPath)).toContain("B 新版");

    await chmod(copiedB, 0);
    await expect(buildPlanningMaterialsContext(deckPath)).rejects.toMatchObject(
      {
        code: "INVALID_WORKSPACE",
        message: "读取策划材料失败：b.md",
        details: { materialName: "b.md" },
      },
    );
  });
});

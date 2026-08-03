import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ContentSpec } from "@ppt-maker/core";
import { describe, expect, it, vi } from "vitest";
import { loadDeckContentSpec } from "../src/deck/content-spec.js";
import { runDeckGenerate } from "../src/deck/generate.js";
import {
  DECK_PLANNING_DIR,
  listSpecChangeRecords,
} from "../src/deck/planning-store.js";
import { runDeckRegenerate } from "../src/deck/regenerate.js";
import {
  applySpecChange,
  previewSpecChange,
  rollbackSpecChange,
} from "../src/deck/spec-edit.js";
import { createEmptyDeckWorkspace } from "../src/deck/workspace.js";
import {
  buildSpec,
  entryAt,
  fakeGenerator,
  fakePageImage,
  writeSpecFile,
} from "./deck-generate-fixtures.js";

/** 生成图只做一次：每个用例都建 deck，重复跑 sharp 是纯浪费 */
let sharedImage: Promise<Buffer> | undefined;
function pageImage(): Promise<Buffer> {
  sharedImage ??= fakePageImage();
  return sharedImage;
}

/** 建一个两页全 generated 的 deck，规格已在 deck 内 */
async function setupDeck(spec: ContentSpec = buildSpec()): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), "ppt-maker-spec-edit-"));
  const deckPath = join(parent, "deck");
  const specPath = await writeSpecFile(parent, spec);
  await runDeckGenerate({
    deckPath,
    specPath,
    confirmUpload: true,
    generate: fakeGenerator(await pageImage()),
  });
  return deckPath;
}

/** 目录递归内容哈希：路径 + 文件字节，用来证明「一个字节都没动」 */
async function hashDir(directory: string): Promise<string> {
  const lines: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    const items = await readdir(current, { withFileTypes: true });
    items.sort((left, right) => left.name.localeCompare(right.name));
    for (const item of items) {
      const path = join(current, item.name);
      const relative = prefix === "" ? item.name : `${prefix}/${item.name}`;
      if (item.isDirectory()) {
        lines.push(`d:${relative}`);
        await walk(path, relative);
        continue;
      }
      const digest = createHash("sha256")
        .update(await readFile(path))
        .digest("hex");
      lines.push(`f:${relative}:${digest}`);
    }
  }
  await walk(directory, "");
  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

/** 改第 index 条条目的文字，其余原样 */
function withEditedEntry(
  spec: ContentSpec,
  index: number,
  text: string,
): ContentSpec {
  return {
    ...spec,
    entries: spec.entries.map((entry, position) =>
      position === index
        ? { ...entry, textGroups: [{ label: "标题", items: [text] }] }
        : entry,
    ),
  };
}

/**
 * 历史记录 id（倒序，最新在前）。
 *
 * 断言一律**相对基线**，不写死绝对条数：`deck generate` 的首次导入本身就走
 * `applySpecChange`（C3），因此 `setupDeck` 之后历史里已经有一条。写死条数会让
 * 这些用例在收编路径变化时红一次，而红的原因与它们要测的东西无关。
 */
async function historyIds(deckPath: string): Promise<string[]> {
  return (await listSpecChangeRecords(deckPath)).map(
    (record) => record.recordId,
  );
}

function readSpec(deckPath: string): Promise<ContentSpec> {
  return loadDeckContentSpec(deckPath).then((spec) => {
    if (spec === null) {
      throw new Error("deck 内没有规格");
    }
    return spec;
  });
}

const NOW = "2026-08-02T09:00:00.000Z";

describe("applySpecChange 是规格写入的唯一入口", () => {
  it("改一条条目：规格落盘、历史 +1、该页被算作新增过时", async () => {
    const deckPath = await setupDeck();
    const before = await readSpec(deckPath);
    const baseline = await historyIds(deckPath);

    const result = await applySpecChange({
      deckPath,
      nextSpec: withEditedEntry(before, 0, "全球营收总览"),
      origin: "manual",
      summary: "改写封面标题",
      now: () => NOW,
      newRecordId: () => "record-001",
    });

    // 1. 规格真的落盘了
    const onDisk = await readSpec(deckPath);
    expect(entryAt(onDisk, 0).textGroups).toEqual([
      { label: "标题", items: ["全球营收总览"] },
    ]);
    expect(onDisk.updatedAt).toBe(NOW);
    // 未改的条目一字不动
    expect(entryAt(onDisk, 1)).toEqual(entryAt(before, 1));

    // 2. 历史比基线恰好多一条，且新增的那条能重建这次变更
    const records = await listSpecChangeRecords(deckPath);
    expect(records).toHaveLength(baseline.length + 1);
    expect(records.slice(1).map((item) => item.recordId)).toEqual(baseline);
    const record = records[0];
    expect(record?.recordId).toBe("record-001");
    expect(record?.origin).toBe("manual");
    expect(record?.summary).toBe("改写封面标题");
    expect(record?.entriesBefore).toEqual([
      { specEntryId: "entry-001", index: 0, value: entryAt(before, 0) },
    ]);
    expect(record?.entriesAfter).toEqual([
      { specEntryId: "entry-001", index: 0, value: entryAt(onDisk, 0) },
    ]);
    // style 没变，只有被改的那条进指纹
    expect(record?.fingerprints.map((item) => item.specEntryId)).toEqual([
      "entry-001",
    ]);
    expect(record?.fingerprints[0]?.before).not.toBe(
      record?.fingerprints[0]?.after,
    );
    expect(result.historyWritten).toBe(true);

    // 3. 过时的是且只是那一页
    expect(result.drifted).toHaveLength(1);
    expect(result.drifted[0]?.pageLabel).toBe("page-01");
    expect(result.drifted[0]?.specEntryId).toBe("entry-001");
    expect(result.drifted[0]?.before).toBe(record?.fingerprints[0]?.before);
    expect(result.drifted[0]?.after).toBe(record?.fingerprints[0]?.after);
  });

  it("改 style：所有条目进 fingerprints，所有页变过时", async () => {
    const deckPath = await setupDeck();
    const before = await readSpec(deckPath);

    const result = await applySpecChange({
      deckPath,
      nextSpec: { ...before, style: { description: "暖橙主色、圆角卡片" } },
      origin: "manual",
      summary: "换风格",
      now: () => NOW,
      newRecordId: () => "record-style",
    });

    // style 进指纹投影，改它波及全 deck：两条条目一条都不能漏。
    // `diffContentSpec` 的 style 那一支**只置 styleChanged、不往集合里塞条目**
    // （T1 的边界），全条目覆盖由 applySpecChange 显式兜——所以断言要落在「长度
    // 等于条目总数」上，只断言 id 列表会随夹具条目数变化而失去意义。
    expect(result.record.fingerprints).toHaveLength(before.entries.length);
    expect(result.record.fingerprints.map((item) => item.specEntryId)).toEqual([
      "entry-001",
      "entry-002",
    ]);
    for (const fingerprint of result.record.fingerprints) {
      expect(fingerprint.before).not.toBe(fingerprint.after);
    }
    expect(result.record.styleBefore).toEqual(before.style);
    expect(result.record.styleAfter).toEqual({
      description: "暖橙主色、圆角卡片",
    });
    // 条目本身没被编辑过，因此前后集合为空——但两页都过时
    expect(result.record.entriesBefore).toEqual([]);
    expect(result.drifted.map((page) => page.pageLabel)).toEqual([
      "page-01",
      "page-02",
    ]);
  });

  it("入参伪造 specId / createdAt 一律被忽略，updatedAt 由代码盖", async () => {
    const deckPath = await setupDeck();
    const before = await readSpec(deckPath);

    await applySpecChange({
      deckPath,
      nextSpec: {
        ...withEditedEntry(before, 1, "被改过的要点"),
        specId: "spec-伪造",
        createdAt: "1999-01-01T00:00:00.000Z",
        updatedAt: "1999-01-01T00:00:00.000Z",
      },
      origin: "proposal",
      summary: "模型提案落盘",
      now: () => NOW,
    });

    const onDisk = await readSpec(deckPath);
    expect(onDisk.specId).toBe(before.specId);
    expect(onDisk.createdAt).toBe(before.createdAt);
    expect(onDisk.updatedAt).toBe(NOW);
  });

  it("历史写失败时规格照样落盘、historyWritten 为 false，且不抛", async () => {
    const deckPath = await setupDeck();
    const before = await readSpec(deckPath);
    // planning 被占成同名普通文件 → mkdir 必失败。
    // 先删掉建 deck 时写下的那份历史：C3 的首次导入已经把目录建出来了
    await rm(join(deckPath, DECK_PLANNING_DIR), {
      recursive: true,
      force: true,
    });
    await writeFile(join(deckPath, DECK_PLANNING_DIR), "占位", "utf8");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await applySpecChange({
      deckPath,
      nextSpec: withEditedEntry(before, 0, "日志写不进去也要保住规格"),
      origin: "manual",
      summary: "旁路日志失败不得阻断规格保存",
      now: () => NOW,
    });

    expect(result.historyWritten).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();

    // 前五步一步没少：规格已落盘，过时页照常算出
    expect(entryAt(await readSpec(deckPath), 0).textGroups).toEqual([
      { label: "标题", items: ["日志写不进去也要保住规格"] },
    ]);
    expect(result.drifted.map((page) => page.pageLabel)).toEqual(["page-01"]);
  });

  it("已经过时的页不重复计入：同一页连改两次，第二次的 drifted 为空", async () => {
    const deckPath = await setupDeck();
    const first = await readSpec(deckPath);
    await applySpecChange({
      deckPath,
      nextSpec: withEditedEntry(first, 0, "第一次改"),
      origin: "manual",
      summary: "第一次",
      now: () => NOW,
    });

    const second = await applySpecChange({
      deckPath,
      nextSpec: withEditedEntry(await readSpec(deckPath), 0, "第二次改"),
      origin: "manual",
      summary: "第二次",
      now: () => NOW,
    });

    // 界面要说的是「确认后 N 页**变为**已过时」，page-01 上一轮就过时了
    expect(second.drifted).toEqual([]);
  });

  it("删条目：落盘结果里的 missing 与 --dry-run 的 willMiss 逐字段一致", async () => {
    // 预告与结果必须说同一件事。两处各算一遍、只有一处被渲染，就会出现
    // 「预演说 1 页失联，确认完输出只字不提」——用户据以做决定的数字凭空蒸发。
    const deckPath = await setupDeck();
    const before = await readSpec(deckPath);
    const next: ContentSpec = {
      ...before,
      entries: before.entries.slice(0, 1),
    };

    const preview = await previewSpecChange(deckPath, next);
    const applied = await applySpecChange({
      deckPath,
      nextSpec: next,
      origin: "manual",
      summary: "删掉第二页条目",
      now: () => NOW,
    });

    expect(applied.missing.map((page) => page.pageLabel)).toEqual(["page-02"]);
    expect(applied.missing).toEqual(preview.willMiss);
    expect(applied.drifted).toEqual(preview.willDrift);
  });

  it("首次写入（磁盘上还没有规格）：全部条目记为新增，记录能被读回", async () => {
    // C3：`deck generate --spec` 的首次导入走同一入口，不给 origin 加新枚举值。
    // T4 收编那处调用时依赖本用例锁住的行为。
    const parent = await mkdtemp(join(tmpdir(), "ppt-maker-spec-edit-first-"));
    const deckPath = join(parent, "deck");
    await createEmptyDeckWorkspace({ workspacePath: deckPath });

    const spec = buildSpec();
    const result = await applySpecChange({
      deckPath,
      nextSpec: spec,
      origin: "manual",
      summary: "deck generate 导入外部规格",
      now: () => NOW,
      newRecordId: () => "record-first",
    });

    expect((await readSpec(deckPath)).entries).toHaveLength(2);
    expect(result.drifted).toEqual([]); // deck 里还一页都没有
    expect(result.record.entriesBefore.map((item) => item.value)).toEqual([
      null,
      null,
    ]);
    expect(
      result.record.fingerprints.map((item) => [item.specEntryId, item.before]),
    ).toEqual([
      ["entry-001", null],
      ["entry-002", null],
    ]);
    // styleBefore 不能是空串：`ContentSpecStyleSchema` 要求非空，写了空串这条记录
    // 会在读取时被 safeParse 当坏行静默丢弃——「写进去了却读不出来」
    expect(result.record.styleBefore).toEqual(spec.style);
    expect(
      (await listSpecChangeRecords(deckPath)).map((record) => record.recordId),
    ).toEqual(["record-first"]);
  });
});

describe("historyWritten 在每一个面上都被渲染", () => {
  it("deck regenerate 的日志写失败时，警告真的被打出来（不是只放在返回值里）", async () => {
    // `runDeckRegenerate` 的返回类型里没有 `historyWritten`，它只能就地出声。
    // 只写不读的标记等于没写：规格改了、历史查不到，而屏幕上什么都没说。
    const deckPath = await setupDeck();
    await rm(join(deckPath, DECK_PLANNING_DIR), {
      recursive: true,
      force: true,
    });
    await writeFile(join(deckPath, DECK_PLANNING_DIR), "占位", "utf8");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runDeckRegenerate({
      deckPath,
      page: "page-01",
      note: "标题再短一点",
      confirmUpload: true,
      generate: fakeGenerator(await pageImage(), "req_history_fail"),
    });

    const warned = errorSpy.mock.calls.some((call) =>
      call.some(
        (argument) =>
          typeof argument === "string" && argument.includes("未能写入变更历史"),
      ),
    );
    errorSpy.mockRestore();
    expect(warned).toBe(true);
  }, 180_000);
});

describe("rollbackSpecChange 只增不减", () => {
  it("回滚回到前值、再回滚回到后值，历史每次 +1", async () => {
    const deckPath = await setupDeck();
    const original = await readSpec(deckPath);
    const baseline = await historyIds(deckPath);

    const changed = await applySpecChange({
      deckPath,
      nextSpec: withEditedEntry(original, 0, "改过的标题"),
      origin: "manual",
      summary: "改标题",
      now: () => NOW,
      newRecordId: () => "record-change",
    });
    expect(changed.historyWritten).toBe(true);

    // 第一次回滚：规格回到 original
    const first = await rollbackSpecChange({
      deckPath,
      recordId: "record-change",
      now: () => NOW,
      newRecordId: () => "record-rollback-1",
    });
    expect(first.record.origin).toBe("rollback");
    expect(first.record.rollbackOf).toBe("record-change");
    expect(first.record.summary).toBe("回滚：改标题");
    expect(entryAt(await readSpec(deckPath), 0).textGroups).toEqual(
      entryAt(original, 0).textGroups,
    );
    expect(await historyIds(deckPath)).toHaveLength(baseline.length + 2);

    // 第二次回滚：回滚那条回滚记录 → 规格回到「改过的标题」
    const second = await rollbackSpecChange({
      deckPath,
      recordId: "record-rollback-1",
      now: () => NOW,
      newRecordId: () => "record-rollback-2",
    });
    expect(second.record.rollbackOf).toBe("record-rollback-1");
    expect(entryAt(await readSpec(deckPath), 0).textGroups).toEqual([
      { label: "标题", items: ["改过的标题"] },
    ]);

    // 历史只增不减：三条新记录一条不少、顺序倒序，基线那几条原封不动留在后面
    expect(await historyIds(deckPath)).toEqual([
      "record-rollback-2",
      "record-rollback-1",
      "record-change",
      ...baseline,
    ]);
  });

  it("记录不存在时报错，且规格一字不动", async () => {
    const deckPath = await setupDeck();
    const digest = await hashDir(deckPath);

    // 断言**错误码**而不只是消息：调用方要靠 code 分支，靠消息匹配会在改文案时静默失效
    await expect(
      rollbackSpecChange({ deckPath, recordId: "record-不存在" }),
    ).rejects.toMatchObject({
      code: "SPEC_HISTORY_RECORD_NOT_FOUND",
    });
    expect(await hashDir(deckPath)).toBe(digest);
  });
});

describe("previewSpecChange 零副作用", () => {
  it("算得出过时与失联，且跑完 deck 目录逐字节不变", async () => {
    const deckPath = await setupDeck();
    const before = await readSpec(deckPath);
    const digest = await hashDir(deckPath);

    // 改一条 + 删一条
    const next: ContentSpec = {
      ...withEditedEntry(before, 0, "预告用的新标题"),
      entries: withEditedEntry(before, 0, "预告用的新标题").entries.slice(0, 1),
    };
    const preview = await previewSpecChange(deckPath, next);

    expect(preview.diff.modified).toEqual(["entry-001"]);
    expect(preview.diff.removed).toEqual(["entry-002"]);
    expect(preview.willDrift.map((page) => page.pageLabel)).toEqual([
      "page-01",
    ]);
    expect(preview.willMiss.map((page) => page.pageLabel)).toEqual(["page-02"]);
    expect(preview.willMiss[0]?.after).toBeNull();

    // 一个字节都没写。目录递归内容哈希覆盖了「没新建文件」与「没改既有文件」两件事，
    // 因此也就覆盖了「没往 spec-history.jsonl 里追加」——预告不是变更，不该留痕。
    expect(await hashDir(deckPath)).toBe(digest);
  });
});

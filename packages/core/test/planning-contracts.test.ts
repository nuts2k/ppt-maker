import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../src/constants.js";
import type {
  ContentSpec,
  ContentSpecEntry,
} from "../src/content-spec-contracts.js";
import { ContentSpecSchema } from "../src/content-spec-contracts.js";
import {
  applyRollbackToSpec,
  diffContentSpec,
  SPEC_CHANGE_RECORD_V,
  type SpecChangeRecord,
  SpecChangeRecordSchema,
} from "../src/planning-contracts.js";

function entry(id: string, pageType: string, text: string): ContentSpecEntry {
  return {
    specEntryId: id,
    pageType,
    textGroups: [{ label: "要点", items: [text] }],
    visualIntent: "左文右图",
    revisionNotes: [],
  };
}

const BASE: ContentSpec = {
  schemaVersion: SCHEMA_VERSION,
  specId: "spec-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  style: { description: "深蓝主色、无衬线中文、大留白" },
  entries: [
    entry("entry-001", "cover", "产品发布会"),
    entry("entry-002", "content", "更快"),
    entry("entry-003", "summary", "谢谢"),
  ],
};

function withEntries(
  spec: ContentSpec,
  entries: readonly ContentSpecEntry[],
): ContentSpec {
  return { ...spec, entries: [...entries] };
}

/** 索引取条目并断言存在——测试里不用 `!`，缺了要当场报错而不是静默 undefined */
function entryAt(spec: ContentSpec, index: number): ContentSpecEntry {
  const found = spec.entries[index];
  if (found === undefined) {
    throw new Error(`测试夹具缺少条目 ${index}`);
  }
  return found;
}

function idsOf(spec: ContentSpec): string[] {
  return spec.entries.map((item) => item.specEntryId);
}

/** 用真实 diff 结果组装一条记录，并**经 schema 校验**——保证测试用的记录是合法的 */
function makeRecord(
  before: ContentSpec,
  after: ContentSpec,
  overrides: Partial<SpecChangeRecord> = {},
): SpecChangeRecord {
  const diff = diffContentSpec(before, after);
  return SpecChangeRecordSchema.parse({
    v: SPEC_CHANGE_RECORD_V,
    recordId: "record-1",
    at: "2026-08-02T00:00:00.000Z",
    origin: "manual",
    summary: "测试变更",
    styleBefore: before.style,
    styleAfter: after.style,
    entriesBefore: diff.entriesBefore,
    entriesAfter: diff.entriesAfter,
    fingerprints: [],
    conversationRef: null,
    rollbackOf: null,
    ...overrides,
  });
}

describe("SPEC_CHANGE_RECORD_V", () => {
  it("是局部版本号 1，不随全仓 SCHEMA_VERSION 走", () => {
    // 断言字面值：写成引用 SCHEMA_VERSION 的话，宿主升版时用例会跟着变，
    // 正好掩盖「旁路文件被绑进全仓迁移」这个缺陷。
    expect(SPEC_CHANGE_RECORD_V).toBe(1);
  });
});

describe("SpecChangeRecordSchema", () => {
  const valid = makeRecord(BASE, withEntries(BASE, BASE.entries.slice(0, 2)));

  it("接受合法记录", () => {
    expect(SpecChangeRecordSchema.safeParse(valid).success).toBe(true);
  });

  it("接受 fingerprints 两侧为 null（新增与删除各占一侧）", () => {
    const result = SpecChangeRecordSchema.safeParse({
      ...valid,
      fingerprints: [
        { specEntryId: "entry-003", before: "abc", after: null },
        { specEntryId: "entry-004", before: null, after: "def" },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("拒绝其它版本号", () => {
    expect(SpecChangeRecordSchema.safeParse({ ...valid, v: 2 }).success).toBe(
      false,
    );
  });

  it("拒绝未知 origin", () => {
    expect(
      SpecChangeRecordSchema.safeParse({ ...valid, origin: "auto" }).success,
    ).toBe(false);
  });

  it("拒绝空 summary", () => {
    expect(
      SpecChangeRecordSchema.safeParse({ ...valid, summary: "" }).success,
    ).toBe(false);
  });

  it("拒绝非 ISO 时间", () => {
    expect(
      SpecChangeRecordSchema.safeParse({ ...valid, at: "2026/08/02" }).success,
    ).toBe(false);
  });

  it("拒绝负数或小数 index", () => {
    expect(
      SpecChangeRecordSchema.safeParse({
        ...valid,
        entriesBefore: [{ specEntryId: "entry-001", index: -1, value: null }],
      }).success,
    ).toBe(false);
    expect(
      SpecChangeRecordSchema.safeParse({
        ...valid,
        entriesBefore: [{ specEntryId: "entry-001", index: 1.5, value: null }],
      }).success,
    ).toBe(false);
  });

  it("拒绝缺字段与缺 rollbackOf（可空但不可缺）", () => {
    const { rollbackOf: _dropped, ...withoutRollbackOf } = valid;
    expect(SpecChangeRecordSchema.safeParse(withoutRollbackOf).success).toBe(
      false,
    );
  });

  it("拒绝条目值不合法的记录（value 走完整条目校验）", () => {
    expect(
      SpecChangeRecordSchema.safeParse({
        ...valid,
        entriesBefore: [
          {
            specEntryId: "entry-001",
            index: 0,
            value: { ...entry("entry-001", "cover", "x"), pageType: "" },
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe("diffContentSpec", () => {
  it("规格完全相同时四项皆空", () => {
    const diff = diffContentSpec(BASE, { ...BASE });
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
    expect(diff.reordered).toBe(false);
    expect(diff.styleChanged).toBe(false);
    expect(diff.entriesBefore).toEqual([]);
    expect(diff.entriesAfter).toEqual([]);
  });

  it("新增：before 侧记 value 为 null", () => {
    const added = entry("entry-004", "content", "新页");
    const diff = diffContentSpec(
      BASE,
      withEntries(BASE, [...BASE.entries, added]),
    );
    expect(diff.added).toEqual(["entry-004"]);
    expect(diff.removed).toEqual([]);
    expect(diff.modified).toEqual([]);
    expect(diff.reordered).toBe(false);
    expect(diff.entriesBefore).toEqual([
      { specEntryId: "entry-004", index: 3, value: null },
    ]);
    expect(diff.entriesAfter).toEqual([
      { specEntryId: "entry-004", index: 3, value: added },
    ]);
  });

  it("删除末条：after 侧记 value 为 null，其余条目不受牵连", () => {
    const diff = diffContentSpec(
      BASE,
      withEntries(BASE, BASE.entries.slice(0, 2)),
    );
    expect(diff.removed).toEqual(["entry-003"]);
    expect(diff.added).toEqual([]);
    expect(diff.modified).toEqual([]);
    expect(diff.reordered).toBe(false);
    expect(diff.entriesBefore).toEqual([
      { specEntryId: "entry-003", index: 2, value: entryAt(BASE, 2) },
    ]);
    expect(diff.entriesAfter).toEqual([
      { specEntryId: "entry-003", index: 2, value: null },
    ]);
  });

  it("删除首条：后续条目因位置变化一并进入前后集合（否则回滚恢复不出顺序）", () => {
    const diff = diffContentSpec(
      BASE,
      withEntries(BASE, BASE.entries.slice(1)),
    );
    expect(diff.removed).toEqual(["entry-001"]);
    expect(diff.modified).toEqual([]);
    expect(diff.reordered).toBe(true);
    expect(diff.entriesBefore.map((item) => item.specEntryId)).toEqual([
      "entry-002",
      "entry-003",
      "entry-001",
    ]);
    expect(diff.entriesBefore.map((item) => item.index)).toEqual([1, 2, 0]);
    expect(diff.entriesAfter.map((item) => item.index)).toEqual([0, 1, 0]);
  });

  it("修改：只记该条目，reordered 保持 false", () => {
    const edited = entry("entry-002", "content", "更快更稳");
    const diff = diffContentSpec(
      BASE,
      withEntries(BASE, [entryAt(BASE, 0), edited, entryAt(BASE, 2)]),
    );
    expect(diff.modified).toEqual(["entry-002"]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.reordered).toBe(false);
    expect(diff.entriesBefore).toEqual([
      { specEntryId: "entry-002", index: 1, value: entryAt(BASE, 1) },
    ]);
    expect(diff.entriesAfter).toEqual([
      { specEntryId: "entry-002", index: 1, value: edited },
    ]);
  });

  it("追加 revisionNotes 算作修改（它进指纹投影）", () => {
    const noted: ContentSpecEntry = {
      ...entry("entry-002", "content", "更快"),
      revisionNotes: ["文字再少一点"],
    };
    const diff = diffContentSpec(
      BASE,
      withEntries(BASE, [entryAt(BASE, 0), noted, entryAt(BASE, 2)]),
    );
    expect(diff.modified).toEqual(["entry-002"]);
  });

  it("纯重排：不进 modified，只置 reordered", () => {
    const diff = diffContentSpec(
      BASE,
      withEntries(BASE, [entryAt(BASE, 1), entryAt(BASE, 0), entryAt(BASE, 2)]),
    );
    expect(diff.modified).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.reordered).toBe(true);
    expect(diff.entriesBefore.map((item) => item.specEntryId)).toEqual([
      "entry-002",
      "entry-001",
    ]);
    expect(diff.entriesBefore.map((item) => item.index)).toEqual([1, 0]);
    expect(diff.entriesAfter.map((item) => item.index)).toEqual([0, 1]);
  });

  it("style 变更单独表达，不牵动条目集合", () => {
    const diff = diffContentSpec(BASE, {
      ...BASE,
      style: { description: "暖橙主色、衬线中文" },
    });
    expect(diff.styleChanged).toBe(true);
    expect(diff.entriesBefore).toEqual([]);
    expect(diff.entriesAfter).toEqual([]);
  });

  it("输出确定：先按 after 的 index 升序，删除项按 before 的 index 追加", () => {
    const added = entry("entry-004", "content", "新页");
    const editedFirst = entry("entry-001", "cover", "产品发布会（改）");
    // after: [entry-004, entry-001(改), entry-003]；entry-002 被删。
    // entry-003 前后都在 index 2、值未变，因此**不进**受影响集合——
    // 一次增删同时发生时它恰好没被挤动，这正是「只记受影响条目」的意义。
    const after = withEntries(BASE, [added, editedFirst, entryAt(BASE, 2)]);
    const diff = diffContentSpec(BASE, after);
    expect(diff.entriesAfter.map((item) => item.specEntryId)).toEqual([
      "entry-004",
      "entry-001",
      "entry-002",
    ]);
    expect(diff.entriesAfter.map((item) => item.index)).toEqual([0, 1, 1]);
    // 前后集合逐位配对，同一位置说的是同一个条目
    expect(diff.entriesBefore.map((item) => item.specEntryId)).toEqual(
      diff.entriesAfter.map((item) => item.specEntryId),
    );
  });

  it("空规格作为 before 时全部条目算新增（首次导入形态）", () => {
    const diff = diffContentSpec(withEntries(BASE, []), BASE);
    expect(diff.added).toEqual(["entry-001", "entry-002", "entry-003"]);
    expect(diff.entriesBefore.every((item) => item.value === null)).toBe(true);
  });
});

describe("applyRollbackToSpec", () => {
  it("撤销新增：那次变更新增出来的条目被删掉", () => {
    const after = withEntries(BASE, [
      ...BASE.entries,
      entry("entry-004", "content", "新页"),
    ]);
    const restored = applyRollbackToSpec(after, makeRecord(BASE, after));
    expect(idsOf(restored)).toEqual(idsOf(BASE));
    expect(restored.entries).toEqual(BASE.entries);
  });

  it("撤销删除：条目按 index 插回原位", () => {
    const after = withEntries(BASE, BASE.entries.slice(1));
    const restored = applyRollbackToSpec(after, makeRecord(BASE, after));
    expect(idsOf(restored)).toEqual(["entry-001", "entry-002", "entry-003"]);
    expect(restored.entries).toEqual(BASE.entries);
  });

  it("撤销修改：条目值回到前值", () => {
    const after = withEntries(BASE, [
      entryAt(BASE, 0),
      entry("entry-002", "content", "更快更稳"),
      entryAt(BASE, 2),
    ]);
    const restored = applyRollbackToSpec(after, makeRecord(BASE, after));
    expect(restored.entries).toEqual(BASE.entries);
  });

  it("撤销纯重排：顺序回到原样", () => {
    const after = withEntries(BASE, [
      entryAt(BASE, 1),
      entryAt(BASE, 0),
      entryAt(BASE, 2),
    ]);
    const restored = applyRollbackToSpec(after, makeRecord(BASE, after));
    expect(idsOf(restored)).toEqual(["entry-001", "entry-002", "entry-003"]);
  });

  it("撤销 style 变更", () => {
    const after: ContentSpec = {
      ...BASE,
      style: { description: "暖橙主色、衬线中文" },
    };
    const restored = applyRollbackToSpec(after, makeRecord(BASE, after));
    expect(restored.style).toEqual(BASE.style);
  });

  it("未被该记录触及的条目原样保留（回滚只撤那一次变更）", () => {
    // 变更 A：改 entry-002
    const afterA = withEntries(BASE, [
      entryAt(BASE, 0),
      entry("entry-002", "content", "更快更稳"),
      entryAt(BASE, 2),
    ]);
    const recordA = makeRecord(BASE, afterA);
    // 变更 B（与 A 无关）：追加 entry-004
    const later = entry("entry-004", "content", "后来加的");
    const afterB = withEntries(afterA, [...afterA.entries, later]);

    const restored = applyRollbackToSpec(afterB, recordA);
    expect(idsOf(restored)).toEqual([
      "entry-001",
      "entry-002",
      "entry-003",
      "entry-004",
    ]);
    expect(entryAt(restored, 1)).toEqual(entryAt(BASE, 1));
    expect(entryAt(restored, 3)).toEqual(later);
  });

  it("同一次变更里既删又重排：插回顺序按 index 升序，不按记录里的排列顺序", () => {
    // `entriesBefore` 的排列是「先按 after 的 index、再追加被删项」，因此这里是
    // D@3, C@2, A@0, B@1 —— **不是**升序。`applyRollbackToSpec` 若照这个顺序直接插，
    // D 会先被钉到末尾、随后被 C 挤开，结果是 A,B,D,C。
    //
    // 这条用例锁的就是那个 `.sort((l, r) => l.index - r.index)`：去掉它本用例必红，
    // 而删一条 / 改一条 / 纯重排这些单点场景恰好都不受影响（试过，全绿），
    // 只有「删多条 + 剩下的还换了位」这种组合才暴露。
    const four = withEntries(BASE, [
      ...BASE.entries,
      entry("entry-004", "content", "第四页"),
    ]);
    const after = withEntries(four, [entryAt(four, 3), entryAt(four, 2)]);
    const record = makeRecord(four, after);
    expect(record.entriesBefore.map((item) => item.index)).toEqual([
      3, 2, 0, 1,
    ]);

    const restored = applyRollbackToSpec(after, record);
    expect(idsOf(restored)).toEqual([
      "entry-001",
      "entry-002",
      "entry-003",
      "entry-004",
    ]);
    expect(restored.entries).toEqual(four.entries);
  });

  it("index 超出当前长度时追加而不是抛错", () => {
    const record = makeRecord(BASE, withEntries(BASE, []), {
      recordId: "record-clear",
      summary: "清空全部条目",
    });
    // 当前规格已被别的变更削到只剩一条，回滚时 index 2 超出长度
    const shrunk = withEntries(BASE, [entryAt(BASE, 0)]);
    const restored = applyRollbackToSpec(shrunk, record);
    expect(idsOf(restored)).toEqual(["entry-001", "entry-002", "entry-003"]);
  });

  it("沿用 current 的 specId / createdAt / updatedAt，且不改动入参", () => {
    const after: ContentSpec = {
      ...withEntries(BASE, BASE.entries.slice(0, 2)),
      specId: "spec-1",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T09:00:00.000Z",
    };
    const snapshot = structuredClone(after);
    const restored = applyRollbackToSpec(after, makeRecord(BASE, after));
    expect(restored.specId).toBe("spec-1");
    expect(restored.createdAt).toBe("2026-08-01T00:00:00.000Z");
    // updatedAt 由写入入口统一盖，纯函数不碰
    expect(restored.updatedAt).toBe("2026-08-02T09:00:00.000Z");
    expect(after).toEqual(snapshot);
    expect(ContentSpecSchema.safeParse(restored).success).toBe(true);
  });

  it("回滚后再回滚：规格在两个版本间来回，历史只增不减", () => {
    const v2 = withEntries(BASE, [
      entryAt(BASE, 0),
      entry("entry-002", "content", "更快更稳"),
    ]);

    // 第一次回滚：v2 → v1
    const recordA = makeRecord(BASE, v2, { recordId: "record-a" });
    const v3 = applyRollbackToSpec(v2, recordA);
    expect(v3.entries).toEqual(BASE.entries);

    // 第二次回滚：回滚掉「那次回滚」本身 → 回到 v2
    const recordB = makeRecord(v2, v3, {
      recordId: "record-b",
      origin: "rollback",
      rollbackOf: "record-a",
      summary: "回滚：测试变更",
    });
    const v4 = applyRollbackToSpec(v3, recordB);
    expect(v4.entries).toEqual(v2.entries);
    expect(idsOf(v4)).toEqual(["entry-001", "entry-002"]);
  });
});

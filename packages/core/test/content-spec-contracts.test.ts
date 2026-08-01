import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "../src/constants.js";
import {
  type ContentSpec,
  type ContentSpecEntry,
  ContentSpecSchema,
  ContentSpecViewSchema,
  flattenSpecEntryTexts,
  materializeContentSpec,
  specViewFingerprintValues,
} from "../src/content-spec-contracts.js";

/**
 * 与 CLI 的 `sha256Values` 逐字节同构（长度前缀式稳定哈希）。
 *
 * core 保持零运行时依赖，因此指纹的「投影」在 core、「哈希」在 CLI；
 * 本文件在测试里复刻哈希那一步，用来断言投影的行为。
 */
function sha256Values(values: readonly string[]): string {
  const hash = createHash("sha256");
  for (const value of values) {
    hash.update(String(Buffer.byteLength(value)), "utf8");
    hash.update(":", "utf8");
    hash.update(value, "utf8");
    hash.update("\n", "utf8");
  }
  return hash.digest("hex");
}

const BASE: ContentSpec = {
  schemaVersion: SCHEMA_VERSION,
  specId: "spec-1",
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  style: { description: "深蓝主色、无衬线中文、大留白" },
  entries: [
    {
      specEntryId: "entry-001",
      pageType: "cover",
      textGroups: [
        { label: "标题", items: ["产品发布会"] },
        { label: "副标题", items: ["2026 年度", "第一季度"] },
      ],
      visualIntent: "居中大标题，底部渐变",
      revisionNotes: [],
    },
    {
      specEntryId: "entry-002",
      pageType: "content",
      textGroups: [{ label: "要点", items: ["更快", "更稳"] }],
      visualIntent: "左文右图",
      revisionNotes: [],
    },
  ],
};

/** 索引取条目并断言存在——测试里不用 `!`，缺了要当场报错而不是静默 undefined */
function entryAt(spec: ContentSpec, index: number): ContentSpecEntry {
  const entry = spec.entries[index];
  if (entry === undefined) {
    throw new Error(`测试夹具缺少条目 ${index}`);
  }
  return entry;
}

function fingerprintOf(spec: ContentSpec, entryIndex: number): string {
  return sha256Values(
    specViewFingerprintValues(spec.style, entryAt(spec, entryIndex)),
  );
}

describe("ContentSpecSchema", () => {
  it("接受合法规格", () => {
    expect(ContentSpecSchema.safeParse(BASE).success).toBe(true);
  });

  it("拒绝重复的 specEntryId", () => {
    const duplicated: unknown = {
      ...BASE,
      entries: [
        BASE.entries[0],
        { ...BASE.entries[1], specEntryId: "entry-001" },
      ],
    };
    const result = ContentSpecSchema.safeParse(duplicated);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("条目 ID 重复");
  });

  it("拒绝含换行的页面文字（展平后每条须恰好占一行）", () => {
    const withNewline: unknown = {
      ...BASE,
      entries: [
        {
          ...BASE.entries[0],
          textGroups: [{ label: "标题", items: ["第一行\n第二行"] }],
        },
      ],
    };
    expect(ContentSpecSchema.safeParse(withNewline).success).toBe(false);
  });

  it("拒绝空的页面文字条目", () => {
    const empty: unknown = {
      ...BASE,
      entries: [
        { ...BASE.entries[0], textGroups: [{ label: "标题", items: [""] }] },
      ],
    };
    expect(ContentSpecSchema.safeParse(empty).success).toBe(false);
  });

  it("允许 visualIntent 为空串（并非每页都有额外视觉意图）", () => {
    const noIntent: unknown = {
      ...BASE,
      entries: [{ ...BASE.entries[0], visualIntent: "" }],
    };
    expect(ContentSpecSchema.safeParse(noIntent).success).toBe(true);
  });
});

describe("specViewFingerprintValues（C1 指纹口径）", () => {
  it("改一条条目只有该条目的指纹变化", () => {
    const before = [fingerprintOf(BASE, 0), fingerprintOf(BASE, 1)];
    const edited: ContentSpec = {
      ...BASE,
      entries: [
        {
          ...entryAt(BASE, 0),
          textGroups: [
            { label: "标题", items: ["产品发布会（改）"] },
            { label: "副标题", items: ["2026 年度", "第一季度"] },
          ],
        },
        entryAt(BASE, 1),
      ],
    };
    const after = [fingerprintOf(edited, 0), fingerprintOf(edited, 1)];
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it("改 style 时全部条目的指纹都变化", () => {
    const before = [fingerprintOf(BASE, 0), fingerprintOf(BASE, 1)];
    const restyled: ContentSpec = {
      ...BASE,
      style: { description: "暖橙主色、衬线中文" },
    };
    const after = [fingerprintOf(restyled, 0), fingerprintOf(restyled, 1)];
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).not.toBe(before[1]);
  });

  it("追加 revisionNotes 改变指纹", () => {
    const noted: ContentSpec = {
      ...BASE,
      entries: [
        { ...entryAt(BASE, 0), revisionNotes: ["标题再大一点"] },
        entryAt(BASE, 1),
      ],
    };
    expect(fingerprintOf(noted, 0)).not.toBe(fingerprintOf(BASE, 0));
  });

  it("JSON 键顺序重排不改变指纹", () => {
    const entry = entryAt(BASE, 0);
    const reordered = ContentSpecSchema.parse(
      JSON.parse(
        JSON.stringify({
          entries: BASE.entries.map((item) => ({
            revisionNotes: item.revisionNotes,
            visualIntent: item.visualIntent,
            textGroups: item.textGroups.map((group) => ({
              items: group.items,
              label: group.label,
            })),
            pageType: item.pageType,
            specEntryId: item.specEntryId,
          })),
          style: BASE.style,
          updatedAt: BASE.updatedAt,
          createdAt: BASE.createdAt,
          specId: BASE.specId,
          schemaVersion: BASE.schemaVersion,
        }),
      ),
    );
    expect(
      sha256Values(
        specViewFingerprintValues(reordered.style, entryAt(reordered, 0)),
      ),
    ).toBe(sha256Values(specViewFingerprintValues(BASE.style, entry)));
  });

  it("前缀标签防止不同结构拼出同一串", () => {
    const grouped = specViewFingerprintValues(BASE.style, {
      ...entryAt(BASE, 0),
      textGroups: [{ label: "a", items: ["b"] }],
    });
    const merged = specViewFingerprintValues(BASE.style, {
      ...entryAt(BASE, 0),
      textGroups: [{ label: "a b", items: [] }],
    });
    expect(sha256Values(grouped)).not.toBe(sha256Values(merged));
  });
});

describe("flattenSpecEntryTexts", () => {
  it("按分组顺序展平全部文字", () => {
    expect(flattenSpecEntryTexts(entryAt(BASE, 0))).toEqual([
      "产品发布会",
      "2026 年度",
      "第一季度",
    ]);
  });
});

describe("ContentSpecViewSchema", () => {
  it("合并视图带 style 与单条目", () => {
    expect(
      ContentSpecViewSchema.safeParse({
        schemaVersion: SCHEMA_VERSION,
        style: BASE.style,
        entry: BASE.entries[0],
      }).success,
    ).toBe(true);
  });
});

describe("materializeContentSpec", () => {
  it("为模型初稿分配顺序 id 并置空 revisionNotes", () => {
    const spec = materializeContentSpec(
      {
        style: { description: "极简黑白" },
        entries: [
          {
            pageType: "cover",
            textGroups: [{ label: "标题", items: ["开场"] }],
            visualIntent: "居中",
          },
          {
            pageType: "content",
            textGroups: [{ label: "要点", items: ["一", "二"] }],
            visualIntent: "分栏",
          },
        ],
      },
      { specId: "spec-draft-1", now: "2026-08-01T10:00:00.000Z" },
    );
    expect(spec.entries.map((entry) => entry.specEntryId)).toEqual([
      "entry-001",
      "entry-002",
    ]);
    expect(
      spec.entries.every((entry) => entry.revisionNotes.length === 0),
    ).toBe(true);
    expect(ContentSpecSchema.safeParse(spec).success).toBe(true);
  });
});

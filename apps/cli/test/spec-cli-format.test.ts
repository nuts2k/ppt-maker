// `deck spec-apply` / `spec-history` / `spec-rollback` 三条命令的输出格式化。
//
// 命令回调本身不测（本仓库没有 spawn CLI 的先例），所以可测的部分全部做成了纯函数：
// 回调只剩「取参 → 调用 → 打印」。这里锁的就是那几个纯函数的文案。
import type { ContentSpecDiff, SpecChangeRecord } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import type {
  ApplySpecChangeResult,
  DriftedPage,
  PreviewSpecChangeResult,
} from "../src/deck/spec-edit.js";
import {
  formatSpecChangePreview,
  formatSpecChangeResult,
  formatSpecHistory,
  formatSpecHistoryWarning,
} from "../src/deck/spec-edit.js";
import { buildSpec } from "./deck-generate-fixtures.js";

function buildRecord(
  overrides: Partial<SpecChangeRecord> = {},
): SpecChangeRecord {
  return {
    v: 1,
    recordId: "record-001",
    at: "2026-08-02T10:00:00.000Z",
    origin: "manual",
    summary: "改第二页文字",
    styleBefore: { description: "深蓝主色" },
    styleAfter: { description: "深蓝主色" },
    entriesBefore: [],
    entriesAfter: [],
    fingerprints: [{ specEntryId: "entry-002", before: "aaa", after: "bbb" }],
    conversationRef: null,
    rollbackOf: null,
    ...overrides,
  };
}

function buildDrifted(overrides: Partial<DriftedPage> = {}): DriftedPage {
  return {
    slideId: "slide-002",
    pageLabel: "page-02",
    specEntryId: "entry-002",
    before: "aaa",
    after: "bbb",
    ...overrides,
  };
}

function buildResult(
  overrides: Partial<ApplySpecChangeResult> = {},
): ApplySpecChangeResult {
  return {
    spec: buildSpec(),
    record: buildRecord(),
    historyWritten: true,
    drifted: [buildDrifted()],
    missing: [],
    ...overrides,
  };
}

function buildDiff(overrides: Partial<ContentSpecDiff> = {}): ContentSpecDiff {
  return {
    styleChanged: false,
    entriesBefore: [],
    entriesAfter: [],
    added: [],
    removed: [],
    modified: [],
    reordered: false,
    ...overrides,
  };
}

function buildPreview(
  overrides: Partial<PreviewSpecChangeResult> = {},
): PreviewSpecChangeResult {
  return {
    diff: buildDiff(),
    willDrift: [],
    willMiss: [],
    ...overrides,
  };
}

describe("formatSpecChangeResult", () => {
  it("打印 recordId、摘要、来源与新增过时页", () => {
    const output = formatSpecChangeResult(buildResult());
    expect(output).toContain("已保存规格变更：record-001");
    expect(output).toContain("  摘要: 改第二页文字");
    expect(output).toContain("  来源: 人工");
    expect(output).toContain("  受影响条目: 1");
    expect(output).toContain("  新增过时: 1 页 — page-02 (entry-002)");
  });

  it("没有页面因此过时时如实说「无」，不留空行", () => {
    const output = formatSpecChangeResult(buildResult({ drifted: [] }));
    expect(output).toContain("  新增过时: 无");
    expect(output.split("\n").every((line) => line.trim() !== "")).toBe(true);
  });

  it("有页面因条目被删而失联时单列一行——与 --dry-run 的预告对得上", () => {
    // `--dry-run` 会写「确认后 N 页规格失联」，落盘后的输出不提这件事，
    // 用户据以做决定的那个数字就凭空蒸发了
    const output = formatSpecChangeResult(
      buildResult({
        drifted: [],
        missing: [
          buildDrifted({
            slideId: "slide-001",
            pageLabel: "page-01",
            specEntryId: "entry-001",
            after: null,
          }),
        ],
      }),
    );
    expect(output).toContain("  新增失联: 1 页 — page-01 (entry-001)");
  });

  it("没有失联页时不打印那一行", () => {
    expect(formatSpecChangeResult(buildResult())).not.toContain("新增失联");
  });

  it("回滚记录额外打印回滚自哪条", () => {
    const output = formatSpecChangeResult(
      buildResult({
        record: buildRecord({
          recordId: "record-002",
          origin: "rollback",
          summary: "回滚：改第二页文字",
          rollbackOf: "record-001",
        }),
      }),
    );
    expect(output).toContain("  来源: 回滚");
    expect(output).toContain("  回滚自: record-001");
  });

  it("recordId 打全不截断——它是 spec-rollback --record 的唯一入参", () => {
    const recordId = "7f3a1c9e-2b44-4d51-9a0e-6c8b5d2f1e73";
    const output = formatSpecChangeResult(
      buildResult({ record: buildRecord({ recordId }) }),
    );
    expect(output).toContain(recordId);
  });
});

describe("formatSpecHistoryWarning", () => {
  it("日志写成功时不出声", () => {
    expect(formatSpecHistoryWarning(buildResult())).toBeNull();
  });

  it("日志写失败时说清「规格已保存、但这次改动进不了历史」", () => {
    expect(
      formatSpecHistoryWarning(buildResult({ historyWritten: false })),
    ).toBe(
      "警告：规格已保存，但本次改动未能写入变更历史（planning/spec-history.jsonl）；该记录无法回看，也无法回滚。",
    );
  });
});

describe("formatSpecChangePreview", () => {
  it("预演文案明说不写文件，并给出条目变更计数", () => {
    const output = formatSpecChangePreview(
      buildPreview({
        diff: buildDiff({
          added: ["entry-003"],
          modified: ["entry-002"],
          styleChanged: true,
        }),
      }),
    );
    expect(output).toContain("预演：不写入任何文件");
    expect(output).toContain("  条目变更: 新增 1、删除 0、修改 1");
    expect(output).toContain("  风格: 已修改");
  });

  it("确认后无影响时如实说明，不打印空的页面清单", () => {
    const output = formatSpecChangePreview(buildPreview());
    expect(output).toContain("  确认后不会有页面变为已过时或失联");
    expect(output).not.toContain("变为已过时:");
    expect(output).not.toContain("规格失联:");
  });

  it("过时与失联分列，各带页数与页清单", () => {
    const output = formatSpecChangePreview(
      buildPreview({
        willDrift: [
          buildDrifted(),
          buildDrifted({
            slideId: "slide-003",
            pageLabel: "page-03",
            specEntryId: "entry-003",
          }),
        ],
        willMiss: [
          buildDrifted({
            slideId: "slide-001",
            pageLabel: "page-01",
            specEntryId: "entry-001",
            after: null,
          }),
        ],
      }),
    );
    expect(output).toContain(
      "  确认后 2 页变为已过时: page-02 (entry-002), page-03 (entry-003)",
    );
    expect(output).toContain("  确认后 1 页规格失联: page-01 (entry-001)");
  });

  it("纯位置调整单列一行，并写明不影响过时判定", () => {
    const output = formatSpecChangePreview(
      buildPreview({ diff: buildDiff({ reordered: true }) }),
    );
    expect(output).toContain("  顺序: 有条目位置调整（不影响过时判定）");
    expect(output).toContain("  条目变更: 新增 0、删除 0、修改 0");
  });
});

describe("formatSpecHistory", () => {
  it("无记录时说明文件可能不存在，而不是打印一个空清单", () => {
    expect(formatSpecHistory([])).toBe(
      "变更历史：无记录（planning/spec-history.jsonl 不存在或为空）",
    );
  });

  it("单条记录含时间、来源、受影响条目数、recordId 与摘要", () => {
    const lines = formatSpecHistory([buildRecord()]).split("\n");
    expect(lines[0]).toBe("变更历史：1 条（最近在前）");
    expect(lines[1]).toBe(
      "  2026-08-02T10:00:00.000Z  人工  受影响 1 条  record-001",
    );
    expect(lines[2]).toBe("    改第二页文字");
  });

  it("多条按传入顺序输出（listSpecChangeRecords 已倒序），回滚条目多一行来源", () => {
    const output = formatSpecHistory([
      buildRecord({
        recordId: "record-003",
        at: "2026-08-02T12:00:00.000Z",
        origin: "rollback",
        summary: "回滚：改第二页文字",
        rollbackOf: "record-001",
      }),
      buildRecord({
        recordId: "record-002",
        at: "2026-08-02T11:00:00.000Z",
        origin: "proposal",
        summary: "采纳提案：精简第三页",
      }),
      buildRecord(),
    ]);
    expect(output.startsWith("变更历史：3 条（最近在前）")).toBe(true);
    // 按记录头那一行的位置比，不按裸 id：record-001 还会作为 rollbackOf 出现在第一条里
    const headOf = (recordId: string): number =>
      output.indexOf(`条  ${recordId}`);
    expect(headOf("record-003")).toBeLessThan(headOf("record-002"));
    expect(headOf("record-002")).toBeLessThan(headOf("record-001"));
    expect(output).toContain("  回滚  ");
    expect(output).toContain("  提案  ");
    expect(output).toContain("    回滚自 record-001");
  });

  it("--json 形态原样输出记录数组，可被脚本解析回来", () => {
    const records = [buildRecord({ recordId: "record-002" }), buildRecord()];
    const parsed: unknown = JSON.parse(
      formatSpecHistory(records, { json: true }),
    );
    expect(parsed).toEqual(records);
  });

  it("--json 为空时输出空数组而不是中文提示", () => {
    expect(formatSpecHistory([], { json: true })).toBe("[]");
  });
});

/**
 * 来源选择界面里两条**判定**的回归锁：新 deck 的落点推导、付费门槛的次数与文案。
 *
 * 本项目没有 DOM 测试库，规则一律测在纯函数产物上（见 quality-guidelines.md）。
 * 表单渲染不测，但「落点算错会把 deck 建到别处」「门槛不写次数等于没有门槛」
 * 这两件事必须锁住。
 */

import type { ContentSpec } from "@ppt-maker/core";
import { describe, expect, it } from "vitest";
import {
  buildGenerateConfirm,
  generationCallCount,
  specEntryTitle,
  summarizeSpec,
} from "../src/renderer/lib/source-picker-core.js";
import {
  workspacePathForFile,
  workspacePathForImages,
} from "../src/renderer/lib/workspace-switch-core.js";

const ISO = "2026-08-01";

describe("新 deck 的落点", () => {
  it("文件来源：同级、去掉扩展名、带日期后缀", () => {
    expect(workspacePathForFile("/Users/k/test/b2-export.pdf", ISO)).toBe(
      "/Users/k/test/b2-export-2026-08-01",
    );
    expect(workspacePathForFile("/Users/k/test/content-spec.json", ISO)).toBe(
      "/Users/k/test/content-spec-2026-08-01",
    );
  });

  it("多个点只截最后一段扩展名", () => {
    expect(workspacePathForFile("/x/deck.v1.2.pdf", ISO)).toBe(
      "/x/deck.v1.2-2026-08-01",
    );
  });

  /** 隐藏文件的首字符点是名字的一部分，截掉会得到一个空目录名 */
  it("首字符的点不当扩展名", () => {
    expect(workspacePathForFile("/x/.spec", ISO)).toBe("/x/.spec-2026-08-01");
  });

  /**
   * 目录名里的点是名字的一部分，文件名里的点是扩展名分隔符——两条规则必须分开，
   * 合成一个开关迟早把 `~/decks/v1.2` 截成 `v1`。
   */
  it("目录来源保留名字里的点", () => {
    expect(workspacePathForImages("/x/decks/v1.2", ISO)).toBe(
      "/x/decks/v1.2-2026-08-01",
    );
  });
});

function spec(entries: ContentSpec["entries"]): ContentSpec {
  return {
    schemaVersion: 1,
    specId: "spec-1",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    style: { description: "克制的深色科技风" },
    entries,
  };
}

describe("规格初稿预览", () => {
  it("标题取第一组的第一条文字", () => {
    const entry = {
      specEntryId: "e1",
      pageType: "cover",
      textGroups: [
        { label: "主标题", items: ["下一代校样台"] },
        { label: "副标题", items: ["2026 路线图"] },
      ],
      visualIntent: "居中大标题",
      revisionNotes: [],
    };
    expect(specEntryTitle(entry)).toBe("下一代校样台");
  });

  /**
   * 逐级兜底到分组标签与页型，**不返回空串**：初稿预览里出现一行空条目时，
   * 用户无从判断该不该为它付一次图像生成的钱。
   */
  it("没有可用文字时退到分组标签，再退到页型", () => {
    const base = {
      specEntryId: "e2",
      pageType: "transition",
      visualIntent: "",
      revisionNotes: [],
    };
    expect(
      specEntryTitle({ ...base, textGroups: [{ label: "过渡页", items: [] }] }),
    ).toBe("过渡页");
    expect(specEntryTitle({ ...base, textGroups: [] })).toBe("transition");
  });

  it("摘要逐条给出 id、页型与标题", () => {
    const summary = summarizeSpec(
      spec([
        {
          specEntryId: "e1",
          pageType: "cover",
          textGroups: [{ label: "标题", items: ["封面"] }],
          visualIntent: "",
          revisionNotes: [],
        },
        {
          specEntryId: "e2",
          pageType: "content",
          textGroups: [{ label: "要点", items: ["第一点", "第二点"] }],
          visualIntent: "",
          revisionNotes: [],
        },
      ]),
    );
    expect(summary).toEqual([
      { specEntryId: "e1", pageType: "cover", title: "封面" },
      { specEntryId: "e2", pageType: "content", title: "第一点" },
    ]);
  });
});

describe("批量生成的付费门槛", () => {
  it("调用次数即条目数", () => {
    expect(
      generationCallCount(
        spec([
          {
            specEntryId: "e1",
            pageType: "cover",
            textGroups: [],
            visualIntent: "",
            revisionNotes: [],
          },
          {
            specEntryId: "e2",
            pageType: "content",
            textGroups: [],
            visualIntent: "",
            revisionNotes: [],
          },
        ]),
      ),
    ).toBe(2);
  });

  /** 门槛的价值在于说清代价：次数与不可撤销都必须出现在原生框里 */
  it("写明条目数与不可撤销", () => {
    const options = buildGenerateConfirm(6);
    expect(options.message).toContain("6");
    expect(options.detail).toContain("不可撤销");
    expect(options.confirmLabel).toContain("6");
  });

  /**
   * 次数一律是**上限**：CLI 会与 deck 既有页对账跳过已生成的条目，而「新建」也
   * 可能落到同一天建过的同一个目录上。写成确切的 N 是多报——门槛的价值在于说
   * 真话，多报与少报都不行。
   */
  it("次数写成上限，并说明为什么可能更少", () => {
    const options = buildGenerateConfirm(6);
    expect(options.message).toContain("最多 6 次");
    expect(options.detail).toContain("跳过");
    expect(options.confirmLabel).toContain("最多");
  });
});

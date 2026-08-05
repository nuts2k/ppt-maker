/**
 * 策划页「待建页」一档的规则锁。
 *
 * 本仓没有 DOM 测试库，渲染层的规则一律测在纯函数产物上；两条无法收进纯函数的
 * 约束（「用 saved 不用草稿」「建完不跳转」）改为静态断言 PlanningPage.tsx 的源码，
 * 并各配一条**正对照**——只断言「不含某串」的用例在提取失败时会假通过。
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ContentSpec } from "@ppt-maker/core";
import { describe, expect, it, vi } from "vitest";
import type {
  SlideDetail,
  SourceTaskRequest,
  SourceTaskResult,
} from "../src/main/ipc/channels.js";
import {
  classifyPendingEntries,
  createPagesFlow,
  hasSpecImpact,
  resolveCreatePagesAction,
  selectedPendingEntryIds,
  specActionBlockedReason,
  specImpactEmptyCopy,
  summarizeCreatePages,
} from "../src/renderer/lib/planning-core.js";

function makeEntry(specEntryId: string): ContentSpec["entries"][number] {
  return {
    specEntryId,
    pageType: "cover",
    textGroups: [{ label: "标题", items: [`${specEntryId} 的标题`] }],
    visualIntent: "居中大标题",
    revisionNotes: [],
  };
}

function makeSpec(entryIds: readonly string[]): ContentSpec {
  return {
    schemaVersion: 1,
    specId: "spec-1",
    createdAt: "2026-08-04T00:00:00.000Z",
    updatedAt: "2026-08-04T00:00:00.000Z",
    style: { description: "克制的编辑部校样风" },
    entries: entryIds.map(makeEntry),
  };
}

function makeSlide(specEntryId: string): SlideDetail {
  return {
    slideId: `slide-${specEntryId}`,
    workspacePath: `slides/${specEntryId}`,
    absWorkspacePath: `/decks/demo/slides/${specEntryId}`,
    pageLabel: specEntryId,
    sourceImageName: "page.png",
    currentStage: "report",
    stageStatus: "completed",
    removed: false,
    sourceKind: "generated",
    hasExtractableText: null,
    sourceAcceptance: "manual",
    specEntryId,
    regenerableSpecEntryId: specEntryId,
    specDrift: "in-sync",
    stages: [],
    lastError: null,
    stageDurations: {},
    pendingTextReview: 0,
  };
}

const ACCEPTED: SourceTaskResult = {
  accepted: true,
  message: "建立 1 页，失败 0 页，跳过 0 页",
  deckPath: "/decks/demo",
  deckCreated: false,
  created: 1,
  failed: 0,
  skipped: 0,
  report: null,
  reportPath: null,
  regenerated: null,
};

describe("规格影响面板的渲染条件", () => {
  /*
   * 放宽前的判据只看过时与失联，于是零页 deck（待建 N 条、另两类皆空）
   * 看到的是一句「当前没有已过时或失联页面」——最该出现建页入口的那一刻。
   */
  it("三类任一非空即渲染，全空才是空态", () => {
    expect(hasSpecImpact({ pending: 0, drifted: 0, missing: 0 })).toBe(false);
    expect(hasSpecImpact({ pending: 6, drifted: 0, missing: 0 })).toBe(true);
    expect(hasSpecImpact({ pending: 0, drifted: 1, missing: 0 })).toBe(true);
    expect(hasSpecImpact({ pending: 0, drifted: 0, missing: 1 })).toBe(true);
  });

  /*
   * 三类都算在 `saved` 上，而编辑器显示的是 `draft ?? saved`。有草稿时草稿里新加的
   * 条目一条都不在待建页里，此时照说「规格里的每个条目都已建成页面」，用户正看着
   * 编辑器里那条没建的条目——界面在说假话，且这一档没有任何按钮可以解释。
   */
  it("有未保存草稿时，空态不得宣称「每个条目都已建成页面」", () => {
    expect(specImpactEmptyCopy(false)).toBe(
      "规格里的每个条目都已建成页面，也没有已过时或失联页面。",
    );

    const dirtyCopy = specImpactEmptyCopy(true);
    expect(dirtyCopy).not.toBe(specImpactEmptyCopy(false));
    // 必须点明这句只讲已保存的那份，并告诉用户草稿要先保存
    expect(dirtyCopy).toContain("已保存的规格");
    expect(dirtyCopy).toContain("先保存");
  });
});

describe("建页按钮", () => {
  it("按钮上的数字跟着勾选数走", () => {
    const of = (selectedCount: number): string =>
      resolveCreatePagesAction({ selectedCount, dirty: false, running: false })
        .label;
    expect(of(6)).toBe("建立所选 6 页");
    expect(of(1)).toBe("建立所选 1 页");
    expect(of(0)).toBe("建立所选 0 页");
  });

  /*
   * `entryIds` 的省略与 `[]` 在 CLI 侧语义不同：省略＝建全部待建条目，
   * `[]` 会被 `SPEC_SELECTION_EMPTY` 整体拒绝。界面必须在这里就挡住，
   * 否则用户只是没勾任何东西，却收到一条看不懂的报错。
   */
  it("一条都没勾时禁用，但不给多余的理由", () => {
    const action = resolveCreatePagesAction({
      selectedCount: 0,
      dirty: false,
      running: false,
    });
    expect(action.disabled).toBe(true);
    expect(action.title).toBeNull();
  });

  it("两档的禁用理由同源，只差一个动作词", () => {
    const params = { dirty: true, running: false } as const;
    expect(specActionBlockedReason({ ...params, verb: "建页" })).toBe(
      "请先保存规格，再按磁盘现值建页",
    );
    expect(specActionBlockedReason({ ...params, verb: "重生成" })).toBe(
      "请先保存规格，再按磁盘现值重生成",
    );
    // 任务占用这一句两档完全一致，不带动作词
    expect(
      specActionBlockedReason({ dirty: false, running: true, verb: "建页" }),
    ).toBe("已有建页任务正在执行");
    expect(
      specActionBlockedReason({ dirty: false, running: true, verb: "重生成" }),
    ).toBe("已有建页任务正在执行");
    // 建页按钮的 title 必须来自这里，而不是自己再写一份
    expect(
      resolveCreatePagesAction({ selectedCount: 1, ...params }).title,
    ).toBe(specActionBlockedReason({ ...params, verb: "建页" }));
  });

  it("PlanningPage 的重生成按钮也用同一个判据", () => {
    expect(planningSource()).toContain('verb: "重生成"');
    // 正对照：旧的就地拼写已经不在文件里，否则上面那条断言可以与它并存
    expect(planningSource()).not.toContain(
      '? "请先保存规格，再按磁盘现值重生成"',
    );
  });

  it("有未保存草稿时禁用并说明原因", () => {
    const action = resolveCreatePagesAction({
      selectedCount: 3,
      dirty: true,
      running: false,
    });
    expect(action.disabled).toBe(true);
    expect(action.title).toBe("请先保存规格，再按磁盘现值建页");
  });

  it("任务执行中时禁用，措辞与重生成那档同口径", () => {
    const action = resolveCreatePagesAction({
      selectedCount: 3,
      dirty: false,
      running: true,
    });
    expect(action.disabled).toBe(true);
    expect(action.title).toBe("已有建页任务正在执行");
  });

  it("可点时不给 title", () => {
    expect(
      resolveCreatePagesAction({
        selectedCount: 2,
        dirty: false,
        running: false,
      }),
    ).toEqual({ label: "建立所选 2 页", disabled: false, title: null });
  });
});

describe("勾选集合", () => {
  it("只取勾中的条目并保持规格顺序", () => {
    const pending = [
      { specEntryId: "e1" },
      { specEntryId: "e2" },
      { specEntryId: "e3" },
    ];
    expect(selectedPendingEntryIds(pending, new Set(["e3", "e1"]))).toEqual([
      "e1",
      "e3",
    ]);
    expect(selectedPendingEntryIds(pending, new Set(["e2"]))).toEqual(["e2"]);
    expect(selectedPendingEntryIds(pending, new Set())).toEqual([]);
  });
});

describe("建页编排", () => {
  function deps(confirmed: boolean): {
    confirm: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    requests: SourceTaskRequest[];
  } {
    const requests: SourceTaskRequest[] = [];
    return {
      confirm: vi.fn(async () => confirmed),
      start: vi.fn(async (request: SourceTaskRequest) => {
        requests.push(request);
        return ACCEPTED;
      }),
      requests,
    };
  }

  /*
   * 勾一条就只建一条。这条失效时界面看起来完全正常——确认框写着 1 次，
   * 实际却按全量跑，用户只在账单和页面网格里发现多出来的页。
   */
  it("只勾一条时请求里就只有那一条，且不带 specPath", async () => {
    const d = deps(true);
    const result = await createPagesFlow(d, ["entry-003"]);

    expect(result).toBe(ACCEPTED);
    expect(d.requests).toEqual([{ kind: "generate", entryIds: ["entry-003"] }]);
    const request = d.requests[0];
    expect(request && "specPath" in request).toBe(false);
  });

  it("付费确认写明确切次数，取消则一次都不发起", async () => {
    const d = deps(false);
    const result = await createPagesFlow(d, ["e1", "e2"]);

    expect(result).toBeNull();
    expect(d.start).not.toHaveBeenCalled();
    const options = d.confirm.mock.calls[0]?.[0] as { message: string };
    expect(options.message).toBe("将调用 2 次图像生成");
  });

  /*
   * 按钮禁用之外的第二道：即便被绕过（键盘、将来某个新入口），也绝不把空数组
   * 发下去——CLI 收到 `[]` 会抛 `SPEC_SELECTION_EMPTY`，而省略才是「建全部」。
   */
  it("一条都没勾时连确认框都不弹，更不会发一个空数组", async () => {
    const d = deps(true);
    expect(await createPagesFlow(d, [])).toBeNull();
    expect(d.confirm).not.toHaveBeenCalled();
    expect(d.start).not.toHaveBeenCalled();
    expect(d.requests).toEqual([]);
  });
});

describe("建页完成提示", () => {
  /*
   * 走查实测的形态（2026-08-04）：零页 deck、规格 4 条、用户手动取消 3 条只留 1 条。
   * CLI 的 `skipped` 是 3，旧实现照着它说「被跳过的条目此前已经建过页」——那 3 条
   * 一次都没建过，是用户自己刚取消的，同一屏的待建页一档正说着「待建页 3 条」。
   * 默认全选时 `skipped` 恒为 0，这条永远看不出来。
   */
  it("用户取消勾选造成的跳过，不得被说成「已经建过页」", () => {
    const summary = summarizeCreatePages({
      requested: 1,
      created: 1,
      failed: 0,
    });

    expect(summary.alreadyBuilt).toBe(0);
    const text = summary.notes.join("");
    expect(text).not.toContain("已经建过页");
    expect(text).not.toContain("跳过");
    // 该说的还得说：建出来的页仍要逐张确认源图
    expect(text).toContain("逐张确认源图");
  });

  /*
   * 反向对照：勾了 3 条，其中 1 条在发起前已被别处建掉（created 2 / failed 0）。
   * 这才是真正的「此前已经建过页」，必须说得清——只压住上一条会把它一起压没。
   */
  it("勾了却没被执行的条目，仍然如实报出", () => {
    const summary = summarizeCreatePages({
      requested: 3,
      created: 2,
      failed: 0,
    });

    expect(summary.alreadyBuilt).toBe(1);
    expect(summary.notes.join("")).toContain("1 条在发起前已经建出页面");
  });

  it("失败如实报出，且不把用户指向一个没有逐条原因的地方", () => {
    const summary = summarizeCreatePages({
      requested: 3,
      created: 1,
      failed: 2,
    });

    expect(summary.failed).toBe(2);
    // requested 全部有着落（1 建成 + 2 失败），不该再多报一个「已建过」
    expect(summary.alreadyBuilt).toBe(0);
    const text = summary.notes.join("");
    expect(text).toContain("仍留在待建页");
    /*
     * 活动日志里只有一条汇总记录（`source-task-runner` 的 `record` 写 `result.message`），
     * 逐条失败原因只在执行期间的进度事件里闪过。指过去用户什么也找不到。
     */
    expect(text).not.toContain("活动日志");
  });

  it("三个数不一致时钳到 0，不报负数", () => {
    expect(
      summarizeCreatePages({ requested: 1, created: 2, failed: 0 })
        .alreadyBuilt,
    ).toBe(0);
  });
});

describe("待建条目取磁盘现值", () => {
  /*
   * 草稿里新加的条目在磁盘上并不存在。用草稿算会让「待建 N 条」大于实际会建出的
   * 页数，而付费确认框写的正是这个 N。这条用例证明两者**确实不同**——不同才谈得上
   * 选错一个会出事。
   */
  it("草稿里的新条目不算待建，磁盘现值才算", () => {
    const saved = makeSpec(["e1", "e2"]);
    const draft = makeSpec(["e1", "e2", "e3-仅在草稿里"]);
    // e1 已经建成页，因此磁盘现值下只剩 e2 待建
    const slides = [makeSlide("e1")];

    expect(
      classifyPendingEntries(saved, slides).map((e) => e.specEntryId),
    ).toEqual(["e2"]);
    expect(
      classifyPendingEntries(draft, slides).map((e) => e.specEntryId),
    ).toEqual(["e2", "e3-仅在草稿里"]);
  });

  it("PlanningPage 用 saved 而不是 editable 算待建条目", () => {
    expect(planningSource()).toContain("pendingEntrySummaries(saved, slides)");
    // 正对照：editable 这个变量确实存在于本文件，上面那条才不是在断言一个笔误
    expect(planningSource()).toContain("const editable = draft ?? saved;");
    /*
     * 反向锁：正向锁只证明「这一处调用在」，挡不住有人**另加**一处按草稿算的调用——
     * 那时两条断言可以并存，而界面上的「待建 N 条」已经由后者说了算。
     */
    expect(planningSource()).not.toContain("pendingEntrySummaries(editable");
    expect(planningSource()).not.toContain("pendingEntrySummaries(draft");
  });
});

describe("建完不离开策划页", () => {
  it("handleCreatePages 不做任何视图切换，而 handleRegenerate 会", () => {
    const create = extractFunction("handleCreatePages");
    const regenerate = extractFunction("handleRegenerate");

    // 正对照：证明提取真的拿到了函数体，否则「不含某串」在空串上恒真
    expect(regenerate).toContain("backToConsole()");
    expect(regenerate).toContain("resetPlanning()");

    /*
     * `extractFunction` 切到第一个两格缩进的 `}` 为止。若将来函数体里出现同样缩进的
     * 收尾（嵌套函数、被格式化拆开的块），提取会**静默截断**，下面两条「不含」在半截
     * 函数体上照样全绿。因此先钉住它确实读到了最后一句。
     */
    expect(create).toContain("startSourceTask");
    expect(create).toContain("failed: result.failed,"); // 函数体最后一行
    expect(create).not.toContain("backToConsole");
    expect(create).not.toContain("resetPlanning");
  });
});

function planningSource(): string {
  return readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "../src/renderer/pages/PlanningPage.tsx",
    ),
    "utf8",
  );
}

/** 取组件内某个顶层 async 函数的函数体（缩进两格，故以 `\n  }` 收尾） */
function extractFunction(name: string): string {
  const source = planningSource();
  const start = source.indexOf(`async function ${name}(`);
  if (start === -1) throw new Error(`PlanningPage.tsx 里找不到 ${name}`);
  const end = source.indexOf("\n  }", start);
  if (end === -1) throw new Error(`${name} 的函数体没有收尾`);
  return source.slice(start, end);
}

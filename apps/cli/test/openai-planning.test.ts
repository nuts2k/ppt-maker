import type { ContentSpec } from "@ppt-maker/core";
import { describe, expect, it, vi } from "vitest";
import {
  askPlanningQuestion,
  buildPlanningQuestionRequest,
  buildPlanningSpecDraftRequest,
  buildSpecChangeProposalRequest,
  draftPlanningSpec,
  OPENAI_PLANNING_MODEL,
  proposeSpecChange,
  type SpecChangeProposalRequest,
} from "../src/providers/openai-planning.js";

const NOW = "2026-08-04T00:00:00.000Z";

const CURRENT_SPEC: ContentSpec = {
  schemaVersion: 1,
  specId: "spec-001",
  createdAt: NOW,
  updatedAt: NOW,
  style: { description: "黑白校样风格" },
  entries: [
    {
      specEntryId: "entry-001",
      pageType: "cover",
      textGroups: [{ label: "标题", items: ["相邻页唯一标题"] }],
      visualIntent: "相邻页不可泄漏的视觉意图",
      revisionNotes: [],
    },
    {
      specEntryId: "entry-002",
      pageType: "content",
      textGroups: [{ label: "标题", items: ["目标页标题"] }],
      visualIntent: "目标页唯一视觉意图",
      revisionNotes: ["减少文字"],
    },
    {
      specEntryId: "entry-003",
      pageType: "summary",
      textGroups: [{ label: "正文", items: ["另一相邻页标题"] }],
      visualIntent: "另一相邻页不可泄漏的视觉意图",
      revisionNotes: [],
    },
  ],
};

const QUESTION_OUTPUT = {
  reply: "我已理解这是一次内部评审。",
  dimensions: {
    audience: "resolved",
    scenario: "resolved",
    length: "open",
    structure: "open",
    style: "not_applicable",
  },
  nextQuestion: "预计控制在多少页？",
  canDraft: false,
};

const DRAFT_OUTPUT = {
  style: { description: "留白充足的编辑部校样风" },
  entries: [
    {
      pageType: "cover",
      textGroups: [{ label: "标题", items: ["季度复盘"] }],
      visualIntent: "标题左对齐，使用细线分隔",
    },
  ],
};

const PROPOSAL_OUTPUT = {
  reply: "建议压缩目标页并强化层级。",
  styleProposal: null,
  entryProposals: [
    {
      specEntryId: "entry-002",
      remove: false,
      pageType: "content",
      textGroups: [{ label: "标题", items: ["目标页标题"] }],
      visualIntent: "左文右图，缩短正文",
      revisionNotes: ["减少文字"],
    },
  ],
};

function promptOf(request: SpecChangeProposalRequest): string {
  const content = request.input[0]?.content;
  if (typeof content !== "string") {
    throw new Error("测试请求缺少文本提示词");
  }
  return content;
}

describe("OpenAI 策划 Provider", () => {
  it("策划提问使用独立 Structured Output，并把网关空 requestId 归一为 null", async () => {
    const parser = vi.fn(async (request) => ({
      id: "   ",
      model: OPENAI_PLANNING_MODEL,
      outputParsed: QUESTION_OUTPUT,
      usage: { input_tokens: 80, output_tokens: 40 },
      request,
    }));

    const analysis = await askPlanningQuestion({
      history: [{ role: "user", content: "给管理层做季度复盘" }],
      userText: "控制在十分钟内",
      materialsContext: "材料：第三季度毛利率改善",
      parseResponse: parser,
    });

    expect(parser).toHaveBeenCalledTimes(1);
    expect(analysis.request.store).toBe(false);
    expect(analysis.request.model).toBe(OPENAI_PLANNING_MODEL);
    expect(analysis.request.text.format.name).toBe("planning_question_output");
    expect(analysis.requestId).toBeNull();
    expect(analysis.provider).toBe("openai");
    expect(analysis.result).toEqual(QUESTION_OUTPUT);
    expect(analysis.request.input[0]?.content).toContain("第三季度毛利率改善");
    expect(analysis.request.input[0]?.content).toContain("控制在十分钟内");
  });

  it("多轮上下文初稿复用 ContentSpecDraftSchema，但不调用既有单轮入口", async () => {
    const parser = vi.fn(async () => ({
      id: "resp_draft",
      model: OPENAI_PLANNING_MODEL,
      outputParsed: DRAFT_OUTPUT,
      usage: null,
    }));

    const analysis = await draftPlanningSpec({
      history: [
        { role: "user", content: "做季度复盘" },
        { role: "assistant", content: "受众是谁？" },
        { role: "user", content: "管理层" },
      ],
      materialsContext: "材料：只使用已经确认的数据",
      parseResponse: parser,
    });

    expect(parser).toHaveBeenCalledTimes(1);
    expect(analysis.request.store).toBe(false);
    expect(analysis.request.text.format.name).toBe(
      "planning_content_spec_draft",
    );
    expect(analysis.request.input[0]?.content).toContain("受众是谁？");
    expect(analysis.request.input[0]?.content).toContain("已经确认的数据");
    expect(analysis.result).toEqual(DRAFT_OUTPUT);
  });

  it("单条目请求只暴露目标完整条目与相邻标题", async () => {
    let captured: SpecChangeProposalRequest | undefined;
    await proposeSpecChange({
      instruction: "把第二页压缩成三条",
      currentSpec: CURRENT_SPEC,
      scope: { kind: "entry", targetSpecEntryId: "entry-002" },
      materialsContext: "内部材料",
      parseResponse: async (request) => {
        captured = request;
        return {
          id: "resp_entry",
          model: OPENAI_PLANNING_MODEL,
          outputParsed: PROPOSAL_OUTPUT,
          usage: {},
        };
      },
    });

    if (captured === undefined) {
      throw new Error("Provider 未收到规格提案请求");
    }
    const prompt = promptOf(captured);
    expect(prompt).toContain("styleProposal 必须为 null");
    expect(prompt).toContain('"currentStyle"');
    expect(prompt).not.toContain('"editableStyle"');
    expect(prompt).toContain("目标页唯一视觉意图");
    expect(prompt).toContain("相邻页唯一标题");
    expect(prompt).toContain("另一相邻页标题");
    expect(prompt).not.toContain("相邻页不可泄漏的视觉意图");
    expect(prompt).not.toContain("另一相邻页不可泄漏的视觉意图");
  });

  it("全 deck 改稿恒为一次 Responses 请求并携带完整规格", async () => {
    const parser = vi.fn(async () => ({
      id: "resp_deck",
      model: OPENAI_PLANNING_MODEL,
      outputParsed: PROPOSAL_OUTPUT,
      usage: { input_tokens: 200 },
    }));

    const analysis = await proposeSpecChange({
      instruction: "统一压缩全 deck",
      currentSpec: CURRENT_SPEC,
      scope: { kind: "deck" },
      materialsContext: "长期材料",
      parseResponse: parser,
    });

    expect(parser).toHaveBeenCalledTimes(1);
    expect(analysis.request.store).toBe(false);
    expect(analysis.request.text.format.name).toBe("planning_spec_proposal");
    expect(promptOf(analysis.request)).toContain("entry-001");
    expect(promptOf(analysis.request)).toContain("entry-003");
    expect(analysis.result).toEqual(PROPOSAL_OUTPUT);
  });

  it("三个模型面 schema 彼此独立且不含 Structured Outputs 不支持的约束", () => {
    const question = buildPlanningQuestionRequest({
      history: [],
      userText: "先聊聊",
      materialsContext: "",
    });
    const draft = buildPlanningSpecDraftRequest({
      history: [],
      materialsContext: "",
    });
    const proposal = buildSpecChangeProposalRequest({
      instruction: "修改",
      currentSpec: CURRENT_SPEC,
      scope: { kind: "deck" },
      materialsContext: "",
    });

    expect([
      question.text.format.name,
      draft.text.format.name,
      proposal.text.format.name,
    ]).toEqual([
      "planning_question_output",
      "planning_content_spec_draft",
      "planning_spec_proposal",
    ]);
    for (const request of [question, draft, proposal]) {
      const schema = JSON.stringify(request.text.format);
      expect(schema).not.toContain("minLength");
      expect(schema).not.toContain("minItems");
      expect(schema).not.toContain("refine");
    }
  });

  it("refusal、空解析或错误 schema 都统一拒绝", async () => {
    const invalidResponse = async () => ({
      id: null,
      model: OPENAI_PLANNING_MODEL,
      outputParsed: null,
      usage: null,
    });

    await expect(
      askPlanningQuestion({
        history: [],
        userText: "继续",
        materialsContext: "",
        parseResponse: invalidResponse,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    await expect(
      draftPlanningSpec({
        history: [],
        materialsContext: "",
        parseResponse: invalidResponse,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    await expect(
      proposeSpecChange({
        instruction: "修改",
        currentSpec: CURRENT_SPEC,
        scope: { kind: "deck" },
        materialsContext: "",
        parseResponse: invalidResponse,
      }),
    ).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  it("单条目目标不存在时在调用 Provider 前拒绝", async () => {
    const parser = vi.fn(async () => ({
      id: "should-not-run",
      model: OPENAI_PLANNING_MODEL,
      outputParsed: PROPOSAL_OUTPUT,
      usage: null,
    }));
    await expect(
      proposeSpecChange({
        instruction: "修改",
        currentSpec: CURRENT_SPEC,
        scope: { kind: "entry", targetSpecEntryId: "entry-404" },
        materialsContext: "",
        parseResponse: parser,
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(parser).not.toHaveBeenCalled();
  });
});

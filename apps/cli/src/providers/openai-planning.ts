import {
  type ContentSpec,
  type ContentSpecDraft,
  ContentSpecDraftSchema,
  FoundationError,
  type PlanningChangeScope,
  type PlanningQuestionOutput,
  PlanningQuestionOutputSchema,
  type SpecProposal,
  SpecProposalSchema,
} from "@ppt-maker/core";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";

export const OPENAI_PLANNING_PROVIDER = "openai" as const;
export const OPENAI_PLANNING_MODEL = "gpt-5.6-luna";
export const PLANNING_QUESTION_PROMPT_VERSION = "m6-planning-question-v1";
export const PLANNING_SPEC_DRAFT_PROMPT_VERSION = "m6-planning-spec-draft-v1";
export const SPEC_CHANGE_PROPOSAL_PROMPT_VERSION = "m6-spec-change-proposal-v1";

export interface PlanningPromptMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface OpenAiPlanningResponse {
  /** 第三方网关可能不返回 request id，此时必须保持 null。 */
  readonly id: string | null;
  readonly model: string;
  readonly outputParsed: unknown;
  readonly usage: unknown;
}

export interface OpenAiPlanningAnalysis<TRequest, TResult> {
  readonly request: TRequest;
  readonly provider: typeof OPENAI_PLANNING_PROVIDER;
  readonly requestId: string | null;
  readonly model: string;
  readonly usage: unknown;
  readonly result: TResult;
}

function formatConversation(history: readonly PlanningPromptMessage[]): string {
  if (history.length === 0) {
    return "（尚无历史消息）";
  }
  return history
    .map(
      (message, index) =>
        `${index + 1}. ${message.role === "user" ? "用户" : "策划助手"}：${message.content}`,
    )
    .join("\n");
}

function formatMaterialsContext(materialsContext: string): string {
  return materialsContext.trim().length === 0
    ? "（未提供背景材料）"
    : materialsContext;
}

function buildPlanningQuestionPrompt(input: {
  readonly history: readonly PlanningPromptMessage[];
  readonly userText: string;
  readonly materialsContext: string;
}): string {
  return [
    "你是演示文稿内容策划助手。结合完整对话与 deck 的长期背景材料，回应用户，并用一个最有价值的问题继续收敛需求。",
    "必须完整判断五个维度：audience（受众）、scenario（使用场景）、length（篇幅）、structure（结构）、style（风格）。每项只能是 open、resolved 或 not_applicable。",
    "nextQuestion 只放下一条问题；若无需继续提问则为 null。canDraft 表示现有信息是否足以形成可执行初稿，即使仍有次要维度 open 也可为 true。",
    "不要生成规格或 JSON 补丁，不要杜撰用户未提供的事实。reply 用中文，简洁说明本轮理解与仍需补充之处。",
    `提示词版本：${PLANNING_QUESTION_PROMPT_VERSION}`,
    "\n【既有对话】",
    formatConversation(input.history),
    "\n【deck 背景材料】",
    formatMaterialsContext(input.materialsContext),
    "\n【用户本轮消息】",
    input.userText,
  ].join("\n");
}

export function buildPlanningQuestionRequest(input: {
  readonly history: readonly PlanningPromptMessage[];
  readonly userText: string;
  readonly materialsContext: string;
}) {
  return {
    model: OPENAI_PLANNING_MODEL,
    store: false,
    input: [
      {
        role: "user" as const,
        content: buildPlanningQuestionPrompt(input),
      },
    ],
    text: {
      format: zodTextFormat(
        PlanningQuestionOutputSchema,
        "planning_question_output",
      ),
    },
  };
}

export type PlanningQuestionRequest = ReturnType<
  typeof buildPlanningQuestionRequest
>;
export type OpenAiPlanningQuestionParser = (
  request: PlanningQuestionRequest,
) => Promise<OpenAiPlanningResponse>;

function buildPlanningSpecDraftPrompt(input: {
  readonly history: readonly PlanningPromptMessage[];
  readonly materialsContext: string;
}): string {
  return [
    "你是演示文稿内容策划助手。用户决定按现有信息出初稿；请把完整对话和 deck 背景材料收敛为一份 16:9 演示文稿内容规格初稿。",
    "输出一段可执行的 style.description，并按内容自行分页。每页只输出 pageType、textGroups 与 visualIntent。",
    "textGroups 是页面上真实出现的文字：label 表示角色，items 是逐条文字；每条文字只能出现一次且不得包含换行。",
    "visualIntent 只描述版式与视觉呈现，不得重复页面文字。忠于已有信息，不得杜撰数据、机构名或结论。",
    "不要输出 specId、specEntryId、时间戳或 revisionNotes，这些字段由代码分配。",
    `提示词版本：${PLANNING_SPEC_DRAFT_PROMPT_VERSION}`,
    "\n【完整对话】",
    formatConversation(input.history),
    "\n【deck 背景材料】",
    formatMaterialsContext(input.materialsContext),
  ].join("\n");
}

export function buildPlanningSpecDraftRequest(input: {
  readonly history: readonly PlanningPromptMessage[];
  readonly materialsContext: string;
}) {
  return {
    model: OPENAI_PLANNING_MODEL,
    store: false,
    input: [
      {
        role: "user" as const,
        content: buildPlanningSpecDraftPrompt(input),
      },
    ],
    text: {
      format: zodTextFormat(
        ContentSpecDraftSchema,
        "planning_content_spec_draft",
      ),
    },
  };
}

export type PlanningSpecDraftRequest = ReturnType<
  typeof buildPlanningSpecDraftRequest
>;
export type OpenAiPlanningSpecDraftParser = (
  request: PlanningSpecDraftRequest,
) => Promise<OpenAiPlanningResponse>;

function entryTitle(entry: ContentSpec["entries"][number]): string | null {
  return entry.textGroups[0]?.items[0] ?? null;
}

function buildEditableSpecContext(
  currentSpec: ContentSpec,
  scope: PlanningChangeScope,
): unknown {
  if (scope.kind === "deck") {
    return {
      scope: "deck",
      editableStyle: currentSpec.style,
      editableEntries: currentSpec.entries,
    };
  }

  const targetIndex = currentSpec.entries.findIndex(
    (entry) => entry.specEntryId === scope.targetSpecEntryId,
  );
  if (targetIndex < 0) {
    throw new FoundationError(
      "INVALID_INPUT",
      `规格中不存在目标条目：${scope.targetSpecEntryId}`,
      { targetSpecEntryId: scope.targetSpecEntryId },
    );
  }
  const target = currentSpec.entries[targetIndex];
  if (target === undefined) {
    throw new FoundationError(
      "INVALID_INPUT",
      `规格中不存在目标条目：${scope.targetSpecEntryId}`,
      { targetSpecEntryId: scope.targetSpecEntryId },
    );
  }
  return {
    scope: "entry",
    currentStyle: currentSpec.style,
    editableEntry: target,
    adjacentTitles: currentSpec.entries
      .slice(Math.max(0, targetIndex - 1), targetIndex + 2)
      .filter((entry) => entry.specEntryId !== target.specEntryId)
      .map((entry) => ({
        specEntryId: entry.specEntryId,
        pageType: entry.pageType,
        title: entryTitle(entry),
      })),
  };
}

function buildSpecChangeProposalPrompt(input: {
  readonly instruction: string;
  readonly currentSpec: ContentSpec;
  readonly scope: PlanningChangeScope;
  readonly materialsContext: string;
}): string {
  const scopeInstruction =
    input.scope.kind === "entry"
      ? [
          `本轮只允许改动条目 ${input.scope.targetSpecEntryId}。`,
          "entryProposals 必须只包含该条目的一份完整替换提案；不得改动或返回相邻条目。",
          "deck style 仅作为只读背景，styleProposal 必须为 null。",
        ].join(" ")
      : [
          "本轮是全 deck 原子改稿。",
          "一次返回所有需要新增、替换或删除的完整条目提案；不要把工作拆成后续调用。",
        ].join(" ");

  return [
    "你是演示文稿内容规格的改稿助手。你只能提出可审阅提案，不能声称已经保存或直接落盘。",
    scopeInstruction,
    "entryProposals 中每项都是完整条目而不是 patch。现有条目沿用给出的 specEntryId；新增条目的 specEntryId 留空字符串；remove=true 表示删除，此时其余条目字段仍按 Schema 返回。",
    "styleProposal 只在确实需要调整整份 deck 风格时给出完整新描述，否则为 null。reply 用中文概括修改理由。",
    "不得编造未知的非空 id。用户未要求的内容保持不变。",
    `提示词版本：${SPEC_CHANGE_PROPOSAL_PROMPT_VERSION}`,
    "\n【用户改稿指令】",
    input.instruction,
    "\n【可编辑规格上下文】",
    JSON.stringify(buildEditableSpecContext(input.currentSpec, input.scope)),
    "\n【deck 背景材料】",
    formatMaterialsContext(input.materialsContext),
  ].join("\n");
}

export function buildSpecChangeProposalRequest(input: {
  readonly instruction: string;
  readonly currentSpec: ContentSpec;
  readonly scope: PlanningChangeScope;
  readonly materialsContext: string;
}) {
  return {
    model: OPENAI_PLANNING_MODEL,
    store: false,
    input: [
      {
        role: "user" as const,
        content: buildSpecChangeProposalPrompt(input),
      },
    ],
    text: {
      format: zodTextFormat(SpecProposalSchema, "planning_spec_proposal"),
    },
  };
}

export type SpecChangeProposalRequest = ReturnType<
  typeof buildSpecChangeProposalRequest
>;
export type OpenAiSpecChangeProposalParser = (
  request: SpecChangeProposalRequest,
) => Promise<OpenAiPlanningResponse>;

type PlanningRequest =
  | PlanningQuestionRequest
  | PlanningSpecDraftRequest
  | SpecChangeProposalRequest;

function normalizeRequestId(requestId: string | null): string | null {
  const normalized = requestId?.trim() ?? "";
  return normalized.length === 0 ? null : normalized;
}

async function createDefaultParser<TRequest extends PlanningRequest>(): Promise<
  (request: TRequest) => Promise<OpenAiPlanningResponse>
> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new FoundationError(
      "MISSING_DEPENDENCY",
      "缺少 OPENAI_API_KEY，无法运行策划对话模型",
    );
  }
  const client = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
  });
  return async (request) => {
    const response = await client.responses.parse(request);
    return {
      id: response.id ?? null,
      model: response.model,
      outputParsed: response.output_parsed,
      usage: response.usage,
    };
  };
}

export async function askPlanningQuestion(options: {
  readonly history: readonly PlanningPromptMessage[];
  readonly userText: string;
  readonly materialsContext: string;
  readonly parseResponse?: OpenAiPlanningQuestionParser;
}): Promise<
  OpenAiPlanningAnalysis<PlanningQuestionRequest, PlanningQuestionOutput>
> {
  const request = buildPlanningQuestionRequest(options);
  const parseResponse =
    options.parseResponse ??
    (await createDefaultParser<PlanningQuestionRequest>());
  const response = await parseResponse(request);
  const requestId = normalizeRequestId(response.id);
  const parsed = PlanningQuestionOutputSchema.safeParse(response.outputParsed);
  if (!parsed.success) {
    throw new FoundationError(
      "INVALID_PROVIDER_RESPONSE",
      "策划提问未返回符合 Schema 的结果，可能为 refusal 或空解析",
      { requestId, issues: parsed.error.issues },
    );
  }
  return {
    request,
    provider: OPENAI_PLANNING_PROVIDER,
    requestId,
    model: response.model,
    usage: response.usage,
    result: parsed.data,
  };
}

export async function draftPlanningSpec(options: {
  readonly history: readonly PlanningPromptMessage[];
  readonly materialsContext: string;
  readonly parseResponse?: OpenAiPlanningSpecDraftParser;
}): Promise<
  OpenAiPlanningAnalysis<PlanningSpecDraftRequest, ContentSpecDraft>
> {
  const request = buildPlanningSpecDraftRequest(options);
  const parseResponse =
    options.parseResponse ??
    (await createDefaultParser<PlanningSpecDraftRequest>());
  const response = await parseResponse(request);
  const requestId = normalizeRequestId(response.id);
  const parsed = ContentSpecDraftSchema.safeParse(response.outputParsed);
  if (!parsed.success) {
    throw new FoundationError(
      "INVALID_PROVIDER_RESPONSE",
      "策划初稿未返回符合 Schema 的结果，可能为 refusal 或空解析",
      { requestId, issues: parsed.error.issues },
    );
  }
  return {
    request,
    provider: OPENAI_PLANNING_PROVIDER,
    requestId,
    model: response.model,
    usage: response.usage,
    result: parsed.data,
  };
}

export async function proposeSpecChange(options: {
  readonly instruction: string;
  readonly currentSpec: ContentSpec;
  readonly scope: PlanningChangeScope;
  readonly materialsContext: string;
  readonly parseResponse?: OpenAiSpecChangeProposalParser;
}): Promise<OpenAiPlanningAnalysis<SpecChangeProposalRequest, SpecProposal>> {
  const request = buildSpecChangeProposalRequest(options);
  const parseResponse =
    options.parseResponse ??
    (await createDefaultParser<SpecChangeProposalRequest>());
  const response = await parseResponse(request);
  const requestId = normalizeRequestId(response.id);
  const parsed = SpecProposalSchema.safeParse(response.outputParsed);
  if (!parsed.success) {
    throw new FoundationError(
      "INVALID_PROVIDER_RESPONSE",
      "规格改稿未返回符合 Schema 的结果，可能为 refusal 或空解析",
      { requestId, issues: parsed.error.issues },
    );
  }
  return {
    request,
    provider: OPENAI_PLANNING_PROVIDER,
    requestId,
    model: response.model,
    usage: response.usage,
    result: parsed.data,
  };
}

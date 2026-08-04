import { extname, resolve } from "node:path";
import { planningConversationService } from "@cli/deck/planning-conversation.js";
import {
  PlanningAcceptProposalRequestSchema,
  type PlanningAcceptProposalResult,
  PlanningAcceptProposalResultSchema,
  type PlanningChangeScope,
  type PlanningConversationSnapshot,
  PlanningDraftSpecRequestSchema,
  PlanningDraftSpecResultSchema,
  PlanningImportMaterialRequestSchema,
  PlanningListMaterialsRequestSchema,
  PlanningLoadRequestSchema,
  PlanningLoadResultSchema,
  type PlanningMaterialEntry,
  PlanningMaterialEntrySchema,
  type PlanningMaterialsResult,
  PlanningMaterialsResultSchema,
  PlanningPreviewProposalRequestSchema,
  type PlanningProposalPreview,
  PlanningProposalPreviewSchema,
  type PlanningProposalResult,
  type PlanningProposalSelection,
  PlanningProposeChangeRequestSchema,
  PlanningProposeChangeResultSchema,
  PlanningRejectProposalRequestSchema,
  type PlanningRejectProposalResult,
  PlanningRejectProposalResultSchema,
  PlanningRemoveMaterialRequestSchema,
  PlanningSendMessageRequestSchema,
  PlanningSendMessageResultSchema,
} from "@ppt-maker/core";
import { dialog, ipcMain } from "electron";
import type { DeckRunner } from "../runner/deck-runner.js";
import type { SourceTaskRunner } from "../runner/source-task-runner.js";

/**
 * main 只依赖策划服务的公开动作，不拥有会话折叠、唯一 pending、提案落盘等业务规则。
 * 独立接口让 IPC 用例可以注入受控服务，也避免为测试启动真实 Provider。
 */
export interface PlanningIpcService {
  load(deckPath: string): Promise<unknown>;
  sendMessage(deckPath: string, text: string): Promise<unknown>;
  draftSpec(deckPath: string): Promise<unknown>;
  proposeChange(
    deckPath: string,
    instruction: string,
    scope: PlanningChangeScope,
  ): Promise<unknown>;
  previewProposal(
    deckPath: string,
    proposalMessageId: string,
    selection: PlanningProposalSelection,
  ): Promise<unknown>;
  acceptProposal(
    deckPath: string,
    proposalMessageId: string,
    selection: PlanningProposalSelection,
  ): Promise<unknown>;
  rejectProposal(deckPath: string, proposalMessageId: string): Promise<unknown>;
  listMaterials(deckPath: string): Promise<readonly PlanningMaterialEntry[]>;
  importMaterial(
    deckPath: string,
    sourcePath: string,
  ): Promise<PlanningMaterialEntry>;
  removeMaterial(deckPath: string, name: string): Promise<void>;
}

const MATERIAL_EXTENSIONS = new Set([".md", ".txt"]);

export function registerPlanningHandlers(
  runner: Pick<DeckRunner, "isRunning">,
  sourceTasks: Pick<SourceTaskRunner, "isRunning">,
  service: PlanningIpcService = planningConversationService,
): void {
  function assertDecisionAvailable(): void {
    if (runner.isRunning()) {
      throw new Error("流水线正在执行，请停止后再处理策划提案");
    }
    if (sourceTasks.isRunning()) {
      throw new Error("建页任务正在执行，请等它结束后再处理策划提案");
    }
  }

  ipcMain.handle(
    "planning:load",
    async (_event, deckPath: string): Promise<PlanningConversationSnapshot> => {
      const request = PlanningLoadRequestSchema.parse({ deckPath });
      return PlanningLoadResultSchema.parse(
        await service.load(resolve(request.deckPath)),
      );
    },
  );

  ipcMain.handle(
    "planning:send-message",
    async (
      _event,
      deckPath: string,
      text: string,
    ): Promise<PlanningConversationSnapshot> => {
      const request = PlanningSendMessageRequestSchema.parse({
        deckPath,
        text,
      });
      return PlanningSendMessageResultSchema.parse(
        await service.sendMessage(resolve(request.deckPath), request.text),
      );
    },
  );

  ipcMain.handle(
    "planning:draft-spec",
    async (_event, deckPath: string): Promise<PlanningProposalResult> => {
      const request = PlanningDraftSpecRequestSchema.parse({ deckPath });
      return PlanningDraftSpecResultSchema.parse(
        await service.draftSpec(resolve(request.deckPath)),
      );
    },
  );

  ipcMain.handle(
    "planning:propose-change",
    async (
      _event,
      deckPath: string,
      text: string,
      scope: PlanningChangeScope,
    ): Promise<PlanningProposalResult> => {
      const request = PlanningProposeChangeRequestSchema.parse({
        deckPath,
        text,
        scope,
      });
      return PlanningProposeChangeResultSchema.parse(
        await service.proposeChange(
          resolve(request.deckPath),
          request.text,
          request.scope,
        ),
      );
    },
  );

  ipcMain.handle(
    "planning:preview-proposal",
    async (
      _event,
      deckPath: string,
      proposalMessageId: string,
      selection: PlanningProposalSelection,
    ): Promise<PlanningProposalPreview> => {
      const request = PlanningPreviewProposalRequestSchema.parse({
        deckPath,
        proposalMessageId,
        selection,
      });
      return PlanningProposalPreviewSchema.parse(
        await service.previewProposal(
          resolve(request.deckPath),
          request.proposalMessageId,
          request.selection,
        ),
      );
    },
  );

  ipcMain.handle(
    "planning:accept-proposal",
    async (
      _event,
      deckPath: string,
      proposalMessageId: string,
      selection: PlanningProposalSelection,
    ): Promise<PlanningAcceptProposalResult> => {
      const request = PlanningAcceptProposalRequestSchema.parse({
        deckPath,
        proposalMessageId,
        selection,
      });
      assertDecisionAvailable();
      return PlanningAcceptProposalResultSchema.parse(
        await service.acceptProposal(
          resolve(request.deckPath),
          request.proposalMessageId,
          request.selection,
        ),
      );
    },
  );

  ipcMain.handle(
    "planning:reject-proposal",
    async (
      _event,
      deckPath: string,
      proposalMessageId: string,
    ): Promise<PlanningRejectProposalResult> => {
      const request = PlanningRejectProposalRequestSchema.parse({
        deckPath,
        proposalMessageId,
      });
      assertDecisionAvailable();
      const snapshot = await service.rejectProposal(
        resolve(request.deckPath),
        request.proposalMessageId,
      );
      return PlanningRejectProposalResultSchema.parse({ snapshot });
    },
  );

  ipcMain.handle(
    "planning:list-materials",
    async (_event, deckPath: string): Promise<PlanningMaterialsResult> => {
      const request = PlanningListMaterialsRequestSchema.parse({ deckPath });
      const materials = await service.listMaterials(resolve(request.deckPath));
      return PlanningMaterialsResultSchema.parse({ materials });
    },
  );

  ipcMain.handle(
    "planning:import-material",
    async (_event, deckPath: string): Promise<PlanningMaterialEntry | null> => {
      const deckRequest = PlanningLoadRequestSchema.parse({ deckPath });
      const selected = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "策划材料", extensions: ["md", "txt"] }],
      });
      const sourcePath = selected.filePaths[0];
      if (selected.canceled || sourcePath === undefined) {
        return null;
      }
      if (!MATERIAL_EXTENSIONS.has(extname(sourcePath).toLowerCase())) {
        throw new Error("策划材料只支持 .md 或 .txt 文件");
      }
      const request = PlanningImportMaterialRequestSchema.parse({
        deckPath: deckRequest.deckPath,
        sourcePath,
      });
      return PlanningMaterialEntrySchema.parse(
        await service.importMaterial(
          resolve(request.deckPath),
          resolve(request.sourcePath),
        ),
      );
    },
  );

  ipcMain.handle(
    "planning:remove-material",
    async (
      _event,
      deckPath: string,
      name: string,
    ): Promise<PlanningMaterialsResult> => {
      const request = PlanningRemoveMaterialRequestSchema.parse({
        deckPath,
        name,
      });
      const resolvedDeckPath = resolve(request.deckPath);
      await service.removeMaterial(resolvedDeckPath, request.name);
      const materials = await service.listMaterials(resolvedDeckPath);
      return PlanningMaterialsResultSchema.parse({ materials });
    },
  );
}

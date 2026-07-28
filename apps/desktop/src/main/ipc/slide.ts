import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runAcceptClean } from "@cli/clean/accept.js";
import { runAcceptPptx } from "@cli/pptx/accept.js";
import { runAcceptFinal } from "@cli/slide/accept-final.js";
import { invalidateSlideStage } from "@cli/slide/invalidate.js";
import { loadSlideWorkspace } from "@cli/slide/workspace.js";
import {
  type SlideStage,
  type TextReviewDocument,
  TextReviewDocumentSchema,
  validateTextReviewDocument,
} from "@ppt-maker/core";
import { ipcMain, shell } from "electron";
import { type ActivityLog, buildActivityRecord } from "../activity-log.js";
import { resolveDeckContext } from "../deck-context.js";
import {
  loadTextReviewDocument,
  REVIEW_RELATIVE_PATH,
  readFinalChecks,
  resolvePptxArtifactPath,
} from "../slide-detail.js";
import type {
  AcceptFinalResult,
  AcceptOptions,
  ActivityResult,
  FinalChecks,
} from "./channels.js";

export function registerSlideHandlers(activityLog: ActivityLog): void {
  async function log(
    workspacePath: string,
    kind: string,
    stage: string,
    result: ActivityResult,
    detail: string,
  ): Promise<void> {
    const context = await resolveDeckContext(workspacePath);
    if (context === null) return;
    await activityLog.append(
      context.deckId,
      buildActivityRecord({
        kind,
        result,
        detail,
        slideId: null,
        pageLabel: context.pageLabel,
        stage,
        durationMs: null,
      }),
    );
  }

  ipcMain.handle(
    "slide:load-review",
    async (
      _event,
      workspacePath: string,
    ): Promise<TextReviewDocument | null> => {
      return loadTextReviewDocument(resolve(workspacePath));
    },
  );

  ipcMain.handle(
    "slide:save-review",
    async (
      _event,
      workspacePath: string,
      document: TextReviewDocument,
    ): Promise<{ valid: boolean; errors: number; warnings: number }> => {
      const ws = resolve(workspacePath);
      const parsed = TextReviewDocumentSchema.parse(document);
      const reviewPath = join(ws, ...REVIEW_RELATIVE_PATH);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(reviewPath, JSON.stringify(parsed, null, 2), "utf-8");

      const workspace = await loadSlideWorkspace(ws);
      const sourceImage = workspace.manifest.assets.find(
        (a) => a.role === "source_image",
      );
      const violations = validateTextReviewDocument(parsed, {
        image: sourceImage?.image ?? parsed.image,
      });
      const errors = violations.filter((v) => v.severity === "error").length;
      const warnings = violations.filter(
        (v) => v.severity === "warning",
      ).length;
      return { valid: errors === 0, errors, warnings };
    },
  );

  ipcMain.handle(
    "slide:accept-clean",
    async (
      _event,
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<{ acceptedPath: string; autoCheckSummary: string }> => {
      try {
        const result = await runAcceptClean({
          workspacePath: resolve(workspacePath),
          ...(opts?.acceptedBy ? { acceptedBy: opts.acceptedBy } : {}),
          ...(opts?.note ? { note: opts.note } : {}),
        });
        await log(
          workspacePath,
          "accept-clean",
          "accept-clean",
          "success",
          `验收干净底图：${result.autoCheckSummary}`,
        );
        return {
          acceptedPath: result.acceptedPath,
          autoCheckSummary: result.autoCheckSummary,
        };
      } catch (error) {
        await log(
          workspacePath,
          "accept-clean",
          "accept-clean",
          "failure",
          `验收失败：${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );

  ipcMain.handle(
    "slide:accept-pptx",
    async (
      _event,
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<{ acceptedPath: string; autoCheckSummary: string }> => {
      try {
        const result = await runAcceptPptx({
          workspacePath: resolve(workspacePath),
          ...(opts?.acceptedBy ? { acceptedBy: opts.acceptedBy } : {}),
          ...(opts?.note ? { note: opts.note } : {}),
        });
        await log(
          workspacePath,
          "accept-pptx",
          "accept-pptx",
          "success",
          `验收 PPTX：${result.autoCheckSummary}`,
        );
        return {
          acceptedPath: result.acceptedPath,
          autoCheckSummary: result.autoCheckSummary,
        };
      } catch (error) {
        await log(
          workspacePath,
          "accept-pptx",
          "accept-pptx",
          "failure",
          `验收失败：${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );

  /*
   * 最终确认：一次人工动作写入 accept-clean 与 accept-pptx 两条验收记录。
   *
   * 全部落库工作在 CLI 的 runAcceptFinal 内完成（含幂等跳过已 completed 的一侧），
   * main 只负责调用与活动日志，不在此重写任何验收语义。
   */
  ipcMain.handle(
    "slide:accept-final",
    async (
      _event,
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<AcceptFinalResult> => {
      try {
        const result = await runAcceptFinal({
          workspacePath: resolve(workspacePath),
          ...(opts?.acceptedBy ? { acceptedBy: opts.acceptedBy } : {}),
          ...(opts?.note ? { note: opts.note } : {}),
        });
        await log(
          workspacePath,
          "accept-final",
          "accept-final",
          "success",
          `最终确认验收：${result.autoCheckSummary}`,
        );
        return result;
      } catch (error) {
        await log(
          workspacePath,
          "accept-final",
          "accept-final",
          "failure",
          `最终确认失败：${error instanceof Error ? error.message : String(error)}`,
        );
        throw error;
      }
    },
  );

  /*
   * 用系统默认程序（macOS 下即 PowerPoint）打开该页 PPTX 做最终把关。
   *
   * 打不开不抛错、也不静默：产物未生成或系统拒绝打开都如实回传 message，
   * 让界面能说清「为什么点了没反应」。shell.openPath 的约定是——返回空串为成功，
   * 非空串即失败原因。
   */
  ipcMain.handle(
    "slide:open-pptx",
    async (
      _event,
      workspacePath: string,
    ): Promise<{ opened: boolean; message: string }> => {
      const ws = resolve(workspacePath);
      const workspace = await loadSlideWorkspace(ws);
      const pptxPath = resolvePptxArtifactPath(ws, workspace.manifest);
      if (pptxPath === null) {
        return { opened: false, message: "该页尚未生成 PPTX 产物" };
      }
      const failure = await shell.openPath(pptxPath);
      if (failure !== "") {
        return { opened: false, message: `无法打开 PPTX：${failure}` };
      }
      return { opened: true, message: `已用系统默认程序打开：${pptxPath}` };
    },
  );

  ipcMain.handle(
    "slide:load-final-checks",
    async (_event, workspacePath: string): Promise<FinalChecks> => {
      const ws = resolve(workspacePath);
      const workspace = await loadSlideWorkspace(ws);
      return readFinalChecks(ws, workspace.manifest);
    },
  );

  ipcMain.handle(
    "slide:load-image",
    async (
      _event,
      workspacePath: string,
      role: string,
    ): Promise<string | null> => {
      const ws = resolve(workspacePath);
      const workspace = await loadSlideWorkspace(ws);
      const asset = workspace.manifest.assets.find((a) => a.role === role);
      if (!asset) return null;
      const imagePath = join(ws, asset.path);
      try {
        const buffer = await readFile(imagePath);
        const ext = asset.image?.format ?? "png";
        return `data:image/${ext};base64,${buffer.toString("base64")}`;
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    "slide:invalidate-stage",
    async (
      _event,
      workspacePath: string,
      stage: SlideStage,
      reason: string,
    ): Promise<{ invalidated: string[] }> => {
      const result = await invalidateSlideStage({
        workspacePath: resolve(workspacePath),
        stage,
        reason,
      });
      return { invalidated: [...result.invalidated] };
    },
  );
}

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runAcceptClean } from "@cli/clean/accept.js";
import { runAcceptPptx } from "@cli/pptx/accept.js";
import { loadSlideWorkspace } from "@cli/slide/workspace.js";
import {
  type TextReviewDocument,
  TextReviewDocumentSchema,
  validateTextReviewDocument,
} from "@ppt-maker/core";
import { ipcMain } from "electron";
import { type ActivityLog, buildActivityRecord } from "../activity-log.js";
import { resolveDeckContext } from "../deck-context.js";
import type { AcceptOptions, ActivityResult } from "./channels.js";

/**
 * 复核文档在工作区内的相对路径，必须与 CLI 的 `slide/review.ts`、
 * `slide/assist-review.ts`、`slide/validate-review.ts` 三处保持一致。
 *
 * 曾经这里漏写 `stages/` 一层，`load-review` 的 readFile 失败后被 catch 吞成 null，
 * 单页复核画布拿到 0 个文字块、侧边栏三块全空，而控制台没有任何报错——
 * 表现为「点进去什么都没有」。改动此常量前先确认 CLI 侧写入路径。
 */
const REVIEW_RELATIVE_PATH = ["stages", "review", "text-blocks.json"] as const;

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
      const ws = resolve(workspacePath);
      const reviewPath = join(ws, ...REVIEW_RELATIVE_PATH);
      try {
        const raw = await readFile(reviewPath, "utf-8");
        return TextReviewDocumentSchema.parse(JSON.parse(raw));
      } catch {
        return null;
      }
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
}

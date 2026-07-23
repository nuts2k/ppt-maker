import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { runAcceptClean } from "@cli/clean/accept.js";
import { runAcceptPptx } from "@cli/pptx/accept.js";
import { runSlideRunFrom } from "@cli/slide/run-from.js";
import { loadSlideWorkspace } from "@cli/slide/workspace.js";
import {
  type TextReviewDocument,
  TextReviewDocumentSchema,
  validateTextReviewDocument,
} from "@ppt-maker/core";
import { type BrowserWindow, ipcMain } from "electron";
import type {
  AcceptOptions,
  SlideRunOptions,
  SlideRunResult,
} from "./channels.js";

export function registerSlideHandlers(_mainWindow: BrowserWindow): void {
  ipcMain.handle(
    "slide:load-review",
    async (
      _event,
      workspacePath: string,
    ): Promise<TextReviewDocument | null> => {
      const ws = resolve(workspacePath);
      const reviewPath = join(ws, "review", "text-blocks.json");
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
      const reviewPath = join(ws, "review", "text-blocks.json");
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
    "slide:run",
    async (
      _event,
      workspacePath: string,
      from: string,
      opts?: SlideRunOptions,
    ): Promise<SlideRunResult> => {
      const result = await runSlideRunFrom(from, {
        workspacePath: resolve(workspacePath),
        ...(opts?.confirmApi === true ? { confirmApi: true } : {}),
        ...(opts?.confirmUpload === true ? { confirmUpload: true } : {}),
      });
      return {
        executed: result.executed,
        gate: result.gate,
        message: result.message,
        nextCommand: result.nextCommand,
      };
    },
  );

  ipcMain.handle(
    "slide:accept-clean",
    async (
      _event,
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<{ acceptedPath: string; autoCheckSummary: string }> => {
      const result = await runAcceptClean({
        workspacePath: resolve(workspacePath),
        ...(opts?.acceptedBy ? { acceptedBy: opts.acceptedBy } : {}),
        ...(opts?.note ? { note: opts.note } : {}),
      });
      return {
        acceptedPath: result.acceptedPath,
        autoCheckSummary: result.autoCheckSummary,
      };
    },
  );

  ipcMain.handle(
    "slide:accept-pptx",
    async (
      _event,
      workspacePath: string,
      opts?: AcceptOptions,
    ): Promise<{ acceptedPath: string; autoCheckSummary: string }> => {
      const result = await runAcceptPptx({
        workspacePath: resolve(workspacePath),
        ...(opts?.acceptedBy ? { acceptedBy: opts.acceptedBy } : {}),
        ...(opts?.note ? { note: opts.note } : {}),
      });
      return {
        acceptedPath: result.acceptedPath,
        autoCheckSummary: result.autoCheckSummary,
      };
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

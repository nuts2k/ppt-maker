import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { runAcceptClean } from "@cli/clean/accept.js";
import { runAcceptPptx } from "@cli/pptx/accept.js";
import { runSlideReport } from "@cli/report/run.js";
import { runAcceptFinal } from "@cli/slide/accept-final.js";
import { invalidateSlideStage } from "@cli/slide/invalidate.js";
import { replaceSlideSource } from "@cli/slide/replace-source.js";
import { loadSlideWorkspace } from "@cli/slide/workspace.js";
import {
  type SlideStage,
  type TextReviewDocument,
  TextReviewDocumentSchema,
  validateTextReviewDocument,
} from "@ppt-maker/core";
import { dialog, ipcMain, shell } from "electron";
import { resolveInvalidationTarget } from "../../shared/stages.js";
import { type ActivityLog, buildActivityRecord } from "../activity-log.js";
import { resolveDeckContext } from "../deck-context.js";
import { decideInvalidation } from "../save-invalidation.js";
import {
  currentSourceImageAsset,
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
  ReplaceSourceResult,
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

  /*
   * 保存文本复核：写盘之外还要把改动传给下游阶段。
   *
   * 此前只写盘不碰 manifest，用户改完分类保存后轨道依旧全绿、产物却是旧的
   * （见 save-invalidation.ts 的判据说明）。失效必须分粒度：一律失效 mask 会让
   * 每次保存都触发 clean 的付费图像调用。
   */
  ipcMain.handle(
    "slide:save-review",
    async (
      _event,
      workspacePath: string,
      document: TextReviewDocument,
    ): Promise<{
      valid: boolean;
      errors: number;
      warnings: number;
      invalidated: string[];
    }> => {
      const ws = resolve(workspacePath);
      const parsed = TextReviewDocumentSchema.parse(document);
      const previous = await loadTextReviewDocument(ws);
      const reviewPath = join(ws, ...REVIEW_RELATIVE_PATH);
      const { writeFile } = await import("node:fs/promises");
      await writeFile(reviewPath, JSON.stringify(parsed, null, 2), "utf-8");

      const target = decideInvalidation(previous, parsed);
      let invalidated: string[] = [];
      if (target !== null) {
        const result = await invalidateSlideStage({
          workspacePath: ws,
          stage: target,
          reason: "保存复核内容",
        });
        invalidated = [...result.invalidated];
        await log(
          workspacePath,
          "save-review",
          target,
          "success",
          `保存复核内容，已作废：${invalidated.join("、")}`,
        );
      }

      const workspace = await loadSlideWorkspace(ws);
      // 按 sourceImageAssetId 取：换源后 assets 里的第一条是旧图，用它的尺寸校验
      // 文字块坐标会得出与当前图无关的结论
      const sourceImage = currentSourceImageAsset(workspace.manifest);
      const violations = validateTextReviewDocument(parsed, {
        image: sourceImage?.image ?? parsed.image,
      });
      const errors = violations.filter((v) => v.severity === "error").length;
      const warnings = violations.filter(
        (v) => v.severity === "warning",
      ).length;
      return { valid: errors === 0, errors, warnings, invalidated };
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
   *
   * 验收成功后静默补跑 report：它是毫秒级的本地汇总，用户没有任何决策要做，
   * 因此不出现在可见阶段序列里（shared/stages.ts），改由此处收尾。
   * 顺序不可颠倒——report 的前置依赖 accept-pptx 此时刚写为 completed。
   * 补跑失败只写活动日志、不改 IPC 返回值：验收记录已经落盘，让 report 的异常冒泡
   * 会把「验收成功」翻转成「验收失败」。
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
        try {
          await runSlideReport({ workspacePath: resolve(workspacePath) });
        } catch (error) {
          await log(
            workspacePath,
            "report",
            "report",
            "failure",
            `生成报告失败（不影响验收结果）：${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
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
      // 源图有多条资产（换源保留旧图），只有 sourceImageAssetId 指向当前那张。
      // 其余 role 保持既有按 role 取首条的行为，不在本次改动范围内。
      const asset =
        role === "source_image"
          ? currentSourceImageAsset(workspace.manifest)
          : workspace.manifest.assets.find((a) => a.role === role);
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

  /*
   * 换源：选新图 → 二次确认 → 执行。
   *
   * 二次确认用系统原生 messageBox（含 checkbox）而不是自造 modal——它是破坏性
   * 动作的标准控件，且「保留已确认文字块」这个选项必须默认**不勾**：
   * 换源后旧图上的人工判断对新图不成立，继承它不是保留成果，是把过期结论
   * 冒充为当前结论。保留是用户显式选择的结果，因此不构成静默分歧。
   */
  ipcMain.handle(
    "slide:replace-source",
    async (_event, workspacePath: string): Promise<ReplaceSourceResult> => {
      const ws = resolve(workspacePath);
      const picked = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "16:9 页面图", extensions: ["png", "jpg", "jpeg"] }],
      });
      const imagePath = picked.canceled ? undefined : picked.filePaths[0];
      if (imagePath === undefined) {
        return { replaced: false };
      }

      const confirm = await dialog.showMessageBox({
        type: "warning",
        message: "替换这一页的源图？",
        detail:
          "该页已确认的文字块会被归档，源图确认及下游阶段全部需要重新执行。其它页不受影响。",
        checkboxLabel: "保留已确认的文字块（仅适用于同版式微调）",
        checkboxChecked: false,
        buttons: ["取消", "替换源图"],
        defaultId: 1,
        cancelId: 0,
      });
      if (confirm.response !== 1) {
        return { replaced: false };
      }

      try {
        const result = await replaceSlideSource({
          workspacePath: ws,
          imagePath,
          keepReview: confirm.checkboxChecked,
        });
        await log(
          workspacePath,
          "replace-source",
          "init",
          "success",
          `已换源为 ${basename(imagePath)}，失效：${result.invalidated.join("、") || "无"}${
            result.archivedReview ? "，旧复核稿已归档" : ""
          }`,
        );
        return {
          replaced: true,
          invalidated: [...result.invalidated],
          archivedReview: result.archivedReview,
          requiresAcceptance: result.requiresAcceptance,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await log(workspacePath, "replace-source", "init", "failure", message);
        // 界面必须看见失败，不能吞掉后返回一个「没换成但也没说为什么」的成功壳
        throw error;
      }
    },
  );

  ipcMain.handle(
    "slide:invalidate-stage",
    async (
      _event,
      // renderer 传的是 RunStage（含瞬态阶段），不能直接当 SlideStage 用：
      // 两侧类型隔着 ipcRenderer.invoke，编译期互不校验，见 resolveInvalidationTarget
      workspacePath: string,
      stage: string,
      reason: string,
    ): Promise<{ invalidated: string[] }> => {
      const result = await invalidateSlideStage({
        workspacePath: resolve(workspacePath),
        stage: resolveInvalidationTarget(stage) as SlideStage,
        reason,
      });
      return { invalidated: [...result.invalidated] };
    },
  );
}

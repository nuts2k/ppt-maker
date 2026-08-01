import { SCHEMA_VERSION } from "./constants.js";
import type { SlideStage } from "./workspace-contracts.js";

/**
 * 旧 manifest 的加载期归一化（M5 父任务 §3、design §3）。
 *
 * **必须在 `SlideWorkspaceManifestSchema.parse` 之前调用，作用于原始 JSON。**
 * 顺序颠倒就永远执行不到：`superRefine` 会先因「缺少阶段状态：accept-source」
 * 报错，M3/M4 时代的每一个工作区都会加载失败。这是 M5 零迁移承诺的唯一例外点。
 *
 * 只补两样缺失的东西，别的一律原样透传——归一化不是修复程序，
 * 掩盖真实损坏会让后面的错误更难查。
 */

const SOURCE_GATE_STAGE: SlideStage = "accept-source";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 工作区路径契约保证使用正斜杠的相对路径，无需 node:path，core 因此保持零运行时依赖 */
function baseName(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] ?? path;
}

function findStageState(
  stages: readonly unknown[],
  stage: SlideStage,
): Record<string, unknown> | null {
  for (const entry of stages) {
    if (isRecord(entry) && entry.stage === stage) {
      return entry;
    }
  }
  return null;
}

function initAttemptId(raw: Record<string, unknown>): string | null {
  const stages = Array.isArray(raw.stages) ? raw.stages : [];
  const init = findStageState(stages, "init");
  const fromState = init?.lastSuccessfulAttemptId ?? init?.latestAttemptId;
  if (typeof fromState === "string" && fromState.length > 0) {
    return fromState;
  }
  const attempts = Array.isArray(raw.attempts) ? raw.attempts : [];
  for (const attempt of attempts) {
    if (
      isRecord(attempt) &&
      attempt.stage === "init" &&
      typeof attempt.id === "string" &&
      attempt.id.length > 0
    ) {
      return attempt.id;
    }
  }
  return null;
}

export interface NormalizeSlideManifestContext {
  /** 来自 config.json，用于给旧数据补 `originalFileName` */
  readonly sourceImagePath: string;
}

export function normalizeSlideManifest(
  raw: unknown,
  context: NormalizeSlideManifestContext,
): unknown {
  if (!isRecord(raw)) {
    return raw;
  }
  const attemptId = initAttemptId(raw);
  if (attemptId === null) {
    // 连 init attempt 都取不到的 manifest 本就不合法，交给 schema 报出真实原因，
    // 不要在这里补出一个「看起来合法」的来源掩盖它。
    return raw;
  }

  const next: Record<string, unknown> = { ...raw };

  // 1) 来源缺失 → 视作 imported。M0–M4 唯一入口就是导入图片，这不是猜测而是事实。
  if (next.source === undefined || next.source === null) {
    next.source = {
      kind: "imported",
      originalFileName: baseName(context.sourceImagePath),
      // 取 manifest 自己的 createdAt 而非 now()：写 now 等于声称「今天导入的」，
      // 与事实相反，正是 M4 点名的那类记录失真。
      recordedAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
      attemptId,
    };
  }

  // 2) 缺 accept-source 阶段状态 → 补 completed，沿用 init 的 attempt 与指纹。
  //    旧数据一律是 imported，按 D6 自动放行，故初始即已完成。
  const stages = Array.isArray(next.stages) ? [...next.stages] : null;
  if (stages !== null && findStageState(stages, SOURCE_GATE_STAGE) === null) {
    const init = findStageState(stages, "init");
    stages.push({
      schemaVersion: SCHEMA_VERSION,
      stage: SOURCE_GATE_STAGE,
      status: "completed",
      latestAttemptId: attemptId,
      lastSuccessfulAttemptId: attemptId,
      completedInputFingerprint: init?.completedInputFingerprint ?? null,
      invalidatedAt: null,
      invalidationReason: null,
    });
    next.stages = stages;
  }

  return next;
}

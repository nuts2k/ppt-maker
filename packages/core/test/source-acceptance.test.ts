import { describe, expect, it } from "vitest";
import {
  AUTO_SOURCE_TRUST_PROVIDER,
  resolveSourceAcceptanceMode,
  SOURCE_ACCEPTANCE_TEXT,
  type WorkspaceAsset,
  type WorkspaceStageAttempt,
  type WorkspaceStageState,
} from "../src/index.js";

/**
 * 源图确认性质的判定（父任务 A10）。
 *
 * 这一层的所有夹具都**不带 `source`**：判据必须完全落在阶段状态、attempt 与资产上。
 * 只要哪一格开始需要来源类型才能算对，就说明实现又回到了「按来源反推」。
 */

function stage(
  overrides: Partial<WorkspaceStageState> = {},
): WorkspaceStageState {
  return {
    schemaVersion: 1,
    stage: "accept-source",
    status: "completed",
    latestAttemptId: "accept-source-001",
    lastSuccessfulAttemptId: "accept-source-001",
    completedInputFingerprint: "a".repeat(64),
    invalidatedAt: null,
    invalidationReason: null,
    ...overrides,
  };
}

function attempt(
  overrides: Partial<WorkspaceStageAttempt> = {},
): WorkspaceStageAttempt {
  return {
    schemaVersion: 1,
    id: "accept-source-001",
    stage: "accept-source",
    number: 1,
    status: "completed",
    inputFingerprint: "a".repeat(64),
    startedAt: "2026-08-02T00:00:00.000Z",
    endedAt: "2026-08-02T00:00:00.000Z",
    provider: "developer",
    providerVersion: "developer",
    assetIds: ["asset-source-acceptance"],
    error: null,
    ...overrides,
  };
}

function acceptanceAsset(
  overrides: Partial<WorkspaceAsset> = {},
): WorkspaceAsset {
  return {
    schemaVersion: 1,
    id: "asset-source-acceptance",
    path: "stages/source/accepted.json",
    role: "source_acceptance",
    sha256: "b".repeat(64),
    byteSize: 128,
    createdAt: "2026-08-02T00:00:00.000Z",
    producedBy: "accept-source",
    attemptId: "accept-source-001",
    image: null,
    ...overrides,
  };
}

describe("resolveSourceAcceptanceMode", () => {
  it("人工确认：有绑到当前 attempt 的验收记录", () => {
    expect(
      resolveSourceAcceptanceMode({
        stages: [stage()],
        attempts: [attempt()],
        assets: [acceptanceAsset()],
      }),
    ).toBe("manual");
  });

  /** 自动放行的产生端只留一条 attempt，磁盘上没有 accepted.json */
  it("自动放行：attempt 带 auto-source-trust 且无验收资产", () => {
    expect(
      resolveSourceAcceptanceMode({
        stages: [stage()],
        attempts: [
          attempt({ provider: AUTO_SOURCE_TRUST_PROVIDER, assetIds: [] }),
        ],
        assets: [],
      }),
    ).toBe("auto");
  });

  /**
   * 这一格是整条判据链的要害：`normalizeSlideManifest` 给旧 manifest 补出的
   * `accept-source` 沿用 init 的 attempt（provider 是 `ppt-maker-cli`，既不是自动放行
   * 标识、也没有验收资产）。若实现写成「provider 不是 auto 就算人工确认」，
   * M3/M4 时代的每一页都会凭空长出一条人工痕迹。
   */
  it("旧工作区归一化出来的闸门算自动放行，不得报成人工确认", () => {
    expect(
      resolveSourceAcceptanceMode({
        stages: [
          stage({
            latestAttemptId: "init-001",
            lastSuccessfulAttemptId: "init-001",
          }),
        ],
        attempts: [
          attempt({
            id: "init-001",
            stage: "init",
            provider: "ppt-maker-cli",
            providerVersion: "0.0.0",
            assetIds: ["asset-source-image"],
          }),
        ],
        assets: [],
      }),
    ).toBe("auto");
  });

  it("阶段未完成一律待确认", () => {
    for (const status of [
      "pending",
      "running",
      "failed",
      "interrupted",
    ] as const) {
      expect(
        resolveSourceAcceptanceMode({
          stages: [stage({ status })],
          attempts: [attempt()],
          assets: [acceptanceAsset()],
        }),
        status,
      ).toBe("pending");
    }
  });

  /**
   * 被人工失效（阶段轨道上点重跑）后 `accept-source` 转 `stale`，
   * `lastSuccessfulAttemptId` 与验收资产都还在。这同样是欠着的一次确认——
   * 不能因为「曾经完成过」就报成已确认。
   */
  it("stale 是欠着的一次确认，不因为曾经完成过就报成已确认", () => {
    expect(
      resolveSourceAcceptanceMode({
        stages: [
          stage({
            status: "stale",
            invalidatedAt: "2026-08-02T01:00:00.000Z",
            invalidationReason: "人工要求从该阶段重跑",
          }),
        ],
        attempts: [attempt()],
        assets: [acceptanceAsset()],
      }),
    ).toBe("pending");
  });

  /**
   * 换源会把上一代验收记录归档（路径改到 `archived/<initAttemptId>/`，id 加后缀，
   * 但 **role 与 attemptId 都不变**）。新一代若是自动放行，那条归档记录绝不能
   * 冒充成「这一页有人确认过」。
   */
  it("换源后归档的旧验收记录不冒充当前那份", () => {
    expect(
      resolveSourceAcceptanceMode({
        stages: [
          stage({
            latestAttemptId: "accept-source-002",
            lastSuccessfulAttemptId: "accept-source-002",
          }),
        ],
        attempts: [
          attempt(),
          attempt({
            id: "accept-source-002",
            number: 2,
            provider: AUTO_SOURCE_TRUST_PROVIDER,
            providerVersion: null,
            assetIds: [],
          }),
        ],
        assets: [
          acceptanceAsset({
            id: "asset-source-acceptance-archived-init-002",
            path: "stages/source/archived/init-002/accepted.json",
          }),
        ],
      }),
    ).toBe("auto");
  });

  it("缺少 accept-source 阶段状态时为待确认，不抛错", () => {
    expect(
      resolveSourceAcceptanceMode({ stages: [], attempts: [], assets: [] }),
    ).toBe("pending");
  });
});

describe("SOURCE_ACCEPTANCE_TEXT", () => {
  /**
   * 措辞是这个区分的全部意义：`auto` 必须说清「按来源」，
   * 写成含糊的「已确认」等于把区分又抹掉一次。
   */
  it("三档齐全，且自动放行档不写成「已确认」", () => {
    expect(Object.keys(SOURCE_ACCEPTANCE_TEXT).sort()).toEqual([
      "auto",
      "manual",
      "pending",
    ]);
    expect(SOURCE_ACCEPTANCE_TEXT.manual).toBe("人工确认");
    expect(SOURCE_ACCEPTANCE_TEXT.auto).toBe("按来源自动放行");
    expect(SOURCE_ACCEPTANCE_TEXT.pending).toBe("待确认");
  });
});

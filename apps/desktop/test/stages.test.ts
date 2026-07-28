/**
 * 失效目标解析的回归锚点。
 *
 * 2026-07-27 E1 走查实测：点阶段轨道上的「复核校验」节点毫无效果——界面切回复核
 * 视图并给了正反馈，manifest 却一字未改，随后的 run 被幂等规则整段跳过。瞬态阶段
 * 不写 manifest，拿它去匹配 WorkspaceStageState 永远匹配不上，失效于是静默成为空
 * 操作。这组用例锁定「瞬态阶段有替身」与「未知阶段必须抛错」两条。
 */

import { describe, expect, it } from "vitest";
import {
  RUN_STAGE_SEQUENCE,
  resolveInvalidationTarget,
  TRANSIENT_STAGES,
} from "../src/shared/stages.js";

describe("resolveInvalidationTarget", () => {
  it("瞬态阶段 validate-review 映射到下游第一个持久阶段 mask", () => {
    expect(resolveInvalidationTarget("validate-review")).toBe("mask");
  });

  it("持久阶段原样返回", () => {
    expect(resolveInvalidationTarget("mask")).toBe("mask");
    expect(resolveInvalidationTarget("clean")).toBe("clean");
    expect(resolveInvalidationTarget("accept-pptx")).toBe("accept-pptx");
  });

  it("未知阶段抛错而非静默放过（静默会退化成「点了没反应」）", () => {
    expect(() => resolveInvalidationTarget("init")).toThrow("未知阶段");
    expect(() => resolveInvalidationTarget("")).toThrow("未知阶段");
    expect(() => resolveInvalidationTarget("nope")).toThrow("未知阶段");
  });

  it("执行序列里每个阶段都能解析出一个持久的失效目标", () => {
    for (const stage of RUN_STAGE_SEQUENCE) {
      const target = resolveInvalidationTarget(stage);
      expect(TRANSIENT_STAGES).not.toContain(target);
    }
  });
});

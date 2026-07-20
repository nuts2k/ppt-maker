import { describe, expect, it } from "vitest";
import { assertPptxFontReady, collectDoctorReport } from "../src/doctor.js";

const baseDependencies = {
  nodeVersion: "v24.4.0",
  platform: "darwin" as const,
  arch: "arm64",
  exists: (path: string) =>
    path === "/Applications/Microsoft PowerPoint.app" ||
    path.endsWith("/msyh.ttc"),
  run: (command: string) => {
    if (command === "pnpm") return "10.32.0";
    if (command === "xcrun") return "Apple Swift version 6.2.3";
    throw new Error("unexpected command");
  },
  now: () => new Date("2026-07-20T00:00:00.000Z"),
};

describe("collectDoctorReport", () => {
  it("报告完整基线环境", () => {
    const report = collectDoctorReport(baseDependencies);
    expect(report.summary).toEqual({ pass: 6, warn: 0, fail: 0 });
  });

  it("把 Node 25 标记为警告", () => {
    const report = collectDoctorReport({
      ...baseDependencies,
      nodeVersion: "v25.6.1",
    });
    expect(report.checks.find((check) => check.id === "node")?.status).toBe(
      "warn",
    );
  });

  it("把缺失微软雅黑标记为失败", () => {
    const report = collectDoctorReport({
      ...baseDependencies,
      exists: (path) => path === "/Applications/Microsoft PowerPoint.app",
    });
    expect(
      report.checks.find((check) => check.id === "font-microsoft-yahei")
        ?.status,
    ).toBe("fail");
    expect(() => assertPptxFontReady(report, undefined)).toThrow(
      "Microsoft YaHei 不可用",
    );
    expect(() => assertPptxFontReady(report, "Arial")).not.toThrow();
  });
});

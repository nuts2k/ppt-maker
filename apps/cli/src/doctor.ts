import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { arch, platform } from "node:os";
import {
  DEFAULT_FONT_FACE,
  type DoctorCheck,
  type DoctorReport,
  DoctorReportSchema,
  FoundationError,
  SCHEMA_VERSION,
  SUPPORTED_NODE_MAJOR,
  SUPPORTED_PNPM_MAJOR,
} from "@ppt-maker/core";

const POWERPOINT_PATH = "/Applications/Microsoft PowerPoint.app";
const POWERPOINT_FONT_PATHS = [
  `${POWERPOINT_PATH}/Contents/Resources/DFonts/msyh.ttc`,
  `${POWERPOINT_PATH}/Contents/Resources/DFonts/msyhbd.ttc`,
  `${POWERPOINT_PATH}/Contents/Resources/DFonts/msyhl.ttc`,
] as const;

export interface DoctorDependencies {
  readonly nodeVersion: string;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly exists: (path: string) => boolean;
  readonly run: (command: string, args: readonly string[]) => string;
  readonly now: () => Date;
}

function major(version: string): number | null {
  const match = version.match(/v?(\d+)/);
  return match ? Number(match[1]) : null;
}

function commandCheck(
  dependencies: DoctorDependencies,
  id: string,
  label: string,
  command: string,
  args: readonly string[],
  expectedMajor?: number,
): DoctorCheck {
  try {
    const output = dependencies.run(command, args).trim();
    const actualMajor = expectedMajor === undefined ? null : major(output);
    if (expectedMajor !== undefined && actualMajor !== expectedMajor) {
      return {
        id,
        label,
        status: "warn",
        message: `检测到 ${output || "未知版本"}，项目基线要求主版本 ${expectedMajor}`,
        details: { output, expectedMajor },
      };
    }

    return {
      id,
      label,
      status: "pass",
      message: output || "可用",
    };
  } catch (error) {
    return {
      id,
      label,
      status: "fail",
      message: `${label} 不可用`,
      details: {
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function collectDoctorReport(
  dependencies: DoctorDependencies,
): DoctorReport {
  const checks: DoctorCheck[] = [];
  const nodeMajor = major(dependencies.nodeVersion);

  checks.push({
    id: "node",
    label: "Node.js",
    status: nodeMajor === SUPPORTED_NODE_MAJOR ? "pass" : "warn",
    message:
      nodeMajor === SUPPORTED_NODE_MAJOR
        ? `${dependencies.nodeVersion} 符合 Node.js ${SUPPORTED_NODE_MAJOR} LTS 基线`
        : `${dependencies.nodeVersion} 偏离 Node.js ${SUPPORTED_NODE_MAJOR} LTS 基线`,
    details: { expectedMajor: SUPPORTED_NODE_MAJOR, actualMajor: nodeMajor },
  });

  checks.push(
    commandCheck(
      dependencies,
      "pnpm",
      "pnpm",
      "pnpm",
      ["--version"],
      SUPPORTED_PNPM_MAJOR,
    ),
  );

  checks.push({
    id: "platform",
    label: "运行平台",
    status: dependencies.platform === "darwin" ? "pass" : "fail",
    message:
      dependencies.platform === "darwin"
        ? `macOS / ${dependencies.arch}`
        : `首期只支持 macOS，当前为 ${dependencies.platform} / ${dependencies.arch}`,
  });

  checks.push(
    commandCheck(dependencies, "swift", "Swift", "xcrun", [
      "swift",
      "--version",
    ]),
  );

  const powerpointInstalled = dependencies.exists(POWERPOINT_PATH);
  checks.push({
    id: "powerpoint",
    label: "Microsoft PowerPoint",
    status: powerpointInstalled ? "pass" : "fail",
    message: powerpointInstalled
      ? `${POWERPOINT_PATH} 已安装`
      : `${POWERPOINT_PATH} 不存在`,
  });

  const powerpointFontPath = POWERPOINT_FONT_PATHS.find((path) =>
    dependencies.exists(path),
  );
  checks.push({
    id: "font-microsoft-yahei",
    label: DEFAULT_FONT_FACE,
    status: powerpointFontPath ? "pass" : "fail",
    message: powerpointFontPath
      ? `PowerPoint 内置字体可用：${powerpointFontPath}`
      : "未发现 PowerPoint 内置微软雅黑；导出前必须显式安装或配置备用字体",
    details: powerpointFontPath
      ? { source: "powerpoint-bundle", path: powerpointFontPath }
      : undefined,
  });

  const summary = checks.reduce(
    (counts, check) => {
      counts[check.status] += 1;
      return counts;
    },
    { pass: 0, warn: 0, fail: 0 },
  );

  return DoctorReportSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    generatedAt: dependencies.now().toISOString(),
    checks,
    summary,
  });
}

export function collectSystemDoctorReport(): DoctorReport {
  return collectDoctorReport({
    nodeVersion: process.version,
    platform: platform(),
    arch: arch(),
    exists: existsSync,
    run: (command, args) =>
      execFileSync(command, [...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    now: () => new Date(),
  });
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = report.checks.map((check) => {
    const marker =
      check.status === "pass" ? "✓" : check.status === "warn" ? "!" : "✗";
    return `${marker} ${check.label}: ${check.message}`;
  });

  lines.push(
    `汇总：${report.summary.pass} 通过，${report.summary.warn} 警告，${report.summary.fail} 失败`,
  );
  return lines.join("\n");
}

export function assertPptxFontReady(
  report: DoctorReport,
  explicitFontFace: string | undefined,
): void {
  if (explicitFontFace !== undefined) {
    return;
  }

  const fontCheck = report.checks.find(
    (check) => check.id === "font-microsoft-yahei",
  );
  if (fontCheck?.status !== "pass") {
    throw new FoundationError(
      "MISSING_DEPENDENCY",
      `${DEFAULT_FONT_FACE} 不可用；请安装字体或通过 --font-face 显式指定备用字体`,
      { check: fontCheck ?? null },
    );
  }
}

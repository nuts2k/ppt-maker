import { describe, expect, it } from "vitest";
import type {
  DoctorCheckItem,
  DoctorReport,
} from "../src/main/ipc/channels.js";
import {
  doctorChipView,
  exportNotice,
  startupNotice,
} from "../src/renderer/lib/doctor-view.js";

function check(id: string, status: DoctorCheckItem["status"]): DoctorCheckItem {
  return { id, label: id, status, message: `${id} 的说明` };
}

/** 按检查项自动汇总 summary，避免测试用例手写计数出错 */
function report(...checks: readonly DoctorCheckItem[]): DoctorReport {
  const summary = { pass: 0, warn: 0, fail: 0 };
  for (const item of checks) summary[item.status] += 1;
  return { checks, summary };
}

/** 与真实 doctor 一致的全绿报告：node / pnpm / platform / swift / powerpoint / 字体 */
function healthyReport(): DoctorReport {
  return report(
    check("node", "pass"),
    check("pnpm", "pass"),
    check("platform", "pass"),
    check("swift", "pass"),
    check("powerpoint", "pass"),
    check("font-microsoft-yahei", "pass"),
  );
}

describe("doctorChipView", () => {
  it("加载中（无报告、未失败）不渲染 chip", () => {
    expect(doctorChipView(null, false)).toBeNull();
  });

  it("doctor 调用失败降级为环境未知而非隐藏", () => {
    expect(doctorChipView(null, true)?.label).toBe("环境未知");
  });

  it("全通过显示环境正常", () => {
    expect(doctorChipView(healthyReport(), false)?.label).toBe("环境正常");
  });

  it("有失败项时优先显示失败计数", () => {
    const view = doctorChipView(
      report(check("pnpm", "warn"), check("powerpoint", "fail")),
      false,
    );
    expect(view?.label).toBe("环境异常 1 项");
    expect(view?.className).toContain("signature-coral");
  });

  it("只有警告时显示警告计数（含基线项，与下拉明细同口径）", () => {
    const view = doctorChipView(report(check("pnpm", "warn")), false);
    expect(view?.label).toBe("环境警告 1 项");
    expect(view?.className).toContain("signature-mustard");
  });
});

describe("startupNotice", () => {
  it("报告未就绪时不提示", () => {
    expect(startupNotice(null)).toBeNull();
  });

  it("全通过不提示", () => {
    expect(startupNotice(healthyReport())).toBeNull();
  });

  it("基线项（node / pnpm）异常不打扰用户", () => {
    const result = startupNotice(
      report(check("node", "warn"), check("pnpm", "fail")),
    );
    expect(result).toBeNull();
  });

  it("关键项异常时提示，且只列出未通过的关键项", () => {
    const result = startupNotice(
      report(
        check("pnpm", "warn"),
        check("platform", "pass"),
        check("swift", "fail"),
        check("font-microsoft-yahei", "warn"),
      ),
    );
    expect(result?.level).toBe("fail");
    expect(result?.title).toBe("环境检查发现 2 项异常");
    expect(result?.items.map((item) => item.id)).toEqual([
      "swift",
      "font-microsoft-yahei",
    ]);
  });

  it("关键项只有警告时按警告呈现", () => {
    const result = startupNotice(report(check("swift", "warn")));
    expect(result?.level).toBe("warn");
    expect(result?.title).toBe("环境检查发现 1 项警告");
  });

  it("条目顺序沿用报告本身，与 chip 明细一致", () => {
    const result = startupNotice(
      report(
        check("font-microsoft-yahei", "fail"),
        check("powerpoint", "fail"),
        check("platform", "fail"),
      ),
    );
    expect(result?.items.map((item) => item.id)).toEqual([
      "font-microsoft-yahei",
      "powerpoint",
      "platform",
    ]);
  });
});

describe("exportNotice", () => {
  it("报告未就绪时不拦截导出", () => {
    expect(exportNotice(null)).toBeNull();
  });

  it("全通过不拦截导出", () => {
    expect(exportNotice(healthyReport())).toBeNull();
  });

  it("Swift 缺失不拦截导出（已完成页的拼装不依赖 OCR）", () => {
    const result = exportNotice(
      report(
        check("swift", "fail"),
        check("powerpoint", "pass"),
        check("font-microsoft-yahei", "pass"),
      ),
    );
    expect(result).toBeNull();
  });

  it("字体不可用时拦截并说明后果", () => {
    const result = exportNotice(report(check("font-microsoft-yahei", "fail")));
    expect(result?.level).toBe("fail");
    expect(result?.title).toBe("1 项环境检查未通过，仍要导出吗？");
    expect(result?.items.map((item) => item.id)).toEqual([
      "font-microsoft-yahei",
    ]);
  });

  it("PowerPoint 与字体同时缺失时合并为一条", () => {
    const result = exportNotice(
      report(
        check("powerpoint", "fail"),
        check("font-microsoft-yahei", "fail"),
        check("pnpm", "warn"),
      ),
    );
    expect(result?.items).toHaveLength(2);
    expect(result?.title).toBe("2 项环境检查未通过，仍要导出吗？");
  });
});

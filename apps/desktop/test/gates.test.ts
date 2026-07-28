import { describe, expect, it } from "vitest";
import { describePageDone, gateLabel } from "../src/shared/gates.js";

describe("gateLabel", () => {
  it("覆盖 CLI 会返回的全部人工闸门", () => {
    expect(gateLabel("human-edit")).toBe("停在文本复核门");
    expect(gateLabel("api")).toBe("停在 API 调用确认");
    expect(gateLabel("upload")).toBe("停在上传确认");
    expect(gateLabel("manual")).toBe("停在最终确认");
    expect(gateLabel("validation-failed")).toBe("复核校验未通过");
  });

  it("失败与无闸门都没有前缀", () => {
    expect(gateLabel("error")).toBeNull();
    expect(gateLabel(null)).toBeNull();
  });
});

describe("describePageDone", () => {
  it("闸门前缀之后原样接 CLI 的 message", () => {
    expect(
      describePageDone(
        "page-02",
        "human-edit",
        "有 45 个版式目标文字待人工复核",
      ),
    ).toBe("page-02 · 停在文本复核门：有 45 个版式目标文字待人工复核");
  });

  it("正常跑完不加前缀", () => {
    expect(
      describePageDone("page-01", null, "已执行到 report，流水线完成"),
    ).toBe("page-01 · 已执行到 report，流水线完成");
  });

  it("未知闸门不编造文案，退回纯 message", () => {
    expect(describePageDone("page-01", "future-gate", "新闸门")).toBe(
      "page-01 · 新闸门",
    );
  });
});

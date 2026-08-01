import { FoundationError } from "@ppt-maker/core";

/**
 * 解析 `--pages` 的页号范围，如 `3-8,12`。
 *
 * 返回升序去重的 PDF 原始页号。是否越界不在这里判断——越界页要带 `out_of_range`
 * 进入抽取报告（用户写了 `--pages 99` 需要看到「这页不存在」，而不是静默消失）。
 */
export function parsePageSelection(spec: string): number[] {
  const trimmed = spec.trim();
  if (trimmed.length === 0) {
    throw new FoundationError("INVALID_INPUT", "--pages 不能为空", { spec });
  }

  const selected = new Set<number>();
  for (const rawPart of trimmed.split(",")) {
    const part = rawPart.trim();
    if (part.length === 0) {
      throw new FoundationError(
        "INVALID_INPUT",
        `--pages 含空的区间：${spec}`,
        { spec },
      );
    }

    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range?.[1] !== undefined && range[2] !== undefined) {
      const from = Number.parseInt(range[1], 10);
      const to = Number.parseInt(range[2], 10);
      if (from < 1 || to < 1) {
        throw new FoundationError(
          "INVALID_INPUT",
          `--pages 的页号必须从 1 开始：${part}`,
          { spec, part },
        );
      }
      if (to < from) {
        throw new FoundationError(
          "INVALID_INPUT",
          `--pages 的区间起点大于终点：${part}`,
          { spec, part },
        );
      }
      for (let page = from; page <= to; page += 1) {
        selected.add(page);
      }
      continue;
    }

    if (!/^\d+$/.test(part)) {
      throw new FoundationError(
        "INVALID_INPUT",
        `--pages 只接受页号或 a-b 区间：${part}`,
        { spec, part },
      );
    }
    const page = Number.parseInt(part, 10);
    if (page < 1) {
      throw new FoundationError(
        "INVALID_INPUT",
        `--pages 的页号必须从 1 开始：${part}`,
        { spec, part },
      );
    }
    selected.add(page);
  }

  return [...selected].sort((a, b) => a - b);
}

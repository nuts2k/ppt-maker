#!/usr/bin/env python3
"""复现 prd.md 中 F-2 / F-3 / F-6 / F-7 / F-8 / F-9 / F-10 的全部测量数字。

用法（无需真实工作区，直接跑仓库内快照）：
    python3 .trellis/tasks/07-26-review-flow-simplification/research/measure.py

数据来源：research/data-snapshot/，取自真实工作区 ~/test/ppttest-2026-07-25
（2026-07-24 生成，2 页 155 块）。仅含 text-blocks.json 与 clean 检查指标，
不含源图与 clean plate，故视觉类走查仍需真实工作区。
"""

from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

SNAPSHOT = Path(__file__).parent / "data-snapshot"
PAGES = ("page-01", "page-02")


def load(page: str) -> dict:
    return json.loads((SNAPSHOT / page / "text-blocks.json").read_text())


def norm(text: str | None) -> str:
    return re.sub(r"\s+", "", text or "")


def source_texts(block: dict) -> tuple[str | None, str | None]:
    by_kind = {s["kind"]: s for s in block["sources"]}
    return (
        by_kind.get("offline_ocr", {}).get("text"),
        by_kind.get("ai_text_assist", {}).get("text"),
    )


def f2_font_size_and_thresholds(page: str, doc: dict) -> None:
    """F-2：字号缺失 + bbox 高度阈值命中率。"""
    blocks, height = doc["blocks"], doc["image"]["height"]
    have_size = sum(1 for b in blocks if b["style"]["fontSizePx"] is not None)
    print(f"  F-2 style.fontSizePx 非空: {have_size}/{len(blocks)}")
    have_vision = sum(
        1 for b in blocks if any(s["kind"] == "cloud_vision" for s in b["sources"])
    )
    print(f"      cloud_vision 来源块: {have_vision}/{len(blocks)}")
    for pct in (1.3, 1.6, 2.0, 2.4):
        limit = height * pct / 100
        hit = [b for b in blocks if b["bboxPx"]["height"] < limit]
        layout = [b for b in hit if b["classification"] == "layout_text"]
        print(
            f"      阈值 {pct}%H={limit:.1f}px: 命中 {len(hit)}/{len(blocks)}"
            f"，其中 layout_text {len(layout)}"
        )


def f3_line_fragments(doc: dict) -> None:
    """F-3：行级碎片（多行块数）。"""
    blocks = doc["blocks"]
    multi = sum(1 for b in blocks if len(b["lines"]) > 1)
    print(f"  F-3 多行块: {multi}/{len(blocks)}（为 0 说明全部是行级碎片）")


def f6_no_human_edits(doc: dict) -> None:
    """F-6：界面未被使用的痕迹。"""
    blocks = doc["blocks"]
    print(
        f"  F-6 updatedAt 非空 {sum(1 for b in blocks if b['updatedAt'] is not None)}"
        f" / manual 来源 {sum(1 for b in blocks if any(s['kind'] == 'manual' for s in b['sources']))}"
        f" / rotationDeg≠0 {sum(1 for b in blocks if b['rotationDeg'] != 0)}"
        f" / quadPx 非空 {sum(1 for b in blocks if b['quadPx'] is not None)}"
        f"（共 {len(blocks)} 块，全部 reviewStatus="
        f"{Counter(b['reviewStatus'] for b in blocks).most_common(1)[0][0]}）"
    )


def f7_object_symbol_suspects(doc: dict) -> None:
    """F-7：被判为 object_symbol 的块清单（人工判断是否误判）。"""
    symbols = [
        b for b in doc["blocks"] if b["classification"] == "object_integrated_symbol"
    ]
    print(f"  F-7 object_integrated_symbol {len(symbols)} 块:")
    print("      " + " · ".join(b["text"] for b in symbols))


def f8_ghosting_risk(doc: dict) -> None:
    """F-8：layout_text 未入 mask → 导出重影。"""
    bad = [
        b
        for b in doc["blocks"]
        if b["classification"] == "layout_text" and not b["includeInMask"]
    ]
    if bad:
        for b in bad:
            print(
                f"  F-8 重影风险块 {b['id']}: {b['text']!r}"
                f" 高 {b['bboxPx']['height']:.0f}px reviewStatus={b['reviewStatus']}"
            )
    else:
        print("  F-8 无 layout_text 未入 mask 的块")


def f9_source_disagreement(doc: dict) -> None:
    """F-9 / D4：双源分歧率，即三分区的项数。"""
    blocks = doc["blocks"]
    layout = [b for b in blocks if b["classification"] == "layout_text"]
    disagree = []
    for b in layout:
        ocr, assist = source_texts(b)
        if ocr is not None and assist is not None and norm(ocr) != norm(assist):
            disagree.append((b["id"], ocr, assist))
    non_layout = len(blocks) - len(layout)
    print(
        f"  F-9 分区: 文字待确认 {len(disagree)}"
        f" / 分类待确认 {non_layout}"
        f" / 已一致 {len(layout) - len(disagree)}"
        f"（layout_text {len(layout)}，分歧率 {len(disagree) / len(layout):.0%}）"
    )
    for block_id, ocr, assist in disagree[:5]:
        print(f"      {block_id}: {ocr!r} → {assist!r}")

    low_conf = sum(
        1
        for b in layout
        for s in b["sources"]
        if s["kind"] == "offline_ocr"
        and s["confidence"] is not None
        and s["confidence"] < 0.85
    )
    print(f"      对照：OCR confidence<0.85 覆盖 {low_conf}/{len(layout)}（筛不掉工作量）")


def f10_merge_simulation(doc: dict, strict: bool) -> int:
    """F-10：行→段落几何合并模拟，返回合并后组数。"""
    blocks, width = doc["blocks"], doc["image"]["width"]
    items = sorted(blocks, key=lambda b: (b["bboxPx"]["y"], b["bboxPx"]["x"]))
    groups: list[list[dict]] = []
    tol = width * (0.008 if strict else 0.012)
    for block in items:
        box = block["bboxPx"]
        for group in groups:
            prev = group[-1]
            prev_box = prev["bboxPx"]
            if prev["classification"] != block["classification"]:
                continue
            ratio = min(prev_box["height"], box["height"]) / max(
                prev_box["height"], box["height"]
            )
            if ratio < (0.92 if strict else 0.75):
                continue
            gap = box["y"] - (prev_box["y"] + prev_box["height"])
            if gap > 0.8 * prev_box["height"] or gap < -0.5 * prev_box["height"]:
                continue
            left_delta = abs(box["x"] - prev_box["x"])
            center_delta = abs(
                (box["x"] + box["width"] / 2)
                - (prev_box["x"] + prev_box["width"] / 2)
            )
            if (left_delta if strict else min(left_delta, center_delta)) > tol:
                continue
            overlap = min(prev_box["x"] + prev_box["width"], box["x"] + box["width"]) - max(
                prev_box["x"], box["x"]
            )
            if overlap <= 0:
                continue
            # 严格版：首行明显短于次行 → 疑似标题，不并入
            if strict and len(group) == 1 and prev_box["width"] < 0.6 * box["width"]:
                continue
            group.append(block)
            break
        else:
            groups.append([block])
    return len(groups)


def f4_clean_checks(page: str) -> None:
    """F-4：clean 自动检查不具备判别力。"""
    records = json.loads((SNAPSHOT / page / "clean-checks.json").read_text())
    for attempt, checks in records.items():
        if checks is None:
            continue
        print(
            f"  F-4 {attempt}: 残字像素 {checks['textResidue']['residualForegroundPixels']}"
            f" · size.ok {checks['size']['ok']}"
            f" · maskOutside {checks['outsideMaskDiff']['changedRatio']:.2%}"
            f" · containerRing {checks['containerRingDiff']['changedRatio']:.2%}"
        )


def main() -> None:
    for page in PAGES:
        doc = load(page)
        blocks = doc["blocks"]
        print(f"== {page}  {doc['image']['width']}×{doc['image']['height']}  {len(blocks)} 块")
        print(f"  分类分布: {dict(Counter(b['classification'] for b in blocks))}")
        f2_font_size_and_thresholds(page, doc)
        f3_line_fragments(doc)
        f4_clean_checks(page)
        f6_no_human_edits(doc)
        f7_object_symbol_suspects(doc)
        f8_ghosting_risk(doc)
        f9_source_disagreement(doc)
        loose = f10_merge_simulation(doc, strict=False)
        tight = f10_merge_simulation(doc, strict=True)
        print(f"  F-10 合并模拟: 宽松 {len(blocks)}→{loose} · 严格 {len(blocks)}→{tight}")
        print()


if __name__ == "__main__":
    main()

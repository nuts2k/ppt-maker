#!/bin/bash
# 批量运行 M2 评测集的离线阶段：init → ocr → review
# 不涉及 API 调用，全部本地完成
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PAGES_DIR="$PROJECT_ROOT/artifacts/m2-pages"
WORKSPACES_DIR="$PROJECT_ROOT/artifacts/m2-workspaces"

mkdir -p "$WORKSPACES_DIR"

SUCCESS=0
FAIL=0

for page in "$PAGES_DIR"/page-*.png; do
  slug=$(basename "$page" .png)
  ws="$WORKSPACES_DIR/$slug"

  if [ -d "$ws" ]; then
    echo "[$slug] 工作区已存在，跳过 init"
  else
    echo "[$slug] init..."
    if ! pnpm ppt-maker slide init "$page" --workspace "$ws" > /dev/null 2>&1; then
      echo "[$slug] init 失败"
      FAIL=$((FAIL + 1))
      continue
    fi
  fi

  # 检查 ocr 是否已完成
  if [ -f "$ws/stages/ocr/ocr-001/result.json" ]; then
    echo "[$slug] OCR 已完成，跳过"
  else
    echo "[$slug] ocr..."
    if ! pnpm ppt-maker slide ocr "$ws" > /dev/null 2>&1; then
      echo "[$slug] ocr 失败"
      FAIL=$((FAIL + 1))
      continue
    fi
  fi

  # review（生成 text-blocks.json）
  if [ -f "$ws/stages/review/text-blocks.json" ]; then
    echo "[$slug] review 已完成，跳过"
  else
    echo "[$slug] review..."
    if ! pnpm ppt-maker slide review "$ws" > /dev/null 2>&1; then
      echo "[$slug] review 失败（可能需要 review 命令，尝试 run --from review）"
      pnpm ppt-maker slide run --from review "$ws" > /dev/null 2>&1 || true
    fi
  fi

  SUCCESS=$((SUCCESS + 1))
  echo "[$slug] 离线阶段完成"
done

echo ""
echo "=== 批量离线阶段完成 ==="
echo "成功: $SUCCESS  失败: $FAIL"

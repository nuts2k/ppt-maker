#!/bin/bash
# 快照一个 deck 的逐页状态 + 每页目录内容指纹，用于「其它页零变化」这类判据。
#
# 只断言 deck status 的字段不够：换源 / 追加会不会动到别页的**产物**，靠的是
# 逐页目录的 shasum 前后一致。两样都要。
#
# 用法：snap.sh ~/test/some-deck /tmp/before.txt
#      ...做操作...
#      snap.sh ~/test/some-deck /tmp/after.txt && diff /tmp/before.txt /tmp/after.txt
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"
DECK="$1"; OUT="$2"

cd "$REPO"
node apps/cli/dist/index.js deck status "$DECK" --json 2>/dev/null | python3 -c "
import json,sys
d=json.load(sys.stdin)
print('summary', json.dumps(d['summary'],ensure_ascii=False,sort_keys=True))
for s in d['slides']:
    print(s['workspacePath'], s['currentStage'], s['stageStatus'], s['sourceKind'], s['specDrift'], s['sourceImageName'])
" > "$OUT"

for d in "$DECK"/slides/*/; do
  echo "HASH $(basename "$d") $(find "$d" -type f | sort | xargs shasum 2>/dev/null | shasum | cut -d' ' -f1)" >> "$OUT"
done

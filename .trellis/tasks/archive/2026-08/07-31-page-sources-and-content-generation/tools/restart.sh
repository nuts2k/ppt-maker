#!/bin/bash
# 单实例重启桌面端 dev（renderer 9222 + main 5858），并把选择框桩打进主进程。
#
# 为什么要「单实例」：两个 Electron 一起活着会抢端口——旧实例占着 9222、新实例
# 只拿到 5858，于是补丁打在 A、界面跑在 B，表现为打了桩却毫无效果，很难看出来。
#
# 用法：.trellis/tasks/.../tools/restart.sh          （在仓库根目录跑）
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../../.." && pwd)"

pkill -9 -f "electron@43.2.0" 2>/dev/null
pkill -9 -f "electron-vite" 2>/dev/null
sleep 3

cd "$REPO"
REMOTE_DEBUGGING_PORT=9222 V8_INSPECTOR_PORT=5858 nohup pnpm desktop > /tmp/ppt-maker-desktop-dev.log 2>&1 &

for i in $(seq 1 40); do
  if curl -s --max-time 1 http://127.0.0.1:9222/json/list 2>/dev/null | grep -q 5173 \
     && curl -s --max-time 1 http://127.0.0.1:5858/json/list 2>/dev/null | grep -q webSocketDebuggerUrl; then
    echo "ports ready after ${i}s"
    break
  fi
  sleep 1
done
sleep 2

cd "$HERE" && node main-cdp.mjs evalfile patch-dialog.js

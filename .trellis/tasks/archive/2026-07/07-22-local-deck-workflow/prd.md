# M3 多页本地转换工具

## 目标

把 M1 单页 pipeline 扩展为多页图片转 PPTX 工具，形成开发者本人可长期使用的本地转换工作流。

## 背景

- **Monorepo**：`packages/core`（Zod schema / 纯数据契约）+ `apps/cli`（CLI 命令与 I/O 逻辑）
- **单页 CLI**：`ppt-maker slide <subcommand> <workspace>`，每个 workspace 对应一张幻灯片
- **工作区磁盘布局**：`manifest.json`（assets / stages / attempts）、`config.json`（16:9 / 微软雅黑 / explicit_only）、`inputs/`、`stages/<name>/<attempt-id>/`
- **阶段 DAG**：init → ocr → review → assist-review → mask → clean → accept-clean → pptx → accept-pptx → report
- **关键机制**：指纹复用、上传门 / 人工门停止、SHA256 完整性校验、上游变更自动 stale 下游
- **M2 评测**：25 页独立 slide workspace（`artifacts/m2-workspaces/page-XX/`），批处理通过外部脚本逐页调用，无 deck 层概念

## 需求

### R1 Deck 数据模型

Deck 目录 = 轻量索引 manifest + N 个独立 slide workspace 子目录。slide workspace 内部结构不变，deck manifest 只记录页面顺序、全局配置和导出记录。Deck manifest schema 定义在 `packages/core`，与 `SlideWorkspaceManifestSchema` 平级。

### R2 多页导入

`deck init --images <dir> --workspace <path>`，扫描目录下所有 PNG/JPEG，按文件名排序创建 slide workspace。`--name <title>` 可选，默认用目录名。首版不支持参考文案批量匹配。

### R3 批处理执行

`deck run <deck> --confirm-api --confirm-upload`，逐页串行执行 pipeline 的所有可自动化阶段。人工门（accept-clean、accept-pptx）仍逐页停止。单页失败记录错误后继续下一页。执行结束后汇报每页的停止状态。

### R4 多页 PPTX 导出

`deck export <deck> -o <output.pptx>`，合并所有页面为单一 PPTX 文件。已通过 accept-pptx 的页面使用原生文本层，未完成的页面用源图做占位页（标记"待完成"），保持页码连续。可选 `--strict` 要求全部验收才允许导出。

### R5 状态查看

`deck status <deck>` 输出每页当前阶段状态 + 汇总统计（完成 / 待人工 / 失败），支持 `--json`。详细检查信息用 `slide report <workspace>` 查看单页。

### R6 页面增删

`deck add-slide <deck> <image>` 追加页面到 deck 末尾。`deck remove-slide <deck> <page>` 从 manifest 移除引用但不删除磁盘数据。首版不支持页面重排序。

### R7 CLI 结构

新增 `deck` 顶层命令，与 `slide` 平级。`slide` 命令保持不变，用户仍可单独操作单页 workspace。

### R8 阶段恢复与持久化

Deck manifest 和 slide workspace 全部持久化到磁盘。中断后重启 `deck run` 可恢复，已完成的阶段通过指纹复用跳过。

## 验收标准

- [ ] AC1：`deck init --images <dir>` 创建 deck workspace，包含按文件名排序的 slide workspace 子目录
- [ ] AC2：`deck run --confirm-api --confirm-upload` 逐页推进到人工门，单页失败不影响其他页面
- [ ] AC3：`deck status` 正确显示每页阶段状态和汇总统计
- [ ] AC4：`deck export -o output.pptx` 生成多页 PPTX，已验收页面为原生文本层，未完成页面为源图占位页
- [ ] AC5：`deck export --strict` 在存在未验收页面时拒绝导出
- [ ] AC6：`deck add-slide` 可追加页面，`deck remove-slide` 可移除引用
- [ ] AC7：中断后重启 `deck run` 可恢复，已完成阶段不重复执行
- [ ] AC8：slide 命令可独立操作 deck 内的单页 workspace
- [ ] AC9：TypeScript 类型检查和现有测试不回退

## 非目标

- 完整桌面可视化编辑（M4）
- 内容策划和图片生成（M5）
- 非文字元素矢量化
- 页面并行执行
- 参考文案批量匹配
- 页面重排序

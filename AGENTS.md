# 本项目 Agent 约束

## Open Design 参考目录

`open-design/` 是外部仓库的只读参考副本，不是本项目未来要开发的项目，也不是本项目的代码基础。

- 允许：读取、搜索、分析其中的源码和文档。
- 禁止：修改 `open-design/` 下的任何文件，包括新增、删除、重命名、格式化和生成构建产物。
- 禁止：在 `open-design/` 内安装依赖或执行会产生文件写入的操作。
- 本项目的代码、配置、依赖和实现必须放在 `open-design/` 之外。

相关技术栈和架构记录见 [OPEN-DESIGN-REFERENCE.md](/Users/kelin/Work/ppt-maker/OPEN-DESIGN-REFERENCE.md)。

## 子代理派发原则

- 调用 `spawn_agent` 时，`fork_turns` 默认使用 `"none"`，并在 `message` 中提供完成任务所需的全部信息。
- 仅当任务依赖近期对话时，才将 `fork_turns` 设置为满足需求的最小值 `"1"` 或 `"2"`。
- 不使用 `fork_turns="all"`。

## 语言与沟通规范

- 非必要情况下，沟通、代码注释、Git 提交消息、文档均使用**中文**。
- 变量名、函数名、类型名等代码标识符使用英文。
- 不发送非必要的过程性说明。

## 前端设计规范

- 所有前端界面的视觉设计必须遵从 [DESIGN.md](/Users/kelin/Work/ppt-maker/DESIGN.md)。
- 包括但不限于：颜色、排版、圆角、间距、组件样式和响应式行为。
- 实现前端代码前必须先读取 DESIGN.md，确保设计一致性。

## 代码搜索规则

- **代码语义探索优先 CodeGraph**：当目标是理解代码实现、调用链、影响面、符号关系、handler/service/store/router 追踪时，优先使用 CodeGraph MCP（`codegraph_context` / `codegraph_trace` / `codegraph_impact` / `codegraph_search`）。若 CodeGraph 未初始化、不可用或结果不足，再回退到 `mcp__fast-context__fast_context_search`。
- **文档语义探索优先 fast-context**：当目标是检索历史设计文档、实施计划、ROADMAP/PRD、执行记录、业务背景、跨 Markdown 方案对齐时，优先使用 `mcp__fast-context__fast_context_search`。
- **探索性问题禁止直接 Grep**：当用户提问包含“……是什么”“怎么实现的”“机制”“流程”“逻辑”“策略”等探索性关键词时，必须先按上述路由选择 CodeGraph 或 fast-context，禁止直接 Grep。
- **精确定位**：已知文件名、函数名、字符串、错误消息、日志文本、测试名时，用 Grep / Glob；已知文件路径时直接读取。
- **Worktree 注意**：CodeGraph 索引按 worktree 独立维护；若 CodeGraph 提示当前 worktree 未初始化或索引来自其他 worktree，先在当前 worktree 根目录运行 `codegraph init -i`。
- 并行读取多个文件时无需等待，直接同时发起所有 Read 调用。
<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->

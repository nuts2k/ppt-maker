# 后端开发规范

本目录记录 PPT Maker 已由真实代码和技术探针验证的 CLI、核心领域契约与原生适配器约定。未实现的 Electron、数据库和完整转换流水线不得提前写入规范。

## 规范索引

| 规范 | 内容 | 状态 |
|---|---|---|
| [目录结构](./directory-structure.md) | pnpm workspace、核心包、CLI 和 macOS 原生适配器边界 | M0 已验证 |
| [跨层契约](./contracts.md) | CLI、OCR JSON、单页工作区、阶段图、16:9 与 PPTX 边界、双人工点闸门与瞬态阶段失效、多代资产的「当前产物」判据、**来源规则派生状态的重判点与消费端**、原生二进制契约边界、独立契约文件的版本轴、模型可提案不可直接落盘、**规格写入唯一入口与变更日志** | M1 部分已验证；M4 链路契约已由端到端走查验证；M5 四节由真实 deck、真实 PDF 与阶段三集成走查验证；M6「规格写入唯一入口与变更日志」已由真实 deck 走查验证（2026-08-03），「模型可提案不可直接落盘」已由受控 Provider、跨层自动测试、桌面视觉走查及真实 `gpt-5.6-luna` / 最小一页 strict PPTX 链路验证（2026-08-04） |
| [错误处理](./error-handling.md) | 稳定错误码、工作区完整性、CLI 退出行为和 Provider 响应校验 | M1 部分已验证 |
| [质量规范](./quality-guidelines.md) | Node 24、TypeScript、Biome、Vitest 和探针验证 | M0 已验证 |
| [日志规范](./logging-guidelines.md) | 当前 CLI 输出和后续结构化日志边界 | M0 最小规范 |
| [数据库规范](./database-guidelines.md) | 持久化、迁移和查询约定 | M3 前不填写 |

## 质量检查

修改 backend 代码后至少运行：

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

涉及 Node 运行时行为时还必须在 Node.js 24 环境验证。涉及 OCR 或 PPTX 时，应使用仓库内 16:9 PNG/JPEG fixture 运行对应探针，并记录无法自动验证的 PowerPoint/macOS 权限边界。

`open-design/` 是只读参考副本，不得纳入 workspace、格式化、构建、测试或依赖安装范围。

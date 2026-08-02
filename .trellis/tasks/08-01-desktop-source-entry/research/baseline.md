# 开工前基线（2026-08-01，规划会话）

`implement.md` 阶段 1.1 的「纯类型移动、零回归」以本记录为准。

## 命令与结果

```bash
pnpm -r build && pnpm format:check && pnpm -r typecheck && pnpm -r test
# EXIT=0
```

| 包 | 测试文件 | 用例 |
|---|---|---|
| `packages/core` | 9 | 103 passed |
| `apps/desktop` | 28 | 359 passed |
| `apps/cli` | 26 | 163 passed |
| **合计** | **63** | **625 passed** |

`pnpm -r build`（含 `build:pdf` / `build:vision` 两个原生二进制）、`pnpm format:check`、
`pnpm -r typecheck` 均无输出错误。

## 用法

阶段 1.1 做完后重跑同一条命令，**用例数必须仍是 625 且全绿**。任何一条变红都说明
类型移动动到了行为——立即停下查清楚，不要顺手改测试让它变绿。

后续阶段会新增用例，届时基数只增不减；减少即为回归。

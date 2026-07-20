# 目录结构

## 当前布局

```text
apps/
  cli/                       # 命令解析、环境诊断、技术探针和单页阶段编排
packages/
  core/                      # 平台无关领域 Schema、常量、坐标和错误类型
native/
  macos-vision-ocr/          # Apple Vision Swift 可执行适配器
fixtures/
  foundation/                # 可提交的受控 PNG/JPEG 与生成脚本输入
```

pnpm workspace 只包含 `apps/*` 和 `packages/*`。Swift 适配器由根脚本构建，但不是 JavaScript workspace 包。

## 模块边界

- `packages/core` 不依赖 CLI、PptxGenJS、Swift 或 `open-design/`，也不暴露 Apple Vision 类型。
- `apps/cli` 负责解析参数、调用核心校验、启动外部适配器及写出显式目标文件，不承载长期领域状态。
- `apps/cli/src/slide/` 负责 M1 页面工作区的文件编排；阶段图、Schema 和失效规则仍由 `packages/core` 持有。
- `native/macos-vision-ocr` 只负责调用系统 Vision 并输出版本化 JSON；它不得修改输入图片或联网。
- 测试放在各包的 `test/`，并通过公开或明确导出的函数验证稳定行为。
- 生成物只进入已忽略的 `dist/`、`native/**/.build/` 和 `artifacts/`。

## 新模块放置规则

- 可被 CLI 和未来 Electron 共用的纯领域逻辑放入 `packages/core/src/`。
- 只涉及命令行 I/O 或系统进程编排的代码放入 `apps/cli/src/`。
- macOS 框架类型和调用留在 `native/`，通过 JSON Schema 穿越进程边界。
- 没有真实实现前，不创建空 Electron、数据库、daemon 或 Provider 包。

## 命名与导入

- TypeScript 文件使用小写短横线或已有的单词文件名，类型和函数使用英文标识符。
- 项目采用 strict ESM；源码相对导入必须写 `.js` 后缀，例如 `./contracts.js`。
- 跨包通过包名导入，例如 `@ppt-maker/core`，禁止从另一个包的 `src/` 深层导入。

## 禁止模式

- 禁止复制、修改或运行 `open-design/` 的源码作为产品基础。
- 禁止核心包直接执行系统命令、读取 PowerPoint 应用包或引用 Vision 类型。
- 禁止为了未来功能提前创建没有实现和测试的目录层级。

# 质量规范

## 工具链基线

- Node.js：24 LTS，`engines` 为 `>=24 <25`。
- pnpm：10.x，根 `packageManager` 固定精确版本。
- TypeScript：strict + ESM/NodeNext。
- 格式与静态检查：Biome。
- 单元与契约测试：Vitest。

## 必须遵守

- 所有跨进程或可持久化数据使用 Zod 运行时校验，并包含 `schemaVersion`。
- 文字、路径、Provider 名称等必填字符串使用非空约束；哈希和坐标使用具体格式/范围约束。
- 图片像素坐标是权威坐标，只在 PPTX 合成边界换算为英寸。
- 无法可靠获取的值显式使用 `null`，例如当前 Vision 的 `rotationDeg`；禁止编造默认角度或置信度。
- fixture 路径从 `import.meta.url` 或显式参数解析，测试不得依赖调用者的 `process.cwd()`。
- 原生模块缓存和产物写入仓库内已忽略目录，保证受限环境可重复构建。

## 测试要求

- 新增纯函数必须覆盖正常、边界和错误输入。
- Schema 变更必须覆盖有效样例和至少一个无效样例。
- PNG/JPEG 读取必须使用真实受控文件测试，不以伪造扩展名代替格式覆盖。
- 命令行为测试必须断言退出语义、结构化输出或生成物关键内容。
- PPTX 除自动检查 ZIP/XML 外，还要记录 Microsoft PowerPoint for Mac 的人工打开、文本可编辑和字体属性验证。
- OCR 必须区分沙箱权限失败与正常 macOS 环境结果，并记录是否使用网络。

## 禁止模式

- 禁止 `any`、无解释的双重断言或跳过 Zod 校验。第三方 ESM 类型不准确时，只能在单一边界收窄到实际使用的最小接口。
- 禁止把 Quick Look 渲染结果当作 PowerPoint 字体或排版的权威证据。
- 禁止为让测试通过而伪造 OCR/PPTX 成功，或把人工验证写成自动验证。
- 禁止格式化、构建、测试或安装依赖时触碰 `open-design/`。

## 提交前检查

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
python3 ./.trellis/scripts/task.py validate <task>
git diff --check
```

涉及运行时兼容性的变更还必须在 Node.js 24 下执行相关测试。检查后确认 `git status` 中没有 `open-design/` 变化。

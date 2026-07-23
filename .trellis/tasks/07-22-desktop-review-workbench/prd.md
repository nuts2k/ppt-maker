# M4 桌面复核工作台

## 目标

把 M1–M3 建立的结构化文件校正流程（编辑 JSON → CLI 命令）升级为高效的可视化校正体验。开发者通过桌面应用完成多页 PPT 的复核、校正和导出，无需直接编辑 JSON 文件或手动运行 CLI 命令。

## 用户画像

开发者本人（单人本地使用），macOS + PowerPoint for Mac。

## 核心工作流

1. **打开 Deck** — 选择已有 deck 工作区或通过目录创建新 deck
2. **页面总览** — 缩略图列表查看所有页面及其阶段状态
3. **页面复核** — 在画布上叠加文字框，所见即所得地编辑文字内容、分类、位置和样式
4. **Pipeline 执行** — 从 UI 触发 OCR → assist-review → mask → clean → pptx 流程，阶段级进度反馈
5. **人工验收** — accept-clean（滑块擦除对比原图/clean plate）和 accept-pptx（内联确认面板）
6. **导出** — 多页合并为单一 PPTX

## 功能需求

### F1 Deck 管理

- F1.1 打开已有 deck 工作区（选择目录）
- F1.2 从图片目录创建新 deck（等同 `deck init --images <dir>`）
- F1.3 添加页面（等同 `deck add-slide`）
- F1.4 移除页面（等同 `deck remove-slide`，软删除）
- F1.5 页面缩略图列表，显示每页当前阶段状态

### F2 页面复核画布

- F2.1 原图上叠加半透明文字框，按 `text-blocks.json` 中的 `bboxPx` 定位
- F2.2 点击选中文字框，显示属性面板（text、lines、classification、includeInMask、style、reviewStatus）
- F2.3 双击文字框进入文字编辑模式，修改 text 和 lines
- F2.4 拖拽调整文字框位置（更新 bboxPx）
- F2.5 拖拽文字框边缘调整大小（更新 bboxPx width/height）
- F2.6 右键菜单快速切换 classification（layout_text / object_integrated_symbol / uncertain）
- F2.7 切换 includeInMask 状态
- F2.8 低置信度队列：高亮 reviewStatus === "unreviewed" 且 classification === "uncertain" 的块，支持逐个导航
- F2.9 候选来源查看：选中文字框时显示 sources 列表（offline_ocr / cloud_vision / reference_text / manual）
- F2.10 画布缩放和平移

### F3 原图/Clean Plate 对比

- F3.1 滑块擦除对比：单视图内垂直分割滑块，左半原图右半 clean plate
- F3.2 滑块可自由拖动
- F3.3 同步显示自动检查结果（文字残留、容器完整性等）

### F4 Pipeline 执行

- F4.1 从 UI 一键触发完整 pipeline（等同 `slide run --from init --confirm-api --confirm-upload`）
- F4.2 从指定阶段重跑（等同 `slide run --from <stage>`）
- F4.3 阶段级进度显示：每个阶段显示 pending / running / completed / failed 状态
- F4.4 执行过程中 UI 不阻塞，可切换查看其他页面
- F4.5 错误展示：失败阶段显示错误信息（code + message）
- F4.6 deck 级批量执行（等同 `deck run`），逐页串行，进度实时更新

### F5 人工验收门

- F5.1 accept-clean：pipeline 到达 accept-clean 阶段时暂停，在页面内显示内联确认面板
  - 展示自动检查结果
  - 核查清单（文字残留、容器完整性、非文字区域误改）
  - 接受/拒绝操作
- F5.2 accept-pptx：展示 PPTX 自动检查结果，核查清单，确认后记录接受
- F5.3 验收记录写入 workspace manifest（与 CLI 一致）

### F6 导出

- F6.1 导出按钮（等同 `deck export -o <path>`）
- F6.2 strict 模式开关（要求所有页通过 accept-pptx）
- F6.3 导出结果展示（原生页数 / 占位页数）
- F6.4 文件保存对话框选择输出路径

### F7 系统状态

- F7.1 环境检查（等同 `doctor`）：微软雅黑可用性、Apple Vision 可用性
- F7.2 环境问题在启动时提示，不阻止打开但在导出前警告

## 技术决策

| 领域 | 选择 | 理由 |
|------|------|------|
| 桌面框架 | Electron | 复用 Node.js 生态，直接 import 现有业务函数 |
| 前端框架 | React | 画布交互和状态管理生态成熟 |
| 构建工具 | electron-vite | Vite HMR + Electron 三入口开箱即用 |
| 状态管理 | Zustand | 轻量 TS 友好，slice 模式适合 deck→slide 树形数据 |
| CSS | Tailwind CSS | 单人项目快速迭代 |
| UI 组件库 | shadcn/ui | 源码级可控，Radix 基础，配合 Tailwind |
| 桥接方式 | 直接复用 | Electron main 进程 import 业务函数，renderer 通过 IPC 调用 |
| 视觉设计 | DESIGN.md | 遵从项目 DESIGN.md 设计系统 |

## 产品约束

- 仅 macOS，不考虑 Windows/Linux。
- 单人本地使用，无账号、无云同步、无多人协作。
- 所有数据操作必须通过现有业务函数（`packages/core` + `apps/cli/src`），UI 不绕过复核、版本和恢复契约。
- 人工门不可自动跳过，必须在 UI 中显式确认。
- 16:9 固定比例。
- 微软雅黑为唯一字体。

## 验收标准

- [ ] 可从 UI 打开已有 deck 工作区，看到页面缩略图列表和阶段状态
- [ ] 可从 UI 创建新 deck（选择图片目录）
- [ ] 页面复核画布：文字框叠加、选中、编辑文字、拖拽位置/大小、切换分类和 includeInMask
- [ ] 低置信度队列可逐块导航
- [ ] 滑块擦除对比原图和 clean plate
- [ ] 可从 UI 触发完整 pipeline 和按阶段重跑，阶段级进度实时显示
- [ ] accept-clean 和 accept-pptx 内联确认面板可用，验收记录正确写入
- [ ] 可从 UI 导出多页 PPTX（含 strict 模式）
- [ ] 环境检查在启动时执行并提示问题
- [ ] UI 操作产生的 workspace 数据与 CLI 完全兼容（CLI 可读取 UI 修改的数据，反之亦然）
- [ ] TypeScript 类型检查通过
- [ ] 所有前端视觉遵从 DESIGN.md 设计系统

## 非目标

- 账号、云同步、多人协作
- 普通用户级新手引导
- 内容策划和图片生成（M5）
- 页面并行执行优化
- 参考文案批量匹配
- Windows/Linux 支持

# M4 桌面复核工作台 — 实施计划

## 阶段概览

| 阶段 | 内容 | 验证 |
|------|------|------|
| P1 | Electron 骨架搭建 | 窗口启动、HMR、空白页面渲染 |
| P2 | IPC 层 + 业务桥接 | 从 renderer 调用 doctor 并显示结果 |
| P3 | Deck 管理页 | 打开/创建 deck、缩略图列表、阶段状态 |
| P4 | 复核画布 — 只读 | 原图 + 文字框叠加渲染、分类着色、缩放/平移 |
| P5 | 复核画布 — 编辑 | 选中、拖拽、缩放、双击编辑、分类切换、保存 |
| P6 | 低置信度队列 + 候选来源 | 队列导航、来源面板 |
| P7 | Pipeline 执行 + 进度 | 触发 pipeline、阶段进度、错误展示 |
| P8 | 人工验收门 | accept-clean 内联面板 + 滑块对比、accept-pptx 面板 |
| P9 | 导出 | 导出按钮、strict 模式、保存对话框 |
| P10 | 收尾 | 环境检查集成、typecheck、整体冒烟测试 |

## P1 Electron 骨架搭建

- [ ] 1.1 创建 `apps/desktop/package.json`，配置 electron、electron-vite、react、typescript 依赖
- [ ] 1.2 创建 `apps/desktop/electron.vite.config.ts`，配置 main/preload/renderer 三入口
- [ ] 1.3 创建 `apps/desktop/src/main/index.ts`：BrowserWindow 创建、加载 renderer
- [ ] 1.4 创建 `apps/desktop/src/main/preload/index.ts`：空 contextBridge
- [ ] 1.5 创建 `apps/desktop/src/renderer/index.html` + `main.tsx` + `App.tsx`：空白 React 页面
- [ ] 1.6 配置 Tailwind CSS（tailwind.config.ts、postcss.config.js、全局样式）
- [ ] 1.7 根 `package.json` 中添加 workspace 引用
- [ ] 1.8 配置 tsconfig.json（renderer 和 main 分开，路径别名指向 packages/core 和 apps/cli/src）

**验证**：`npm run dev` 启动后窗口显示空白 React 页面，HMR 生效。

## P2 IPC 层 + 业务桥接

- [ ] 2.1 定义 IPC 通道类型（`src/main/ipc/channels.ts`）：所有 invoke 通道的入参和返回类型
- [ ] 2.2 实现 `src/main/ipc/system.ts`：`system:doctor`（调用 `collectSystemDoctorReport`）、`system:select-directory`（`dialog.showOpenDialog`）、`system:save-file-dialog`
- [ ] 2.3 实现 `src/main/preload/index.ts`：通过 contextBridge 暴露 `window.api`
- [ ] 2.4 实现 `src/renderer/lib/ipc-client.ts`：类型安全的 `window.api` 封装
- [ ] 2.5 在 main/index.ts 中注册所有 IPC handler
- [ ] 2.6 renderer 中调用 `api.system.doctor()` 并在页面展示结果

**验证**：启动后页面显示 doctor 报告（微软雅黑状态、Vision 状态）。

## P3 Deck 管理页

- [ ] 3.1 实现 `src/main/ipc/deck.ts`：`deck:open`（loadDeckWorkspace + deckStatus）、`deck:create`（createDeckWorkspace）、`deck:add-slide`、`deck:remove-slide`、`deck:status`
- [ ] 3.2 实现 `src/renderer/stores/deck-store.ts`：openDeck、refreshStatus actions
- [ ] 3.3 实现 `src/renderer/stores/ui-store.ts`：基础 UI 状态
- [ ] 3.4 实现 `AppShell.tsx`：顶层布局（顶栏 + 侧栏 + 内容区）
- [ ] 3.5 实现 `DeckPage.tsx`：
  - 打开按钮（调用 selectDirectory → openDeck）
  - 创建按钮（选择图片目录 → createDeck）
- [ ] 3.6 实现 `SlideGrid.tsx` + `SlideCard.tsx`：缩略图网格
  - 加载源图缩略图（IPC 读取 source_image 资产）
  - 显示每页阶段状态徽标
  - 点击进入复核页
- [ ] 3.7 实现添加/移除页面操作
- [ ] 3.8 实现 `src/main/ipc/slide.ts`：`slide:load-asset-image`（读取图片返回 base64 data URL）

**验证**：打开已有 deck 工作区，看到缩略图列表和阶段状态；可创建新 deck。

## P4 复核画布 — 只读

- [ ] 4.1 实现 `src/main/ipc/slide.ts`：`slide:load-review`（读取 text-blocks.json 返回 TextReviewDocument）
- [ ] 4.2 实现 `src/renderer/stores/slide-store.ts`：loadSlide、sourceImageUrl、cleanPlateUrl
- [ ] 4.3 实现 `SlidePage.tsx`：画布 + 侧边栏布局
- [ ] 4.4 实现 `ReviewCanvas.tsx`：
  - 底图渲染（`<img>` 填满画布内部坐标）
  - CSS transform 容器实现缩放（滚轮）和平移（中键/空格+拖拽）
- [ ] 4.5 实现 `useCanvasTransform.ts`：缩放/平移状态管理
- [ ] 4.6 实现 `TextBlockOverlay.tsx`：
  - 按 bboxPx 绝对定位
  - 按 classification 着色（layout_text 绿 / object_integrated_symbol 灰 / uncertain 橙）
  - unreviewed 虚线边框
  - 显示文字内容

**验证**：打开已走过 review 阶段的 slide，看到原图上正确叠加的文字框，颜色区分，可缩放/平移。

## P5 复核画布 — 编辑

- [ ] 5.1 点击选中：更新 ui-store.selectedBlockId，选中态蓝色描边
- [ ] 5.2 实现 `PropertyPanel.tsx`：选中块的属性编辑（text、classification、includeInMask、reviewStatus、style 字段）
- [ ] 5.3 实现拖拽移动：pointer events，更新 bboxPx.x/y
- [ ] 5.4 实现 `TextBlockHandle.tsx`：四角 + 四边中点缩放手柄，更新 bboxPx width/height
- [ ] 5.5 实现 `TextEditor.tsx`：双击进入文字编辑（textarea 覆盖），Escape/失焦提交
- [ ] 5.6 右键菜单：快速切换 classification、toggleIncludeInMask
- [ ] 5.7 slide-store 中 dirty 标记 + saveReview action
- [ ] 5.8 实现 `src/main/ipc/slide.ts`：`slide:save-review`（Schema 校验 + 写入 text-blocks.json + 运行 validateTextReviewDocument）
- [ ] 5.9 保存按钮 + Cmd+S 快捷键
- [ ] 5.10 离开页面时若 dirty 提示保存

**验证**：编辑文字、拖拽位置、调整大小、切换分类，保存后 CLI 可正常读取修改后的 text-blocks.json。

## P6 低置信度队列 + 候选来源

- [ ] 6.1 实现 `ConfidenceQueue.tsx`：筛选 reviewStatus === "unreviewed" 且 classification === "uncertain" 的块
  - 列表显示块 ID + 文字摘要
  - 点击条目跳转到画布对应位置并选中
  - 上一个/下一个导航按钮
  - 显示剩余待处理数量
- [ ] 6.2 实现 `SourceList.tsx`：选中块的 sources 数组
  - 按 kind 分组显示（offline_ocr / cloud_vision / reference_text / manual）
  - 显示每个来源的 text 和 confidence

**验证**：有 uncertain + unreviewed 块时队列显示正确数量，导航跳转到对应位置。

## P7 Pipeline 执行 + 进度

- [ ] 7.1 实现 `src/renderer/stores/pipeline-store.ts`：running、stageStatuses、pendingGate
- [ ] 7.2 main process：pipeline 执行封装
  - 拆解 `runSlideRunFrom` 为逐阶段调用，每完成一个阶段通过 `webContents.send('pipeline:progress', event)` 推送
  - 到达人工门时推送 gate 事件并暂停等待
- [ ] 7.3 preload 中注册 `onPipelineProgress` 监听
- [ ] 7.4 实现 `StageProgress.tsx`：
  - 10 个阶段的状态指示器（init → report）
  - 当前运行阶段高亮 + 动画
  - 完成/失败着色
- [ ] 7.5 SlidePage 中添加"运行 Pipeline"按钮（完整执行）和"从此阶段重跑"下拉菜单
- [ ] 7.6 错误展示：失败阶段展开显示 error.code + error.message
- [ ] 7.7 Deck 级批量执行：DeckPage 中"全部执行"按钮，逐页串行，缩略图卡片实时更新状态

**验证**：触发 pipeline 后阶段逐个亮起，完成后刷新状态；错误时显示错误信息。

## P8 人工验收门

- [ ] 8.1 实现 `SliderCompare.tsx`：
  - 两张图叠加 + clipPath 分割
  - 垂直分割线可拖拽
  - 左半原图右半 clean plate 标签
- [ ] 8.2 实现 `AcceptPanel.tsx`：
  - 内联面板（非模态）
  - 展示自动检查结果列表（passed/failed/warning）
  - 核查清单（checkbox）
  - 接受者标识输入（默认 "developer"）
  - 备注输入
  - 接受/拒绝按钮
- [ ] 8.3 accept-clean 流程：
  - pipeline 推送 gate === 'accept-clean' → 显示 SliderCompare + AcceptPanel
  - 用户点接受 → IPC `slide:accept-clean` → 继续 pipeline
  - 用户点拒绝 → pipeline 中止
- [ ] 8.4 accept-pptx 流程：
  - pipeline 推送 gate === 'accept-pptx' → 显示 PPTX 检查结果 + AcceptPanel
  - 提示用户在 PowerPoint for Mac 中打开确认
  - 接受后记录

**验证**：pipeline 到达人工门时暂停，显示内联面板；接受后 pipeline 继续；验收记录与 CLI 兼容。

## P9 导出

- [ ] 9.1 实现 `src/main/ipc/deck.ts`：`deck:export`（调用 exportDeckPptx）
- [ ] 9.2 DeckPage 添加导出按钮
  - 保存对话框选择输出路径（默认 .pptx 后缀）
  - strict 模式开关
- [ ] 9.3 导出完成后显示结果（原生页数 / 占位页数 / 输出路径）
- [ ] 9.4 strict 模式下未全部验收时提示错误

**验证**：导出生成的 PPTX 与 CLI `deck export` 生成的完全一致。

## P10 收尾

- [ ] 10.1 启动时运行 doctor 检查，有问题时在顶栏显示警告
- [ ] 10.2 Toolbar 完善：当前 deck 名称、页码、保存状态指示
- [ ] 10.3 TypeScript 类型检查通过（renderer + main）
- [ ] 10.4 整体冒烟测试：创建 deck → 触发 pipeline → 复核 → 接受 → 导出完整流程
- [ ] 10.5 确保 DESIGN.md 视觉一致性：颜色、圆角、间距、按钮样式

**验证**：端到端完整流程可在桌面应用中完成；typecheck 通过。

## 回滚策略

- 每个阶段完成后提交一次
- 如果某阶段引入问题，可回退到上一阶段的提交
- 业务函数层不做任何修改，回滚不影响 CLI 功能

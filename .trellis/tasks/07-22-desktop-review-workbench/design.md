# M4 桌面复核工作台 — 技术设计

## 1. 项目结构

```
apps/
  desktop/                     # 新增 Electron 桌面应用
    electron.vite.config.ts
    package.json
    src/
      main/                    # Electron main process
        index.ts               # app 生命周期、窗口管理
        ipc/                   # IPC handler 注册
          deck.ts              # deck 操作（init/status/export/add/remove）
          slide.ts             # slide 操作（run/review/accept）
          system.ts            # doctor、文件对话框
        preload/
          index.ts             # contextBridge 暴露 API
      renderer/                # React 前端
        index.html
        main.tsx
        App.tsx
        stores/                # Zustand stores
          deck-store.ts        # deck 状态（manifest、slides 列表）
          slide-store.ts       # 当前 slide 状态（text-blocks、stage states）
          pipeline-store.ts    # pipeline 执行进度
          ui-store.ts          # UI 状态（选中块、缩放、面板开关）
        pages/
          DeckPage.tsx         # 页面总览（缩略图列表）
          SlidePage.tsx        # 单页复核画布
        components/
          canvas/              # 画布相关
            ReviewCanvas.tsx   # 画布容器（缩放/平移）
            TextBlockOverlay.tsx  # 文字框叠加层
            TextBlockHandle.tsx   # 拖拽/缩放手柄
            TextEditor.tsx     # 双击编辑文字
          compare/
            SliderCompare.tsx  # 滑块擦除对比
          pipeline/
            StageProgress.tsx  # 阶段进度条
            AcceptPanel.tsx    # 内联验收面板
          sidebar/
            PropertyPanel.tsx  # 属性面板
            SourceList.tsx     # 候选来源列表
            ConfidenceQueue.tsx # 低置信度队列
          deck/
            SlideGrid.tsx      # 缩略图网格
            SlideCard.tsx      # 单页缩略图卡片
          layout/
            AppShell.tsx       # 顶层布局
            Toolbar.tsx        # 工具栏
        hooks/
          useIpc.ts            # IPC 调用封装
          useCanvasTransform.ts # 画布缩放/平移状态
        lib/
          ipc-client.ts        # 类型安全的 IPC 客户端
  cli/                         # 现有 CLI（不变）
packages/
  core/                        # 现有核心契约（不变）
```

## 2. 架构分层

```
┌─────────────────────────────────────────────┐
│  Renderer (React + Zustand + Tailwind)      │
│  - 纯 UI 渲染和交互                          │
│  - 通过 preload API 调用 main               │
└──────────────────┬──────────────────────────┘
                   │ IPC (contextBridge)
┌──────────────────▼──────────────────────────┐
│  Main Process (Electron)                     │
│  - IPC handler 薄壳                          │
│  - 直接 import 业务函数                       │
│  - 文件系统、对话框、菜单                      │
└──────────────────┬──────────────────────────┘
                   │ 直接函数调用
┌──────────────────▼──────────────────────────┐
│  业务层 (apps/cli/src + packages/core)       │
│  - loadDeckWorkspace / writeDeckManifest     │
│  - runSlideRunFrom / runAssistReview         │
│  - exportDeckPptx / runAcceptClean           │
│  - 所有数据契约和校验                          │
└─────────────────────────────────────────────┘
```

关键原则：renderer 层不直接操作文件系统或调用业务逻辑，所有数据操作通过 IPC 走 main process。

## 3. IPC 契约

### 3.1 类型安全设计

在 preload 中用 `contextBridge.exposeInMainWorld` 暴露类型化 API：

```typescript
// src/main/preload/index.ts
const api = {
  deck: {
    open: (path: string) => ipcRenderer.invoke('deck:open', path),
    create: (imagesDir: string, name?: string) => ipcRenderer.invoke('deck:create', imagesDir, name),
    status: (path: string) => ipcRenderer.invoke('deck:status', path),
    export: (path: string, output: string, strict?: boolean) => ipcRenderer.invoke('deck:export', path, output, strict),
    addSlide: (deckPath: string, imagePath: string) => ipcRenderer.invoke('deck:add-slide', deckPath, imagePath),
    removeSlide: (deckPath: string, pageLabel: string) => ipcRenderer.invoke('deck:remove-slide', deckPath, pageLabel),
  },
  slide: {
    loadReview: (workspacePath: string) => ipcRenderer.invoke('slide:load-review', workspacePath),
    saveReview: (workspacePath: string, document: TextReviewDocument) => ipcRenderer.invoke('slide:save-review', workspacePath, document),
    run: (workspacePath: string, from: string, opts?: RunOptions) => ipcRenderer.invoke('slide:run', workspacePath, from, opts),
    acceptClean: (workspacePath: string, opts?: AcceptOptions) => ipcRenderer.invoke('slide:accept-clean', workspacePath, opts),
    acceptPptx: (workspacePath: string, opts?: AcceptOptions) => ipcRenderer.invoke('slide:accept-pptx', workspacePath, opts),
    loadAssetImage: (workspacePath: string, assetPath: string) => ipcRenderer.invoke('slide:load-asset-image', workspacePath, assetPath),
  },
  system: {
    doctor: () => ipcRenderer.invoke('system:doctor'),
    selectDirectory: () => ipcRenderer.invoke('system:select-directory'),
    saveFileDialog: (defaultName: string) => ipcRenderer.invoke('system:save-file-dialog', defaultName),
  },
  onPipelineProgress: (callback: (event: PipelineProgressEvent) => void) => {
    ipcRenderer.on('pipeline:progress', (_e, event) => callback(event));
    return () => ipcRenderer.removeAllListeners('pipeline:progress');
  },
};
```

### 3.2 Pipeline 进度事件

Pipeline 执行是长时间操作。main process 通过 `webContents.send` 向 renderer 推送进度：

```typescript
interface PipelineProgressEvent {
  slideId: string;
  stage: SlideStage;
  status: 'running' | 'completed' | 'failed';
  gate?: 'accept-clean' | 'accept-pptx';  // 到达人工门时填入
  error?: { code: string; message: string };
}
```

## 4. 状态管理

### 4.1 Store 划分

```typescript
// deck-store: 当前打开的 deck
interface DeckState {
  deckPath: string | null;
  manifest: DeckManifest | null;
  slideStatuses: Map<string, SlideStatusSummary>;  // slideId → 阶段汇总
  // actions
  openDeck: (path: string) => Promise<void>;
  refreshStatus: () => Promise<void>;
}

// slide-store: 当前选中的 slide 复核数据
interface SlideState {
  slideId: string | null;
  workspacePath: string | null;
  reviewDocument: TextReviewDocument | null;
  sourceImageUrl: string | null;  // data: URL 或 file: URL
  cleanPlateUrl: string | null;
  dirty: boolean;  // 是否有未保存的编辑
  // actions
  loadSlide: (workspacePath: string) => Promise<void>;
  updateBlock: (blockId: string, patch: Partial<TextReviewBlock>) => void;
  saveReview: () => Promise<void>;
}

// pipeline-store: 执行进度
interface PipelineState {
  running: boolean;
  currentSlideId: string | null;
  stageStatuses: Map<SlideStage, PipelineStageStatus>;
  pendingGate: 'accept-clean' | 'accept-pptx' | null;
}

// ui-store: 纯 UI 状态
interface UIState {
  selectedBlockId: string | null;
  canvasTransform: { scale: number; offsetX: number; offsetY: number };
  compareMode: boolean;
  sidebarPanel: 'properties' | 'sources' | 'queue';
}
```

### 4.2 数据流

1. 用户打开 deck → `deck-store.openDeck()` → IPC `deck:open` → main 调用 `loadDeckWorkspace` + `deckStatus` → 返回 manifest + 状态
2. 用户点击 slide → `slide-store.loadSlide()` → IPC `slide:load-review` → main 读取 `text-blocks.json` → 返回 `TextReviewDocument`
3. 用户编辑文字框 → `slide-store.updateBlock()` → 本地更新 store（标记 dirty）
4. 用户保存 → `slide-store.saveReview()` → IPC `slide:save-review` → main 写入 `text-blocks.json` + 运行 `validateTextReviewDocument`
5. 用户触发 pipeline → `pipeline-store` 接收进度事件 → UI 实时更新阶段状态
6. Pipeline 到达人工门 → `pipeline-store.pendingGate` 置位 → UI 显示内联确认面板

## 5. 画布渲染

### 5.1 坐标系

- 源图实际像素坐标系（如 2048×1152）作为画布内部坐标
- `TextReviewBlock.bboxPx` 直接映射到画布坐标
- CSS transform（scale + translate）实现缩放和平移
- 文字框用绝对定位的 `<div>` 叠加在 `<img>` 上方

### 5.2 交互层

```
<ReviewCanvas>                    # 缩放/平移容器
  <img src={sourceImage} />       # 底图
  {blocks.map(block =>
    <TextBlockOverlay              # 文字框叠加
      key={block.id}
      block={block}
      selected={block.id === selectedBlockId}
      onSelect / onDragEnd / onResizeEnd / onDoubleClick
    />
  )}
</ReviewCanvas>
```

- 选中态：蓝色描边 + 四角/四边拖拽手柄
- 未选中态：半透明边框，颜色按 classification 区分
  - `layout_text`：绿色（将进入原生层）
  - `object_integrated_symbol`：灰色（保留在背景）
  - `uncertain`：橙色（需要人工判断）
- reviewStatus === "unreviewed" 的块额外添加虚线边框

### 5.3 拖拽和缩放

使用 pointer events 实现：
- `onPointerDown` 记录起始位置
- `onPointerMove` 计算偏移量，更新 store 中的 bboxPx
- `onPointerUp` 提交最终位置
- 缩放手柄在四角和四边中点，拖拽时保持对边/对角不动

## 6. 滑块擦除对比

```
<SliderCompare>
  <div style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}>
    <img src={sourceImage} />     # 原图
  </div>
  <div style={{ clipPath: `inset(0 0 0 ${sliderPos}%)` }}>
    <img src={cleanPlate} />      # clean plate
  </div>
  <div className="slider-handle"  # 垂直分割线 + 拖拽手柄
    style={{ left: `${sliderPos}%` }}
  />
</SliderCompare>
```

## 7. 业务函数复用策略

### 7.1 可直接复用的函数

| 函数 | 来源 | 用途 |
|------|------|------|
| `loadDeckWorkspace` | `apps/cli/src/deck/workspace.ts` | 读取 deck manifest |
| `writeDeckManifest` | 同上 | 写入 deck manifest |
| `createDeckWorkspace` | 同上 | deck init |
| `deckStatus` | `apps/cli/src/deck/status.ts` | deck 状态查询 |
| `exportDeckPptx` | `apps/cli/src/deck/export.ts` | deck 导出 |
| `addSlideToDeck` | `apps/cli/src/deck/add-slide.ts` | 添加页面 |
| `removeSlideFromDeck` | `apps/cli/src/deck/remove-slide.ts` | 移除页面 |
| `runSlideRunFrom` | `apps/cli/src/slide/run-from.ts` | 按阶段执行 |
| `runAcceptClean` | `apps/cli/src/clean/accept.ts` | 接受 clean plate |
| `runAcceptPptx` | `apps/cli/src/pptx/accept.ts` | 接受 PPTX |
| `collectSystemDoctorReport` | `apps/cli/src/doctor.ts` | 环境检查 |
| `validateTextReviewDocument` | `packages/core/src/text-blocks.ts` | text-blocks 校验 |

### 7.2 需要适配的部分

- `runSlideRunFrom` 的门控回调：CLI 通过 process.stdin 交互，桌面版改为 IPC 事件通知 + 等待 renderer 响应
- 图片加载：renderer 不能直接读文件系统，需要 main process 读取图片后通过 IPC 返回 data URL 或 使用 `file://` 协议（需配置 Electron 安全策略）
- 进度回调：CLI 的 `process.stderr.write` 改为 `webContents.send`

## 8. Electron 安全

- 启用 contextIsolation，禁用 nodeIntegration
- preload 脚本通过 contextBridge 暴露白名单 API
- 使用 `protocol.registerFileProtocol` 注册自定义协议（如 `pptmaker://`）安全加载工作区图片
- CSP 限制：仅允许加载本地资源

## 9. 兼容性保证

- UI 编辑的 `TextReviewDocument` 通过 `TextReviewDocumentSchema.parse()` 校验后再写入磁盘
- workspace manifest 的读写复用现有函数，不引入新的序列化路径
- CLI 和桌面应用操作同一个工作区时，通过文件修改时间戳检测冲突（简单起见，不做文件锁）

## 10. 包依赖关系

```
apps/desktop
  ├── packages/core          # 数据契约和校验
  ├── apps/cli/src (部分)     # 业务函数（通过 TypeScript path alias 或 workspace 引用）
  ├── electron               # 桌面框架
  ├── electron-vite           # 构建工具
  ├── react + react-dom       # UI 框架
  ├── zustand                 # 状态管理
  ├── tailwindcss             # CSS
  └── @radix-ui/* + shadcn/ui 组件  # UI 组件
```

注意：apps/cli/src 中的业务函数需要从 CLI 的 index.ts（commander 壳）中分离出来单独引用。当前架构已经满足这一条件——业务逻辑在各子模块中，index.ts 仅做 CLI 参数解析和 process 交互。

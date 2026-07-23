# M3 多页本地转换工具 — 技术设计

## 1. 架构概览

```
packages/core/
  src/
    deck-contracts.ts        ← 新增：DeckManifest schema
    workspace-contracts.ts   ← 不变

apps/cli/src/
  index.ts                   ← 扩展：注册 deck 命令组
  deck/                      ← 新增目录
    workspace.ts             ← createDeckWorkspace / loadDeckWorkspace
    run.ts                   ← runDeckPipeline（逐页串行）
    export.ts                ← exportDeckPptx（多页合并）
    status.ts                ← deckStatus（汇总统计）
    add-slide.ts             ← addSlideToDeck
    remove-slide.ts          ← removeSlideFromDeck
  pptx/
    synthesize.ts            ← 扩展：synthesizeDeckPptx 支持多页
```

Deck 层是 slide workspace 的**编排层**，不修改 slide workspace 的内部结构。

## 2. Deck Manifest 契约

定义在 `packages/core/src/deck-contracts.ts`：

```typescript
export const DeckSlideEntrySchema = z.object({
  slideId: z.string().min(1),
  workspacePath: WorkspaceRelativePathSchema, // 相对于 deck 根目录
  sourceImageName: z.string().min(1),         // 原始文件名，用于显示
  addedAt: z.string().datetime(),
  removedAt: z.string().datetime().nullable(), // 非空表示已软删除
});

export const DeckManifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  deckVersion: z.literal(1),
  deckId: z.string().min(1),
  name: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  aspectRatio: z.literal("16:9"),
  fontFace: z.literal("Microsoft YaHei"),
  cloudCalls: z.literal("explicit_only"),
  slides: z.array(DeckSlideEntrySchema),
  exports: z.array(DeckExportRecordSchema),
});
```

### Deck 磁盘布局

```
my-deck/
  deck-manifest.json          ← deck 级索引
  slides/
    page-01/                  ← 标准 slide workspace
      manifest.json
      config.json
      inputs/
      stages/
    page-02/
      ...
  exports/
    export-001.pptx
    export-002.pptx
```

- `deck-manifest.json`（非 `manifest.json`）避免与 slide workspace 的同名文件混淆。
- slides 子目录名按 `page-NN` 编号，NN 从 01 开始，按文件名排序。
- exports 记录每次导出的 PPTX 文件。

## 3. 数据流

### deck init

```
扫描 --images 目录
  → 过滤 PNG/JPEG
  → 按文件名排序
  → 逐个调用 createSlideWorkspace（复用 M1）
  → 写入 deck-manifest.json
```

### deck run

```
读取 deck-manifest.json
  → 过滤 removedAt === null 的 slides
  → 逐页串行：
      → loadSlideWorkspace
      → runSlideRunFrom("ocr", { workspacePath, confirmApi, confirmUpload })
         ※ 需要扩展 runSlideRunFrom 接受 confirmApi / confirmUpload 参数
         ※ 遇到人工门停止，记录停止状态
      → catch 错误，记录到结果，继续下一页
  → 打印每页状态汇总
```

**关键扩展**：现有 `runSlideRunFrom` 遇到 API 门和上传门直接返回停止，不支持自动通过。需要增加 `confirmApi` 和 `confirmUpload` 选项，当标志为 true 时自动通过这两个门继续执行。这是对 `slide/run-from.ts` 的唯一修改。

### deck export

```
读取 deck-manifest.json
  → 过滤 removedAt === null 的 slides
  → 按 slides 数组顺序逐页：
      → 检查 accept-pptx 状态
      → 已验收：读取 clean plate + text blocks，调用 synthesize 添加到 PptxGenJS
      → 未验收：读取源图，添加为占位页（中央标注"待完成"）
  → 写入单一 PPTX 文件
  → 更新 deck-manifest.json 的 exports 记录
```

**关键点**：`synthesizePptx` 当前创建新 PptxGenJS 实例并输出单文件。deck export 需要一个新函数 `synthesizeDeckPptx`，在单个 PptxGenJS 实例上按顺序添加多页。

### deck status

```
读取 deck-manifest.json
  → 逐页 loadSlideWorkspace
  → 提取每页最远完成阶段 / 当前停止点
  → 汇总统计：完成 / 待人工 / 失败 / 未开始
  → 格式化输出
```

## 4. 对现有代码的修改

### 4.1 packages/core

- 新增 `deck-contracts.ts`：DeckManifest、DeckSlideEntry、DeckExportRecord schema
- `index.ts`：增加 `export * from "./deck-contracts.js"`
- 其他文件不修改

### 4.2 apps/cli/src/slide/run-from.ts

扩展 `RunFromOptions` 和 `runSlideRunFrom`：

```typescript
export interface RunFromOptions {
  readonly workspacePath: string;
  readonly confirmApi?: boolean;      // 新增
  readonly confirmUpload?: boolean;   // 新增
}
```

当 `confirmApi === true` 时，assist-review 阶段自动调用 `runAssistReview`；当 `confirmUpload === true` 时，clean 阶段自动调用 `runSlideClean`。人工门（accept-clean、accept-pptx）不受影响。

### 4.3 apps/cli/src/pptx/synthesize.ts

新增 `synthesizeDeckPptx`：

```typescript
export interface DeckSlideInput {
  type: "native" | "placeholder";
  // native: cleanPlatePath + blocks + imageWidth/Height
  // placeholder: sourcePath + imageWidth/Height
}

export async function synthesizeDeckPptx(input: {
  slides: DeckSlideInput[];
  outputPath: string;
  fontFace: string;
  deckName: string;
}): Promise<SynthesizeDeckPptxResult>
```

### 4.4 apps/cli/src/index.ts

注册 `deck` 命令组及子命令：init、run、export、status、add-slide、remove-slide。

## 5. 兼容性

- slide 命令不变，现有 slide workspace 结构不变
- 现有测试不受影响
- deck 内的 slide workspace 可独立用 `slide` 命令操作
- SCHEMA_VERSION 保持 1（deck-manifest 是新契约，不是修改现有契约）

## 6. 风险与缓解

| 风险 | 缓解 |
|---|---|
| runSlideRunFrom 扩展可能引入回退 | 新参数默认 undefined，不改变原有行为；现有测试覆盖 |
| PptxGenJS 多页合成未验证 | M0 已验证 PptxGenJS 单页；多页是 addSlide 的循环调用，风险低 |
| 25 页串行 API 调用时间长 | 开发者可后台运行，M2 已验证可接受性 |
| deck-manifest.json 与 slide manifest 状态不一致 | deck 层不缓存 slide 状态，每次读取 slide manifest 获取最新状态 |

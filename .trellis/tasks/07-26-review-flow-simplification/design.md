# 复核链路简化与文本复核体验重构 — 技术设计

> 对应 PRD 决策 D1–D8。本任务**显式解除** M4 V2 的「不修改 `packages/core` 与 `apps/cli`」约束（D8）；改动范围覆盖 core 校验、CLI 运行器与桌面端 renderer/main。

## 1. 架构总览

```
┌─ packages/core ───────────────────────────────────────┐
│ text-blocks.ts                                        │
│   + LAYOUT_TEXT_MUST_BE_MASKED 校验规则（D8/R4.1）      │
│   + buildFreshBlock: layout_text → includeInMask=true  │
│   + splitSourceTexts()：抽出双源文本比对（供 CLI/UI 复用）│
│ stage-graph.ts  不改（R1.4：枚举与依赖保持不变）           │
└──────────────────────┬────────────────────────────────┘
┌─ apps/cli ───────────┴────────────────────────────────┐
│ slide/run-from.ts                                     │
│   + human-edit 门（validate-review 之后、mask 之前）     │
│   + accept-clean 不再返回 manual 门（直通 pptx）          │
│ slide/accept-final.ts（新）                            │
│   一次调用写入 accept-clean + accept-pptx 双验收记录      │
│ clean/accept.ts / pptx/accept.ts  保留（CLI 单步可用）    │
│ mask/run.ts / pptx/run.ts  门禁保留为兜底，不再是主停点     │
└──────────────────────┬────────────────────────────────┘
┌─ apps/desktop ───────┴────────────────────────────────┐
│ renderer                                             │
│   ReviewPage（新，替代 SlidePage 的 canvas 视图）        │
│     ├ BlockListPanel（三分区，主操作面）★新              │
│     │   ├ TextDiffRow（字符级 diff）★新                │
│     │   └ ClassificationRow ★新                       │
│     ├ ReviewCanvas（改：只读标注 + 高亮居中 + 整体拖动）    │
│     └ ReviewShortcutBar ★新                           │
│   FinalConfirmPage（新，替代 AcceptFlow）               │
│     ├ CompositePreview（合成预览）★新                   │
│     ├ SliderCompare（保留）                            │
│     └ CheckSummary（pptx 六项 + clean 指标）★新         │
│   删除：TextBlockHandle、TextEditor、ConfidenceQueue、  │
│         PropertyPanel（能力并入 BlockListPanel）        │
│ main                                                  │
│   ipc/slide.ts: + accept-final、+ delete-block 走保存   │
│   runner/deck-runner.ts: 门类型映射更新                  │
└───────────────────────────────────────────────────────┘
```

## 2. packages/core 改动

### 2.1 新增校验规则（R4.1）

`validateTextReviewDocument` 现有规则「非 layout_text 不得入 mask」（`text-blocks.ts:542`）之后追加反向规则：

```ts
if (block.classification === "layout_text" && !block.includeInMask) {
  violations.push({
    blockId: block.id,
    field: "includeInMask",
    code: "LAYOUT_TEXT_MUST_BE_MASKED",
    message: "版式目标文字必须参与 mask，否则导出后文字会与背景重影",
    severity: "error",
  });
}
```

`REVIEW_VALIDATION_RULES_VERSION` 从 `review-validation-v1` 升为 `review-validation-v2`，使旧报告可区分。

**影响面**：`validate-review` 是 `RUN_SEQUENCE` 中的软门（`run-from.ts:110`：`report.status !== "passed"` 即返回 `validation-failed`）。既有工作区中 page-02 `block-045` 会因此校验失败并停下，由 R3.10 的一键修正处置（R4.3，不做数据迁移）。

### 2.2 新块默认入 mask（R4.2）

`buildFreshBlock`（`text-blocks.ts:243`）当前恒 `includeInMask: false`。改为：

```ts
includeInMask: classification === "layout_text",
```

`maskInvalidationProjection` 已包含 `includeInMask`（`text-blocks.ts:435`），故该默认值变化会正确使 mask 及下游失效——这是期望行为。

人工确认块（`isHumanTouched`）的 `includeInMask` 不被覆写（`mergeTextBlockCandidates` 只刷新 sources），重跑 review 不会推翻人工判断。

### 2.3 双源文本比对（R3.1、R3.2）

新增纯函数，供 CLI 报告与桌面端列表分区共用同一判据，避免两处口径漂移：

```ts
export interface BlockSourceTexts {
  readonly ocr: string | null;          // offline_ocr 来源文本
  readonly assist: string | null;       // ai_text_assist 来源文本
  readonly agrees: boolean;             // 去空白后逐字相等；任一为 null 时为 false
}
export function compareBlockSources(block: TextReviewBlock): BlockSourceTexts;
```

归一化规则：去除所有空白字符后比较（与 PRD F-9 的测量口径一致）。

## 3. apps/cli 改动

### 3.1 新增 human-edit 门（R1.1）

`RUN_SEQUENCE` 数组不变。在 `validate-review` 分支通过之后、进入 `mask` 之前插入门判定：

```ts
} else if (stage === "mask") {
  const doc = await loadReviewDocument(options.workspacePath);
  const pending = doc.blocks.filter(
    (b) => b.classification === "layout_text" && b.reviewStatus === "unreviewed",
  );
  if (pending.length > 0) {
    return {
      executed,
      stoppedAt: "review",
      gate: "human-edit",
      nextCommand: null,          // 桌面端负责导向复核界面；CLI 无对应命令
      message: `有 ${pending.length} 个版式目标文字待人工复核`,
    };
  }
  await runSlideMask({ workspacePath: options.workspacePath });
  executed.push(stage);
}
```

`stoppedAt: "review"` 而非 `"mask"`：语义是「回到 review 产物做人工复核」，且待办队列与 `rerunFrom` 都按 `stoppedAt` 定位界面。

`mask/run.ts:155` 与 `pptx/run.ts:103` 的原门禁**保留**，降级为兜底——直接调用单阶段命令时仍需拦截。

### 3.2 accept-clean 直通（R1.2）

`run-from.ts:146` 的 `accept-clean || accept-pptx` 分支拆分：

- `accept-clean`：不再返回 `manual` 门，直接跳过（不执行任何动作，也不标 completed）。
- `accept-pptx`：保留 `manual` 门，作为最终确认停点。

`pptx/run.ts` 的 `assertAcceptedCleanPlate` 门禁会因 accept-clean 未 completed 而抛错——这是必须处理的耦合点。**处理方式**：调整 `assertAcceptedCleanPlate` 的调用时机，改为在最终确认写入双记录之后才要求；即 `pptx` 阶段不再前置要求 clean 已验收。

理由：D1 的语义是「先出最终产物、再一次性验收」，pptx 生成本身不依赖人工验收，只依赖 clean 产物存在且非 stale。改为断言「clean 阶段 completed 且产物哈希匹配」，把「人工已接受」的断言移到 `accept-final`。

### 3.3 accept-final（R1.3）

新增 `apps/cli/src/slide/accept-final.ts`：

```ts
export interface RunAcceptFinalOptions {
  readonly workspacePath: string;
  readonly acceptedBy?: string;
  readonly note?: string;
}
export interface RunAcceptFinalResult {
  readonly cleanAcceptanceId: string;
  readonly pptxAcceptanceId: string;
  readonly autoCheckSummary: string;
}
```

实现为顺序调用现有 `runAcceptClean` 与 `runAcceptPptx`，两者的 `note` 前缀统一为 `经最终产物确认统一验收：`。清单默认值沿用各自的 `DEFAULT_CHECKLIST`（`clean/accept.ts:41`）。

失败语义：`runAcceptClean` 成功而 `runAcceptPptx` 失败时不回滚——manifest 停在「clean 已验收、pptx 未验收」，重试 `accept-final` 时 `runAcceptClean` 因已 completed 而幂等跳过。

CLI 暴露 `ppt-maker slide accept-final <workspace>`；原 `accept-clean` / `accept-pptx` 子命令保留（R1.6）。

### 3.4 门类型与待办分组（R1.5）

`RunFromResult.gate` 的取值收敛为：`human-edit` / `api` / `upload` / `manual` / `validation-failed` / `error`。`manual` 此后只对应最终确认。

桌面端 `todo-queue.ts` 的耐久层推导（`design.md` V2 §3.2）相应改为：

| 分组 | 耐久层判据 |
|---|---|
| 需文本复核 | `review` completed 且存在 `layout_text && unreviewed` 块 |
| 需修数据错误 | `stages/review/validation.json` status 为 failed |
| 待最终确认 | `pptx` completed 且 `accept-pptx` 未 completed |
| 失败 | stageStatus ∈ {failed, interrupted, stale} |

「待验收 clean」分组删除。

## 4. apps/desktop renderer 改动

### 4.1 ReviewPage — 列表主导（R3）

布局（DESIGN.md 映射）：

```
┌─ SlideToolbar（保留，去掉视图切换的 compare 档）─────────────┐
├─ StageRail（保留）──────────────────────────────────────┤
├──────────────── 主区 ────────────────┬─ 画布（定位）──────┤
│ BlockListPanel  宽 480px             │ ReviewCanvas      │
│  ▾ 文字待确认 25                      │  当前块高亮        │
│  ▾ 分类待确认 18                      │  其余块淡化        │
│  ▸ 已一致 19    [全部通过]             │  自动居中          │
├──────────────────────────────────────┴───────────────────┤
│ ReviewShortcutBar（快捷键常驻可见，caption/muted）           │
└──────────────────────────────────────────────────────────┘
```

- 列表容器 `surface-soft`，分区标题 `caption` 大写 + 计数徽标；项卡 `rounded-sm` + hairline，当前项用 `surface-strong` 底 + `border-border-strong`。
- 主区与画布左右分栏，比 V1 的「画布 + 320px 侧栏」反转主次关系。

**分区派生**（纯函数 `lib/review-partition.ts`，不新增持久化）：

```ts
type Partition = "text-pending" | "classification-pending" | "agreed";
function partitionOf(block: TextReviewBlock): Partition {
  if (block.classification === "object_integrated_symbol") return "classification-pending";
  if (block.classification === "uncertain") return "classification-pending";
  return compareBlockSources(block).agrees ? "agreed" : "text-pending";
}
```

`uncertain` 归入分类待确认（真实数据为 0，但契约允许）。分区内按 `zIndex` 后 `readingOrder` 排列，与 `text-blocks.json` 的存储顺序一致。

**TextDiffRow**：字符级 diff 用最长公共子序列逐字符对齐，差异段 `signature-coral` 底色 + ink 文字（沿用 DESIGN.md 内色板，与 PropertyPanel 的约束提示同套做法）。上行为 OCR 原文（`muted`），下行为可编辑 `textarea`（初值 = 当前 `block.text`，即 assist 文本）。

**焦点与键盘流**（R3.5）：

| 键 | 行为 |
|---|---|
| Tab / ↓ | 下一项（跨分区连续） |
| Shift+Tab / ↑ | 上一项 |
| 直接打字 | 当前项 textarea 已聚焦，无需额外进入编辑态 |
| Enter | 标记当前项 `reviewStatus=reviewed` 并前进 |
| ⌥1 / ⌥2 | 分类切为版式文字 / 对象符号 |
| ⌫（textarea 为空时不触发） | 无；删除块走列表上的显式按钮，避免误删 |
| ⌘S | 保存（保留） |

键位以 `⌥` 而非裸数字键，避免与 textarea 输入冲突。

**编辑写回**：沿用 `slide-store.updateBlock`，并补写 `updatedAt`（F-6 显示当前批量标记不写该字段，导致无法区分人工编辑与批量通过）。同时向 `sources` 追加 `kind: "manual"` 条目——这是「如实反映实际编辑」验收项的落点。

「全部通过」批量写 `reviewStatus=reviewed`，**不**写 `updatedAt`、**不**加 manual 来源（语义是「确认无需改动」而非「编辑过」）。

### 4.2 ReviewCanvas 改动（R3.6、R3.7）

- 移除块内文本叠加（消除双层重影）与 `TextEditor`。
- 标注分三态：当前项（`info-border` 2px 实线 + 外发光式 `ring`）、同分区其他项（hairline 1px）、其他分区项（hairline 1px + `opacity-40`）。分类不再用边框色编码——分类信息由列表分区表达，画布只表达「哪一块是当前项」。
- 当前项变化时把该块滚到视口中心：`useCanvasTransform` 增加 `centerOn(bbox)`。
- 块整体拖动保留（`onPointerDown` 落在块内且非画布平移时按 `dx/dy` 更新 bbox）；移除 `TextBlockHandle` 与 8 手柄逻辑。

### 4.3 FinalConfirmPage — 合成预览（R2）

**CompositePreview** 与 `pptx/synthesize.ts` 共用公式，避免口径漂移：把 `resolveFontSizePt` / `toAlign` / `toValign` / `toBold` 从 `synthesize.ts` 提到 `packages/core`（它们是纯函数，无 PptxGenJS 依赖），renderer 直接 import。

渲染方式：绝对定位 div 覆盖在 clean plate `<img>` 上，容器宽 = 显示宽，每块：

```
left/top/width/height = bboxPx / imageSize × 100%
font-size = resolveFontSizePt(block, imageWidth) × (显示宽 / PPTX_WIDE_WIDTH_INCHES / 72)
font-family = "Microsoft YaHei"（doctor 已预检存在）
color / text-align / align-items = colorHex / toAlign / toValign
white-space: pre-wrap（保留 lines.join("\n") 的显式换行）
```

字号换算保证：无论显示尺寸如何缩放，磅值→像素的比例与 PPT 版面一致。

差异明示（R2.6）：预览区顶部常驻一行 `caption`/`muted` 提示「预览按 PPT 磅值换算渲染，换行可能与 PowerPoint 略有差异，最终以 PowerPoint 为准」。

**动作区**（R2.3）：

| 动作 | 实现 |
|---|---|
| 完成 | `slide:accept-final` |
| 重做底板 | `slide:invalidate-stage("clean")` → `runSlide(from: "clean")` |
| 回到文本复核 | `slide:invalidate-stage("review")` → 切到 ReviewPage |

沿用 SlidePage 现有 `rerunFrom` 的「先失效再启动」纪律（`SlidePage.tsx:245` 注释记录的空转陷阱）。

**CheckSummary**（R2.5）：pptx 六项检查（`pptx/checks.ts:44-115`）逐项 passed/failed；clean 四组裸指标（size / textResidue / outsideMaskDiff / containerRingDiff）以数值呈现并标注「当前无判定阈值」（F-4）。failed 项用 `signature-coral`，但不禁用「完成」。

### 4.4 删除清单

| 文件 | 处置 |
|---|---|
| `components/canvas/TextBlockHandle.tsx` | 删除（D6） |
| `components/canvas/TextEditor.tsx` | 删除（编辑移入列表） |
| `components/sidebar/ConfidenceQueue.tsx` | 删除（F-6 恒空） |
| `components/sidebar/PropertyPanel.tsx` | 删除，字段能力并入 BlockListPanel 项卡 |
| `components/sidebar/SourceList.tsx` | 删除，来源信息由 TextDiffRow 直接呈现 |
| `components/slide/AcceptFlow.tsx` | 由 FinalConfirmPage 取代 |
| `lib/accept-gate.ts` | 简化：只推导「待最终确认」单一闸门 |

## 5. main 进程改动

- `ipc/slide.ts`：新增 `slide:accept-final`（调 `runAcceptFinal`）；`slide:accept-clean` / `accept-pptx` 保留供回滚。
- `ipc/slide.ts`：新增 `slide:open-pptx`（`shell.openPath` 打开 `stages/pptx/slide.pptx`，R2.4）。
- `runner/deck-runner.ts`：`page-done` 事件的 `gate` 增加 `human-edit`；ActivityLog 记录文案相应更新。
- 删除块与文本编辑仍走既有 `slide:save-review`，无新增 IPC。

## 6. 数据流（一页完整走一轮）

```
批量处理 → ocr → review → assist-review → validate-review
  ├ validation failed ─────→ 待办：需修数据错误 → ReviewPage
  └ passed → 检测 layout_text&&unreviewed
        ├ 有 → gate: human-edit ──→ 待办：需文本复核 → ReviewPage
        │        人工复核完 → 「继续处理此页」→ run --from mask
        └ 无 → mask → clean → pptx → report
                 → gate: manual（accept-pptx）→ 待办：待最终确认
                        → FinalConfirmPage
                            ├ 完成 → accept-final（双验收记录）→ 该页完成
                            ├ 重做底板 → invalidate(clean) → run --from clean
                            └ 回到文本复核 → invalidate(review) → ReviewPage
```

注意 `report` 在 `accept-pptx` 之后（`STAGE_DEPENDENCIES`），故首轮跑到 `pptx` 即停于最终确认，`report` 在验收后由「继续处理此页」补跑。这与 R1.2 的「跑到 report」措辞有出入，实现按阶段依赖为准：**最终确认停在 pptx 完成之后，report 于验收后自动补跑**。

## 7. 兼容与回滚

- `SlideStage` 枚举与 `STAGE_DEPENDENCIES` 不变，既有 manifest 直接可读（R1.4）。
- 既有已完成页（accept-clean/accept-pptx 均 completed）不受影响，新逻辑对已 completed 阶段幂等跳过。
- 既有停在 accept-clean 的页：新版不再为其生成闸门，`run --from` 会直通 pptx，然后停在最终确认——自然收敛，无需迁移。
- `LAYOUT_TEXT_MUST_BE_MASKED` 会使部分既有工作区校验失败并停在文本复核门（R4.3），属预期。
- 回滚 = git revert；`review-validation-v2` 报告与 v1 共存，无格式破坏；accept-final 写入的两条记录与 CLI 单步写入的记录结构完全一致。

## 8. 风险与权衡

| 风险 | 处理 |
|---|---|
| `assertAcceptedCleanPlate` 前置条件放宽（§3.2）削弱了「底板必须人工接受才能生成 PPTX」的约束 | 约束不是取消而是后移：最终确认写入 accept-clean 记录，且导出仍要求 accept-pptx completed。`deck export --strict` 语义不变 |
| 合成预览换行与 PptxGenJS 不一致，可能预览过关而 PPT 错位 | R2.6 界面明示 + 保留「在 PowerPoint 中打开」；差异属已知残留，不承诺像素一致 |
| 字符级 diff 在长文本上的可读性 | 分歧多为 1–3 字（F-9 示例），按字符高亮足够；超长文本回退为整行并排 |
| `buildFreshBlock` 默认 `includeInMask=true` 触发 mask 及下游大面积失效 | 仅影响新生成/重跑 review 的块；人工确认块受 `isHumanTouched` 保护 |
| 删除 PropertyPanel 后丢失 `maskParams`、`riskAcceptance` 的编辑入口 | 两者本就无 UI 暴露（F-1）或未被使用（真实数据 `accepted_with_risk` 为 0），不构成回退 |
| 一次改动横跨 core / cli / desktop 三层 | 按 implement.md 分阶段推进，每阶段独立可验证；core 与 cli 改动先落地并补测试，再动 UI |

# 复核链路简化与文本复核体验重构

> M4 桌面复核工作台的续作。M4 V2 已交付批量控制台与阶段可视化（任务 `07-22-desktop-review-workbench`，已归档），本任务处理其暴露出的三个体验问题。

## 目标

把当前"每个阶段都能停下来但大多停下来也没用"的链路，收敛为**一个真正有意义的人工介入点（文本复核）+ 其余阶段直达产出**，并把文本复核本身做到顺手。

## 背景：用户反馈（2026-07-26）

1. 整条链路虽然基本都能停下来人工复核或调整，但真正有意义的只有文本复核；其他阶段就算不满意也没有有效调整手段，只能重来——不如简化，调整后直接产出到最后。
2. 文本复核的用户体验不好：操作不顺手，画布上的标注不明显。
3. 是否可以把特别小的文字直接判定为 object symbol，以减少调整项。

## 已确认事实（代码与真实产物证据）

### F-1 五个门里只有一个有真实调整手段

`RUN_SEQUENCE`（`apps/cli/src/slide/run-from.ts:12`）= ocr → review → assist-review → validate-review → mask → clean → accept-clean → pptx → accept-pptx → report。

| 门 | gate 类型 | 人工能做什么 |
|---|---|---|
| assist-review | `api`（`run-from.ts:98`） | 只是确认调 API；`--confirm-api` 即跳过，无决策内容 |
| validate-review | `validation-failed`（`run-from.ts:114`） | 回文本复核修数据错误——**有意义** |
| clean | `upload`（`run-from.ts:140`） | 只是确认上传；`--confirm-upload` 即跳过，无决策内容 |
| accept-clean | `manual`（`run-from.ts:155`） | 仅"接受"或"拒绝并从 mask/clean 重跑"（`SlidePage.tsx:245`） |
| accept-pptx | `manual` | 仅"接受" |

`maskParams`（foregroundColors / colorTolerance / edgeThreshold / minComponentAreaPx / dilationRadiusPx / excludePolygons，`packages/core/src/text-blocks.ts:31`）在契约层可调，但桌面端无任何 UI 暴露。因此 accept-clean 的"不满意"只能重跑掷骰子，无定向修复路径。

### F-2 字号信息在真实数据中完全缺失

真实工作区 `~/test/ppttest-2026-07-25`（2 页，155 块）：

- `style.fontSizePx` 155/155 为 `null`。
- `sources` 全部为 `offline_ocr + ai_text_assist`，**无一个 `cloud_vision` 候选**（`mergeTextBlockCandidates` 只在有 vision 候选时才填 style，`text-blocks.ts:199`）。

因此"按字号判定"只能用 bbox 高度占图高的比例做代理。实测命中率：

| 阈值（占图高） | page-01 命中/60 | 其中原为 layout_text | page-02 命中/95 | 其中原为 layout_text |
|---|---|---|---|---|
| 1.3% | 6 | 1 | 3 | 1 |
| 1.6% | 32 | 16 | 22 | 16 |
| 2.0% | 39 | 23 | 61 | 53 |
| 2.4% | 44 | 28 | 89 | 72 |

结论：安全窗口（≤1.3%H）只能减少 3–6 项，不构成"显著减少"；抬到能显著减少的 2.0%H 会把 53 个真正的正文行降级为位图，违背 ROADMAP 的覆盖率 100% 原则。

### F-3 复核项数量的主因是行级碎片，不是小字

155 个块中**多行块数为 0**，全部单行。示例：

- page-01：`"结合档期全量数据，自动生成"` / `"复盘报告初稿及改善建议，加速"` / `"知识沉淀。"` 属同一段落，被拆成 3 块。
- page-02：`"• 时"` 与 `"代：明代（约15世纪）"` 在词内被切断。

减少调整项的有效杠杆是块合并/成段，而非小字降级。

### F-4 clean 自动检查不具备判别力

三次真实 clean 记录（`slides/*/stages/clean/clean-*/record.json`）：

| 指标 | page-01/001 | page-01/002 | page-02/001 |
|---|---|---|---|
| `textResidue.residualForegroundPixels` | 0 | 0 | 0 |
| `size.ok` | false | false | false |
| `outsideMaskDiff.changedRatio` | 4.10% | 4.39% | 8.47% |
| `containerRingDiff.changedRatio` | 1.84% | 3.21% | 0.65% |

残字像素恒为 0（检测形同虚设）；尺寸恒为 false（gpt-image-2 返回 1672×940 而期望 2048×1152，仅 `aspectRatioOk` 为 true）。`apps/cli/src/clean/checks.ts` 只输出裸指标，**未定义任何通过阈值**。因此"自动检查通过即自动接受"在当前实现下不可用，人眼仍是底板质量的唯一防线。

### F-5 accept-pptx 界面看不到最终效果

`AcceptFlow.tsx:118-139`：accept-pptx 分支只展示 clean plate 图 + 一段"请去 PowerPoint for Mac 打开"的文字，界面内没有任何最终版式渲染，且 5 项清单必须全部勾选才允许接受（`AcceptFlow.tsx:99,190`）。

PPTX 文本框几何完全由 `text-blocks` 派生（`apps/cli/src/pptx/synthesize.ts`）：bbox → x/y/w/h，`fontSizePx` 为 null 时按 bbox 高度估算（`synthesize.ts:62-68`），对齐取 `horizontalAlign` / `verticalAlign`。因此浏览器侧用同一份数据做预览在几何上高保真，差异只在字体度量与换行。

### F-6 文本复核界面在真实使用中未被使用

真实工作区 155 块中：`updatedAt` 非空 **0**、`manual` 来源 **0**、`rotationDeg != 0` 为 **0**、`quadPx` 非空为 **0**，而 155 块全部为 `reviewed`——由工具栏「全部标记已复核」批量写入（`slide-store.ts:103`，`markAllBlocksReviewed` 不写 `updatedAt`）。

即：画布的 8 个拖拽手柄、缩放平移、旋转支持零使用；实际行为是「打开 → 全部标记已复核 → 跑下去」。

界面层的具体阻碍：

| 现象 | 位置 |
|---|---|
| 描边一律 `border-2`，分类色为绿/灰/mustard，60–95 框同粗细密集铺满，无层次 | `TextBlockOverlay.tsx:24,112` |
| 块内叠 `text-[10px] truncate` 识别文本，直接压在原图同处文字上，双层重影且截断 | `TextBlockOverlay.tsx:128` |
| 选中态仅 `bg-info/10`，彩色底图上几乎不可见 | `TextBlockOverlay.tsx:113` |
| 编辑器字号硬编码 10px，在 13–19px 高的框内编辑；提交需 Cmd+Enter | `TextEditor.tsx:15,37` |
| 改分类必须切到右侧「属性」标签页点按钮，无快捷键 | `PropertyPanel.tsx:92` |
| 块间无任何键盘导航 | `SlidePage.tsx`（无实现） |
| 「低置信度队列」只筛 `unreviewed && uncertain`，真实数据 `uncertain` 为 0，该标签页恒空 | `ConfidenceQueue.tsx:28` |

### F-7 object_symbol 误判造成静默漏字（当前最大质量漏洞）

page-02 的 18 个 `object_integrated_symbol` 中包含明显属于版式文字的项：`历史脉络`、`鉴赏与收藏`、`器型结构`、`② 材质说明`、`③ 纹样寓意`、`⑤ 核心特征`、`◎ 颈部`、`◎ 肩部`、`◎ 圈足`、`口沿`。同组部件标注中 `◎ 腹部` 却被判为 `layout_text`，分类自相矛盾。

被误判为 object_symbol 的文字不进 mask、不进 PPTX 文本层，永久留在位图中，直接违背 100% 覆盖率目标；而唯一本应发现它的低置信度队列因 F-6 恒空，故该风险完全静默。

### F-8 layout_text 未入 mask 会导致导出重影（潜在缺陷）

page-02 `block-045`（`"色彩含义"`，24px 高）为 `layout_text` 且 `includeInMask=false`：文字既留在 clean plate 中、又生成原生文本框 → 导出后重影。

`validateTextReviewDocument`（`text-blocks.ts:542`）只检查「非 layout_text 不得入 mask」，反向（`layout_text && !includeInMask`）无任何检查，故静默通过。

### F-9 双源分歧是复核工作量的真实构成

`offline_ocr` 与 `ai_text_assist` 文本比对（去空白后逐字）：

| 页 | layout_text | 双源分歧 | 双源一致 |
|---|---|---|---|
| page-01 | 44 | 25（57%） | 19 |
| page-02 | 77 | 45（58%） | 32 |

Apple Vision 离线 OCR 错误率高，`ai_text_assist` 在纠错（`主贾蛸论→主要结论`、`外郎波动→销量波动`、`象衽鲍洁高雅、连锦不绝，→象征洁净高雅、连绵不绝，`、`Al Agent→AI Agent`）。

替代过滤信号无效：OCR `confidence<0.85` 覆盖 29/44 与 65/77，叠加极小块与可疑字符后并集覆盖 66% / 86%，筛不掉工作量。「双源是否逐字一致」是唯一干净的二分。

### F-10 行→段落合并被否决（表格定位不可复原）

几何合并规则在真实数据上实测：宽松版 60→42 / 95→52，但系统性把小标题吞进正文（`改善建议`+4 条 bullet、`信息收集助手`+2 行正文、`瓷胎`/`缠枝莲纹`/`白釉`/`云纹`/`回纹` 各自被并进描述）。根因是区分标题与正文需要字重，而 `style.fontWeight` 与 `fontSizePx` 同样全为 null。

收紧版（行高比 ≥0.92、左边界严格对齐、首行不明显短于后续行）：60→48（-20%）、95→79（-17%），标题误并消除，但残余误合并集中在表格竖列（`价格/¥120/¥65/¥?`、`商品A/商品B`、`1,230/2,340`）。

**否决理由（用户判断）**：表格单元格合并为一个文本框后，各字段被行距均匀排开，无法回到原表格行的中央位置——`synthesize.ts` 只有整框级 `valign`，不存在行级定位能力。合并对表格类页面是不可复原的破坏。

### F-11 文本复核门从未存在，现以错误形式代偿

`human-edit` gate 只在 `run-from.ts:39` 的类型声明中存在，代码从未返回过它。新页执行 `run --confirm-api --confirm-upload` 的真实行为是走到 mask 阶段被门禁以**错误**打断：`mask/run.ts:155-160`「存在未复核却参与 mask 的文字块」。

下游另有两道复核门禁：

- `mask/run.ts:155`：`includeInMask` 且 `unreviewed` → 抛 `INVALID_STAGE_STATE`
- `pptx/run.ts:103`：任一 `layout_text` 为 `unreviewed` → 抛 `INVALID_STAGE_STATE`

本应是「该你复核文字了」的人工门，实际表现为「阶段执行失败」。这解释了 F-6：用户是被报错拦下后才去点「全部标记已复核」的。因此 D1 的前段文本复核门需要**新增**，而非复用现有实现。

补充事实：`validate-review` 不是 manifest 阶段。`SlideStage` 枚举（`stage-graph.ts:12-23`）为 init / ocr / review / assist-review / mask / clean / accept-clean / pptx / accept-pptx / report，`validate-review` 仅是 `RUN_SEQUENCE` 中的 runner 概念，产出 `stages/review/validation.json`。

## 决策

| # | 决策 | 内容 |
|---|---|---|
| D1 | 人工门形态 | **单终点验收**。链路只保留两个人工点：前段文本复核、末尾最终产物确认。`accept-clean` 不再单独停顿，滑块对比降级为最终确认页里的可展开视图；不满意时在同一界面选择「重做底板」（重跑 clean→pptx）或「回到文本复核」 |
| D2 | 最终效果呈现 | **本地合成预览**。renderer 内以 clean plate 为背景、按 `text-blocks` 用系统微软雅黑渲染文本层，与 PPTX 共用同一套几何与样式公式；可切换到滑块对比原图/底板；保留「在 PowerPoint 中打开」按钮做最终把关，不再强制勾满清单 |
| D3 | 复核交互范式 | **列表主导 + 画布联动**。左侧按阅读顺序列出全部块，文本就地可改、分类快捷键切换、Tab/↑↓ 逐块推进；画布同步高亮当前块并自动居中，其余块淡化 |
| D4 | 一致项处理 | 列表分区：**「文字待确认」**（双源分歧的 layout_text，带字符级 diff 高亮）、**「分类待确认」**（全部 object_symbol，默认展开，一键改为版式文字）、**「已一致」**（默认折叠为汇总行 + 「全部通过」按钮）。一致项**不自动**写 `reviewStatus=reviewed`，仍需人显式确认，避免 report 中「已复核」语义贬值 |
| D5 | 行→段落合并 | **不做**（自动与人工均不做）。见 F-10：表格单元格合并后无法复原行级定位 |
| D6 | 几何编辑范围 | 保留画布缩放/平移（定位必需）与块整体拖动；**移除 8 个缩放手柄**（`TextBlockHandle`）与旋转编辑（真实数据 `rotationDeg` 全 0、`quadPx` 全 null）；列表提供「删除此块」处理重复与碎片块 |
| D7 | 小字自动降级 | **不实现**。安全阈值（≤1.3%H）净新增仅 1–2 块，且 D4 要求逐项过目全部 `object_symbol`，降级只会增加待确认项——方向相反 |
| D8 | 质量护栏 | 在 `validateTextReviewDocument` 新增 `LAYOUT_TEXT_MUST_BE_MASKED`（error），堵死 F-8 导出重影；`buildFreshBlock` 对 `layout_text` 默认 `includeInMask=true`。**显式解除 M4 V2 的「不修改 packages/core 与 apps/cli」约束**。F-7 分类误判由 D4 的分区覆盖，不依赖校验 |

## 需求

### R1 链路收敛为双人工点（D1、F-11）

- R1.1 `RUN_SEQUENCE` 在 `validate-review` 之后、`mask` 之前新增**显式文本复核门**：存在 `layout_text` 且 `reviewStatus === "unreviewed"` 的块时返回 `gate: "human-edit"`，`stoppedAt: "review"`，并给出待复核块数。取代当前 mask/pptx 门禁以错误形式代偿的行为（F-11）。
- R1.2 `accept-clean` 不再单独停顿。执行流从 `clean` 直通 `pptx`，停于最终确认；`report` 依 `STAGE_DEPENDENCIES` 位于 `accept-pptx` 之后，于验收完成后自动补跑。
- R1.3 最终确认一次性写入 `accept-clean` 与 `accept-pptx` 两条验收记录，备注标明「经最终产物确认统一验收」。人在最终确认页确实可查看底板（R2.2），故验收记录仍如实反映人工判断。
- R1.4 `SlideStage` 枚举与 `STAGE_DEPENDENCIES` 保持不变，既有工作区 manifest 无需迁移。
- R1.5 桌面端待办队列的分组随之收敛为：需文本复核 / 待最终确认 / 失败。
- R1.6 CLI 保持可用：`slide accept-clean` / `accept-pptx` 命令继续存在，`run --from` 语义与新门一致。

### R2 最终确认页（D1、D2）

- R2.1 默认视图为**合成预览**：clean plate 作背景，按 `text-blocks` 的 `bboxPx` / `resolveFontSizePt` 同一公式 / `colorHex` / `horizontalAlign` / `verticalAlign` 用系统微软雅黑渲染文本层。
- R2.2 可切换到滑块对比（原图 vs clean plate），复用现有 `SliderCompare`。
- R2.3 三个动作：**完成**（写双验收记录）、**重做底板**（失效 `clean` 及下游后重跑 clean→pptx）、**回到文本复核**（失效 `review` 及下游）。
- R2.4 「在 PowerPoint 中打开」按钮打开该页 PPTX 产物；不再强制勾满清单即可完成。
- R2.5 展示 pptx 自动检查结果（`pptx/checks.ts` 六项）与 clean 检查裸指标；检查失败项以显著样式呈现，但不阻止完成。
- R2.6 预览与 PPTX 的保真差异（浏览器换行 vs PptxGenJS）在界面上明示，提示以 PowerPoint 为准。

### R3 文本复核界面（D3、D4、D6）

- R3.1 三分区列表：**文字待确认**（双源分歧的 `layout_text`）、**分类待确认**（全部 `object_symbol`）、**已一致**（双源逐字一致的 `layout_text`，默认折叠为汇总行）。分区内按阅读顺序排列。
- R3.2 「文字待确认」每项并排显示 `offline_ocr` 原文与 `ai_text_assist` 文本，**字符级 diff 高亮**；文本框就地可编辑。
- R3.3 「分类待确认」每项显示文本与「改为版式文字」单击动作。
- R3.4 「已一致」提供「全部通过」按钮批量写 `reviewStatus=reviewed`；不自动预设（D4）。
- R3.5 键盘流：Tab / ↑↓ 逐项推进，聚焦项文本框直接可打字，快捷键切换分类，Enter 确认当前项并前进。全部快捷键在界面内可见。
- R3.6 画布联动：高亮当前项对应块并自动居中滚动，其余块淡化；标注不再在框内叠加识别文本（消除双层重影，F-6）。
- R3.7 保留画布缩放/平移与块整体拖动；移除缩放手柄与旋转编辑（D6）。
- R3.8 列表每项提供「删除此块」。
- R3.9 移除 `ConfidenceQueue`（筛选条件在真实数据下恒空，F-6）。
- R3.10 `layout_text` 且 `includeInMask === false` 的项显示「会重影」警告与一键修正（配合 D8 的校验规则）。

### R4 质量护栏（D8）

- R4.1 `validateTextReviewDocument` 新增 `LAYOUT_TEXT_MUST_BE_MASKED`（severity `error`）：`classification === "layout_text"` 且 `includeInMask === false` 时报错。
- R4.2 `buildFreshBlock` 对 `classification === "layout_text"` 的新块默认 `includeInMask = true`。
- R4.3 既有工作区（如 `~/test/ppttest-2026-07-25` page-02 `block-045`）会因 R4.1 校验失败并停在文本复核门，由 R3.10 的一键修正处置——这是预期行为，不做数据迁移。

## 验收标准

**链路层**

- [ ] 全新 deck 执行批量处理，逐页停在**文本复核门**（`gate: "human-edit"`），而非以 mask 阶段错误形式中止
- [ ] 完成文本复核后继续执行，一路跑到 `pptx` 并停在最终确认，中途**不再停于 accept-clean**；验收后 `report` 自动补跑至 completed
- [ ] 最终确认「完成」后，manifest 中 `accept-clean` 与 `accept-pptx` 均为 completed，备注含统一验收说明，`deck status` 与 CLI 可正常读取
- [ ] 「重做底板」使 `clean` 及下游失效并重跑至最终确认；「回到文本复核」使 `review` 及下游失效并回到复核界面
- [ ] 既有工作区 manifest 无需迁移即可被新版打开

**复核体验层**

- [ ] 打开文本复核界面即可看到三分区与各分区计数，无需任何点击或悬停
- [ ] 「文字待确认」每项能直接读出 OCR 原文与 AI 文本的差异位置，不需要去画布上找这块字
- [ ] 全程仅用键盘（Tab / ↑↓ / 打字 / 分类快捷键 / Enter）即可完成一页复核
- [ ] 「已一致」折叠区一次点击可全部通过
- [ ] 「分类待确认」列出全部 `object_symbol`，单击即可改为版式文字
- [ ] 画布上当前项高亮清晰可辨（彩色底图上亦然），且不存在识别文本与原图文字的双层重影
- [ ] 用真实两页数据完成一轮复核，产出的 `text-blocks.json` 中 `updatedAt` / `manual` 来源能如实反映实际编辑

**最终确认层**

- [ ] 合成预览的文本位置、字号、颜色、对齐与导出 PPTX 在 PowerPoint for Mac 中的表现一致（允许换行差异，且界面已明示）
- [ ] 可在预览与滑块对比之间切换
- [ ] pptx 六项自动检查结果与 clean 检查指标可见，失败项显著但不阻止完成

**质量护栏层**

- [ ] `layout_text` 且未入 mask 的块触发 `LAYOUT_TEXT_MUST_BE_MASKED` error，校验不通过
- [ ] 新生成的 `layout_text` 块默认 `includeInMask = true`
- [ ] page-02 `block-045` 类问题在界面上可见并可一键修正

**工程层**

- [ ] TypeScript 类型检查、format、build 通过
- [ ] 既有测试全绿；新增门与校验规则有确定性测试
- [ ] 前端视觉遵从 DESIGN.md

## 非目标

- 行→段落合并（D5，F-10 已否决）
- 小字自动降级为 object symbol（D7 已否决）
- 缩放手柄与旋转编辑（D6 移除）
- 修复 `clean/checks.ts` 的判别力问题（F-4：残字恒 0、尺寸恒 false）——本任务只呈现指标，阈值与检测算法改进另立任务
- 提高 `assist-review` 分类准确率本身（F-7 由界面分区兜住，模型侧改进另立任务）
- 补齐 `maskParams` 调参 UI 与底板局部重绘（D1 已选择放弃这条路）
- 页面并行执行、账号 / 云同步 / 协作、Windows/Linux 支持
- 内容策划与图片生成（M5）

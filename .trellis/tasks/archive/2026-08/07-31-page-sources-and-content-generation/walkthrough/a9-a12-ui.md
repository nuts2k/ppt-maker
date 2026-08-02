# A9 / A10 / A11 / A12 与桌面端界面走查（主会话，2026-08-02）

覆盖 `implement.md` 的 3.6（A9–A11）、3.7 前半（A12），以及 A2 / A5 / A6 / A13
四条**需要界面证据的那一半**（CLI 侧由并行代理另行走查，见同目录其它记录）。

| 条目 | 结论 |
|---|---|
| A9 批量生成后闸门不放行 | **通过** |
| A10 自动放行不伪造人工痕迹 | **磁盘层通过；「报告能区分」不成立 → 缺陷 ①** |
| A11 换源翻转确认要求 | **反向通过；正向路径不存在 → 缺陷 ②** |
| A12 带说明重新生成 | **通过**（CLI 全链路实证 + 桌面端入口实证） |
| A2 桌面端总览逐页看出来源 | **通过** |
| A5 探测结果界面可见 | **通过，但可见性是一次性的 → 缺陷 ③** |
| A6 非 16:9 页进报告不整体失败 | **通过**（界面侧） |
| A13 规格漂移的界面标注 | **通过**（界面侧） |

工作 deck：`~/test/a912-mixed-2026-08-02`（`wt4-append` 的副本，11 页混合来源）。
`~/test/wt4-append` 保持基线未动。

---

## A9 批量生成后「一键处理全部」不放行 generated 页

先在 page-11（唯一的 `generated` 页）上跑一次带说明的重新生成（见下方 A12），
使其回到未确认状态，再执行全 deck 处理：

```
$ node apps/cli/dist/index.js deck run ~/test/a912-mixed-2026-08-02 --confirm-api --confirm-upload
page-01 …: ocr → review → validate-review → mask → pptx → report — 完成
page-02 …: ocr → review → validate-review — 停在 validate-review (validation-failed)
page-03 …: ocr → review → validate-review — 停在 review (human-edit)
page-04 …: 同上
page-05 …: 同上
page-06 …: ocr → review → assist-review → validate-review — 停在 review (human-edit)
page-07 … page-09: 同 page-06
page-10 …: ocr → review → assist-review → validate-review → mask → clean → pptx — 停在 accept-pptx (manual)
page-11 …: （未执行） — 停在 accept-source (source)
汇总：11 页，完成 1，停止 10，失败 0
EXIT=0
```

判据逐条：

- **`generated` 页一步都没走**：page-11 打印的是「（未执行）」，停止原因 `accept-source (source)`。
- **同 deck 的 `imported` / `extracted` 页不受连累**：其余 10 页各自推进到自己的门
  （`review (human-edit)` / `accept-pptx (manual)`），没有一页因为 page-11 停下。
- **进入待办队列**（桌面端）：打开 `~/test/wt4-append`（page-11 同为未确认生成页）后，
  待办队列出现独立分组「待确认源图 1」，条目文案「源图待人工确认，确认后链路才会继续」，
  并带「逐张确认」入口；总览该页显示 `0/10`。

一处需要澄清的读法：run 日志里的 `ocr → review → …` 是**走过的阶段链**，不是重跑。
对比基线与 run 后的 attempt 计数可证：

```
wt4-append   page-01 {ocr:1, review:1, assist-review:4, clean:2, report:3, …}
a912(run 后) page-01 {ocr:1, review:1, assist-review:4, clean:2, report:4, …}
wt4-append   page-02 与 a912 page-02 计数**完全一致**
```

page-01 只多跑了一次 `report`，page-02 一次都没重跑。**旧格式页没有被重新跑一遍花钱。**

同时确认 `accept-source` 在**写操作**时才补齐落盘（a912 的 page-01 stages 末尾追加了
`accept-source / completed / latestAttemptId=init-001`，基线 `wt4-append` 没有该阶段）。
读操作不改写磁盘这一半由 A4 走查另行取证。

**page-02 的 `validate-review (validation-failed)` 是既有数据状态**，不是本次造成：
attempt 计数与基线逐项相同，说明 run 只做了判定没有执行。但 `deck status` 认它
`report completed`（总览显示 10/10），`deck run` 却判它校验不过——同一份数据两个命令口径不一致，
记为观察，是否影响 `--strict` 导出以 A2 走查结论为准。

## A10 自动放行不伪造人工痕迹

**磁盘层完全成立**，两类页的落盘形态泾渭分明：

```
# extracted 页（a912 page-06）：无 accept-source 目录，无 accepted.json
$ find slides/page-06 -name accepted.json      →  （空）
$ ls slides/page-06/stages/accept-source/      →  No such file or directory
  stages[accept-source] = {status: "completed", latestAttemptId: "accept-source-001"}
  attempts[accept-source-001] = {provider: "auto-source-trust", assetIds: [], status: "completed"}

# 人工确认的 generated 页（wt4-spec page-01）
$ find slides/page-01 -name accepted.json      →  slides/page-01/stages/source/accepted.json
  attempts[accept-source-001] = {provider: "developer", assetIds: ["asset-source-acceptance"]}
```

`provider` 一个是 `auto-source-trust` 一个是 `developer`，`assetIds` 一个空一个有，
磁盘上一个没有 `ArtifactAcceptance` 一个有。design.md §4.5 要求的「不伪造人工痕迹」做到了。

### 缺陷 ① 「报告能区分」不成立

A10 后半要求报告能区分「人工确认」与「按来源自动放行」。**报告区分不了**：

- `AUTO_SOURCE_TRUST_PROVIDER`（`apps/cli/src/slide/workspace.ts:43`）在全仓
  **只有产生端，没有任何消费端**（grep 全仓仅此一处）。
- `deck status --json` 的单页对象只有
  `sourceKind` / `specEntryId` / `specDrift` / `generation`，没有任何字段表达确认方式。
- 桌面端同理：IPC `DeckStatusSlide`（`apps/desktop/src/main/ipc/channels.ts:35` 附近）
  不带该信息；总览里 `imported` 页与已人工确认的 `generated` 页看不出差别。

区分只存在于 slide manifest 里，没有任何报告面读它。

## A11 换源后确认要求随来源翻转

### 反向（`generated` → `imported`）：通过

```
$ node apps/cli/dist/index.js deck replace-source ~/test/a912-mixed-2026-08-02 page-11 ~/test/new-source-flipped.png
已换源 slides/page-11；失效阶段：无

# 换源后 page-11
source = {kind: "imported", originalFileName: "new-source-flipped.png", attemptId: "init-003"}
init          completed
accept-source completed      ← 自动放行
ocr           pending
attempts[accept-source-001] = {provider: "auto-source-trust", assetIds: []}
find slides/page-11 -name accepted.json → （空）
```

换成导入图后自动放行，且不写 `accepted.json`。

### 缺陷 ② 正向（`imported` → `generated`）路径不存在

```
$ node apps/cli/dist/index.js deck regenerate ~/test/a912-mixed-2026-08-02 --page page-11 --note x --confirm-upload
错误：只有生成来源的页可以重新生成，该页来源是：imported
真实 EXIT=1
```

- `deck regenerate` 前置校验要求 `source.kind === "generated"`。
- `deck replace-source` 只接受图片文件，产出来源恒为 `imported`。
- 桌面端 `slide.replaceSource(workspacePath)`（`ReviewPage.tsx:443`）同样只走选图片；
  换源 UI 没有「换成生成来源」这一档（`source-picker-core.ts:15` 的三档只用于**新建/追加**）。

于是一页从 `generated` 换成 `imported` 之后**再也回不去**，A11 要求的正向翻转不可达。
这与 design.md §4.5〈换源后的重新判定〉写明的
「换源统一走一条路径，而这条路径按新来源决定是否需要重新确认，**不需要为『重新生成』单开分支**」相悖。

## A12 带调整说明重新生成

### CLI 侧（真实付费调用 1 次）

```
$ node apps/cli/dist/index.js deck regenerate ~/test/a912-mixed-2026-08-02 --page page-11 \
    --note "把主标题再放大一档，背景的窗口叠层进一步简化，只保留一层轮廓" --confirm-upload
即将发送到 gpt-image-2：entry-001 提示词 1210 字节 (235885544767cf6f…)
已重新生成 page-11（entry-001，init-002）
调整说明（1 条，后出现的优先）：把主标题再放大一档…
新源图需人工确认后才会继续下游：ppt-maker slide accept-source
EXIT=0
```

逐条判据：

1. **说明已回写 deck 级规格条目**
   `content-spec.json` 的 `entries[0].revisionNotes` 由 `[]` 变为该句；`updatedAt` 同步刷新。
2. **两次生成各留一份规格条目快照，可分别追溯**
   `slides/page-11/stages/init/init-001/` 与 `init-002/` 各有一套
   `{content-spec.json, prompt.txt, provider.json}`。两份快照 `diff` **只差 revisionNotes**：
   ```
   24c24,26
   <         "revisionNotes": []
   ---
   >         "revisionNotes": ["把主标题再放大一档，背景的窗口叠层进一步简化，只保留一层轮廓"]
   ```
   快照是**条目级**的（顶层键是 `entry` 单数，不是整份 `entries`），符合 D7。
3. **新图基于含该说明的提示词**
   `grep -c "只保留一层轮廓" init-002/prompt.txt` → `1`；同一 grep 对 `init-001/prompt.txt` → `0`。
   provider 记录 `input_tokens: 325`，高于同 deck 其余页的 282–291，与多出的说明段对得上。
4. **其它页零变化**
   `snap.sh` 前后 `diff` 只有一行：
   ```
   < HASH page-11 fc3c5012b423c30bb9dfff0097cb1b2e6ee5e441
   > HASH page-11 de18049b0a1b16d60f62cae7b0e40d6e0f6be2c1
   ```
   其余 10 页逐字节不变，阶段状态一行未动。

顺带记录本次真实调用的 provider 字段（`init-002/provider.json`）：
`model: gpt-image-2`、`endpoint: /v1/images/generations`、`promptVersion: m5-generate-v1`、
`parameters: {size: 2048x1152, quality: high, output_format: png, n: 1}`、
`usage.total_tokens: 1483`、`durationMs: 51545`、**`requestId: null`**。
`requestId` 为空的根因已由 A7 走查定位（`.env` 的 `OPENAI_BASE_URL` 指向的第三方代理
不回传 `x-request-id`，代码侧如实透传），此处独立复现一次。

### 桌面端侧

单页工具栏有「源图审片」入口（子任务④ 为此补的），进入后：

```
源图确认  已确认 4/4
page-04   生成 · 规格条目 entry-004   已确认
[重新生成] [换源]
```

点「重新生成」进入举手态（按钮变「确认重新生成？」），此时说明输入框出现：

```
TEXTAREA  placeholder="可选：说明要调整什么（写回规格条目）"
```

举手态 4 秒无操作自动复位（`SourceReviewPage.tsx:329`），在说明框里打字会重启计时。
说明经 `SourceReviewPage.tsx:270` 作为 `note` 传入重新生成，成功文案为
「已带调整说明重新生成，说明已写回规格条目」。界面路径未再重复付费实证——
子任务④ 的 U 系列走查已含 6 次真实图像生成，CLI 侧本次又端到端实证一遍。

## A2 桌面端总览逐页看出来源

打开 `~/test/wt4-append`（11 页三来源混合），总览逐页带来源标签：

```
导入 page-03  4/10   44 个版式目标文字待复核
抽取 page-05  4/10   35 个版式目标文字待复核
生成 page-11  0/10   源图待人工确认，确认后链路才会继续
```

`imported` / `extracted` / `generated` 三档在同一个 deck 的同一份列表里同时出现，
「待处理 / 全部」两个页签都正确带标签。

A2 走查把 `~/test/a23-mixed-2026-08-02` 跑完之后又验了一次**终态**（上面那次是半成品状态）：

```
Deck 累计：共 11 页 · 已完成 11 · 进行中 0 · 未开始 0
导入 page-01 10/10      抽取 page-06 10/10
导入 page-02 10/10      抽取 page-07 10/10
导入 page-03 10/10      抽取 page-08 10/10
导入 page-04 10/10      抽取 page-09 10/10
导入 page-05 10/10      抽取 page-10 10/10
                        生成 page-11 10/10
```

逐页来源与 CLI `--json` 的 5 `imported` / 5 `extracted` / 1 `generated` **逐页对得上**。
桌面端这一半没有缺口；A2 的缺口只在 CLI 的人读输出（见 `a2-a3.md` 缺陷 1）。

来源列的取值链是单一事实源，CLI 与桌面端同源：
slide manifest `source.kind` → `apps/cli/src/deck/status.ts:199` → `apps/desktop/src/main/ipc/deck.ts:64`
→ `channels.ts:35` → `apps/desktop/src/renderer/lib/source-view.ts:21/33`（`SOURCE_KIND_LABELS`）
→ `SlideCard.tsx:143` 与 `:248-265`（缩略图左上角徽标，与「已移除」互斥、刻意不上色）。

## A5 / A6 桌面端侧

从桌面端走一次 PDF 抽取（新建 Deck… → PDF 文档 → `~/test/mixed-aspect.pdf`），
完成后的抽取报告面板：

```
mixed-aspect.pdf · 全部页 · macos-pdfkit 1+macOS-26.5.2
建立 3 页    跳过 2 页

建立的页面
  第 1 页 → page-01 · 720×405 pt · 含可提取文本层
  第 3 页 → page-02 · 960×540 pt · 含可提取文本层
  第 5 页 → page-03 · 720×405 pt · 无可提取文本层

宽高比不是 16:9（2）
  第 2 页 · 841.9×595.3 pt · 页面尺寸 841.89 × 595.28 pt 的宽高比 1.4143 偏离 16:9
           达 20.45%，超出容差 0.50%；不会自动裁剪、拉伸或补边
  第 4 页 · 595.3×841.9 pt · 页面尺寸 595.28 × 841.89 pt 的宽高比 0.7071 偏离 16:9
           达 60.23%，超出容差 0.50%；不会自动裁剪、拉伸或补边
```

- **A5 界面可见**：逐页「含 / 无可提取文本层」，第 5 页取 `false` 做了对照。
- **A6**：非 16:9 页带尺寸、宽高比、偏离度、容差与「不自动裁剪拉伸补边」的原因，
  deck 正常建起 3 页，命令未整体失败。

### 缺陷 ③ 抽取报告的回溯与页级可见性

**先更正本记录初稿里的一处误判。** 初稿写的是「报告面板关闭后没有任何入口能重新打开，
活动日志那条是纯 `<div>`、`cursor: auto`、不可点」。这个结论错了：我当时查的是**折叠状态**
下的底部状态条（那一行确实是 `<span>`），没注意到同一行右侧有个 `aria-label="展开活动日志"`
的图标按钮。展开活动日志面板后，**每条抽取记录右侧本来就有「查看报告」按钮**
（`ActivityPanel.tsx:154-162`），成功路径的 `reportPath` 也一直写进了日志，回溯链路是齐的。

修复代理据实测把这一半改判为**既有能力**，只给它补了回归锁。实际缺口有两处：

1. **失败路径没有报告入口**：`source-task-runner.ts:88` 的 `recordFailure` 不带 `reportPath`，
   所以零建立（全非 16:9）那种情形，报告写了盘但活动日志那条红色记录点不开。
   CLI 侧同源：`pdf/extract.ts` 抛错时 `details` 不带尺寸/原因/`reportPath`，
   而 `index.ts` 的报告打印在成功路径之后，于是命令失败时用户看不到任何逐页明细。
2. **`hasExtractableText` 没有页级可见性**：`extraction-report-view.ts:109-110` 的注释声称
   「页面详情走 `manifest.source` 那条」，但桌面端没有任何组件读它——IPC `DeckStatusSlide`
   只带 `sourceKind`，CLI `deck status` 同样只回 `source.kind`。
   于是探测结果只在抽取当时的报告面板里出现过，页面本身不带这个信息。

结论修正为：A5 的「界面可见」**成立且可回溯**，缺的是失败路径的入口与页级呈现。

## A13 桌面端标注

`~/test/a12-ui-2026-08-02`（`wt4-spec-2026-08-02` 副本，4 页全 `generated`）总览：

```
生成 page-01 1/10  下一步 文字识别
生成 page-02 1/10  下一步 文字识别
生成 page-03 1/10  下一步 文字识别
生成 page-04 1/10  规格已更新        ← 只有这一页带漂移标注
```

单页视图头部亦标「生成 · 规格条目 entry-004」。漂移只落在 page-04，其余三页无标注，
且四页阶段状态均为 `1/10` 未变——与 A13 的 CLI 侧结论一致。

## A1 三种来源均跑通到「可编辑」PPTX

A2 走查把 `~/test/a23-mixed-2026-08-02` 跑到 11 页全 `report completed`
（5 `imported` / 5 `extracted` / 1 `generated`）并 `deck export --strict` exit 0，
导出件 `/tmp/a2-strict.pptx`（15 318 486 B）。A1 的判据是「**可编辑**」，
所以不能只看导出成功，要拆包看每种来源的页里到底有没有原生文本：

```
$ unzip -q /tmp/a2-strict.pptx && for i in 1 6 11; do
    echo "slide$i: 文本节点 $(grep -o '<a:t>' ppt/slides/slide$i.xml | wc -l) · 图片 $(grep -o '<p:pic>' ppt/slides/slide$i.xml | wc -l)"
  done
slide1  (imported ):  文本节点 44 · 图片 1
slide6  (extracted):  文本节点 44 · 图片 1
slide11 (generated):  文本节点 24 · 图片 1
```

`slide11` 的文本节点抽样：`桌面端截图走查自动化`、`首页_01.png`、`列表页_02.png`……
正是 `entry-001` 规格里的标题与生成图上的文字，说明生成图经 OCR → 复核 → 合成，
文字确实成了 PPTX 里的原生文本框，而不是烙在底图上。

**A1 通过**：三种来源各自都产出了含原生可编辑文本的页，且同处一份 `--strict` 导出件中。

补一条负面对照：`~/test/a912-mixed-2026-08-02` 的 page-10（`extracted`，源自
`mixed-aspect.pdf` 第 5 页）单独 `accept-pptx` 时自动检查报「形状 图1/文本框0」。
查其 `stages/review/text-blocks.json` 的 `blocks` 长度为 **0**——那一页源图本身就没有文字
（正是抽取报告里标「无可提取文本层」的那页）。**文本框 0 是源图内容决定的，不是链路缺陷**，
所以 A1 的 `extracted` 证据取的是有文字的 slide6，不是这页。

## 补 A4 的桌面端一半

A4 的 CLI 侧由并行代理走查（见 `a4.md`，结论通过、0 缺陷），它按分工没启动桌面端，
并指出「若要严格覆盖，主会话在桌面端打开一次旧格式 deck 即可补齐」。这里补上。

用**未被任何命令跑过的**旧格式 deck：`~/test/a4-ui-2026-08-02`
（直接复制自 `~/test/ppttest-2026-07-25`，`grep -c 'accept-source' slides/*/manifest.json` 两页都是 0）。
整目录 61 个文件的聚合指纹在三个时点各测一次：

```
打开 deck 前          7a2bbbaa12617b1fb543fef94f875e58d9364420
桌面端打开 deck 后    7a2bbbaa12617b1fb543fef94f875e58d9364420
进入 page-01 单页后   7a2bbbaa12617b1fb543fef94f875e58d9364420
```

**逐字节未变。** 界面表现：

- 总览：`共 2 页 · 已完成 2 · 进行中 0 · 未开始 0`，两页都是 `10/10`，无任何迁移提示或报错。
- 单页视图：十阶段清单完整，第一项就是「确认源图」——**旧 manifest 里根本没有这个阶段**，
  界面显示的是加载期归一化在内存里补齐的状态，而磁盘上一个字节没写。
  这是 RK4「零迁移」防线在界面侧的直接证据。
- 合成预览正常渲染出原生文本内容（「智能引擎赋能：AI Agent深度融入业务流…」等）。

## 附：一处文案观察（非验收判据）

`~/test/a12-ui-2026-08-02` 打开后，4 页都停在 `accept-source completed`（一步没跑），
总览却显示「没有需要你处理的页面 / 全部 4 页都已推进到位」。字面无错
（确实没有等待人工的页），但「已推进到位」对一份一步未跑的 deck 有误导。
真要推进得点「处理全部」。记为观察，不计入验收。

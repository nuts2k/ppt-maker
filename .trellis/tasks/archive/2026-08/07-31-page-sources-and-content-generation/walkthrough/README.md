# M5 阶段三集成验收 · 走查汇总（2026-08-02）

父任务 `implement.md` 阶段三（3.1–3.8）对 `prd.md` 的 A1–A13 逐条真机走查的总记录。
逐条证据在同目录的分片文件里，本文件只做索引、结论与缺陷去向。

| 分片 | 覆盖 | 执行 |
|---|---|---|
| `a4.md` | A4 | CLI 侧走查代理 |
| `a5-a6.md` | A5 / A6 | CLI 侧走查代理 |
| `a7-a13.md` | A7 / A13 | CLI 侧走查代理 |
| `a2-a3.md` | A2 / A3 | CLI 侧走查代理（最重的一组） |
| `a9-a12-ui.md` | A1 / A9 / A10 / A11 / A12 + 全部界面侧证据 | 主会话 |
| `fix-a10-a11.md` | 缺陷 ① ② 的修复 | 修复代理（worktree 隔离） |

四组 CLI 侧走查在各自独立的 deck 副本上**并行**执行，桌面端是单实例、由主会话独占，
所以「界面上是什么样」这一半统一由主会话取证。

## A1–A13 结论

| 条目 | 结论 | 依据 |
|---|---|---|
| A1 三种来源均跑通到可编辑 PPTX | **通过** | 拆包 `/tmp/a2-strict.pptx`：imported/extracted/generated 三页各有 44/44/24 个原生文本节点 |
| A2 混合来源 + `--strict` | **通过（修复后复验）** | 11 页三来源 `--strict` exit 0；`--json` 与桌面端总览逐页正确；CLI 人读输出缺来源 → 缺陷 ⑤ |
| A3 换源隔离 | **通过** | 默认 / `--keep-review` 各一次，其它页 shasum 逐字节未变；多代资产陷阱未复现 |
| A4 既有工作区零迁移 | **通过** | 旧 deck 直接跑完整条链路并 `--strict` exit 0；读操作磁盘逐字节未变（CLI 与桌面端各测一次） |
| A5 文本层探测落盘且可见 | **通过** | 落盘两处；桌面端抽取报告逐页显示「含/无可提取文本层」。可见性一次性 → 缺陷 ③ |
| A6 混合宽高比不整体失败 | **通过** | 建 3 跳 2、exit 0；跳过页带尺寸/宽高比/偏离度/容差/原因 |
| A7 生成溯源到具体 attempt | **通过** | `status.generation` → `source.attemptId` → `attempts[]` → `stages/init/<attempt>/` 三件套 |
| A8 ROADMAP 与实际交付一致 | **通过（收尾时更新状态行）** | 见文末 |
| A9 闸门不放行 generated | **通过** | `deck run` 后 page-11「（未执行）」停在 `accept-source (source)`，其余 10 页照常推进 |
| A10 自动放行不伪造人工痕迹 | **通过**（缺陷 ① 修复后复验） | 磁盘层本就成立；修复后 `sourceAcceptance` 与磁盘事实 11/11 一致，人读输出与界面均显式区分 |
| A11 换源翻转确认要求 | **通过**（缺陷 ② 修复后复验） | 反向本就成立；修复后 `imported → generated` 可达且回到待确认 |
| A12 带说明重新生成 | **通过** | 说明回写规格条目、两次生成各留条目级快照、新提示词含说明、其它页零变化 |
| A13 规格漂移不污染其它页 | **通过** | 双向验证；除 page-04 的 `specDrift` 外三次 snap diff 零差异 |

## 缺陷清单与去向

走查共发现 **8 条缺陷**，两批修完（提交 `25d6d4e`、`303ea43`），测试 732 → 774。
观察类（不修）另列在后。

| # | 卡住 | 内容 | 去向 |
|---|---|---|---|
| ① | A10 后半 | `AUTO_SOURCE_TRUST_PROVIDER`（`slide/workspace.ts:43`）全仓只有产生端无消费端；`deck status`、桌面端 IPC/界面、`report.json` 三处都区分不了「人工确认 / 按来源自动放行」 | 第一批 |
| ② | A11 正向 | `imported → generated` 路径不存在：`deck regenerate` 拒绝非生成页、`replace-source` 只产 `imported`、桌面端换源同理。与 design.md §4.5「不为重新生成单开分支」相悖 | 第一批 |
| ③ | A5 可见性 | **失败路径**没有报告入口（`recordFailure` 无 `reportPath`；CLI 抛错时 `details` 不带尺寸/原因/路径）；`hasExtractableText` 无页级可见性（IPC 只带 `sourceKind`）。※ 主会话初稿误判「成功路径也回不去」，实测活动日志展开后本就有「查看报告」，已更正 | 第二批 |
| ④ | — | 换源归档把资产 id 改名后没同步 attempt 的 `assetIds`（`replace-source.ts:172-178` 改名、`:390` 原样透传旧 attempts），落盘记录与事实相反 | 第二批 |
| ⑤ | **A2 直接命中** | `formatDeckStatus`（`deck/status.ts:246`）从不读 `slide.sourceKind`，人读输出一个字的来源都没有；数据层与桌面端都没问题，断在展示层 | 第二批 |
| ⑥ | — | `deck run` 对已完成 deck **不幂等**：completed 守卫只写在 `assist-review`/`clean`/`accept-pptx` 三个分支，`report`（`run-from.ts:186`）无任何复用，每跑一次重写 `report.json` 并追加 attempt（已累积 9 条）。**与 `contracts.md`〈阶段落库与强制重跑〉写死的「各阶段守卫 = `status !== "completed"`」直接不一致** | 第二批 |
| ⑦ | — | `report.json` 的 `providerCalls` 不带 `attemptId`，跑过两次生成的页出现两条 `stage:"init"` 且 `requestId` 均为 null，无法区分哪条对应当前图 | 第二批 |
| ⑧ | — | 非生成页的 `accept-source` 被人工失效后是**死路**：`runAcceptSource` 按来源拒绝，而 `run --from` 给出的下一条命令恰恰就是它，除手改 manifest 无出路。既有缺陷，第一批修复时顺手发现 | 第二批 |

### 缺陷 ⑤ 的产品口径（主会话拍板）

A2 原文要求「`deck status` 与桌面端总览能**逐页**看出来源」。桌面端做到了、`--json` 做到了，
只有 CLI 人读输出没有。定的修法是：**默认输出加一行来源分布汇总**
（`来源: 导入 5 / 抽取 5 / 生成 1`），**逐页明细走新增的 `--verbose`**。

理由：`deck status` 现有风格是「只列需要你管的」（完成计数 + 进行中/失败/漂移的点名），
把 N 行常态信息塞进默认输出会淹掉异常项；而「逐页看出来源」由 `--verbose`、`--json`
与桌面端总览共同满足。文案复用 `SOURCE_KIND_LABELS`，不在 CLI 另写一份。

## 观察（不修，记录备查）

1. **规则版本差卡住旧 deck**：`review-validation-v1 → v2` 由 `e03af4a`（2026-07-26，M4 阶段 A）
   引入 `LAYOUT_TEXT_MUST_BE_MASKED`，比 2026-07-25 建的 deck 晚一天。于是这类旧 deck 的
   `deck run` 会停在 `validate-review (validation-failed)`，而 `deck status` 仍显示「完成」
   （status 不做规则版本比对）。失败是响亮的、指名 blockId 与后果，按规则改一个布尔量即可通过。
   不算缺陷，但「比 2026-07-26 更早的 deck 要一次人工内容修正才能继续」是 A4「无迁移步骤」的边角。
   可选改进：失败提示里点明「该文档产出于规则 v1，v2 新增了 X 条」。
2. **clean 自动检查恒报「尺寸异常」**：期望值写死 2048×1152，而源图本身是 1672×940，
   底板与源图同尺寸恰恰是对的。`aspectRatioOk: true`、残留 0 像素，实质无害。非本次引入。
3. **「成本」只到 token 用量**，全仓没有金额字段。与 design §2 一致，是 A7 的措辞比实现强。
4. **`requestId` 恒 null**：`.env` 的 `OPENAI_BASE_URL` 指向的第三方代理不回传 `x-request-id`，
   代码侧如实透传。主会话的真实生成调用独立复现了一次。
5. **生成参数在 `generate-page.ts` 拼了两遍**（`:158` / `:207`）且键名一驼峰一蛇形，
   值同源暂不漂移，但加参数时容易只改一处。
6. **文案**：一步未跑的 deck 打开后显示「全部 N 页都已推进到位」。字面无错（确实没有等待人工的页），
   但对一份一步没跑的 deck 有误导。
7. **走查手法的坑**（非产品问题）：脚本手改 `text-blocks.json` 时只改 `text` 不改 `lines`，
   PPTX 会照旧文字合成且 `validate-review` 不报（取文规则「优先 `lines`，回退 `text`」）。
   桌面端编辑器两个字段一起写，真实用户路径无此问题。

## 代劳处（如实登记）

按《验收覆盖思考指南》，以下人工步骤是被代劳的，凡受影响的结论都已在分片记录里标注：

| 人工步骤 | 代劳方式 | 影响哪些结论 |
|---|---|---|
| 文本复核门（逐块判断 OCR 文字对不对） | 脚本把 `layout_text` 块置 `reviewStatus=reviewed` + `includeInMask=true`，再走产品的 `validate-review` 重新校验 | **不影响**链路连通性、来源维度、失效隔离、strict 导出；**影响**复核质量与最终 PPTX 文字正确性 |
| `accept-clean` / `accept-pptx` / `accept-final` | CLI 命令，`--note` 里写明「未在 PowerPoint for Mac 中人工打开检查」 | 同上 |
| `page-11` 的 `accept-source` | CLI `slide accept-source`，`--note` 写明未实际人工审图 | 同上 |
| `a23` 的 page-02 一次内容修正 | 脚本按规则把该块 `includeInMask` 置 true——**这一页不是自然跑通的**，原因是上面观察 1 的规则版本差 | A2 的「跑通」需带此注脚 |
| 桌面端原生对话框 | 主进程打桩注入路径 / 应答按钮（本机 osascript 发不了按键；锁屏会让原生 `showMessageBox` 把 main 卡在嵌套 run loop）。**调用本身未绕过** | 唯一没有直接证据的是那个框在屏幕上的样子 |

所有 `--note` 都把「未实际人工检查」写进了 `accepted.json`，磁盘记录本身是诚实的。

## 真实云调用

阶段三共 **30 次**：A4 走查 3 次（gpt-5.6-luna ×1、gpt-image-2 ×2）、
A2/A3 走查 20 次（assist-review 8 + clean 12）、主会话 7 次
（A12 的图像生成 1 次 + A9 的 `deck run` 触发 assist-review 5 次、clean 1 次）。
全部走既有 `--confirm-upload` / `--confirm-api` 约定，无一次绕过付费门。

## 第一批修复的真机复验（缺陷 ① ②，提交 `25d6d4e`）

修复在隔离 worktree 里完成，取 diff 合回主工作区后重新 build 并复验。
测试 **732 → 749**（core 111 / desktop 467 / cli 171），`format:check` 与三包 `typecheck` 全过。

### A10

```
$ node apps/cli/dist/index.js deck status ~/test/a23-mixed-2026-08-02
ppttest-2026-07-25 (11 页)
  完成: 11/11
  源图确认: 人工确认 1，按来源自动放行 10，待确认 0
```

逐页把 `--json` 的 `sourceAcceptance` 与磁盘上 `stages/source/accepted.json` 是否存在对表：
**11/11 全部一致**（10 个 `auto` 对应磁盘无文件，1 个 `manual` 对应磁盘有文件）。

关键的负面用例也验了：**旧格式 deck 不得凭空长出人工痕迹**。
`~/test/a4-ui-2026-08-02`（无 `source`、无 `accept-source`）两页均判 `auto`，
且 `deck status` 跑完后整目录指纹仍是 `7a2bbbaa…`——A4 的零迁移没被这次修复破坏。

界面侧：总览卡片的来源徽标 hover 提示为「导入 · 按来源自动放行」/「生成 · 人工确认」，
审片视图头部同样标「导入 · 按来源自动放行」。

### A11

`~/test/a912-mixed-2026-08-02` 的 page-11 此前已由 `generated` 换成 `imported`。
修复后它带上了回程线索 `regenerableSpecEntryId: "entry-001"`（判据是该页自己的
`stages/init/<attemptId>/content-spec.json` 历史快照，不是猜的），于是：

```
$ node apps/cli/dist/index.js deck regenerate ~/test/a912-mixed-2026-08-02 \
    --page page-11 --note "A11 正向复验：从导入来源换回生成来源" --confirm-upload
已重新生成 page-11（entry-001，init-004）
来源已由 imported 换回 generated
失效阶段：accept-source
调整说明（2 条，后出现的优先）：把主标题再放大一档… / A11 正向复验：从导入来源换回生成来源
EXIT=0
```

换回之后：`sourceKind = generated`、`sourceAcceptance = pending`、
`accept-source = stale` 且 `invalidationReason: 重新生成：按内容规格重出该页`、
`init` 保持 `completed`、磁盘无 `accepted.json`。snap diff 只有 page-11 两行，
**其余 10 页逐字节零变化**。

界面侧：把 `~/test/a12-ui-2026-08-02` 的 page-01 换成 `imported` 后，
单页工具栏的「源图审片」入口**仍然可达**（判据由 `generatedSource` 改为 `regenerableSource`），
进去后「重新生成」按钮在，头部标「导入 · 按来源自动放行」。
入口是子任务④ 已建立的那一个，没有新增按钮或模态。

### 修复代理主动记录的三处取舍

1. `accept-source` 转的是 `stale` 而非 `pending`（与既有 generated→generated 路径一致，
   `stale` 携带 `invalidationReason`；对外可观测行为满足「回到待确认」）。
2. 动了 `report/run.ts`（「报告要有 source 段」必然要改它），做的是外科式增补，
   与 `providerCalls` 构造块零重叠。
3. **纯导入页在桌面端仍换不成生成来源**——没有历史快照就拿不到「选哪条规格条目」的入口，
   而选条目是内容决策、属 M6 范畴；CLI 的 `--spec-entry` 覆盖了这个场景。
   另发现一条**既有缺陷、非本轮引入**：非生成页被人工失效 `accept-source` 后，
   工具栏会显示「确认源图」但点下去必然报错（`runAcceptSource` 按来源拒绝）。

## 收尾

- [x] 第一批修复（① ②）合入并复验，提交 `25d6d4e`
- [x] 第二批修复（③④⑤⑥⑦ + 可选改进）合入并复验

## 第二批修复的真机复验（缺陷 ③④⑤⑥⑦）

测试 **749 → 769**（core 111 / desktop 474 / cli 184），`typecheck` 与 `format:check` 全过。

### ⑤ `deck status` 来源可见

```
$ node apps/cli/dist/index.js deck status ~/test/a23-mixed-2026-08-02
ppttest-2026-07-25 (11 页)
  完成: 11/11
  来源: 导入 5 / 抽取 5 / 生成 1
  源图确认: 人工确认 1，按来源自动放行 10，待确认 0

$ … --verbose
  逐页:
  page-01  导入  report (completed)
  …
  page-06  抽取（含可提取文本层）  report (completed)
  page-10  抽取（无可提取文本层）  report (completed)
  page-11  生成  report (completed)
```

`--verbose` 顺带把 ③ 的页级文本层探测也带出来了，page-06 与 page-10 的取值相反，
与磁盘上 `source.hasExtractableText` 一致。`SOURCE_KIND_LABELS` 已下沉到 core，两端共用一份词。

### ⑥ `deck run` 幂等

拿 11 页全完成的 deck 复制到 `/tmp/idem-check`，snap → `deck run --confirm-api --confirm-upload` → 再 snap：

```
$ diff /tmp/idem-before.txt /tmp/idem-after.txt
（空）
```

11 页目录指纹**逐字节不变**（修复前是 11 行 HASH 全变）。`validate-review` 按
`documentSha256` + `rulesVersion` + 当前 review attempt 三条判据复用既有报告，
**没有**为它造一个假的持久状态；显式 `slide report` 命令的递增行为未动，那条既有用例仍绿。

### ③ 抽取报告可见性

单页工具栏那行现在是三段：

```
page-01   抽取 · 按来源自动放行 · 含可提取文本层
page-03   抽取 · 按来源自动放行 · 无可提取文本层
```

失败路径：把 `fixtures/pdf-extraction/no-wide.pdf` 追加进已有 deck（零建立），
顶部报错「PDF 中没有可用于建立页面的 16:9 页：no-wide.pdf（跳过 2 页）」，
展开活动日志后那条红色失败记录右侧长出了「查看报告」，点开是完整的历史报告：

```
no-wide.pdf · 全部页 · macos-pdfkit 1+macOS-26.5.2
建立 0 页    跳过 2 页
宽高比不是 16:9（2）
  第 1 页 · 841.9×595.3 pt · …偏离 16:9 达 20.45%，超出容差 0.50%；不会自动裁剪、拉伸或补边
  第 2 页 · 595.3×841.9 pt · …偏离 16:9 达 60.23%，超出容差 0.50%；不会自动裁剪、拉伸或补边
```

### ⑧ 非生成页失效后的死路

这条是第一批修复代理顺手发现、由主会话补进第二批的，实测比原描述更严重：
不只是界面摆了个必然失败的按钮，**`run --from` 给出的下一条命令
`ppt-maker slide accept-source` 就是那条必然失败的命令**——CLI 与界面双双死路，
这一页除了手改 manifest 没有出路。

修法定在**失效点**而非按钮：按 design.md §4.5，非生成页的源图确认是**来源规则的结论**
而非人工动作，所以 `runAcceptSource` 的拒绝是对的（放开就凭空产生假的人工痕迹），
错的是那个 stale 状态本身不该存在。`invalidateSlideStage` 复用 `replaceSlideSource`
第 5 步同一个 `buildSourceGate`，失效算完后按来源自动重放行。

复验（`/tmp/gate8` 的 page-06，`extracted`，10/10 全完成）：

```
invalidated: ["ocr","review","assist-review","mask","clean","accept-clean","pptx","accept-pptx","report"]
                                                          ↑ 9 个下游，不含 accept-source
init           completed        accept-source  completed（自动重放行）    ocr  stale
sourceAcceptance = auto      blockingStage = ocr   ← 死路解除
attempts[accept-source] = [accept-source-001 auto-source-trust assetIds:[],
                           accept-source-002 auto-source-trust assetIds:[]]
磁盘 stages/source/accepted.json：不存在
```

新增的那条 attempt 是 `auto-source-trust`、`assetIds` 为空、不写 `accepted.json`——
重放行没有伪造任何人工痕迹。**生成页零影响**：人工确认过的 `generated` 页失效后仍是 stale，
`runAcceptSource` 仍可用。刻意留的边界是显式失效 `init` 时不重放行
（那时源图本身存疑，且 `init` 不在 `RUN_SEQUENCE` 里，属另一件事）。

### 可选改进

`validate-review` 失败时会点明「上一次按规则 v1 校验，现为 v2，本次失败可能来自新增规则」。
**没做**「新增了 N 条」——全仓没有按版本索引的规则注册表，要数出 N 得先建一张
版本→规则集的表，成本远超这句提示；只报版本变化是能拿到的事实。这个取舍是对的。
- [ ] `prd.md` 的 A1–A13 勾选
- [ ] `implement.md` 的 3.1–3.8 勾选
- [ ] ROADMAP：M5 小节状态行由「进行中」改为已完成，顶部状态行同步
      （子任务四项已是「已归档」，无需再改）
- [ ] 归档父任务

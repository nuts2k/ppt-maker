# 阶段三修复第二批（缺陷 ③④⑤⑥⑦⑧ + 一条可选改进）

日期：2026-08-02　基线 HEAD：`25d6d4e`（第一批修复）
未提交，改动全部留在主工作区。**未启动桌面端**，未触碰 `~/test/` 与 `open-design/`。

测试数：**core 111 / desktop 474 / cli 189 = 774**（基线 749，+25）。

---

## ⑤ `deck status` 人读输出不显示来源（A2 直接命中）

**根因**：`formatDeckStatus` 只渲染「完成 / 进行中 / 失败 / 规格漂移 / 规格失联 / 源图确认」
六种行，从不读 `slide.sourceKind`。数据层与桌面端都是好的，断在展示层。

**改法**（按主会话拍板的口径）：

1. 中文短词表 `SOURCE_KIND_LABELS` **从桌面端下沉到 core**
   （`packages/core/src/source-contracts.ts`），桌面端 `renderer/lib/source-view.ts`
   改为转出，界面侧既有导入点一行未改。CLI 不再有「照抄一份还是跨包引用」的选择。
2. 默认输出加一行分布汇总：`  来源: 导入 1 / 抽取 1 / 生成 1`。
   顺序取 `SlideSourceKindSchema.options`（不按计数排序——同一个 deck 两次运行不该换行序），
   计数为 0 的档不列。
3. 新增 `deck status --verbose`，逐页一行：`  page-02  抽取（含可提取文本层）  ocr (completed)`。
   已移除页只写「已移除」，不编一个来源出来。

**涉及文件**：`packages/core/src/source-contracts.ts`、`apps/cli/src/deck/status.ts`、
`apps/cli/src/index.ts`、`apps/desktop/src/renderer/lib/source-view.ts`

**新增测试**（`apps/cli/test/deck-status.test.ts`，describe「deck status 的人读输出显示来源」）：

- `默认输出给出来源分布，只列出现过的档`
- `单一来源的 deck 不列出计数为 0 的档`
- `--verbose 逐页列出来源，抽取页附带文本层探测结果`
- `hasExtractableText 只在抽取页有值，其余为 null`

**真机复验**：

```bash
pnpm --filter @ppt-maker/core build && pnpm --filter @ppt-maker/cli build
node apps/cli/dist/index.js deck status ~/test/wt4-append
node apps/cli/dist/index.js deck status ~/test/wt4-append --verbose
```

预期：默认输出在「完成」「源图确认」之间多一行
`  来源: 导入 4 / 抽取 6 / 生成 1`（按该 deck 实际构成）；`--verbose` 额外给出
`  逐页:` 与 11 行明细，6 个抽取页各带「（含/无可提取文本层）」。

---

## ⑥ `deck run` 对已完成 deck 不幂等（契约违背）

**根因**：`run-from.ts` 的 completed 守卫只写在 `assist-review` / `clean` / `accept-pptx`
三个分支上。`report` 既没有守卫、函数内部也**没有**指纹复用，每 run 一次就重写一遍
`report.json`（新 `generatedAt`）并追加一条 attempt；`validate-review` 是瞬态阶段，
同样每次重写 `validation.json` 的 `checkedAt`。与《跨层契约》〈阶段落库与强制重跑〉
写死的「各阶段守卫 = `status !== "completed"`」不一致。

**改法**：

- `report` 补上与既有三个分支同形的守卫（`run-from.ts`）。
  **显式的 `slide report` 命令不受影响**——它直接调 `runSlideReport`，仍然递增 attempt；
  既有用例 `slide report > 重跑 report 递增 attempt 编号而非覆盖` 未改、仍绿。
- `validate-review` **不造假的持久状态**，改为按产物自身的判据复用
  （`validate-review.ts`）：当前路径上那份报告的 `documentSha256` 与实时 sha 相同、
  `rulesVersion` 也相同，且该资产绑在**当前那次 review attempt** 上，就原样返回，一个字节不写。
  绑 attempt 这一条挡住了「`--keep-review` 换源后源图尺寸变了、同一份文档结论可能不同」。

`ocr` / `review` / `mask` / `pptx` 未补守卫：它们函数内部有 `isStageReusable`，
产物字节不变、attempt 不增，代价只是空跑。这与走查记录的判断一致。

**涉及文件**：`apps/cli/src/slide/run-from.ts`、`apps/cli/src/slide/validate-review.ts`

**新增测试**：

- `apps/cli/test/slide-run-report.test.ts`
  - `已跑完的页再 run 一次：report 与 validation 逐字节不变，attempt 不增`
    —— 断言落在**磁盘字节**上（`report.json` / `validation.json` / `manifest.json` 三个文件），
    不是返回值。已验证：把守卫去掉后这条用例立刻红。
  - `report 被失效后 run 会真的重跑它` —— 守卫的另一半，`stale` 必须重跑，
    否则「从阶段 X 重跑」退化成毫秒空转。
- `apps/cli/test/slide-validate-review.test.ts`（新 describe「validate-review 的复用与规则版本差」）
  - `复核稿与规则都没变时复用既有结论，文件逐字节不变`
  - `复核稿改动后重新校验，不再复用`

**真机复验**（在一个 11 页全完成的 deck 副本上，别用原件）：

```bash
cp -R ~/test/<某个全完成 deck> /tmp/idem && \
tools/snap.sh /tmp/idem /tmp/i1.txt && \
node apps/cli/dist/index.js deck run /tmp/idem --confirm-api --confirm-upload && \
tools/snap.sh /tmp/idem /tmp/i2.txt && diff /tmp/i1.txt /tmp/i2.txt && echo "零差异"
python3 -c "import json,collections;print(collections.Counter(a['stage'] for a in json.load(open('/tmp/idem/slides/page-10/manifest.json'))['attempts']))"
```

预期：`diff` 无输出（此前 11 行 HASH 全变）；`report` 的 attempt 计数不再增长。

---

## ③ 抽取报告的可见性（三个缺口）

### 与走查记录不符的一处，以实测为准

走查记录说「活动日志里那条『建立 3 页，跳过 2 页』是纯 `<div>`」。**实测不成立**：
`ActivityPanel.tsx:154-162` 已有「查看报告」按钮，`source-task-runner.ts` 的成功路径
（`record()`）也确实把 `reportPath` 写进了活动日志，IPC `deck:read-extraction-report`
与 `ExtractionReportPanel` 的回溯打开链路齐全。真正缺的是**失败路径**——这与
`a5-a6.md` 缺陷①（`recordFailure` 无 `reportPath`）的描述完全吻合。
我据此把「成功路径回溯」改判为**既有能力**，并给它补了一条回归锁（见下），
只修失败路径。

### 缺口 1：追加路径 + 零建立时报告写了盘但没人告诉用户它在哪

抽取有**三种结局**（全建立 / 部分跳过 / 一页没建成），报告此前只在前两种被打印。

- `apps/cli/src/pdf/extract.ts`：`created.length === 0` 抛错时把
  **整份报告与它的落盘路径**放进 `FoundationError.details`（新建 deck 整个丢弃时
  `reportPath` 为 `null`，报告仍在 details 里）。报告只有页号、尺寸与中文原因，
  无图片内容与秘密，不违反「details 只装可序列化诊断数据」。
- 新增 `extractionFailureDetails(error)`：**CLI 与桌面端共用同一个读取点**，
  两侧各写一次 `as { report?: … }` 就是同一份契约的两个私有副本。
- `apps/cli/src/index.ts`：`deck extract` 的 action 包一层 try/catch，
  失败时先把 `formatExtractionReport(report)` 与 `报告：<path>` 写到 stderr 再重新抛出。
- `apps/desktop/src/main/runner/source-task-runner.ts`：`recordFailure` 增
  `reportPath` 参数并从错误详情取值，活动日志失败行随之长出「查看报告」按钮。

### 缺口 2：`hasExtractableText` 无页级可见性

`extraction-report-view.ts:109-110` 的注释承诺「页面详情走 `manifest.source` 那条」，
但桌面端没有任何组件读它——IPC 只截到 `sourceKind`。现在打通：

- `apps/cli/src/deck/status.ts`：`DeckSlideStatus` 增
  `hasExtractableText: boolean | null`（非 `extracted` 页与移除页为 `null`）。
- `apps/desktop/src/main/ipc/channels.ts`：`DeckStatusSlide` 同步该字段
  （`SlideDetail extends DeckStatusSlide`，main 侧 `slides: status.slides` 直接透传，
  无需改映射）。
- `apps/desktop/src/renderer/lib/source-view.ts`：新增 `extractableTextText`，
  并把它接进 `sourceSummaryText`，于是**单页工具栏那一行**变成
  「抽取 · 按来源自动放行 · 含可提取文本层」，卡片 tooltip 同步。
- 措辞下沉到 core 的 `extractableTextLabel`，抽取报告面板、CLI 报告格式化、
  `deck status --verbose`、页面详情四处共用一句话。
- `extraction-report-view.ts` 那段注释改成实情（那条路径现在是真的）。

### 缺口 3（同缺口 1 的失败路径）

已随缺口 1 一并修掉。

**涉及文件**：`packages/core/src/source-contracts.ts`、`apps/cli/src/pdf/extract.ts`、
`apps/cli/src/pdf/report.ts`、`apps/cli/src/index.ts`、`apps/cli/src/deck/status.ts`、
`apps/desktop/src/main/ipc/channels.ts`、`apps/desktop/src/main/runner/source-task-runner.ts`、
`apps/desktop/src/renderer/lib/source-view.ts`、`apps/desktop/src/renderer/lib/extraction-report-view.ts`

**新增测试**：

- `apps/cli/test/pdf-extract.test.ts`
  - `追加路径下零建立：报告落盘，且路径与逐页原因进错误详情`
  - `新建路径下零建立：报告仍进错误详情，但磁盘上没有（deck 整个丢弃）`
- `apps/desktop/test/source-task-runner.test.ts`（**新文件**，用真实 PDF 夹具驱动真实执行器，
  不桩掉抽取——桩掉会把被测的那一环一起桩掉）
  - `成功记录带上报告路径，供关闭完成面板后回溯`（既有能力的回归锁）
  - `零建立时带上报告路径，且路径指向磁盘上真实存在的报告`
  - `与抽取无关的失败不凭空造一个报告入口`
- `apps/desktop/test/source-view.test.ts`（新 describe「抽取页的文本层探测结果」）
  - `true / false 各有文案，非抽取页不标注`
  - `与抽取报告面板同一措辞，不各写一份`
  - `进入「来源 · 确认性质 · 文本层」摘要行`
  - `非抽取页的摘要行不多出一段`

**真机复验**：

CLI 侧（先复制一个 deck，别用走查原件）：

```bash
cp -R ~/test/a6-mixed-2026-08-02 /tmp/ext && \
node apps/cli/dist/index.js deck extract --pdf ~/test/no-wide.pdf --deck /tmp/ext; echo "EXIT=$?"
```

预期 stderr 里在错误消息**之前**出现完整报告（`建立 0 页，跳过 2 页` + 两行带尺寸与
原因的「跳过 第 N 页」）与一行 `报告：/tmp/ext/extractions/...json`；`EXIT=1` 不变。

桌面端侧（主会话在真机上）：

1. 打开任意 deck → 顶栏「新建 Deck…」→ PDF → 选 `fixtures/pdf-extraction/no-wide.pdf`
   抽进**已存在**的 deck。预期：任务失败，**活动日志那条红色记录右侧出现「查看报告」按钮**，
   点开能看到逐页跳过原因。（此前该行没有按钮。）
2. 打开一个含抽取页的 deck（如 `~/test/wt4-append`），点进任一抽取页的复核页，
   看**工具栏那一行**：应为「抽取 · 按来源自动放行 · 含可提取文本层」
   （此前只有前两段）。导入页与生成页应仍只有两段。
3. 控制台卡片悬停抽取页缩略图，tooltip 同样带第三段。

---

## ④ 换源归档后 attempt 的 `assetIds` 未同步

**根因**：`archiveArtifacts` 在 `renameId: true` 时把资产 id 改成
`<id>-archived-<initAttemptId>`，但只重建了 `assets`；写 manifest 时既有 `attempts`
被原样透传，旧 id 随后被下一次 `accept-source` 以同一个固定 id 重新占用——
顺着「第一次确认」这次 attempt 追到的是**第二次确认**的文件。

**改法**：`archiveArtifacts` 多返回一份 `renamedAssetIds`（旧 id → 新 id），
写 manifest 时对既有 attempts 做一次 `assetIds.map(id => renamed.get(id) ?? id)`。

**涉及文件**：`apps/cli/src/slide/replace-source.ts`

**新增测试**（`apps/cli/test/replace-source.test.ts`）：
`归档改名后 attempt 的 assetIds 仍指向它当时那份资产` —— 走的是 generated 页的
常规循环（确认 → 换源重新生成 → 再确认），断言两层：全局不变量（任一 attempt 的
`assetIds` 都能找到资产，且那份资产的 `attemptId` 就是它自己）+ 具体那一条
（第一次确认指向 `archived/<init-002>/accepted.json`）。

**真机复验**：无界面症状（当前没有消费方读 `attempt.assetIds`）。要看的话，在一个
生成页上跑「确认 → 重新生成 → 再确认」，然后：

```bash
cd <deck> && python3 - <<'PY'
import json,glob
for p in sorted(glob.glob('slides/*/manifest.json')):
    m=json.load(open(p)); byid={a['id']:a for a in m['assets']}
    for at in m['attempts']:
        for aid in at['assetIds']:
            a=byid.get(aid)
            if a and a['attemptId']!=at['id']:
                print(f"{p} attempt={at['id']} → 资产 {aid} 的 attemptId 实为 {a['attemptId']}")
PY
```

预期：无任何输出（此前会打印一行 `accept-source-001 → … 实为 accept-source-002`）。
**注意**：已有的 `~/test` 走查产物里那条错误记录不会被自动修复，要新跑一轮才看得出。

---

## ⑦ 报告 `providerCalls` 不带 `attemptId`

**根因**：`report/run.ts` 按裸 role 收集全部 `provider_record`（这里是**有意的**，
成本要算全部历史调用），但只写 `stage / model / requestId / durationMs / usage`。

**改法**：`ProviderCall` 增必填 `attemptId`（`packages/core/src/report-contracts.ts`），
取值用**承载它的资产的 `attemptId`**，不靠裁 `provider-<attemptId>` 这个约定拼法。
全仓已确认 `SlideReportSchema` 只有写入方、没有读回方，加必填字段不破坏任何既有产物的加载。

`requestId` 恒 null 按要求**未动**（第三方代理不回传 `x-request-id`，代码侧如实透传）。

**涉及文件**：`packages/core/src/report-contracts.ts`、`apps/cli/src/report/run.ts`

**新增测试**（`apps/cli/test/slide-run-report.test.ts`）：
`providerCalls 带 attemptId，多代生成可区分` —— 夹具刻意复刻真实形态：
**同一 stage 两条 `provider_record`、分属 init-001 / init-002 两代**。
只造一条的夹具会让这个缺陷全程隐身。

**真机复验**：对一个跑过两次生成的页重跑报告后查看

```bash
node apps/cli/dist/index.js slide report <workspace> >/dev/null
python3 -c "import json;d=json.load(open('<workspace>/stages/report/report.json'));print(d['providerCalls'])"
```

预期：两条 `stage: "init"` 各带不同的 `attemptId`（`init-001` / `init-002`），
可与该页 `source.attemptId` 对上，从而分辨哪条对应当前这张图。

---

## 可选改进：`validate-review` 失败提示点明规则版本差

**成本低，做了**。`runSlideValidateReview` 多返回一个**不落盘**的
`previousRulesVersion`：当前路径上那份旧报告的 `rulesVersion` 与当前版本不同时才有值。

- `run-from.ts` 的 `validation-failed` 消息追加：
  `；该文档上一次按规则 review-validation-v1 校验，现为 review-validation-v2，本次失败可能来自新增规则`
- `slide validate-review` 命令在失败时先往 stderr 写一句同义的「提示：…」

**没做「新增了 N 条」**：全仓没有按版本索引的规则注册表，要数出 N 得先建一个
版本→规则集的表，成本远超这句提示的价值。只报「版本从 X 变成了 Y」是能拿到的事实，
不编造数字。

**顺带效果**：规则版本不同 ⇒ 不复用旧结论，必定重算——不会拿旧版规则的结论顶数。

**新增测试**：`apps/cli/test/slide-validate-review.test.ts` 的
`上一份报告的规则版本不同时如实回报，供失败提示点明`。

**真机复验**：拿一个 2026-07-25 之前建的 deck 副本（`~/test` 里有），跑

```bash
node apps/cli/dist/index.js deck run /tmp/<旧deck副本> --confirm-api --confirm-upload
```

预期：停在 `validate-review (validation-failed)` 时的那句消息末尾多出规则版本那段话。

---

## ⑧ 非生成页被人工失效 `accept-source` 后卡在一道谁都解不开的门上

### 实测复现（比交办描述更严重：CLI 也是死路）

用一页 `imported` 工作区实跑（脚本见 scratchpad `repro8.mjs`）：

```
[初始]   kind=imported accept-source=completed lastOk=accept-source-001
invalidated: [ 'accept-source' ]
[失效后] kind=imported accept-source=stale   lastOk=accept-source-001
runAcceptSource 抛错: INVALID_STAGE_STATE | 来源 imported 的源图无需人工确认，已在建立工作区时自动放行
run --from ocr → { gate: "source", stoppedAt: "accept-source",
                   nextCommand: "ppt-maker slide accept-source <workspace>",
                   message: "请确认这一页的源图可用，之后链路才会继续" }
```

交办描述说的是「界面摆出一个按下去必然失败的按钮」。**实测比这更严重：
`run --from` 自己给出的下一条命令就是那条必然失败的命令。**
CLI 与界面双双是死路，这一页除了手改 manifest 没有任何出路。

### 判断：修在失效点，不堵按钮

按 `design.md` §4.5，`imported` / `extracted` 的源图确认**不是一次人工动作，
而是来源规则的结论**——「这一页的图是不是已被信任」这个布尔量由
`requiresSourceAcceptance` 单点给出。所以：

- `runAcceptSource` 对非生成页的拒绝**是对的**，不该放开——放开就会凭空产生一条
  `acceptedBy` 指向某人的记录，正是 §4.5 明令禁止的伪造人工痕迹。
- 界面的「确认源图」也不是根因：它读的 `awaitingSourceConfirm` 忠实反映了阶段状态，
  错的是**那个状态本身不该存在**。
- 真正缺的是**失效后按来源重新放行**那一格。

**这不是新机制**：`replaceSlideSource` 第 5 步（`replace-source.ts`）早就是
「先失效 `accept-source`、再按新来源重判」，用的就是 `buildSourceGate`。
`invalidateSlideStage` 是另一条会碰到这道门的路径，它缺了这一步。

### 改法

`apps/cli/src/slide/invalidate.ts` 新增 `reReleaseAutoSourceGate`：失效算完之后，
若 `accept-source` 不是 completed 且该页来源无需人工确认，就用 `buildSourceGate`
重新放行（追加一条 `auto-source-trust` attempt，**不写** `accepted.json`、不建资产）。
**下游仍然保持 stale**——「从该阶段重跑」想要的正是这个结果。

修复后同一脚本：

```
invalidated: []                       # 全新工作区下游本就 pending，如实为空
[失效后] accept-source=completed lastOk=accept-source-002
run --from ocr → { gate: "api", stoppedAt: "assist-review", … }   # 链路照常往下走
```

已跑完的页（下游 completed）上：闸门回 completed、下游 9 个阶段全部 stale、
`invalidated` 如实列出那 9 个而不含 `accept-source`。

**一个刻意留下的边界**：显式失效 `init` 时不重放行——那时源图本身在存疑状态，
放行它会与 `assertStageDependenciesCompleted` 打架。`init` 不在 `RUN_SEQUENCE` 里、
本来就没有重跑路径，属另一件事，未纳入本次收口。

**生成页零影响**（实测）：人工确认过的 generated 页失效后仍是 `stale`，
`runAcceptSource` 仍然可用、再次确认写出 `accept-source-002`。

**顺带**：`accept-gate.ts` 里 `sourceReviewReachable` 那段注释原本举的例子
（「非生成页被人工失效之后同样停在这道门上」）现在不再成立，已改写为生成页的情形，
并注明非生成页由失效点自动重判。桌面端**代码未改**：非生成页不再进入
`awaitingSourceConfirm`，那个按钮自然不出现。

**涉及文件**：`apps/cli/src/slide/invalidate.ts`、
`apps/desktop/src/renderer/lib/accept-gate.ts`（仅注释）

**新增测试**（`apps/cli/test/slide-invalidate.test.ts`，
describe「失效波及 accept-source 时按来源重判」，5 条）：

- `导入页自动重新放行，下游仍然 stale`
- `自动重放行只追加一条 auto-source-trust attempt，不写 accepted.json`
  （连带断言 `resolveSourceAcceptanceMode` 仍判 `auto`，没有假的人工痕迹）
- `重放行后 CLI 不再把用户指向一条必然失败的命令`（断言 `gate !== "source"`，
  同时保留 `runAcceptSource` 对非生成页仍然拒绝这条正对照）
- `生成页不受影响：仍然停在门上等人确认`
- `init 自身未完成时不重放行：源图本身就在存疑状态`

**真机复验**：

**没有 `slide invalidate` 这个 CLI 命令**——`invalidateSlideStage` 只经桌面端 IPC
`slide:invalidate-stage` 暴露，真实用户路径是**单页阶段轨道上点某个阶段「从该阶段重跑」**
（`ReviewPage.tsx` 的 `rerunFrom`）。所以：

桌面端（主路径）：打开一个 `imported` 页 → 在阶段轨道上对 `确认源图` 那一格触发
「从该阶段重跑」。预期该页**不**出现「确认源图」按钮、也不进待办队列，
续跑直接从 `ocr` 开始。（此前：轨道变 stale、工具栏冒出「确认源图」，点下去报
`来源 imported 的源图无需人工确认`。）

CLI 侧要单独看的话走同一个函数：

```bash
cp -R ~/test/<任一含 imported 页的 deck> /tmp/gate8
node -e '(async()=>{const{invalidateSlideStage}=await import("/Users/kelin/Workspace/ppt-maker/apps/cli/dist/slide/invalidate.js");console.log(await invalidateSlideStage({workspacePath:"/tmp/gate8/slides/page-01",stage:"accept-source",reason:"人工要求从该阶段重跑"}))})()'
node apps/cli/dist/index.js deck status /tmp/gate8 --verbose
node apps/cli/dist/index.js deck run /tmp/gate8 --confirm-api --confirm-upload
```

预期：该页 `accept-source` 仍为 `completed`（不是 `stale`），下游转 stale 并被重跑，
`deck run` 不停在源图确认门；`/tmp/gate8/slides/page-01/stages/source/accepted.json`
**不存在**。

---

## 一处需要主会话知道的测试环境现象

`pnpm -r test` 在本轮**跑了三次，第一次 CLI 侧报 10 个失败，后两次全绿**；
CLI 单独跑（`pnpm --filter @ppt-maker/cli test`）也全绿。这与
`b65101e`「抬高 testTimeout 修掉并跑时的随机超时」记录的并跑超时是同一类现象，
**不是本批改动引入的**——失败集中在耗时最长的那批用例上，且不可复现。
若主会话复验时再遇到，先单包重跑一次确认。

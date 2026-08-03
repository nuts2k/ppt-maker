# 换机器接续说明（2026-08-02）

M5 已收官归档，**当前无活动 Trellis 任务**，下一步是 M6 内容策划工作台。
这份文档只解决一件事：**哪些东西不在 git 里，新机器上必须手工补**。

## 一、必须手工带的三样

### 1. `.env`（仓库里没有，也不该有）

```
OPENAI_API_KEY=<20 字符>
OPENAI_BASE_URL=<30 字符>
```

`.env.example` 有模板。**`OPENAI_BASE_URL` 指向的是第三方兼容代理，不是官方端点**——
它不回传 `x-request-id`，所以工作区里所有 `provider.json` 的 `requestId` 恒为 `null`。
这不是代码缺陷（代码侧如实透传），换成官方端点这个字段才会有值。

### 2. Swift 原生二进制（`.build/` 被 gitignore）

两个都要重编，`pnpm build` 已经包含：

| 二进制 | 用途 | 单独构建 |
|---|---|---|
| `native/macos-vision-ocr/.build/macos-vision-ocr` | 离线 OCR | `pnpm build:vision` |
| `native/macos-pdf-render/.build/macos-pdf-render` | PDF 逐页渲染与文本层探测 | `pnpm build:pdf` |

**缺这两个会有 12 个与代码无关的测试失败**，别去查代码。

### 3. `~/test/` 下的真实 deck 工作区（492M，不随仓库迁移）

**最小必带三份（约 80M）**，其余可不带：

| 目录 | 是什么 | 为什么还要它 |
|---|---|---|
| `wt4-spec-2026-08-02`（7.6M） | 4 页全 `generated`、均已确认源图，`content-spec.json` 在 deck 根 | **M6 的直接输入**——内容规格契约的真实使用样本；page-04 带规格漂移标注 |
| `ppttest-2026-07-25`（29M） | M3/M4 旧格式基线，**无 `source` 字段** | 零迁移回归的唯一真实历史数据，fixture 造不出来 |
| `wt4-append`（43M） | 11 页混合来源基线（2 旧格式导入 + 2 导入 + 6 抽取 + 1 生成） | 混合来源类走查的起点，省掉重建 deck |

**可以不带**：`a23-mixed-2026-08-02`、`a912-mixed-2026-08-02`、`a4-regression-2026-08-02`、
`a4-ui-2026-08-02`、`a12-ui-2026-08-02`、`mixed-aspect-2026-08-02`、`a5-vector-2026-08-02`、
`a6-mixed-2026-08-02` —— 都是 2026-08-02 阶段三走查的产物，结论已全部记进
`.trellis/tasks/archive/2026-08/07-31-page-sources-and-content-generation/walkthrough/`。
`wt4-old`、`wt4-images-2026-08-02`、`b2-export-strict-2026-08-02`、`ppttest-switch-target`、
`ppttest-walkthrough-E3` 是更早的中间产物，同样可弃。

PDF 素材（`b2-export-strict.pdf`、`mixed-aspect.pdf`、`no-wide.pdf`）在仓库的
`fixtures/pdf-extraction/` 里有对应件，也能用 `pnpm fixture:pdf` 重新生成。

## 二、新机器落地步骤

```bash
git clone https://github.com/nuts2k/ppt-maker.git && cd ppt-maker
cp .env.example .env && $EDITOR .env        # 填上面两个键

pnpm install
pnpm build                                   # 含 build:vision + build:pdf，缺一不可

node apps/cli/dist/index.js doctor           # 先过这关再动别的
pnpm -r test                                 # 基线 854：core 141 / desktop 474 / cli 239
                                             #（2026-08-03 M6 子任务① 后更新，原 774）
```

`doctor` 会检查 Node / pnpm / Swift / PowerPoint for Mac / Microsoft YaHei 字体。
**PowerPoint for Mac 是硬依赖**（`accept-pptx` 要在里面人工检查导出件），新机器上没装的话
最终确认那一环就只能机械通过。

工具链要求：`pnpm@10.32.0`、Node `>=24`、Xcode Command Line Tools（`xcrun swiftc`）。
本机跑的是 Node 25.8.0，`doctor` 会报一条「偏离 24 LTS 基线」的**警告**——一路用下来没出过问题，
但新机器若装 24 LTS 会更贴合基线。

CodeGraph 索引（`.codegraph/`）也被 gitignore，要用的话在仓库根跑 `codegraph init -i` 重建。

## 三、AI 会话的记忆不跟着仓库走

`~/.claude/projects/-Users-kelin-Work-ppt-maker/memory/` 是本机的，新机器上是空的。
（目录名按仓库路径生成，本机仓库在 `~/Work/ppt-maker`；早先写成 `Workspace` 是笔误。）

> **2026-08-03 订正**：上面这句「是笔误」只对写它的那台机器成立。目录名按仓库路径生成，
> **随机器变**——2026-08-03 这台的仓库实测在 `~/Workspace/ppt-maker`，记忆目录相应是
> `-Users-kelin-Workspace-ppt-maker`。新机器上一律以 `pwd` 为准，别硬编码任何一种写法。
三条要点抄在这里，免得重新踩：

1. **core 必须先 build**，`packages/core/dist` 不入库，跳过它 typecheck 会连环报错；
   `tools/snap.sh` 走的是 `apps/cli/dist`，所以 CLI 也要先 build。
   桌面端调试端口是 `REMOTE_DEBUGGING_PORT=9222`（renderer）/ `V8_INSPECTOR_PORT=5858`（main）。
2. **问「做到什么深度」之前先摆里程碑全貌**——范围决策要给全局视图，不要孤立地问某一条。
3. **关键判断要写进回复本身**，不能只丢一句「见 design.md」——审阅是靠摘要进行的。

走查工具（`cdp.mjs` / `main-cdp.mjs` / `patch-dialog.js` / `restart.sh` / `snap.sh`）随任务归档到了
`.trellis/tasks/archive/2026-08/07-31-page-sources-and-content-generation/tools/`，
下次要真机走查桌面端时原样复用，`tools/README.md` 说明了为什么原生对话框必须打桩
（本机 osascript 发不了按键；锁屏会让原生 `showMessageBox` 把 main 卡在嵌套 run loop 里）。

## 四、M5 留下的、M6 之前值得知道的

**未修的观察**（完整 7 条见走查记录的 `README.md`，这里只挑会绊到 M6 的）：

- **规则版本差**：`review-validation-v1 → v2`（`e03af4a`，2026-07-26）新增
  `LAYOUT_TEXT_MUST_BE_MASKED`。比那天更早建的 deck（含 `ppttest-2026-07-25`）
  `deck run` 会停在 `validate-review`，而 `deck status` 仍显示「完成」——status 不做规则版本比对。
  按规则改一个布尔量即可通过，**不是缺陷**，但第一次遇到会以为是回归。
- **clean 自动检查恒报「尺寸异常」**：期望值写死 2048×1152，而生成图实得 1672×941，
  底板与源图同尺寸恰恰是对的。`aspectRatioOk: true`、残留 0 像素，实质无害。
- **「成本」只到 token 用量**，全仓没有金额字段。A7 的措辞比实现强，M6 若要做成本汇总需先补这一层。

**M6 的进入条件已满足**：内容规格契约已定稿冻结（`design.md` §6，双层结构 + 条目级
`specEntrySha256` + 漂移检测 + `revisionNotes` 回写），且有真实使用——`generated` 页已跑通到
`--strict` PPTX。ROADMAP 的 M6 小节写明两者以内容规格文件为唯一契约衔接，
**M6 只做策划侧，不反过来改生成侧契约**。

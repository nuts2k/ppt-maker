# M5 阶段三：集成验收（新会话入口，2026-08-02）

四个子任务 ①②③④ **全部完成并已归档**。剩下的只有父任务自己的阶段三：
`implement.md` 的 3.1–3.8，对应 `prd.md` 的 A1–A13 逐条走查。

## 立刻做这三步

Trellis 活动任务按会话 id 绑定，换会话不会自动指向：

```bash
python3 ./.trellis/scripts/task.py start .trellis/tasks/07-31-page-sources-and-content-generation
pnpm --filter @ppt-maker/core build   # dist 不入库，typecheck 前必须先 build
pnpm --filter @ppt-maker/cli build    # tools/snap.sh 走的是 apps/cli/dist
```

## 当前状态

| 项 | 状态 |
|---|---|
| 子任务 ①②③④ | 全部完成、已归档（`.trellis/tasks/archive/`） |
| `implement.md` 2.1–2.4 | 全部勾选，2.4 已回写 ④ 的结论 |
| 阶段三 3.1–3.8 | **未做** ← 本次全部工作 |
| 工作区 | 干净，最后一次提交 `662f3a2` |
| 全量验证 | 通过：core 103 / desktop 466 / cli 163 = **732**（这是新下限，减少即回归） |

## 阶段三的性质：走查，不是写代码

`implement.md` 写明「A2 / A3 / A4 需要真实走查，**不接受仅凭子任务各自的验收结论推断**」。
子任务④ 的走查（`archive/2026-08/08-01-desktop-source-entry/walkthrough.md`）覆盖的是
**界面的一半**，A 系列问的是**端到端**——同一件事在两处都得成立才算数，
所以 A2 / A3 / A12 / A13 不能拿 U 系列的结论顶替。

预期产出：**主要是走查记录 + 修掉走查发现的缺陷**，不是新功能。
（④ 的走查在 U1–U13 上查出并修掉了 7 个缺陷，其中一个还是既有的。按这个比例，
阶段三大概率也要改代码，别把它当成一次纯打勾。）

## 已有素材（`~/test/`，不随仓库迁移）

| 目录 | 是什么 | 对哪条有用 |
|---|---|---|
| `wt4-append` | **11 页混合来源**：2 导入（旧格式、十阶段完成）+ 2 导入 + 6 抽取 + 1 生成 | **A2 / A3 / A13 直接在它上面接着做**，省掉重建 deck |
| `wt4-spec-2026-08-02` | 4 页全 `generated`，均已确认源图，`content-spec.json` 在 deck 根 | A7 / A12 / A13 |
| `ppttest-2026-07-25` | M3/M4 旧格式基线（**无 `source` 字段**），**一律复制后验** | A4 |
| `ppttest-archive-fix` | 唯一跑完含云调用完整链路的 deck，`b2-export-strict.pptx` 是它导出的 | A1 参照 |
| `b2-export-strict.pdf` | 真实 PowerPoint 导出件，含矢量文本层 | A5 |
| `mixed-aspect.pdf` / `no-wide.pdf` | 混合宽高比 / 全非 16:9（也在 `fixtures/pdf-extraction/`） | A6 |
| `wt4-images/` | 两张 16:9 图片 | 需要新建导入页时用 |

`wt4-old`、`wt4-images-2026-08-02`、`mixed-aspect-2026-08-02`、`b2-export-strict-2026-08-02`
是 ④ 走查的中间产物，可删。

## 走查工具已经备好

`tools/README.md`（本目录下）。一句话：

```bash
.trellis/tasks/07-31-page-sources-and-content-generation/tools/restart.sh
cd .trellis/tasks/07-31-page-sources-and-content-generation/tools
node cdp.mjs text                    # 读界面
node cdp.mjs eval 'return …;'        # 驱动界面（表达式必须自带 return）
node main-cdp.mjs eval '…'           # 驱动主进程（喂原生对话框的队列在这）
```

**原生对话框在主进程打桩**，理由与它对结论的影响写在 `tools/README.md`：
本机 osascript 发不了按键（原生文件框输不了路径），且**屏幕一锁**会让原生
`showMessageBox` 把 main 卡在嵌套 run loop 里、连调试端口都不响应。
打桩换掉的只是「用户点了哪个文件 / 按了确认还是取消」，调用本身没绕过。

## ④ 留给阶段三的三条（`implement.md` 2.4 有全文）

1. **三个缺陷的修复改变了走查路径**：顶栏新建入口已改为「新建 Deck…」→ 来源选择模态；
   切换工作区后活动日志恒为空这个**既有缺陷**已修（A5 从活动日志回溯会踩到它）；
   生成页全部确认完之后审片视图再无入口，已在单页工具栏补「源图审片」（A12 依赖它）。
2. **A2 的桌面端一半已实证**：`wt4-append` 三档各追加过一次，既有页阶段状态与目录
   指纹逐字节未变。阶段三补的是「跑到 `deck export --strict` 通过」这一半。
3. **A6 的边界**：全非 16:9 的 PDF 由 CLI 判定为「没有可用于建立页面的 16:9 页」并
   **报错**——A6 的「不整体失败」只覆盖混合宽高比，全不合格时报错是② 的既有设计
   （不留空 deck），**走查时别当缺陷**。

## 会花钱的部分

阶段三里真实按次付费的只有 A12（带说明重新生成，1 次图像调用）。
A7 是从已有工作区**读**溯源记录，不产生调用；`wt4-spec-2026-08-02` 里已经有
两次生成（page-02 / page-04 各重新生成过一次），A12 的「两次生成各留一份规格条目
快照」很可能不必再花钱就能查。**先读，读不出来再重新生成。**

## 收尾

阶段三做完后：`prd.md` 的 A1–A13 勾选、`implement.md` 3.1–3.8 勾选、
A8 顺手核对 ROADMAP 的 M5 段落与实际交付一致（ROADMAP 里 ④ 现在写的是
「已完成，待归档」，实际已归档，顺手改掉），然后归档父任务。

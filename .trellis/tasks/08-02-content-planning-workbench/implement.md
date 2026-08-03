# M6 执行计划（父任务）

父任务只做三件事：阶段一的路线图与规范对齐、阶段二的子任务创建与推进、阶段三的集成验收。
**实现不在父任务里写。**

## 阶段一：路线图与规范对齐（父任务直接执行）

- [x] 1.1 更新 `ROADMAP.md` M6 小节：状态改「执行中」，补记 D1–D9 九条决策，
      订正「M6 的策划界面到底能改哪些东西」一节——D8 已定 ①⑤ 与调用参数不开放。
      （2026-08-02 完成：状态行、抬头状态、出图依据表两行「可调归属」、调用参数段、
      结构事实 1 补 D2 结论、新增结构事实 4（版本轴）、新增「已定决策」D1–D9 表、
      交付物按 D1 收窄、两条硬验收、非目标补 D8/D2、子任务表。）
- [x] 1.2 订正 ROADMAP / 契约注释里「`content-spec.json` 有自己的版本轴」的说法：
      `SCHEMA_VERSION` 是全仓共用常量（`packages/core/src/constants.ts:1`），
      各契约写死 `z.literal`，该表述在实现上不成立，留着会误导后来者做出全仓迁移级的改动。
      （2026-08-02 完成：`packages/core/src/content-spec-contracts.ts` 顶部注释、
      `.trellis/spec/backend/contracts.md`〈独立可寻址契约文件的版本轴〉的「现状与已知张力」
      与 §7 Wrong 块、`ROADMAP.md` 结构事实 4。**改的只有注释与文档，无任何行为改动**，
      详见下方 A7 的走查方式。）
- [x] 1.3 把 **D5 对 D7 的放宽**写进 `.trellis/spec/`：
      「模型可提案、不可直接落盘」，及放宽后仍成立的三条（design §6）。
      不写这条，后来者按 M5 父任务 `prd.md:44` 原文会判定本里程碑违规。
      （2026-08-02 完成：`.trellis/spec/backend/contracts.md` 新增末节
      〈模型可提案、不可直接落盘〉，七段式；`backend/index.md` 索引行补该节并标注
      「M6 规划期决策，实现尚未落地」——backend/index.md 开篇要求只收录已验证的约定，
      故显式标状态而非伪称已验证。）
- [x] 1.4 创建三个子任务并写入各自 `prd.md` 的目标与边界引用（见下）。
      （2026-08-02 完成，实际目录名见阶段二表格。三份 `prd.md` 只播种目标 / 边界引用 /
      需求与验收的种子，各子任务自行走 Phase 1 细化后再 `task.py start`。）

阶段一不动任何 `apps/` / `packages/` 下的**代码**。1.2 触及
`packages/core/src/content-spec-contracts.ts` 的**顶部块注释**，是本步骤明列的订正对象——
留着错误表述的代价（后来者据此做出全仓迁移级改动）远大于让 `git diff` 多一段注释。

## 阶段二：创建并推进子任务

三个子任务已于 2026-08-02 创建（`--no-start`，父任务仍为当前活动任务）：

| 顺序 | 任务目录 | 交付物 | 依赖 |
|---|---|---|---|
| ① | `08-02-spec-edit-and-history` | core/CLI：统一写入入口 `applySpecChange`、变更日志读写与回滚、批量重生成命令、零页 deck 边界 | 无 |
| ② | `08-02-planning-view` | 桌面端：新增 `AppView` `planning`、条目列表与逐字段编辑器、已过时页清单与勾选确认 | ① |
| ③ | `08-02-planning-conversation` | 策划提问 provider、会话落盘、改稿提案与 diff 确认、背景材料输入 | ①② |

各自 `prd.md` 已播种目标、边界引用、需求与验收的种子；**Phase 1 的细化由子任务自己完成**。

**顺序是硬的**：② 的界面字段直接对着 ① 的写入入口，③ 的提案落盘复用 ① 的同一入口。
并行做会让写入路径被改三遍。

每个子任务自行走完 Phase 1（`prd.md` / `design.md` / `implement.md`）→ `task.py start` → Phase 2/3。
父任务在全部子任务归档前保持 `in_progress`。

### 父任务独占、子任务不得自行修改的四条契约

1. 规格写入统一入口与变更日志的落盘时机（design §2、§3）；
2. `SpecChangeRecord` 与 `PlanningMessage` 的记录形状（design §3.2、§5）；
3. `SpecProposalSchema` 的提案形状与「提案 ≠ 变更」的落盘流程（design §4）；
4. D5 对 D7 的放宽口径（design §6）。

任一子任务发现契约需要改动，**回父任务改**，不在各自实现里微调——M5 的教训是
「来源契约由父任务独占」，否则混合场景要到最后集成才炸。

## 阶段三：集成验收（父任务执行）

逐条走 PRD 的 A1–A9，用真实工作区而非 fixture：

| 验收 | 走查方式 | 真实素材 |
|---|---|---|
| A1 从构思到 `--strict` PPTX | 新建空 deck → 多轮问答 → 出稿 → 生成 → 逐页确认源图 → `deck run` → 导出 | 新建 |
| A2 对话式改稿落条目 + 报漂移 | 改某页文字 → 确认 → `deck status` 看漂移 | `~/test/wt4-spec-2026-08-02` |
| A3 已有 deck 全字段可编辑 | 打开工作台改 `style` / `textGroups` / 删 `revisionNotes` | `~/test/wt4-spec-2026-08-02` |
| A4 改 style → 清单齐全 → 勾选批量重生成 | 未勾选页做前后 sha256 比对，必须**字节不变** | `~/test/wt4-spec-2026-08-02` |
| A5 日志可回看可回滚、删掉不影响功能 | 回滚一次后 `deck run`；再 `rm -rf planning/` 后重跑全链路 | 同上 |
| A6 零迁移 | 打开旧格式 deck（无 `source` 字段），确认不报错、不被改写 | `~/test/ppttest-2026-07-25` |
| A7 契约未变 | `git diff` `content-spec-contracts.ts` / `page-generation.ts` / `constants.ts`：**schema 定义、常量值与函数体逐字未变**。已知的唯一合法差异是阶段一 1.2 对 `content-spec-contracts.ts` 顶部块注释的订正（提交 `f34a1ea` 之后），除它以外应为空 | — |
| A8 付费门槛 | 每个会触发图像生成的入口都截图确认文案含次数与不可撤销 | — |
| A9 测试基线 | 不低于 774（core 111 / desktop 474 / cli 189） | — |
| R8 零页 deck | 有规格零页时，控制台与 `deck status` 如实显示不报错 | 新建 |

混合来源 deck（`~/test/wt4-append`，11 页混合）另跑一遍 A3/A4，确认非 `generated` 页
完全不参与规格对账——`collectGeneratedPages` 只认 `generated` 是 M5 A2 的既有保证，
M6 不得破坏。

## 验证命令

```bash
pnpm build                 # core/dist 与 cli/dist 必须先建，否则 typecheck 连环报错
pnpm typecheck
pnpm format:check
pnpm -r test               # 基线 774
node apps/cli/dist/index.js doctor
```

真机走查桌面端时复用归档工具：
`.trellis/tasks/archive/2026-08/07-31-page-sources-and-content-generation/tools/`
（`cdp.mjs` / `main-cdp.mjs` / `patch-dialog.js` / `restart.sh` / `snap.sh`，
`tools/README.md` 说明了原生对话框为何必须打桩）。

## 风险与回滚点

- **RK-M6-1｜零页 deck 撞到既有未覆盖分支**：若 `deck run` / `status` / 控制台对空 `slides`
  有硬崩，先在子任务① 修边界，不要绕过 D4 改成「内存态草稿」——那会引回第二套存储。
- **RK-M6-2｜全量条目提案在长 deck 上不可用**：若「全 deck 改写」因上下文超限失败率高，
  回滚点是**只保留单条目作用域**，全 deck 改写降级为「逐条目串行提案」，不改 D5。
- **RK-M6-3｜批量重生成误伤**：A4 的「未勾选页字节不变」是硬验收。若做不到，
  批量入口整体撤回到 D9 的次选（只标注、逐页重生成），不带病上线。
- **RK-M6-4｜第三方网关无 `x-request-id`**：`requestId` 恒为 `null` 是已知非缺陷
  （换机器说明 §1），日志如实记 null，**不得伪造或用其它 id 填充**。

## 完成定义

- A1–A9 全部逐条通过并留下证据（走查记录落在本任务 `walkthrough/`）。
- 三个子任务全部归档。
- `ROADMAP.md` M6 小节状态更新为已完成，关键决策回写。
- `.trellis/spec/` 已收录 D5 放宽口径与本轮沉淀的教训。

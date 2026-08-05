# 已知遗留问题

本文件记录**已确认存在、但当前不阻塞开发的问题**，供跨机器、跨会话接续时直接取用。

- 收录标准：有明确代码位置或可复现现象，且已判定不在当前任务范围内。
- 不收录：尚未确认的猜测、已修复的问题（修完即删除条目，不留"已解决"墓碑）。
- 每条标注**取证强度**：`已核实`＝本文件维护时读过对应代码或实测过；`转述`＝来自更早的任务记录，未重新核对。
- 规划新里程碑时应先读本文件，把相关条目纳入范围。

最后更新：2026-08-05

---

## 一、任务状态与结果只活在 renderer 内存里

四条同源，**宜作为一组处理**，分别修会重复改动同一批文件。均属 M7「可靠性与本地交付」范围。

### 1.1 建页的逐条失败原因不落盘

- **位置**：`apps/desktop/src/main/runner/source-task-runner.ts:282`（`record()`）
- **现象**：`record()` 只写一条汇总活动记录（`detail: result.message`），逐条失败原因仅在执行期间的进度事件里闪过，事后无处可查。
- **影响**：完成提示里原本有一句"逐条原因见活动日志"，指向空处，`08-04-spec-to-pages-bridge` 已删掉那句话而非补记录。要让它成真需改 main 侧改为逐条写。
- **取证**：已核实（2026-08-05 读代码）

### 1.2 完成汇总存在页面局部 state，离开策划页即丢

- **位置**：`apps/desktop/src/renderer/pages/PlanningPage.tsx:179`（`createResult` 是局部 `useState`）
- **现象**：建页途中返回控制台时，`handleBack`（`PlanningPage.tsx:245`）只拦未保存草稿、**不拦执行中任务**；`PlanningPage` 由 `App.tsx:41` 条件渲染，一离开就整个卸载，`CreatePagesResult` 面板连同"建成 N 页 / M 条失败"的汇总当场丢失，控制台不会补一份。
- **不受影响的部分**（已验证）：任务在 main 进程继续跑完；`SourceTaskBar` 由全局 store 驱动、控制台也渲染（`ConsolePage.tsx:157`/`173`），进度可见；`runSourceTask` 的 `refreshStatus` / `reloadActivity` 收尾照常；竞态守卫按 `deckPath` 比对，返回控制台不改 deckPath，结果不会被误判为过期响应。
- **与 1.1 的叠加后果**：中途离开 + 部分条目失败 ＝ **失败了哪几条在界面上任何地方都查不到**。
- **取证**：已核实（2026-08-05 读代码）

### 1.3 `deckPath` 零持久化，页面重载或应用重启即回到空态

- **位置**：`apps/desktop/src/renderer/stores/`（无 `persist`、无 `localStorage`）；main 也未把"上次打开的 deck"写入 userData
- **现象**：2026-08-05 用户锁屏/休眠离开，回来后客户端退回"打开 deck"初始界面，重选原 deck 后产物完好。
- **根因分两层，不要混为一谈**：
  1. **直接触发器，仅 dev**：休眠切断 HMR WebSocket，唤醒后 ping 成功，vite 客户端自行重载页面（`vite@7.3.6/dist/client/client.mjs:865-870`：`server connection lost. Polling for restart...` → `waitForSuccessfulPing()` → `location.reload()`）。这是 vite 的正常行为，非本项目缺陷。
  2. **底层缺陷，所有环境**：会话态无持久化，因此**打包后的生产版本里用户正常退出再打开，同样回到"打开 deck"界面**，记不住上次工作的 deck。
- **排查时的硬证据**（复现类似现象时照此顺序取证，别先怀疑业务代码）：页面 `navType === "reload"` 且 `performance.timeOrigin` 晚于进程启动时刻（CDP 读 navigation timing）→ main/renderer PID 与启动时一致（`ps -p` 对比，排除崩溃重建）→ main 侧无任何 `reload` / `render-process-gone` 代码（排除应用自触发）。
- **取证**：已核实（2026-08-05 实测 + 读代码）

### 1.4 页面重载撞上任务执行中，会出现"界面空闲、main 在跑"的窗口期

- **现象（推断）**：若 reload 发生在建页任务执行中，renderer 的 IPC promise 随页面销毁而消失，`runSourceTask` 的收尾（`refreshStatus` / `reloadActivity` / `onResult`）一条都不会执行；main 的 `SourceTaskRunner` 是进程级单例仍会跑完，而 `source-task-store` 重载后 `running` 回到 `false`。此时点建页会被互斥挡下，但 `SourceTaskBar` 在下一个进度事件到达前不显示任何执行中迹象。
- **根子**：`source-task-store.ts:39-45` 的注释已预见"`running` 照的是 main 侧单例"，但 reload 后**没有任何机制主动向 main 查询**当前是否有任务在跑，只被动等下一个进度事件。
- **取证**：**未实测**（从代码推出）。要取证须在任务执行中故意重载页面。

---

## 二、策划工作台交互

### 2.1 建页入口发现性差

- **位置**：`PlanningPage.tsx` 的 `SpecImpactPanel`，渲染在 `SpecEditor` **下方**
- **现象**：长规格时必须把主区滚到底才看得见「规格影响 → 待建页」那一档，而它是该页唯一的"下一步"动作。2026-08-05 用户实际使用时提出。
- **建议方向**：把面板提到编辑器上方，或在顶部一带放一个带待建计数的锚点。
- **取证**：已核实（用户实测反馈）

### 2.2 建页与重生成两个动作行为不一致

- **位置**：`PlanningPage.tsx:284`（`handleRegenerate`）与 `:310`（`handleCreatePages`）
- **现象**：两个按钮上下并排，但 `handleRegenerate` 建完跳回控制台、`handleCreatePages` 留在本页；**结果载体也不同**——前者用 store 的 `lastResult`，后者用局部 `createResult`。
- **前者跳走的理由已失效**：`SourceTaskBar` 提取为跨视图共享组件后，"不跳走就看不到进度"不再成立。
- **修法提示**：统一时光改跳转不够，须把 `createResult` 挪进 `source-task-store`——这一步同时解决 1.2。
- **取证**：已核实（2026-08-05 读代码）

### 2.3 规格影响面板三类全空时仍占版面

- **位置**：`PlanningPage.tsx:1272-1279`
- **现象**：待建 / 已过时 / 失联三类都为空时，仍渲染一块带标题的 Panel 只放一行说明文字，严格讲属"空态占版面"（DESIGN.md 的空态原则是不渲染）。
- **说明**：这是改动前就有的形状，非新引入。
- **取证**：已核实（2026-08-05 读代码）

### 2.4 失联页（missing）一档只有文案没有动作

- **现象**：规格影响面板的失联页一档只陈述事实，没有可执行动作。
- **说明**：`08-04-spec-to-pages-bridge` 的 PRD 已明确列为 Out of Scope。正确做法多半是"恢复规格条目"而非删页，语义需要单独想清楚，**应另开任务**。
- **取证**：转述（来自任务记录，未重新核对代码）

---

## 三、独立项

### 3.1 `clean_plate` 资产尺寸硬编码，manifest 与磁盘不符

- **位置**：`apps/cli/src/clean/run.ts:329`（`width: CLEAN_PLATE_WIDTH` / `height: CLEAN_PLATE_HEIGHT`）
- **现象**：用常量填充资产元数据，manifest 记 2048×1152，磁盘实为 1672×941。
- **为什么抓不到**：`assertWorkspaceAssetIntegrity` 只校验 sha256，校验不到元数据与文件内容不符。
- **背景**：2026-07-22 记为遗留至今未修。ROADMAP 关键决策点已把"生成资产的尺寸必须落盘后实测，禁止用请求参数或常量填充"立为约束（RK1 衍生），但仓库里的这个反例还没清。`08-01-spec-driven-generation` 明确不夹带修它（避免机械清理混进功能实现）。
- **归属建议**：M7。元数据说假话与"可诊断性"直接冲突。
- **取证**：已核实（2026-08-05 读代码，硬编码仍在；尺寸数字为转述）

### 3.2 两处至今未在真机验证

- **「重做底图」**：只验到按钮可点，没有真的点——会重跑 `clean`，烧付费图像接口。
- **`accept-final` 幂等性**：已验收页界面上已无"完成"入口，无从触发；靠 CLI 用例兜底。
- **说明**：记录在此是为了"日后碰到相关问题时先想到这里"，不建议为此单独立项。
- **取证**：转述（2026-07-31 任务记录）

### 3.3 A6 部分失败分支未实测

- **现象**：建页部分失败时"成功页与失败条目分别报出"只核了数据链路，没做渲染取证——造一条注定失败的条目不可靠且要花钱。
- **依赖**：修完 1.1 之后才有稳定的取证对象，两件事应连着做。
- **取证**：未实测

---

## 相关文档

- 里程碑规划见 [ROADMAP.md](./ROADMAP.md)
- 编码约定与判据见 `.trellis/spec/`
- 真机走查手法（CDP 驱动、三处够不到的地方、走查工作区清单）见开发者工作区 journal

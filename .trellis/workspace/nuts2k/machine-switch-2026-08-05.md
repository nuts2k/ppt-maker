# 换机器接续说明（2026-08-05）

**新机器 / 新会话先读这一份。** 更早文档只补充历史与非 Git 环境细节：

- [machine-switch-2026-08-04.md](./machine-switch-2026-08-04.md)：新机器落地步骤、必须手工迁移的内容、M6 结论清单。**本轮不重复，落地步骤照它执行**，只有下面〈四〉列出的差异。
- [machine-switch-2026-08-02.md](./machine-switch-2026-08-02.md)：`.env`、原生二进制、真实 deck 与 AI 会话目录。

## 一、交接时 Git 状态

- 分支：`main`
- 远端：`origin = https://github.com/nuts2k/ppt-maker.git`
- 本轮提交：
  - `a56ece0` `docs: 新增已知遗留问题清单并在 M7 规划入口指路`
  - 本文与 journal 另有一条 `chore` 提交，之后快进推送到 `origin/main`。

新机器先确认：

```bash
git status -sb
git log --oneline -5
git ls-remote origin refs/heads/main
```

`HEAD` 与远端 main 应一致，工作区应干净。已有仓库用 `git pull --ff-only`，不要 merge pull。

## 二、本轮做了什么

**没有写任何产品代码**，四关未跑全（只跑了 `format:check`，EXIT=0）。产出全是文档与调查结论：

1. **盘点了 M7 之前的全部遗留**，集中写入仓库根 [`KNOWN-ISSUES.md`](../../../KNOWN-ISSUES.md)。
   此前这些条目散在任务归档、走查记录和**本机记忆**里，换机器就丢——这正是本轮建文档的动因。
2. **查明了「休眠后客户端退回打开 deck 界面」的根因**（KNOWN-ISSUES 1.3）。结论与取证方式都在文档里，
   **不要在新机器上重查**。一句话：dev 下是 vite 断线重连自行 `location.reload()`，
   底层是 `deckPath` 零持久化。
3. **回答了「建页途中离开策划页会怎样」**（KNOWN-ISSUES 1.2）：任务照常跑完、进度跟得上，
   丢的只有完成汇总，因为它存在 `PlanningPage` 局部 state。

## 三、下一步

**规划 M7「可靠性与本地交付」，尚未开始规划。**

1. 先读 `KNOWN-ISSUES.md`。第一组四条（任务状态只活在 renderer 内存里）与 3.1（`clean_plate`
   尺寸硬编码）都属 M7 范围，应作为规划输入，**不要另起任务逐条修**——它们共享同一批文件。
2. 走 Trellis Phase 1，不要在没有任务规划时直接写代码。计划子任务名 `local-product-hardening`。
3. 路线图父任务 `07-20-ppt-maker-mvp-roadmap` 当前 8/8 done，M0–M6 全部完成。

```bash
python3 ./.trellis/scripts/task.py list
python3 ./.trellis/scripts/get_context.py
```

## 四、相对 08-04 那份的差异

落地步骤整体照旧，只有这几处变了：

- **测试基线 948 → 1000**（core 156 / desktop 571 / CLI 273）。`pnpm test` 期望 1000 项。
- **`~/test/` 新增三个走查工作区**（本轮之前建的，Git 不含，需要时在新机器重建即可，不必迁移）：
  - `wt-bridge-spec`：零页 + 4 条规格，走查后已建出 2 页，**再走查前需清回零页**
  - `wt-bridge-nospec`：零页无规格，验切 deck 竞态用
  - `wt-bridge-allbuilt`：4 页全建完但有 1 页 drifted，**进不了面板空态分支**
- **`~/test/工博馆运营 AI 赋能`**：本机当前打开的真实 deck，17 页，本轮用它做的界面走查。
  Git 不含，跨机器不迁移；新机器上换任意真实 deck 即可。
- 两个复发过的环境坑仍然有效：拉取新代码后 `apps/cli` typecheck 会因 `core/dist` 过期报一堆
  `has no exported member`，先 `pnpm --filter @ppt-maker/core build`；跑全量检查**别用**
  `pnpm test 2>&1 | tail -N`，退出码会变成 `tail` 的，真实失败被掩盖。

## 五、本机遗留的运行态（切走前处理）

- 桌面端 dev server 仍在运行（`REMOTE_DEBUGGING_PORT=9222 pnpm dev` 起的，main PID 54805）。
  切机前 `pkill -f "ppt-maker.*[Ee]lectron"` 或直接关窗口即可，无未保存状态。
- 重启 dev server 时若命令超时被移到后台，会起出第二个实例——**先确认残留为 0 再启**。
- 本机 5173/5174 被另一个项目（DTWorkflow）的 vite 占着；ppt-maker 这次仍拿到了 5173，
  但新机器上端口若不同，走查脚本里 `import()` 的模块 URL 要跟着改
  （用 `performance.getEntriesByType('resource')` 读应用实际加载的 URL，别写死）。

## 六、新会话不要重新论证的结论

- **遗留问题一律看 `KNOWN-ISSUES.md`，不要从聊天记录或本机记忆里读。** 修完即删条目。
- M6 沉淀的硬约束（`applySpecChange` 是唯一写入口、`planning/` 是可删旁路、生成侧契约在 M6
  全程逐字未变、`content-spec.json` 无独立版本轴、模型只产提案）见
  [machine-switch-2026-08-04.md](./machine-switch-2026-08-04.md) 第五节与 `.trellis/spec/`。
- 真机走查手法（CDP 驱动、`Input.dispatchMouseEvent` 而非 `el.click()`、原生确认框须用
  System Events 按按钮名点、三处 CDP 够不到的地方）见 journal Session 11 的〈Environment / 方法学〉。

# 执行计划：桌面端设计语言重构

---

# ⚑ 换机器继续（2026-07-31）

> **本节已完成，保留作迁移记录。** 新机器环境已在 2026-07-31 补齐，与原表的差异：
>
> | 项 | 现状 |
> |---|---|
> | 仓库路径 | `/Users/kelin/Work/ppt-maker` → **`/Users/kelin/Workspace/ppt-maker`**。旧路径出现在 CLAUDE.md 的文档链接里，已一并修正 |
> | 分支 | 六个提交已在 **`main`** 上，`design/desktop-language-rebuild` 不再需要 |
> | 走查工作区 | `ppttest-walkthrough-E2` / `ppttest-switch-target` 未随迁。已从本机既有的 `~/test/ppttest-2026-07-25`（两页流水线全 `completed`）复制出 **`~/test/ppttest-walkthrough-E3`** 与 **`~/test/ppttest-switch-target`**。复制不触发任何云调用；因所有阶段已完成，走查中的重跑会走复用路径 |
> | Claude 记忆 | 目录随路径改名为 `-Users-kelin-Workspace-ppt-maker`，但**内容为空**，未随迁 |
> | `NODE_OPTIONS` | 指向一个随临时目录被清理的 `restore-node-options.cjs`，node 完全起不来。已重建该预加载脚本（作用是把自身的 `--require` 从 `NODE_OPTIONS` 剥离，避免传播给子进程） |
> | `packages/core` | 需**先 `pnpm --filter @ppt-maker/core build`**，否则 `apps/cli` typecheck 报 9 个 `has no exported member`（解析到过期 `dist`）。这一步不在原清单里 |
> | 调试端口 | `REMOTE_DEBUGGING_PORT=9222` 由 electron-vite 原生支持（`dist/cli.js:47`），`ELECTRON_ARGS` 无效 |

分支 `design/desktop-language-rebuild`，最后一个提交 `6a67ed4`，工作树干净。
代码与任务文档都在 git 里，**但下面五样东西不在**，只 clone 是跑不起来的：

| 缺什么 | 为什么不在仓库 | 怎么补 |
|---|---|---|
| `.env` | `.gitignore` 忽略 | 从原机器手工拷。键名见 `.env.example`：`OPENAI_API_KEY` 必填、`OPENAI_BASE_URL` 可选。**别走聊天或提交传密钥** |
| `open-design/`（318MB） | `.gitignore` 忽略，且它**不是子模块也没有 .git**，无法 `git submodule update` | 重新 clone <https://github.com/nexu-io/open-design>。CLAUDE.md 规定它是**只读**参考，不得写入 |
| `.codegraph/` 索引 | 忽略；且索引按 worktree 独立维护 | 仓库根目录跑 `codegraph init -i` |
| 走查工作区 `~/test/ppttest-walkthrough-E2`（29M）、`~/test/ppttest-switch-target`（29M） | 在仓库外 | 直接拷贝目录。**没有它们就跑不了真机走查**。`~/test/ppttest-walkthrough-E1` 继续跑会烧 gpt-image-2，别拷也别跑 |
| Claude 记忆 `~/.claude/projects/-Users-kelin-Work-ppt-maker/memory/` | 在用户目录、按项目路径命名 | 手工拷。**若新机器的仓库路径不同，目录名要跟着改**（路径里的 `/` 换成 `-`） |

新机器上的顺序：

```bash
git clone https://github.com/nuts2k/ppt-maker.git && cd ppt-maker
git checkout design/desktop-language-rebuild
node -v                       # 需要 24，见 .node-version / .nvmrc
pnpm install
# 拷 .env、open-design/、~/test/ 两个工作区、memory/
cd apps/desktop && pnpm typecheck && pnpm test    # 基线：27 文件 / 323 用例全绿
cd ../.. && pnpm format:check
node .trellis/tasks/07-30-desktop-design-language-rebuild/research/palette-contrast.mjs  # 26 项全过
```

四关全绿即环境无误，可以接着做下面「需要用户定的两处」。

---

# ⚑ 交接状态（2026-07-31 · 阶段二完成）

**阶段一、阶段二均已完成。** 用户以「继续阶段二」表达了 AC12 认可。

阶段二采用四路并行 + 两轮收口：`StageRail`/复核页骨架、块列表与文本行、画布与工具栏、
最终确认页四个互斥文件域并行推进，合流后再做基座收口（选中态 + Kbd）与画布颜色单源。

四关结果：typecheck ✓ / **323 测试全绿** / `pnpm format:check` ✓ / 对比度 26 项全过。
真机走查证据在 `research/after-stage2/`。

## 阶段二发现并修掉的、原计划里没有的三件事

1. **AC5 的静态断言此前是失效的**。阶段一的 `grep --include='*.tsx'` 在本机 grep 下
   静默失效，且只扫 `.tsx` 扫不到 `variants.ts`。基座里三处裸 `transition-colors`
   吃的是 tailwind 配置的隐式 DEFAULT —— 基座是全局默认值的源头，这里隐式等于全应用隐式。
2. **`duration-fast` 原为 120ms，掉出 R3 规定的 150–250ms**，而它占全部动效声明的 15/17。
   改 token 为 150ms（体感无差别）比改 15 个调用点划算。
3. **「选中态」与 `<kbd>` 又长出了 5 处 / 4 处手拼**，正是本任务立项要根除的
   `BUTTON_*` 漂移换了个位置。已收进基座 `selected` / `shape` 变体与 `Segmented` / `Kbd`。

## 阶段二真机走查新发现的缺陷（已修）

**复核页当前项文本框截断**：`clientHeight 35px` / `scrollHeight 58px` / 行高 22.75px，
只显示 1.5 行，第二行被从字形中间切断。根因是 `rows` 取源数据行数
（`block.lines.length`），而左栏比整屏窄、一行源文本常折成两行。
与最终确认页 8.2 是同一类缺陷：容器把内容切了，而不是内容自己该省略。
修法为 `[field-sizing:content]` + 4 行上限（Chromium 150 原生支持，真机实测 35→58px）。

## 当前所在分支

`design/desktop-language-rebuild`（从 `main` 切出，**未推远端**）。六个提交：

```
8e56216 chore(task): 记录规划与走查产物
1cfbb72 feat(desktop): 控制台按 20–50 页重做，新增待处理筛选
dc95f8d refactor(desktop): 状态语义改为「有颜色 = 要你管」，完成态归中性
f93bf08 feat(desktop): 新增 components/ui 组件基座，六态齐全
2ff2920 feat(desktop): 重做设计令牌与基础层，中性阶 chroma 归零
642698f docs: 建立 PRODUCT.md 并把 DESIGN.md 重写为「校样台」设计语言
```

## 后续会话应读

1. 根目录 `PRODUCT.md`（战略：register、反参考、五条设计原则、无障碍四条）
2. 根目录 `DESIGN.md`（视觉契约，已重写为「校样台」）
3. 本任务 `design.md` §1 的**不可改清单**与 §5 阶段轨道折叠方案
4. `.trellis/spec/frontend/state-management.md`（判据兼职、同源判据两条教训）
5. `research/after-stage1/` 走查证据与可复跑脚本

## 已确定、不要再问的决策

| 决策 | 结论 |
|---|---|
| 控制台默认筛选 | **保持「待处理」**（用户 2026-07-31 二次确认） |
| 暗色主题 | 不做，非本任务范围 |
| 完成态用色 | 中性，**不许改回绿色**（`test/ui-design-rules.test.ts` 会拦） |
| Impeccable 技能升级 | 用户选择暂不升级 |

## 阶段一相对原计划的偏差（已生效，勿回退）

1. **DESIGN.md 重写从收尾提前到了第 2 步**。CLAUDE.md 要求「实现前端代码前必须先读取 DESIGN.md」，
   让契约滞后到最后等于整个重构期都在对着过期契约写代码。原步骤 9.3 因此已完成。
2. **测试策略改为锁设计规则而非渲染快照**。项目刻意不装 DOM 测试库、测试只导入纯 `.ts`
   （`tsconfig.node.json` 覆盖 `test/` 且不含 `@/*` 映射）。因此变体表与状态表抽成
   `components/ui/variants.ts` 与 `status-spec.ts` 两个纯模块并用**相对 `.js` 导入**，
   新增 `test/ui-design-rules.test.ts` 锁住「完成态不许用饱和色」等规则。
   **新写可测模块时务必沿用相对 `.js` 导入**，用 `@/` 别名会直接失去类型。
3. **对比度令牌从 22 项增至 26 项**：补了 `ink-hover` 与 `proof-hover`
   （近黑按钮的 hover 应当变亮、按压才变暗）。`proof-hover` 白字 4.81:1 偏紧，**不要再提亮**。
4. **`biome.json` 开启了 `css.parser.tailwindDirectives`**，减弱动效兜底的 `!important`
   带局部豁免注释。biome 给的「修复」是删掉它，那会让 AC11 失效，**不要接受该自动修复**。
5. **`.gitignore` 新增 `/.impeccable/hook.cache.json`**（本机缓存），`live/config.json` 需入库。

## 阶段一遗留

- ~~迁移期旧令牌别名~~ —— **已于阶段二收尾整块删除**，11 个文件全部迁完，
  删前逐令牌扫描确认 0 残留。`tailwind.config.ts` 留了一段注释说明不要加回来。

- **活动日志文案口径未统一，且刻意没改**：`执行结束：完成 N，待人工 M` 这句同时由主进程
  `src/main/runner/deck-runner.ts:192` 写入持久化 jsonl。只改渲染层会让实时显示与重启后
  从日志读出的内容不一致。控制条一侧已加「Deck 累计：」前缀消歧。**要彻底统一得两边一起改，
  属于渲染层之外的改动，需先向用户确认。**

## 真机走查踩过的两个坑（会把结论测反）

1. **`Emulation.setEmulatedMedia` 只在设置它的 CDP 会话内有效**。设置与查询必须同一个 WebSocket
   会话内完成，否则「A 脚本设减弱动效 → B 脚本查样式」必然读到未模拟状态。
   可复跑脚本见 `research/after-stage1/reduce-check.mjs`。
2. **`await import('/stores/xxx.ts')` 拿到的可能不是应用那份模块实例**。用它 `setState` 会出现
   「store 值已改、界面纹丝不动」，看着像响应式 bug，实为脚手架假象。
   **验证交互一律用 `Input.dispatchMouseEvent` 真实点击。**

   阶段二找到了拿到**同一份实例**的可靠办法：先读
   `performance.getEntriesByType('resource')` 拿到应用实际加载的 URL
   （本项目是 `http://localhost:5173/stores/deck-store.ts`），再 `import()` 这个**完全相同**
   的 URL —— vite 按 URL 缓存模块，URL 一致即同一实例。改完 store 界面会跟着变，
   这就是实例正确的自证。路径写错（多一段 `/src/renderer`）就会退化成第二份实例。

3. **原生文件对话框够不到，且 `window.api` 是 contextBridge 冻结对象**，
   `Object.defineProperty` 覆写会抛 `Cannot redefine property`。走查时不要试图桩掉它，
   改用上面那条：直接调 `useDeckStore.getState().openDeck(path)` —— 那正是对话框返回后
   应用自己走的路径，只是跳过了 OS 那一段。

---

## 验证命令

```bash
# 快速四关（每个检查点都跑）
cd apps/desktop && pnpm typecheck && pnpm test
cd /Users/kelin/Work/ppt-maker && pnpm format:check   # 注意 format:check 是根脚本

# 令牌对比度（改动任一颜色令牌后必跑，26 项须全过）
node .trellis/tasks/07-30-desktop-design-language-rebuild/research/palette-contrast.mjs

# 真机走查：先起服务，再用 research/after-stage1/ 下的脚本
cd apps/desktop && REMOTE_DEBUGGING_PORT=9222 pnpm dev
```

## 静态断言（对应 PRD 自动可验证项）

**必须用 `rg`，不要用 `grep --include`。** 本机 `grep` 是 ugrep 别名，`--include` 会静默失效，
阶段一因此漏掉了基座里三处无 `duration-` 的 transition —— 断言看着全过，实际什么也没扫。
另外 AC5 必须同时扫 `.ts`：变体表在 `components/ui/variants.ts` 里，只扫 `.tsx` 扫不到。

```bash
cd apps/desktop/src/renderer

rg -c 'signature-' -g '*.tsx' -g '*.ts' .                    # AC2 期望零命中
rg -n 'BUTTON_PRIMARY\s*=|BUTTON_SECONDARY\s*=|const SELECTED\s*=|const KBD\s*=' .  # AC3 期望无输出
rg -In --no-heading -H 'transition' . | rg -v 'duration-'     # AC5 期望只剩注释行
# 旧令牌别名（用属性前缀限定，否则 `ink-muted` 会被 `-muted` 误命中）
rg -n '(^|[^a-z-])(bg|text|border|ring|outline|divide|placeholder|from|via|to|fill|stroke|shadow|accent|caret|decoration)-(primary|body|muted|on-primary|on-dark|surface-soft|surface-strong|surface-dark|link|info|success|signature)' .
```

---

# 阶段一：令牌 + 基座 + 控制台页 ✅ 已完成（2026-07-31）

> 交付结果：typecheck ✓ / **311 测试全绿** / format ✓；对比度 26 项全过；
> 真机实测 AC8 焦点无遗漏、AC9 灰度五态可分辨、AC10 一屏 15 张（目标 ≥12）、
> AC11 动效 73→0 且执行中脉冲降级为静态光环。零 gpt-image-2 调用。

## 1. 令牌层 ✅

- [x] 1.1 `tailwind.config.ts` 落 16 个新令牌
- [x] 1.2 保留旧令牌别名（**阶段二结束前删净**）
- [x] 1.3 字号尺度 + 动效时长 + ease-out 曲线
- [x] 1.4 `index.css` 全局 `:focus-visible` + `prefers-reduced-motion` 兜底 + `tabular-nums`
- [x] 1.5 对比度脚本通过（22 → 实际 26 项，见偏差 3）

## 2. 组件基座 ✅

- [x] 2.1–2.5 `Button` / `IconButton` / `StatusDot` / `StatusChip` / `Panel` / `Input` / `Textarea` / `Checkbox`
- [x] 2.6 单元测试 → 改为 `test/ui-design-rules.test.ts` 锁设计规则（见偏差 2）

## 3. 状态表切换 ✅

- [x] 3.1 `STAGE_DOT_CLASS` 删除，视觉映射迁至 `components/ui/status-spec.ts`；判据函数零改动
- [x] 3.2 `StageTrack` 改用 `StatusDot`
- [x] 3.3 `stage-view.test.ts` 19 例**测试文件零改动**即全绿 ← 判据未被动的硬信号

## 4. 控制台页重做 ✅

- [x] 4.1–4.9 全部完成。12 个文件改动，4 份局部按钮常量清零，筛选复用 `deriveTodoQueue`

额外修正（子代理初版的问题，已改）：

- 卡片详情行**按严重度着色**。初版「有待办原因就上校对红」导致真失败渲染成中性灰、
  常规人工门是红色，失败反比日常流程不显眼。
- 导出 PPTX 由 primary 降为 secondary，全屏只留「处理全部」一个主行动。
- 完成/待执行不给卡片角标，否则 40 张卡的角落会被灰点填满 —— 那是 9 个绿点的同一个错误换了颜色。

## 5. 阶段一真机走查 ✅

- [x] 5.1–5.6 完成，证据与可复跑脚本在 `research/after-stage1/`

**🚪 用户验收门（AC12）：已获认可**（用户 2026-07-31 指示「继续阶段二」）。

---

# 阶段二：复核页 + 最终确认页 ✅ 已完成（2026-07-31）

> 四路并行（互斥文件域）+ 两轮收口。四关：typecheck ✓ / 323 测试 ✓ / format ✓ / 对比度 26 项 ✓。

## 6. 阶段轨道折叠 ✅

- [x] 6.1 `StageRail` 175px → **36px** 收起态：分段进度条 + 一句话状态 + 计数/计时 + `aria-expanded` 展开钮
- [x] 6.2 展开态存 `ui-store.stageRailOpen`（会话级，`reset()` 归零，已补 4 条测试）
- [x] 6.3 收起态异常阶段用 `StatusDot` 压在条上（形状 + 颜色 + 文字三重）。
      **失败错误条挂在折叠区之外**——收起态照样能看到失败与「重跑失败阶段」，
      不然就把 V1「错误只在侧边栏短暂显示」的缺陷换个形式搬了回来

## 7. 复核页 ✅

- [x] 7.1 `ReviewPage` 迁基座，裸 button 清零
- [x] 7.2 `BlockListPanel` 迁基座；diff 用 `proof-wash` 底 + `proof` 字
- [x] 7.3 `TextDiffRow` / `ClassificationRow` / `BlockTextEditor` 迁基座
- [x] 7.4 行内两个徽标收敛成**单一状态槽** `RowStatus`：已复核/风险接受走中性（常态安静），
      未复核才按「要你管的类型」上色。判据仍是原来那两个函数，没新写口径
- [x] 7.5 删掉右侧重复的「N 项」；五档同高胶囊 + `tabular-nums`；
      新增的「另含 N 项刚处理」只在 sticky 造成 visible ≠ 档内计数时出现，解释的是筛选计数答不了的问题
- [x] 7.6 `ReviewShortcutBar` 110px → **30px** 窄条 + `?` 唤起面板（Esc/再按/点外部关闭，焦点送入）
- [x] 7.7 缩放提示从压住内容左下角改为画布下沿独立边条；新增「整页」按钮
      （此前回到整页只有双击这一个鼠标独占动作，键盘用户没有出口）

> 纵向释放实测：阶段轨道 −139px、快捷键条 −80px、工具栏 75→48px，合计约 **246px**。

## 8. 最终确认页 ✅

- [x] 8.1 迁基座，两个本地按钮常量删净
- [x] 8.2 截断根因是**布局不是文案**：旧写法 `aside` 挂 `overflow-y-auto` + 操作区 `sticky bottom-0`，
      sticky 绘制在流内内容之上把说明压掉半行。改成「栏头/滚动区/操作区」三个 flex 兄弟，
      滚动只发生在中段，结构上不可能再压住内容。**没有用 `truncate` 把话吞掉**
- [x] 8.3 完成=primary（仅未验收时存在）、在 PowerPoint 中打开/回到文本复核=secondary、重做底图=ghost
- [x] 8.4 层级建到 20/14/12/11 四档
- [x] 8.5 「已完成最终确认」移到栏头，中性 `StatusChip`，不滚动即可见
- [x] 8.6 三组件迁基座；`SliderCompare` 补 `role="slider"` 键盘操作（此前键盘完全够不到）；
      sticky 操作区与折叠行为保留

## 9. 收尾 ✅

- [x] 9.1 `legacyAliases` 整块删除，删前逐令牌扫描确认 0 残留
- [x] 9.2 静态断言 AC2 / AC3 / AC5 全过；AC4 由全键盘遍历实测（15 个可聚焦元素，无焦点环者 0）
- [x] ~~9.3 重写根 `DESIGN.md`~~ —— 已在阶段一完成（见偏差 1）
- [x] 9.4 真机走查：AC7 三页一致、AC8 焦点无遗漏、AC9 灰度五态可分辨、AC10 一屏 15 张、AC11 动效 0
- [x] 9.5 截图归档 `research/after-stage2/`（含 700px 窗高压力测试与灰度执行中态）
- [x] 9.6 四关全绿

## 阶段二额外收口（原计划外，见顶部说明）

- [x] 基座补 `selected` / `shape` 变体 + `SegmentedGroup` / `Kbd`，9 个手拼调用点收敛，
      **无一处保留 className 覆盖**；6 条断言并做了变异验证
- [x] `TextBlockOverlay` 7 个颜色字面量抽成 `overlay-colors.ts` 并改 oklch，
      与 palette 逐字比对 + 反向锁（源文件不得出现 hex/rgba），两条锁均已变异验证
- [x] 修复复核页当前项文本框截断（`[field-sizing:content]`）

## 回滚点

| 回滚到 | 命令 | 影响 |
|---|---|---|
| 阶段一结束 | `git reset --hard 0a58829` | 阶段二改动全清，阶段一保留 |
| 完全回退 | `git checkout main` | 回到重构前 |

## 未做、留给后续的四条

1. **基座仍有三处重复**：小节标签排版档（`FinalConfirmPage` 与 `CheckSummary` 各一份）、
   行内错误条、`Panel` 只能是 `div` 导致折叠态只能 `cn(panelVariants(), …)` 手拼。
   压着没做是因为不想在尾声连续第三轮改基座。
2. **`SegmentedItem` 用 `aria-pressed`**，严格说互斥档位该用 `role="radiogroup"` + `aria-checked`，
   但会改动键盘遍历行为，不该在收尾时动。
3. **`WorkspaceMenu.tsx:126-140` 菜单项仍是裸 button 手拼类**（是菜单项不是选中态，另一类）。
4. **z-index 无语义刻度**，`StageRail` 折叠层、`DoctorChip`、`WorkspaceMenu` 三处各写各的数字。

## 用户已定的两处（2026-07-31 · 已实施）

| 待定项 | 用户结论 | 落地 |
|---|---|---|
| 块列表键盘陷阱 | **修边界放行 + 加 ⌘/ 求助键** | 见下「阶段三」 |
| 分段控件字号 | **全部保持 12px**，不再改 | 无代码改动 |

## 阶段三：键盘陷阱修复 ✅（2026-07-31）

修的是 M4 遗留缺陷，不是本次重构引入。三处改动：

- [x] `resolveReviewKeyAction` 的 `move` 增加 `escapeAtEdge`：**Tab 为 true、↑↓ 为 false**。
      箭头键抢的是 textarea 内的光标移动，放行会让光标乱跳，且箭头本就带不出焦点，
      对陷阱毫无帮助——所以出口只开给 Tab。
- [x] `moveBy` 改为返回是否真的移动了，索引计算抽成纯函数 `resolveMoveTargetId`
      （边界返回 `null`）。`handleKeyDown` 的 move 分支**先动再决定拦不拦**：
      移动成功或非 Tab 才 `preventDefault`。
- [x] 新增 `resolveShortcutPanelKey`，`⌘/`（Win/Linux `Ctrl+/`）在输入框内也能开关
      快捷键面板。原有 `?` 在可编辑区不拦截的判断是对的，但它让「求助」在块列表的常驻
      textarea 里只剩鼠标一条路；带修饰键的组合不与内容冲突，故不受该限制。
      面板底部提示同步改为「按 Esc 收起；编辑文字时用 ⌘/ 开关」——旧文案对半数场景是错的。

**Esc 未动**：文档原记的第三条出口（`BlockTextEditor` 不传 `onExit` 导致 Esc 无效）
不在用户选定范围内，且 Tab 出口已解陷阱。留作后续。

### 验证

- 单测 323 → **334**（+11）：Tab/↑↓ 的 `escapeAtEdge` 语义、`resolveMoveTargetId`
  六种边界、面板开关键六种组合。
- 真机走查（`research/after-keyboard-trap/`，可复跑）：

  | 场景 | 结果 |
  |---|---|
  | 末项连按 Tab ×4 | 第 1 次即移出列表 |
  | 首项连按 ⇧Tab ×4 | 第 2 次移出列表（第 1 次落在本项内的删除按钮，属正常反向 Tab 顺序） |
  | 焦点在 textarea 按 ⌘/ | 面板唤起 |
  | 首项连按 Tab ×5（回归） | block-001→…→006 逐项推进，**边界放行未破坏列表导航** |

  `nav-intact.mjs` 与 `trap-check.mjs` 是一对：前者证明出口只开在两端，后者证明出口存在。
  少了前者，「放行」和「把列表导航改坏」在结果上无法区分。

- 四关全绿：typecheck ✓ / 503 测试 ✓ / `format:check` ✓ / 对比度 26 项 ✓

### 走查踩到的第三个坑

**面板是 toggle，走查脚本必须自己归零前置状态**。首轮 `⌘/` 判为失败，实为上一步截图
已把面板打开，这次按键正确地把它关掉了。判据 `!before && after` 隐含「初始关闭」这个
未声明的前提。修法是测前先按 Esc。同类脚本都该先归零再断言。

---

## 需要用户定的两处（历史记录，均已定，见上）

### 一、块列表是键盘陷阱（WCAG 2.1.2，A 级）—— 非本次引入

走查实测：焦点一旦进入块列表就出不来。

- 末项按 Tab：`resolveReviewKeyAction` 返回 `{kind:"move",delta:1}`，`BlockListPanel:223`
  无条件 `event.preventDefault()`，`moveBy` 到边界后不动 → 焦点原地不动（实测连按 12 次无位移）。
- 首项按 ⇧Tab：同理，同样不动。
- Esc：`resolveReviewKeyAction` 走 default 放行，但 `BlockTextEditor` 只在 `onExit` 有值时 blur，
  而「文字待确认」档是常驻可编辑、不传 `onExit` → Esc 无效。

**溯源**：`lib/review-keyboard.ts` 自 M4 `9d736ca` 起未改动；`BlockListPanel` 的
`preventDefault` 位置本次也未动（diff 里那一带只多了一行 import）。所以这是 M4 就存在的行为，
不是阶段二引入的回归。

**比看上去更硬的一点**：快捷键面板的 `?` 唤起在 input / textarea / contentEditable 内
**刻意不拦截**（在那里 `?` 是内容不是命令，这是对的）。后果是焦点困在可编辑行时，
键盘用户连快捷键面板都打不开——唯一出口是**鼠标**点窄条上的「⌨ 键盘快捷键」按钮。
也就是说陷阱里没有任何键盘自救手段。

**没有直接改的理由**：Tab 被改作「切换项」是 M4 刻意的交互设计（快捷键条上写着
「Tab / ↓ 切换项」），给它加出口等于改这套键盘模型的语义，超出「只动渲染层表现」的授权范围。

**建议修法**（改动很小，等你点头）：把 `moveBy` 改成返回是否真的移动了，只在移动成功时
`preventDefault`；到边界时放行，让浏览器按正常 Tab 顺序把焦点带出列表。这是绝大多数
「Tab 被改作列表导航」的控件采用的做法 —— 键盘模型不变，只是撞到头时不再吞掉按键。

若采纳，顺带值得给快捷键面板留一个不与输入冲突的键位（例如 `⌘/`），让「求助」在可编辑
行里也是键盘可达的。同样属于动 M4 键盘模型，一并定夺。

### 二、分段控件字号

三个分段控件文字从 14px 降到 12px（`size="sm"` 既有档）。控制台与工具栏里与同排 sm 按钮
一致，是净改善；最终确认页的 `ViewSwitch` 独占一条 bar，12px 略小。改 `md` 能回到 14px，
但工具栏会从 h-7 涨到 h-9，与它「压到 48px」的设计相抵。

## 风险与缓解

| 风险 | 缓解 |
|---|---|
| 改到判据逻辑，把 M4 已修缺陷重新打开 | 判据函数列入不可改清单（design.md §1）；`stage-view` / `todo-queue` / `accept-gate` 既有测试**零改动**是硬信号 |
| store 订阅被改成返回对象，引发全网格重渲染 | 逐字段订阅写法不可改，重构时保留原注释 |
| 删别名时漏掉某个文件导致样式塌陷 | 先跑 AC2 静态断言拿到完整清单，逐个迁完再删 |
| 真机走查烧钱 | 只用 `~/test/ppttest-walkthrough-E2` 副本与 `research/after-stage1/inject40.mjs` 合成数据；**绝不碰 `~/test/ppttest-walkthrough-E1`**；执行态用 `useRunStore.setState` 模拟 |

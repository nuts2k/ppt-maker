# 策划对话实施计划

## L1 core 契约与纯函数

- [x] 在 `planning-contracts.ts` 实现五维度、策划消息、提案决策、会话联合类型、存储提案信封、
      改稿模型输出与跨层结果 schema；模型面 schema 与持久化 schema 分开。
- [x] 实现会话折叠：最新维度、提案状态、唯一 pending；重复决策取第一条有效记录。
- [x] 实现初稿 / 单条目 / 全 deck 提案到候选 `ContentSpec` 的纯函数，id 由代码分配，未知模型 id 拒绝。
- [x] 用例覆盖合法/非法 schema、维度重建、接受/拒绝、重复决策、单 pending 与候选规格约束。

验证：

```bash
pnpm --filter @ppt-maker/core test
pnpm --filter @ppt-maker/core build
```

回滚点：新增契约均为旁路导出，不改 `ContentSpecSchema` 与指纹函数；可整体删除。

## L2 会话与材料存储

- [x] 扩展 `planning-store.ts`：一轮多行的串行追加、缺失返回空、坏行跳过、读路径零创建。
- [x] 实现材料列出 / 导入 / 移除；只接收 `.md` / `.txt`，重名不覆盖，路径不可越出 deck。
- [x] 实现稳定的材料上下文拼接；读取失败指名文件并阻止调用。
- [x] 用例覆盖同 deck 串行、不同 deck 隔离、坏行、权限/目录错误、材料重名和删除原文件不受影响。

验证：

```bash
pnpm --filter @ppt-maker/cli test -- planning-store
```

回滚点：只新增 `planning/session.jsonl` 与 `planning/materials/` 旁路路径，主链路不读。

## L3 三个 Provider 调用面

- [x] 新增策划提问 provider：历史 + 材料 → 回应、五维度、下一问 / 可出稿。
- [x] 复用初稿 schema 实现多轮上下文出稿；不得改 M5 一次性 `spec-draft` 行为。
- [x] 新增规格改稿 provider：单条目 / 全 deck → 完整条目提案；全 deck 恒为一次调用。
- [x] 三者均支持 parser 注入，断言 Responses API、`store:false`、模型面无约束 schema、
      refusal / 空解析时报 `INVALID_PROVIDER_RESPONSE`，`requestId` 缺失保持 `null`。

验证：

```bash
pnpm --filter @ppt-maker/cli test -- provider planning
```

回滚点：Provider 独立模块，不替换任何既有 provider。

## L4 策划领域服务

- [x] 实现 load / send / draft / propose / preview / accept / reject / materials 服务。
- [x] provider 成功后一次追加 user + assistant；追加失败不得返回可接受提案。
- [x] 领域层强制唯一 pending；初稿全量接受；全 deck 允许按 style / 条目筛选。
- [x] 接受重新 preview 后调用 `applySpecChange(origin="proposal", conversationRef=messageId)`；
      拒绝只追加 decision，规格字节不变。
- [x] accepted decision 写失败时返回显式部分成功，不诱导重复接受。
- [x] 集成用受控 provider + 临时 deck 覆盖初稿、单条目、全 deck、拒绝、重开、材料上下文、
      historyWritten false 与超限整体失败。

验证：

```bash
pnpm --filter @ppt-maker/cli test -- planning-conversation
```

回滚点：服务只通过 `applySpecChange` 写规格；删除服务后手工编辑路径原样存在。

## L5 Electron IPC 与 preload

- [x] 在 `IpcApi` 新增 `planning` 命名空间，main 注册对应 handler，preload 逐条转发。
- [x] 所有跨进程入参与返回过 core schema；renderer 不接触 Node 文件系统。
- [x] 提案决策与规格写入复用流水线 / 建页任务互斥；材料文件选择只放行 `.md` / `.txt`。
- [x] IPC 用例覆盖无效 scope / id、运行中拒绝、provider 错误、坏材料、拒绝零写盘与
      `origin/conversationRef` 正确传递。

验证：

```bash
pnpm --filter @ppt-maker/desktop test -- planning-ipc
pnpm --filter @ppt-maker/desktop typecheck
```

回滚点：新增 namespace 不改变现有 `deck` API。

## L6 renderer 状态与纯规则

- [x] 新增 conversation store，按 deck 身份守卫每个异步响应；`reset(nextDeckPath)` 不误伤新请求。
- [x] 实现 E1 dirty 守卫、E5 pending 守卫、单条目默认 scope、选中条目同步与错误恢复。
- [x] 抽出 proposal 选择、diff 展示数据、维度进度、确认文案为纯 `.ts` 模块并测试。
- [x] deferred 用例覆盖“旧 deck 响应迟到”和“不切 deck 正常落地”正反两条，守卫做变异验证。

验证：

```bash
pnpm --filter @ppt-maker/desktop test -- planning-conversation planning-store
```

回滚点：conversation store 与现有 planning store 分离。

## L7 对话、材料与提案界面

- [x] 左栏增加「对话 / 历史」分段切换，兑现完整 tab/radio 键盘语义，不改左右布局骨架。
- [x] 对话面板实现消息流、五维度、材料列表、composer、“就按现有信息出初稿”、scope 选择。
- [x] 右栏实现只读逐字段 diff；初稿整体接受，单条目整体接受，全 deck 可取消 style / 条目。
- [x] pending 时禁用继续发送；dirty 时显示“先保存或放弃右侧修改”，不静默合并。
- [x] 接受前展示精确过时 / 失联数量；规格历史或会话决策写失败均有明确警告。
- [x] 遵从 DESIGN.md：唯一 primary、proof 只标差异/待处理、六态、焦点环、等宽计数、
      reduced-motion；空材料不占固定大块。

验证：

```bash
pnpm --filter @ppt-maker/desktop test
pnpm --filter @ppt-maker/desktop typecheck
pnpm format:check
```

回滚点：PlanningPage 在无 conversation state 时仍可直接渲染既有 HistoryPanel + SpecEditor。

## L8 兼容性与端到端自动验收

- [x] 基线从 877 起，只增不减；运行 core / cli / desktop 全量测试。
- [ ] 复制真实 deck 后验证已有规格改稿；原件递归哈希前后不变。
- [ ] 临时零页 deck 用受控 provider 跑“多轮 → 初稿 → 接受 → 建页 → 后续链路”，全程不手写 JSON。
- [x] 拒绝提案前后比较 `content-spec.json` 字节；session 能查到 proposal + rejected decision。
- [ ] 删除 `planning/` 后 `deck status` / `run` / `export` 主链路仍可用；旧 deck 只读打开零改写。
- [x] 静态确认 `ContentSpecSchema`、指纹、生成 prompt、`SCHEMA_VERSION` 无改动。

验证：

```bash
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

## L9 真机模型与付费走查

- [ ] 在 scratchpad 副本上做一次真实策划提问与一次真实改稿，记录 provider / requestId / 模型；
      第三方网关 requestId 为 null 时如实保留。
- [ ] 若要完成父任务 A1 的真实 `--strict` PPTX，先跑 `deck status --json` 确认页集合，再向用户
      明确请求图像生成调用次数与不可撤销；未经确认不执行。
- [ ] 真实调用只覆盖最小一页路径；未选页、原始 `~/test/` 工作区保持字节不变。

## L10 质量门与交付

- [x] 运行最后一轮全范围 `trellis-check`；所有 WARNING / CRITICAL 回到实际代码验证。
- [x] 更新 backend contracts 中会话落地状态与新增稳定错误码（若实现确实新增）。
- [ ] 回写父任务 A1 / A2 / A5 / A9 的实际证据，不提前勾选未走的真机步骤。
- [ ] `task.py validate` 通过后提交；规划审阅通过前不执行 `task.py start`。

## 2026-08-04 最终验证证据

- `pnpm format:check`：通过；仅有 `apps/cli/src/pdf/extract.ts` 两条既有 info。
- `pnpm typecheck`：core / CLI / desktop 全部通过。
- `pnpm test`：89 个文件、948 项通过（core 156、CLI 265、desktop 527）。
- `pnpm build`：core、CLI、desktop、Apple Vision Swift 与 PDF renderer Swift 全部通过。
- `task.py validate`：implement / check JSONL 各 10 条，全部通过。
- `git diff --check`：通过；`open-design/` 无改动。
- 桌面视觉走查：对话 / 历史键盘导航、材料导入移除、零页与已有规格、E1 dirty 守卫、
  单条目 / 全 deck scope、pending diff / 唯一 primary 均通过；使用受控本地记录，未调用真实模型。
- 独立终审修复：全 deck 选择变化后的 preview 失败会残留旧影响数据；现已在请求开始时清空并补回归测试。
- 未执行 L9 真机模型与图像生成；按成本门禁保留为待确认项，不伪造为已验证。

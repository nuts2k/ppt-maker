# Research: 自动字形 Mask 本地图像像素处理依赖选型

- **Query**: 为「自动字形 Mask」阶段选择 Node 24 / macOS arm64 下可重复的本地图像像素处理依赖（implement.md 第 4 节首项）
- **Scope**: mixed（内部 package.json/pnpm 配置 + 外部 npm registry 元数据）
- **Date**: 2026-07-20

## 需求约束（来自 prd.md / design.md 第 9 节 / glyph-mask-baseline.md）

mask 阶段需在本地对源图完成：
1. 按复核区域（bbox/quad/glyphHints 四边形）裁剪出局部范围。
2. 颜色/亮度阈值分割（前景颜色候选 + 颜色容差）。
3. 边缘检测（边缘阈值参数）。
4. 连通域分析（按连通域面积剔除异常区域）。
5. 排除多边形（落入排除多边形的像素剔除）。
6. 受控膨胀 dilation（膨胀半径，处理描边/阴影/抗锯齿）。
7. 旋转区域处理（quadPx/rotationDeg）。
8. 输出：原尺寸带 alpha 的 PNG mask（clean plate 目标 2048x1152，源图可更大）、黑白预览、源图叠加预览、每块 mask 面积/相对 bbox 覆盖率统计。

硬约束：**完全离线，禁止云调用**；mask 是派生产物，需保存算法版本 + 全部输入哈希 + 输出哈希，clean 阶段校验 mask 未被外部改动；测试要求「像素级预期统计基线」（design.md 第 245-248 行）→ 算法必须**确定性可复现**。

## 环境事实（已核对）

| 项 | 值 | 来源 |
|---|---|---|
| Node engines | `>=24 <25` | `package.json` |
| pnpm | `10.32.0`（`>=10 <11`） | `package.json` |
| 模块类型 | ESM（`"type": "module"`） | `package.json` |
| pnpm 构建门槛 | `onlyBuiltDependencies: [esbuild]` | `pnpm-workspace.yaml` |
| 已有图像依赖 | `image-size@^2.0.0`（仅取尺寸） | `apps/cli/package.json` |

**关键**：pnpm 10 默认拦截依赖的 `install`/`postinstall`/`preinstall` 生命周期脚本，仅执行 `onlyBuiltDependencies` 白名单内的包。因此**任何带 install 脚本的原生编译包（如 node-canvas）在当前配置下会被静默跳过构建，运行时 native addon 加载失败**，除非显式加入白名单。这是选型的一等约束。

## 候选对比表

| 候选 | 最新版本 | 形态 | Node24/arm64 可重复性 | install 脚本 | 算法覆盖 | 许可证 | 维护 |
|---|---|---|---|---|---|---|---|
| **sharp** (libvips) | `0.35.3`（2026-07-01） | N-API 原生，预编译平台包 | 高：`@img/sharp-darwin-arm64@0.35.3` + `@img/sharp-libvips-darwin-arm64@1.3.2` 走 optionalDependencies，锁版本后二进制稳定 | **无**（`hasInstallScript: null`，`build` 非 install 钩子）→ pnpm 无需白名单 | 解码/裁剪(extract)/旋转/合成(composite)/编码/raw 像素/threshold/convolve(可做 Sobel 边缘)/linear。**无** 连通域、无形态学 dilate、无 contour/多边形 | Apache-2.0 | 极活跃 |
| **@techstark/opencv-js** | `5.0.0-release.1` | 纯 WASM/asm.js，无 native | 高：纯 JS 产物，无平台差异，锁版本后完全确定 | 无 | **全覆盖**：cvtColor/inRange/threshold/Canny/findContours/connectedComponentsWithStats/getStructuringElement+dilate/warpAffine/pointPolygonTest | Apache-2.0 | 活跃（`-release.1` 为预发布 tag） |
| **opencv-wasm** | `4.3.0-10` | 纯 WASM | 中：纯 JS 可复现，但基于旧 OpenCV 4.3，长期未更新 | 无 | 同 opencv 全覆盖但 API 更旧 | BSD-3-Clause | 低（陈旧） |
| **jimp** | `1.6.1`（2026-04-07） | 纯 TS/JS，ESM+CJS 双端 | 高：纯 JS，无平台差异 | 无 | crop/rotate/threshold/blur/color/mask/blit。**无** 连通域、无形态学 dilate、无 Canny | MIT | 活跃 |
| **纯 TS + pngjs** | `pngjs@7.0.0` | 纯 JS 编解码 + 自写像素算法 | 最高：全部逻辑在仓库内，字节级确定 | 无 | 全部自实现；pngjs 仅 PNG 编解码（JPG 需另配） | MIT | 稳定 |
| **canvas** (node-canvas) | `3.2.3` | node-gyp 原生 | **低**：`install: prebuild-install \|\| node-gyp rebuild`，预编译缺失时回退编译，依赖 Homebrew Cairo/Pango/libjpeg/giflib | **有** install 脚本 → 当前 pnpm 配置下被拦截，需加白名单 + 系统库 | 光栅绘制 API，非算法库 | MIT | 活跃 |
| **@napi-rs/canvas** | `1.0.2` | N-API 预编译（Rust/skia） | 高：`@napi-rs/canvas-darwin-arm64@1.0.2` 走 optionalDependencies | **无** install 脚本 → 免白名单 | 光栅绘制 API（skia），非算法库 | MIT | 活跃 |

（版本均来自 npm registry 元数据，非记忆断言。sharp 0.35.3 与 `@img/sharp-darwin-arm64` 的 `engines.node` 均为 `>=20.9.0`，Node 24 落在区间内；预编译走 N-API，跨 Node 大版本二进制稳定。）

## 推荐方案

**首选：`sharp` 负责解码/裁剪/旋转/合成/编码 + 像素级算法用 TypeScript 自实现（在 raw RGBA buffer 上）。**

固定版本（写入 `apps/cli/package.json` 或 `packages/core/package.json`，`pnpm-lock.yaml` 锁定平台包）：

```json
"sharp": "0.35.3"
```

lockfile 会同时锁定 `@img/sharp-darwin-arm64@0.35.3`、`@img/sharp-libvips-darwin-arm64@1.3.2`（二进制随 lock 固定）。

职责划分：
- **sharp 做 I/O 与几何**：`.extract()` 裁剪复核区域；`.rotate(deg)` 处理旋转区域；`.raw().toBuffer({resolveWithObject:true})` 取像素做算法；`sharp(buffer,{raw:{...}})` 回写；`.composite()` 生成叠加预览；`.png()` 输出 alpha mask / 黑白预览。
- **TS 自实现像素算法**：颜色/亮度阈值分割、边缘响应、**连通域标注（CCL, two-pass 或 union-find）**、**受控膨胀（结构元卷积/距离阈值）**、**多边形排除（point-in-polygon）**、覆盖率统计。这些是 sharp 未内置、opencv 才有的部分，但均为约 200 行成熟算法。

### 选择依据

1. **可重复性最优**：sharp 无 install 脚本，当前 `onlyBuiltDependencies` 严格配置下**无需改动白名单**即可安装；平台包预编译、锁版本后二进制稳定；自写算法逻辑完全在仓库内，字节级确定，直接满足 design.md「像素级预期统计基线」测试要求。
2. **避开原生编译风险**：不引入 node-canvas 那类 node-gyp/系统库依赖。
3. **契合现有栈**：项目已 ESM、已用轻量 image-size；sharp 是解码/编码/合成的行业标准，Apache-2.0 许可证干净，维护活跃。
4. **相对 opencv-wasm 全家桶的取舍**：opencv 全覆盖但代价是约 9MB WASM、异步初始化、`Mat` 手动 `delete()` 内存管理、CJS 在 ESM 下的 interop、且当前只有 `5.0.0-release.1` 预发布 tag。本项目实际只需 6 个明确定义的算法且要求确定性/可测；自实现比引入全家桶更透明、更易做像素级断言。

### 回滚方案

- **首选算法层回滚 → `@techstark/opencv-js@5.0.0-release.1`**（纯 WASM，离线，可复现）。触发条件：自写连通域/膨胀在复杂样例（渐变、描边、同色容器）表现不稳或性能不足。**切换成本：中**——只替换 TS 算法模块，新增 WASM 异步 init 与 `Mat` 生命周期管理；**sharp 保留做 I/O**，`sharp.raw()` 产出的 RGBA buffer 直接 `cv.matFromArray`/`matFromImageData` 构建 Mat，因此解码/编码/预览/记录代码不受影响。若嫌预发布 tag，可评估 `opencv-wasm@4.3.0-10`（更旧但 API 稳定，BSD-3）。
- **I/O 层回滚 → `jimp@1.6.1` 或 `pngjs@7.0.0`**（纯 JS，零 native）。触发条件：sharp 预编译在目标环境异常（依 engines/预编译判断概率极低）。切换成本：低-中，需替换解码/裁剪/合成/编码调用，算法层不变。
- **若后续需在预览上光栅化绘制文字/框**：用 `@napi-rs/canvas@1.0.2`（预编译 darwin-arm64、无 install 脚本、免白名单），**不要**用 node-canvas（node-gyp + 系统库）。

### 风险点

- sharp 未内置连通域/形态学/多边形，自实现质量决定 mask 精度；须以合成 fixture 建像素统计基线覆盖容器边框、同色结构、旋转文字、艺术字（design.md 第 246、263 行已列为风险）。
- sharp `.rotate()` 与 mask 坐标回映：旋转区域处理需在裁剪后旋转、算法后反旋回源图坐标系，注意插值带来的抗锯齿边缘（受控膨胀参数需覆盖）。
- 若未来把 canvas 类原生包纳入，必须同步更新 `pnpm-workspace.yaml` 的 `onlyBuiltDependencies`，否则安装静默跳过、运行时报错。
- opencv-js 若被选为回滚，`5.0.0-release.1` 为预发布，需在锁定前评估其 API 稳定性与 5.0 兼容性说明。

## Caveats / Not Found

- 版本号与 engines/install 脚本/平台包信息均来自 npm registry 实时元数据（2026-07-20 查询），非记忆断言。
- 未实际执行 `pnpm install` 验证（任务约束禁止装依赖）；「无需白名单」结论基于 sharp `hasInstallScript: null` 且无 install 生命周期钩子的元数据推断，首次落地时应以一次真实 `pnpm install` + `node -e "require('sharp')"` 冒烟确认。
- exa/WebSearch 工具在本会话不可用，未取得第三方博客对「sharp + Node 24」的经验帖；结论以 registry engines 声明与 N-API 预编译机制为据。

## 冒烟验证结果（2026-07-20 落地）

在 `apps/cli` 加入 `sharp@0.35.3` 并执行 `pnpm install` 后实测确认，「无需白名单」推断成立：

- `pnpm install` 未出现 ignored build scripts / approve-builds 提示，无需改动 `onlyBuiltDependencies`。
- lockfile 锁定平台包：`@img/sharp-darwin-arm64@0.35.3` 与 `@img/sharp-libvips-darwin-arm64@1.3.2`（走 optionalDependencies，随 lock 固定），且已在 `node_modules/.pnpm` 物化。
- `require('sharp')` 可用：sharp 0.35.3 / libvips 8.18.3。
- decode→raw RGBA buffer→encode PNG 往返字节确定（`Buffer.compare === 0`），alpha 通道保留，二次编解码无漂移；已由 `apps/cli/test/sharp-smoke.test.ts` 固定该链路。
- 运行环境实际为 Node v25.8.0（本机），sharp 仍正常加载（engines `>=20.9.0`，N-API 预编译跨大版本稳定）。

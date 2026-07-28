# 研究数据说明

## data-snapshot/

取自真实工作区 `~/test/ppttest-2026-07-25`（2026-07-24 生成，2 页 155 块），是 `prd.md` 全部测量数字的原始依据。

| 文件 | 内容 |
|---|---|
| `page-01/text-blocks.json`、`page-02/text-blocks.json` | 复核文档原文，60 与 95 块 |
| `page-*/clean-checks.json` | 三次 clean 尝试的自动检查指标（从各 `clean-00N/record.json` 的 `checks` 抽出） |

已确认不含 API 密钥、provider 原始响应或任何凭据。页面内容为 gpt-image-2 生成的演示素材（虚构的档期复盘报告与青花瓷鉴赏页），非真实业务数据。

## measure.py

复现 `prd.md` 中 F-2 / F-3 / F-4 / F-6 / F-7 / F-8 / F-9 / F-10 的全部数字，只读上述快照，不需要真实工作区：

```bash
python3 .trellis/tasks/07-26-review-flow-simplification/research/measure.py
```

任何时候对结论有疑问，先跑这个脚本，不要凭记忆引用数字。

## 快照能做什么、不能做什么

**能做**（仅靠仓库）：

- 复核三分区的项数验证：page-01 = 25 / 16 / 19，page-02 = 45 / 18 / 32
- `LAYOUT_TEXT_MUST_BE_MASKED` 的真实用例：page-02 `block-045`（`色彩含义`）
- `compareBlockSources` 的一致 / 分歧 / 缺来源三种情形取样
- 字符级 diff 的真实样本（分歧多为 1–3 字，最长为 block-001 的整句差异）
- 分类误判清单（F-7）：page-02 的 `历史脉络`、`鉴赏与收藏`、`器型结构`、`◎ 颈部`、`◎ 肩部`、`◎ 圈足`、`口沿`、`② 材质说明`、`③ 纹样寓意`、`⑤ 核心特征`

**不能做**（必须有真实工作区，含源图与 clean plate）：

- 画布标注可读性走查（C9–C11）
- 合成预览与 PPTX 在 PowerPoint for Mac 中的对比（D1–D3、R2 验收）
- 滑块对比（R2.2）
- 阶段执行与门停顿的端到端走查（E1）

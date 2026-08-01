/**
 * 分段控件的组内键盘导航（WAI-ARIA radiogroup 模式）。
 *
 * 抽成纯函数与 `review-keyboard.ts` 同理：项目不装 DOM 测试库，键位判定散在
 * `useCallback` 里就无法写确定性用例。用相对 `.js` 导入，同时被 vite 与 vitest 解析。
 *
 * ## 为什么必须连键盘行为一起改
 *
 * 档位此前是 `aria-pressed` 的一组独立按钮。读屏把它读成「切换按钮」，与实际语义
 * （一组互斥选项，选一个别的就自动取消）不符。但**只把 role 换成 radio 是更糟的**：
 * radiogroup 模式承诺「整组一个 Tab 停靠点、组内用箭头键移动」，声称了却不兑现，
 * 读屏用户会按箭头键然后发现什么也没发生——比诚实的 `aria-pressed` 更误导。
 *
 * 所以这里给出组内移动的判定，配合 `SegmentedItem` 的 roving `tabIndex`
 * （选中项 0、其余 -1）构成完整模式。
 */

/** 组内导航的判定结果；`null` 表示这个键与分段控件无关，交还给浏览器。 */
export type SegmentedNavResult = number | null;

export interface SegmentedNavInput {
  readonly key: string;
  /** 组内可用档位总数（已排除 disabled）。 */
  readonly count: number;
  /** 当前聚焦档位在可用档位中的下标。 */
  readonly index: number;
}

/**
 * 返回焦点应移到的下标。
 *
 * **左右上下四个方向都收**：radiogroup 的档位在视觉上是横排，但 WAI-ARIA 允许
 * 两个轴向都用，读屏用户的习惯键位并不统一，少收一个轴就有人按不动。
 *
 * **两端环绕**，与 radiogroup 模式一致——这与块列表的 Tab 边界放行不冲突：
 * 那里 Tab 兼着「离开列表」的职责，这里箭头键只在组内移动，组的出口是 Tab 本身。
 */
export function resolveSegmentedNav(
  input: SegmentedNavInput,
): SegmentedNavResult {
  const { key, count, index } = input;
  if (count <= 0) return null;

  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return (index + 1) % count;
    case "ArrowLeft":
    case "ArrowUp":
      return (index - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

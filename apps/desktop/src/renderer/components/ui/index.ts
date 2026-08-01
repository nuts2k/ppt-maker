/**
 * 组件基座统一出口。
 *
 * 业务组件一律从这里取，不要绕过基座直接拼 Tailwind 类字符串 —— 上一版
 * 按钮定义在 4 个文件里各抄一份并已漂移，就是绕过基座的直接后果。
 *
 * 变体与状态表放在 `variants.ts` / `status-spec.ts` 这两个纯 `.ts` 模块里，
 * 以便 `test/ui-design-rules.test.ts` 能直接锁住设计规则（项目测试不导入 `.tsx`）。
 */

export { Button, type ButtonProps } from "./Button";
export {
  Checkbox,
  type CheckboxProps,
  Input,
  type InputProps,
  Textarea,
  type TextareaProps,
} from "./Field";
export { IconButton, type IconButtonProps } from "./IconButton";
export { Kbd, type KbdProps } from "./Kbd";
export { MenuItem, type MenuItemProps } from "./MenuItem";
export { NoticeBar, type NoticeBarProps, type NoticeLevel } from "./NoticeBar";
export { Panel, type PanelProps, type PanelTag } from "./Panel";
export {
  SegmentedGroup,
  SegmentedItem,
  type SegmentedItemProps,
} from "./Segmented";
export { StatusChip, StatusDot } from "./Status";
export {
  resolveSegmentedNav,
  type SegmentedNavInput,
  type SegmentedNavResult,
} from "./segmented-nav";
export { STATUS_DOT_SIZE, STATUS_SPEC, type StatusSpec } from "./status-spec";
export {
  buttonVariants,
  kbdVariants,
  panelVariants,
  SECTION_LABEL,
} from "./variants";

export const SCHEMA_VERSION = 1 as const;

/**
 * 定义在此而非 workspace-contracts.ts：来源契约（source-contracts.ts）也要用它，
 * 而 workspace-contracts.ts 反过来依赖来源契约，放在契约层会形成循环导入。
 */
export const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export const WIDE_ASPECT_RATIO = 16 / 9;
export const WIDE_ASPECT_RATIO_RELATIVE_TOLERANCE = 0.005;

export const PPTX_WIDE_WIDTH_INCHES = 13.333;
export const PPTX_WIDE_HEIGHT_INCHES = 7.5;

export const DEFAULT_FONT_FACE = "Microsoft YaHei";
export const SUPPORTED_NODE_MAJOR = 24;
export const SUPPORTED_PNPM_MAJOR = 10;

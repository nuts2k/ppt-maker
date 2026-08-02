/**
 * IPC 错误的呈现文案。
 *
 * Electron 的 `ipcRenderer.invoke` 会把 main 抛出的错误重新包一层，`message` 变成
 * `Error invoking remote method 'deck:source-task-start': FoundationError: 真正的原因`。
 * 直接贴进错误条，用户先读到的是通道名与两层类名，真正能据以行动的那句被挤到末尾。
 *
 * 建页任务尤其吃这一层：页码范围非法、PDF 里没有 16:9 页这类**领域错误**本就该原样
 * 回显给用户（PRD R3 明确「非法输入由 CLI 报错、界面照常显示原因」），包一层等于把
 * 「照常显示原因」打了折。
 *
 * 只剥外壳、不改内容：剥不掉就原样返回，绝不吞掉任何一段可能有用的文字。
 */

/** `Error invoking remote method 'channel': ` —— Electron 加的那一层 */
const INVOKE_PREFIX = /^Error invoking remote method '[^']*':\s*/;

/**
 * main 侧错误类名前缀，例如 `FoundationError: `。
 *
 * 只剥一层：`FoundationError: PdfError: 原因` 剥完还剩 `PdfError: 原因`，后者是
 * CLI 自己写进消息里的分类信息，不该由桌面端替它判断有没有价值。
 */
const CLASS_PREFIX = /^[A-Z][A-Za-z0-9_]*Error:\s*/;

export function ipcErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const unwrapped = raw.replace(INVOKE_PREFIX, "");
  const stripped = unwrapped.replace(CLASS_PREFIX, "");
  // 剥到空说明这条消息除了外壳什么都没有，那就把外壳还回去，总好过一片空白
  return stripped.trim() === "" ? raw : stripped;
}

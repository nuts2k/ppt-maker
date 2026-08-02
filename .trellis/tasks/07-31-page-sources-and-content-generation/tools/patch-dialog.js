const { dialog } = require("electron");
globalThis.__wt = globalThis.__wt || { openQueue: [], boxQueue: [], log: [] };
if (!dialog.__wtPatched) {
  const origOpen = dialog.showOpenDialog.bind(dialog);
  const origBox = dialog.showMessageBox.bind(dialog);
  // 文件/目录选择框：注入路径（osascript 发不了按键，原生选择框没法输入路径）
  dialog.showOpenDialog = async (...args) => {
    const opts = args.length > 1 ? args[1] : args[0];
    globalThis.__wt.log.push({ type: "open", properties: opts?.properties, filters: opts?.filters });
    if (globalThis.__wt.openQueue.length === 0) return origOpen(...args);
    const filePaths = globalThis.__wt.openQueue.shift();
    return { canceled: filePaths.length === 0, filePaths };
  };
  // 确认框：记录完整选项并按 boxQueue 应答。
  // 屏幕锁定后原生框既截不到也点不了，且会把 main 卡在嵌套 run loop 里（连 CDP 都不响应），
  // 所以这里应答而不是放行。队列空时按「取消」——宁可什么都不做，也不能替用户批准付费。
  dialog.showMessageBox = async (...args) => {
    const opts = args.length > 1 ? args[1] : args[0];
    globalThis.__wt.log.push({ type: "box", opts: JSON.parse(JSON.stringify(opts)) });
    if (globalThis.__wt.boxQueue.length === 0) {
      return { response: opts?.cancelId ?? 1, checkboxChecked: false };
    }
    return { response: globalThis.__wt.boxQueue.shift(), checkboxChecked: false };
  };
  dialog.__wtPatched = true;
}
return "patched";

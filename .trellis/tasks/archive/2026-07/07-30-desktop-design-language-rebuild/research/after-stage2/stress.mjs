// 窗口压到 1280×700：确认最终确认页栏头+操作区不会把滚动区挤没（final 代理提出的检查点）
// 与灰度截图。同一 CDP 会话内完成设置与截图 —— setDeviceMetricsOverride 随会话失效。
const CDP = "http://127.0.0.1:9222";
const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

const [mode, out] = process.argv.slice(2);
if (mode === "height") {
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 700, deviceScaleFactor: 2, mobile: false });
} else if (mode === "gray") {
  await send("Emulation.setEmulatedMedia", { features: [] });
  await send("Emulation.setPageScaleFactor", { pageScaleFactor: 1 });
  await send("Runtime.evaluate", { expression: "document.documentElement.style.filter='grayscale(1)'" });
}
await new Promise((r) => setTimeout(r, 600));
const shot = await send("Page.captureScreenshot", { format: "png" });
const { writeFileSync } = await import("node:fs");
writeFileSync(out, Buffer.from(shot.result.data, "base64"));
// 量一下滚动区是否被挤没
const probe = await send("Runtime.evaluate", { expression: `JSON.stringify(Array.from(document.querySelectorAll('*')).filter(e=>{const s=getComputedStyle(e);return /auto|scroll/.test(s.overflowY)&&e.scrollHeight>0}).map(e=>({cls:e.className.toString().slice(0,40),h:Math.round(e.clientHeight),sh:Math.round(e.scrollHeight)})).filter(x=>x.h<80))`, returnByValue: true });
console.log(out, "已保存；被挤到 <80px 的滚动区:", probe.result.result.value);
if (mode === "gray") await send("Runtime.evaluate", { expression: "document.documentElement.style.filter=''" });
ws.close();

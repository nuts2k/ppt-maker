// 按给定键序逐键走，记录每步 activeElement，用于查焦点能否离开列表。
const CDP = "http://127.0.0.1:9222";
const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const KEYS = { Tab: [9, "Tab"], Escape: [27, "Escape"], ShiftTab: [9, "Tab"] };
for (const spec of process.argv.slice(2)) {
  const [vk, code] = KEYS[spec] ?? KEYS.Tab;
  const mods = spec === "ShiftTab" ? 8 : 0;
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, key: code, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods });
  await new Promise((r) => setTimeout(r, 60));
  const res = await send("Runtime.evaluate", { returnByValue: true, expression: `(() => { const a = document.activeElement; const cs = getComputedStyle(a); const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0; return (ring?'':'⚠无环 ') + a.tagName + ':' + (a.getAttribute('aria-label')||a.innerText||a.value||'').replace(/\\s+/g,' ').slice(0,24); })()` });
  console.log(spec.padEnd(9), res.result.result.value);
}
ws.close();

// 单会话内连续 Tab 并记录每一步的 activeElement，用于查焦点是否被困住。
const CDP = "http://127.0.0.1:9222";
const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

const n = Number(process.argv[2] ?? 25);
await send("Runtime.evaluate", { expression: "document.body.focus(); document.activeElement.blur()" });
const seen = [];
for (let i = 0; i < n; i++) {
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await new Promise((r) => setTimeout(r, 40));
  const res = await send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
    const a = document.activeElement; if (!a) return 'null';
    const cs = getComputedStyle(a);
    const ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0;
    const label = (a.getAttribute('aria-label') || a.innerText || a.value || a.tagName).replace(/\\s+/g,' ').trim().slice(0, 26);
    const row = a.closest('li,[data-block-id]'); const rid = row ? (row.getAttribute('data-block-id') || (row.innerText||'').replace(/\s+/g,' ').slice(0,14)) : '-'; return (ring ? '' : '⚠无环 ') + a.tagName + ':' + label + ' @' + rid;
  })()` });
  seen.push(res.result.result.value);
}
console.log(seen.map((s, i) => `${String(i + 1).padStart(2)} ${s}`).join("\n"));
ws.close();

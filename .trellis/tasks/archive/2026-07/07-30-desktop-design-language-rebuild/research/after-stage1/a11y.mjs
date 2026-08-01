// AC8 键盘焦点可见性 + AC11 减弱动效。
// 用法：node a11y.mjs tab <次数>   |   node a11y.mjs reduce <on|off>
const CDP = "http://127.0.0.1:9222";
const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => { ws.onopen = r; });

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const mid = ++id;
    pending.set(mid, { resolve, reject });
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

const [, , cmd, arg] = process.argv;

if (cmd === "tab") {
  const times = Number(arg ?? 1);
  const trail = [];
  for (let i = 0; i < times; i++) {
    // 真键盘事件，不是 el.focus() —— 后者会绕过 tab 顺序，让「Tab 到不了」的缺陷假通过
    await send("Input.dispatchKeyEvent", {
      type: "rawKeyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9,
    });
    await send("Input.dispatchKeyEvent", {
      type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9,
    });
    const r = await send("Runtime.evaluate", {
      expression: `(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return { at: '(body)' };
        const cs = getComputedStyle(el);
        return {
          at: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 28),
          tag: el.tagName.toLowerCase(),
          outlineWidth: cs.outlineWidth,
          outlineStyle: cs.outlineStyle,
          outlineColor: cs.outlineColor,
        };
      })()`,
      returnByValue: true,
    });
    trail.push(r.result.value);
  }
  // 焦点环判定：宽度非 0 且样式非 none
  const invisible = trail.filter(
    (t) => t.at !== "(body)" &&
      (t.outlineStyle === "none" || t.outlineWidth === "0px"),
  );
  console.log(JSON.stringify({ trail, 无焦点环的元素: invisible }, null, 2));
} else if (cmd === "reduce") {
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: arg === "on" ? "reduce" : "no-preference" }],
  });
  const r = await send("Runtime.evaluate", {
    expression: `(() => {
      const moving = [...document.querySelectorAll('*')].filter(el => {
        const cs = getComputedStyle(el);
        const dur = (s) => s.split(',').some(v => parseFloat(v) > 0.05);
        return (cs.animationName !== 'none' && dur(cs.animationDuration)) || dur(cs.transitionDuration);
      }).map(el => ({
        tag: el.tagName.toLowerCase(),
        cls: el.className.toString().slice(0, 60),
        anim: getComputedStyle(el).animationDuration,
        trans: getComputedStyle(el).transitionDuration,
      }));
      return { 减弱动效: matchMedia('(prefers-reduced-motion: reduce)').matches, 仍在动的元素数: moving.length, 样例: moving.slice(0, 5) };
    })()`,
    returnByValue: true,
  });
  console.log(JSON.stringify(r.result.value, null, 2));
}
ws.close();

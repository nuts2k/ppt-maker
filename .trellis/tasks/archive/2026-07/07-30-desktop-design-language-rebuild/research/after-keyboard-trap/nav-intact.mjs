/*
 * 回归校验：边界放行不能把「Tab = 切换项」这套键盘模型改坏。
 *
 * 从第 1 项起连按 Tab，焦点应逐项推进（block-001 → 002 → 003…）而不是移出列表。
 * 只有撞到末项那一次才允许离开。这条与 trap-check.mjs 是一对：
 * 前者证明有出口，后者证明出口只开在两端。
 *
 * 用法：node nav-intact.mjs
 */
const CDP = "http://127.0.0.1:9222";
const list = await (await fetch(`${CDP}/json/list`)).json();
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => {
  ws.onopen = r;
});
let id = 0;
const pend = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) {
    pend.get(m.id)(m);
    pend.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pend.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  return r.result.result.value;
};

async function key(k, code, vk, mods = 0) {
  for (const type of ["keyDown", "keyUp"]) {
    await send("Input.dispatchKeyEvent", {
      type,
      key: k,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      modifiers: mods,
    });
  }
  await new Promise((r) => setTimeout(r, 70));
}

/** 当前项由列表自己的选中态决定，不看 activeElement——可编辑行的焦点在 textarea 上 */
const CURRENT = `(() => {
  const cur = document.querySelector('li[tabindex="-1"].border-border-strong')
    ?? document.activeElement?.closest?.('li[tabindex="-1"]');
  if (!cur) return '（列表外）';
  return (cur.innerText.match(/block-\\d+/) || ['?'])[0];
})()`;

await evaluate(`(() => {
  const items = [...document.querySelectorAll('li[tabindex="-1"]')];
  items[0].focus();
})()`);

const trace = [await evaluate(CURRENT)];
for (let i = 0; i < 5; i++) {
  await key("Tab", "Tab", 9);
  trace.push(await evaluate(CURRENT));
}

console.log("从首项连按 Tab ×5，当前项轨迹：");
console.log("  " + trace.join(" → "));

const advanced = new Set(trace.filter((t) => t.startsWith("block-"))).size;
console.log(
  advanced >= 5
    ? `  → 结论：逐项推进正常（经过 ${advanced} 个不同的块），边界放行未破坏列表导航`
    : `  → 结论：异常，只经过 ${advanced} 个块`,
);
ws.close();

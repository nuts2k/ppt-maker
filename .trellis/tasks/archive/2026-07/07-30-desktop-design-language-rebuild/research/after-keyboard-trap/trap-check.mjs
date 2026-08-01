/*
 * 键盘陷阱走查（WCAG 2.1.2）。单 CDP 会话内完成「聚焦 → 按键 → 读 activeElement」，
 * 跨会话读状态会读到未受影响的那一份（见 implement.md 走查坑 1）。
 *
 * 三段：末项连按 Tab、首项连按 ⇧Tab、可编辑行按 ⌘/。
 * 每段都打印焦点是否离开了块列表——「离开」即出口存在。
 *
 * 用法：node trap-check.mjs
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
  if (r.result.exceptionDetails) {
    throw new Error(JSON.stringify(r.result.exceptionDetails));
  }
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
  await new Promise((r) => setTimeout(r, 60));
}

/** 焦点当前落在哪，以及它还在不在块列表内 */
const PROBE = `(() => {
  const a = document.activeElement;
  if (!a) return { inList: false, desc: 'null' };
  const li = a.closest('li[tabindex="-1"]');
  const label = (a.getAttribute('aria-label') || a.value || a.innerText || a.tagName)
    .replace(/\\s+/g, ' ').trim().slice(0, 34);
  return {
    inList: li !== null,
    desc: a.tagName + ':' + label,
    block: li ? (li.innerText.match(/block-\\d+/) || ['-'])[0] : '-',
  };
})()`;

function report(title, trace) {
  const escaped = trace.findIndex((s) => !s.inList);
  console.log(`\n【${title}】`);
  for (const [i, s] of trace.entries()) {
    console.log(`  ${String(i + 1).padStart(2)} ${s.inList ? "列表内" : "列表外"} ${s.block} ${s.desc}`);
  }
  console.log(
    escaped === -1
      ? "  → 结论：焦点始终困在列表内（键盘陷阱仍在）"
      : `  → 结论：第 ${escaped + 1} 次按键后焦点移出列表（出口存在）`,
  );
  return escaped !== -1;
}

// —— 1. 末项连按 Tab ——
await evaluate(`(() => {
  const items = [...document.querySelectorAll('li[tabindex="-1"]')];
  items.at(-1).focus();
})()`);
const tabTrace = [];
for (let i = 0; i < 4; i++) {
  await key("Tab", "Tab", 9);
  tabTrace.push(await evaluate(PROBE));
}
const tabOk = report("末项连按 Tab ×4", tabTrace);

// —— 2. 首项连按 ⇧Tab ——
await evaluate(`(() => {
  const items = [...document.querySelectorAll('li[tabindex="-1"]')];
  items[0].focus();
})()`);
const shiftTrace = [];
for (let i = 0; i < 4; i++) {
  await key("Tab", "Tab", 9, 8); // modifiers 8 = Shift
  shiftTrace.push(await evaluate(PROBE));
}
const shiftOk = report("首项连按 ⇧Tab ×4", shiftTrace);

// —— 3. 焦点在文本框时按 ⌘/ 唤起快捷键面板 ——
const hasEditor = await evaluate(`(() => {
  const ta = document.querySelector('li[tabindex="-1"] textarea');
  if (!ta) return false;
  ta.focus();
  return document.activeElement === ta;
})()`);
let panelOk = null;
if (hasEditor) {
  // 面板是 toggle，前一次走查可能把它留在开着的状态，先按 Esc 归零再测
  await key("Escape", "Escape", 27);
  await evaluate(
    `document.querySelector('li[tabindex="-1"] textarea')?.focus()`,
  );
  const before = await evaluate(
    `document.getElementById('review-shortcut-panel') !== null`,
  );
  await key("/", "Slash", 191, 4); // modifiers 4 = Meta
  const after = await evaluate(
    `document.getElementById('review-shortcut-panel') !== null`,
  );
  panelOk = !before && after;
  console.log("\n【焦点在文本框时按 ⌘/】");
  console.log(`  按键前面板存在=${before} / 按键后面板存在=${after}`);
  console.log(
    panelOk
      ? "  → 结论：可编辑行内快捷键面板键盘可达"
      : "  → 结论：面板未被唤起",
  );
} else {
  console.log("\n【焦点在文本框时按 ⌘/】当前筛选下没有可编辑行，跳过");
}

console.log(
  `\n汇总：Tab出口=${tabOk ? "通过" : "失败"} / ⇧Tab出口=${shiftOk ? "通过" : "失败"} / ⌘求助=${panelOk === null ? "跳过" : panelOk ? "通过" : "失败"}`,
);
ws.close();

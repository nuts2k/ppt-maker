/*
 * 分段控件改 radiogroup 后的走查。
 *
 * 换 role 就等于向读屏承诺了整套键盘模式，所以要验的不是「看起来还对」，
 * 而是这四条承诺是否真的兑现：
 *   1. 语义：role=radiogroup + role=radio + aria-checked，且没有残留的 aria-pressed
 *   2. roving tabindex：组内只有选中项是 0，其余 -1
 *   3. Tab 只在整组停一次（不是每档停一次）
 *   4. 箭头键在组内移动并即时选中，两端环绕
 *
 * 单 CDP 会话内完成，理由见 implement.md 走查坑 1。
 * 用法：node segmented-a11y.mjs
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
    throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 400));
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
  await new Promise((r) => setTimeout(r, 70));
}

const pass = [];
function check(name, ok, detail) {
  pass.push(ok);
  console.log(`  ${ok ? "通过" : "失败"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// —— 1. 语义 ——
console.log("\n【1. ARIA 语义】");
const sem = await evaluate(`(() => {
  const groups = [...document.querySelectorAll('[role="radiogroup"]')];
  const radios = [...document.querySelectorAll('[role="radio"]')];
  return {
    groups: groups.length,
    labelled: groups.filter(g => (g.getAttribute('aria-label') || '').length > 0).length,
    radios: radios.length,
    withChecked: radios.filter(r => r.hasAttribute('aria-checked')).length,
    strayPressed: radios.filter(r => r.hasAttribute('aria-pressed')).length,
    legacyFieldset: document.querySelectorAll('fieldset').length,
  };
})()`);
check("存在 radiogroup 且都有 aria-label", sem.groups > 0 && sem.groups === sem.labelled, `${sem.groups} 组`);
check("每个 radio 都有 aria-checked", sem.radios > 0 && sem.radios === sem.withChecked, `${sem.radios} 档`);
check("没有残留 aria-pressed（两套状态语义会互相打架）", sem.strayPressed === 0);
check("旧的 fieldset 外框已清零", sem.legacyFieldset === 0);

// —— 2. roving tabindex ——
console.log("\n【2. roving tabindex】");
const roving = await evaluate(`(() => {
  return [...document.querySelectorAll('[role="radiogroup"]')].map(g => {
    const items = [...g.querySelectorAll('[role="radio"]')];
    return {
      label: g.getAttribute('aria-label'),
      total: items.length,
      zeroTab: items.filter(r => r.tabIndex === 0).length,
      checked: items.filter(r => r.getAttribute('aria-checked') === 'true').length,
    };
  });
})()`);
for (const g of roving) {
  check(
    `「${g.label}」组内只有一个 Tab 停靠点`,
    g.zeroTab === 1,
    `${g.total} 档 / tabIndex=0 有 ${g.zeroTab} 个 / 选中 ${g.checked} 个`,
  );
}

// —— 3. Tab 只在整组停一次 ——
console.log("\n【3. Tab 遍历】");
const tabWalk = await evaluate(`(() => {
  const g = document.querySelector('[role="radiogroup"]');
  const first = g.querySelector('[role="radio"][tabindex="0"]') ?? g.querySelector('[role="radio"]');
  first.focus();
  return first.innerText.replace(/\\s+/g, ' ').trim().slice(0, 20);
})()`);
await key("Tab", "Tab", 9);
const afterTab = await evaluate(`(() => {
  const a = document.activeElement;
  return {
    inSameGroup: a.closest('[role="radiogroup"]') !== null && a.getAttribute('role') === 'radio',
    desc: (a.getAttribute('aria-label') || a.innerText || a.tagName).replace(/\\s+/g,' ').trim().slice(0, 24),
  };
})()`);
check(
  "从组内按 Tab 直接离开整组（不是逐档停靠）",
  !afterTab.inSameGroup,
  `起点「${tabWalk}」→ 落点「${afterTab.desc}」`,
);

// —— 4. 箭头键组内移动 + 环绕 ——
console.log("\n【4. 箭头键导航】");
const groupInfo = await evaluate(`(() => {
  const g = document.querySelector('[role="radiogroup"]');
  const items = [...g.querySelectorAll('[role="radio"]')];
  items[0].focus();
  return { label: g.getAttribute('aria-label'), count: items.length };
})()`);

async function checkedIndex() {
  return await evaluate(`(() => {
    const g = document.querySelector('[role="radiogroup"]');
    const items = [...g.querySelectorAll('[role="radio"]')];
    return {
      focused: items.findIndex(r => r === document.activeElement),
      checked: items.findIndex(r => r.getAttribute('aria-checked') === 'true'),
    };
  })()`);
}

await key("ArrowRight", "ArrowRight", 39);
const right1 = await checkedIndex();
check(
  "→ 焦点前进一档且即时选中（radiogroup 的自动激活）",
  right1.focused === 1 && right1.checked === 1,
  `焦点 idx=${right1.focused} / 选中 idx=${right1.checked}`,
);

await key("ArrowLeft", "ArrowLeft", 37);
const left1 = await checkedIndex();
check("← 退回上一档", left1.focused === 0 && left1.checked === 0);

await key("ArrowLeft", "ArrowLeft", 37);
const wrap = await checkedIndex();
check(
  "首档再按 ← 环绕到末档",
  wrap.focused === groupInfo.count - 1,
  `${groupInfo.count} 档，落到 idx=${wrap.focused}`,
);

await key("Home", "Home", 36);
const home = await checkedIndex();
check("Home 直达首档", home.focused === 0);

console.log(
  `\n汇总：${pass.filter(Boolean).length}/${pass.length} 通过`,
);
ws.close();

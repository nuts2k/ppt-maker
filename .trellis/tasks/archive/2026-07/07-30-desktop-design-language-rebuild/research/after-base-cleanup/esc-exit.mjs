/*
 * Esc 出口走查：焦点在「文字待确认」档的常驻 textarea 里按 Esc，
 * 焦点应交还给项外壳（li[tabindex="-1"]），而不是原地不动。
 *
 * 同时确认两件不该发生的事：
 *   - Esc 不该把该项退出「当前项」状态（它没有只读态可退，退了就等于丢失编辑位置）
 *   - Esc 之后 Tab 仍能继续走正常顺序（焦点真的交出去了，不是假 blur 到 body）
 *
 * 用法：node esc-exit.mjs
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

async function key(k, code, vk) {
  for (const type of ["keyDown", "keyUp"]) {
    await send("Input.dispatchKeyEvent", {
      type,
      key: k,
      code,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
    });
  }
  await new Promise((r) => setTimeout(r, 80));
}

const PROBE = `(() => {
  const a = document.activeElement;
  const li = a?.closest?.('li[tabindex="-1"]');
  return {
    tag: a?.tagName ?? 'null',
    onRow: li !== null && li !== undefined,
    block: li ? (li.innerText.match(/block-\\d+/) || ['-'])[0] : '-',
    isCurrentRow: li ? li.className.includes('border-border-strong') : false,
  };
})()`;

const pass = [];
function check(name, ok, detail) {
  pass.push(ok);
  console.log(`  ${ok ? "通过" : "失败"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// 先确保快捷键面板是关的：Esc 兼着关面板，开着会混淆判读
await key("Escape", "Escape", 27);

const focused = await evaluate(`(() => {
  const ta = document.querySelector('li[tabindex="-1"] textarea');
  if (!ta) return null;
  ta.focus();
  return document.activeElement === ta;
})()`);

if (focused !== true) {
  console.log("当前筛选下没有可编辑行，无法走查 Esc 出口");
  ws.close();
  process.exit(0);
}

const before = await evaluate(PROBE);
console.log(`\n起点：${before.tag} @ ${before.block}`);

await key("Escape", "Escape", 27);
const after = await evaluate(PROBE);

console.log("\n【Esc 出口】");
check(
  "焦点离开 textarea",
  after.tag !== "TEXTAREA",
  `${before.tag} → ${after.tag}`,
);
check(
  "焦点落在项外壳上（不是掉到 body，那样 Tab 会从头开始）",
  after.onRow,
  `落点 @ ${after.block}`,
);
check("仍是同一项", after.block === before.block);
check("该项仍是当前项（Esc 不该丢失编辑位置）", after.isCurrentRow);

// Esc 之后 Tab 应能继续走
await key("Tab", "Tab", 9);
const afterTab = await evaluate(PROBE);
check(
  "Esc 后 Tab 仍能继续推进",
  afterTab.block !== "-" || afterTab.tag !== "BODY",
  `落点 ${afterTab.tag} @ ${afterTab.block}`,
);

console.log(`\n汇总：${pass.filter(Boolean).length}/${pass.length} 通过`);
ws.close();

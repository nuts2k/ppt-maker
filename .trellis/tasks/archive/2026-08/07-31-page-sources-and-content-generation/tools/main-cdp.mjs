// 主进程 CDP：连 V8 inspector（5858），在 main 里执行 JS
// 用法：node main-cdp.mjs eval '<js>'
const PORT = process.env.MAIN_PORT || 5858;

async function pickTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  const list = await res.json();
  const t = list[0];
  if (!t) throw new Error("main inspector 没有目标");
  return t;
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: r, reject: j } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) j(new Error(JSON.stringify(msg.error)));
        else r(msg.result);
      }
    });
    ws.addEventListener("error", (e) => reject(new Error("ws error " + e.message)));
    ws.addEventListener("open", () =>
      resolve({
        send(method, params = {}) {
          return new Promise((r, j) => {
            const myId = ++id;
            pending.set(myId, { resolve: r, reject: j });
            ws.send(JSON.stringify({ id: myId, method, params }));
          });
        },
        close: () => ws.close(),
      }),
    );
  });
}

const [cmd, ...rest] = process.argv.slice(2);
const t = await pickTarget();
const cli = await connect(t.webSocketDebuggerUrl);
try {
  await cli.send("Runtime.enable");
  let expression;
  if (cmd === "eval") expression = rest.join(" ");
  else if (cmd === "evalfile") {
    const { readFileSync } = await import("node:fs");
    expression = readFileSync(rest[0], "utf8");
  } else throw new Error("未知命令");
  const result = await cli.send("Runtime.evaluate", {
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
    includeCommandLineAPI: true,
  });
  if (result.exceptionDetails) {
    console.error(
      "EXCEPTION: " +
        (result.exceptionDetails.exception?.description ??
          JSON.stringify(result.exceptionDetails)),
    );
    process.exit(1);
  }
  const v = result.result.value;
  console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
} finally {
  cli.close();
}

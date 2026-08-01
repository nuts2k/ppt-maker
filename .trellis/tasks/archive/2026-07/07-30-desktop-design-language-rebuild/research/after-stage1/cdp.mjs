// CDP 驱动工具：连上 Electron 渲染进程，跑表达式 / 截图。
// 用法：node cdp.mjs eval "<js表达式>"   |   node cdp.mjs shot <输出文件名>
import { writeFileSync } from "node:fs";

const CDP = "http://127.0.0.1:9222";

async function connect() {
  const list = await (await fetch(`${CDP}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("找不到渲染进程页面");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
    });
  return { send, close: () => ws.close() };
}

async function evaluate(send, expression) {
  const r = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error(
      r.exceptionDetails.exception?.description ?? JSON.stringify(r.exceptionDetails),
    );
  }
  return r.result?.value;
}

const [, , cmd, ...rest] = process.argv;
const { send, close } = await connect();
try {
  if (cmd === "eval") {
    console.log(JSON.stringify(await evaluate(send, rest.join(" ")), null, 2));
  } else if (cmd === "shot") {
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(rest[0], Buffer.from(data, "base64"));
    console.log(`已保存 ${rest[0]}`);
  } else {
    throw new Error("用法：cdp.mjs eval <表达式> | cdp.mjs shot <文件名>");
  }
} finally {
  close();
}

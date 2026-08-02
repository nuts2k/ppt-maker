// CDP 驱动：连接 Electron renderer，执行 JS / 截图 / 读文本
// 用法：
//   node cdp.mjs eval '<js 表达式，可 await>'
//   node cdp.mjs evalfile <path.js>
//   node cdp.mjs shot <out.png>
//   node cdp.mjs text            // 读 body innerText
//   node cdp.mjs targets

const PORT = process.env.CDP_PORT || 9222;

async function listTargets() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return await res.json();
}

async function pickPage() {
  const targets = await listTargets();
  const page = targets.find(
    (t) => t.type === "page" && !t.url.startsWith("devtools://"),
  );
  if (!page) throw new Error("没有找到 page 目标：" + JSON.stringify(targets, null, 2));
  return page;
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
    ws.addEventListener("open", () => {
      resolve({
        send(method, params = {}) {
          return new Promise((r, j) => {
            const myId = ++id;
            pending.set(myId, { resolve: r, reject: j });
            ws.send(JSON.stringify({ id: myId, method, params }));
          });
        },
        close: () => ws.close(),
      });
    });
  });
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "targets") {
    console.log(JSON.stringify(await listTargets(), null, 2));
    return;
  }
  const page = await pickPage();
  const cli = await connect(page.webSocketDebuggerUrl);
  try {
    if (cmd === "shot") {
      const out = rest[0];
      const { data } = await cli.send("Page.captureScreenshot", { format: "png" });
      const { writeFileSync } = await import("node:fs");
      writeFileSync(out, Buffer.from(data, "base64"));
      console.log("saved " + out);
      return;
    }
    let expression;
    if (cmd === "eval") expression = rest.join(" ");
    else if (cmd === "evalfile") {
      const { readFileSync } = await import("node:fs");
      expression = readFileSync(rest[0], "utf8");
    } else if (cmd === "text") {
      expression = "return document.body.innerText;";
    } else {
      throw new Error("未知命令: " + cmd);
    }
    const result = await cli.send("Runtime.evaluate", {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      console.error(
        "EXCEPTION: " +
          JSON.stringify(
            result.exceptionDetails.exception?.description ||
              result.exceptionDetails,
            null,
            2,
          ),
      );
      process.exit(1);
    }
    const v = result.result.value;
    console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));
  } finally {
    cli.close();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

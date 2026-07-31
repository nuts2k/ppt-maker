// 注入 40 页合成数据到 renderer 内存，用于验 AC10 的 20–50 页密度。
// 只写 store，不碰磁盘、不跑流水线，因此零 gpt-image-2 调用。
// 测完调 refreshStatus() 即可还原为真实的 2 页。
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

const expr = `(async () => {
  const d = await import('/stores/deck-store.ts');
  const store = d.useDeckStore.getState();
  const base = store.slides[0];
  if (!base) return { error: '需要先打开一个 deck' };

  const STAGES = base.stages.map(s => s.stage);
  // 九个阶段的完成边界 -> 用来构造「停在第 N 步」的页
  const mk = (i) => {
    const n = i + 1;
    // 分布：4 失败、3 失效、2 执行中、15 待人工（停在复核/确认）、16 已完成
    let stages, lastError = null, pendingTextReview = 0, stageStatus = 'completed';
    if (n % 10 === 3) {                       // 失败
      stages = STAGES.map((s, k) => ({ stage: s, status: k < 4 ? 'completed' : k === 4 ? 'failed' : 'pending' }));
      lastError = { code: 'CLEAN_PLATE_TIMEOUT', message: '干净底图生成超时，需重跑', stage: STAGES[4], at: '2026-07-30T12:00:00Z' };
      stageStatus = 'failed';
    } else if (n % 10 === 6) {                // 失效
      stages = STAGES.map((s, k) => ({ stage: s, status: k < 3 ? 'completed' : k === 3 ? 'stale' : 'pending' }));
      stageStatus = 'stale';
    } else if (n % 20 === 8) {                // 执行中
      stages = STAGES.map((s, k) => ({ stage: s, status: k < 5 ? 'completed' : k === 5 ? 'running' : 'pending' }));
      stageStatus = 'running';
    } else if (n % 3 === 1) {                 // 待文本复核
      stages = STAGES.map((s, k) => ({ stage: s, status: k < 3 ? 'completed' : 'pending' }));
      pendingTextReview = 5 + (n % 7);
      stageStatus = 'completed';
    } else {                                  // 全部完成
      stages = STAGES.map(s => ({ stage: s, status: 'completed' }));
    }
    return {
      ...base,
      slideId: 'synthetic-' + String(n).padStart(2, '0'),
      pageLabel: 'page-' + String(n).padStart(2, '0'),
      stages,
      lastError,
      pendingTextReview,
      stageStatus,
      currentStage: STAGES[Math.max(0, stages.findIndex(s => s.status !== 'completed'))] ?? STAGES[STAGES.length - 1],
    };
  };

  const slides = Array.from({ length: 40 }, (_, i) => mk(i));
  d.useDeckStore.setState({
    slides,
    summary: {
      active: 40,
      completed: slides.filter(s => s.stages.every(x => x.status === 'completed')).length,
      inProgress: slides.filter(s => s.stageStatus === 'running').length,
      notStarted: 0,
    },
  });
  return { injected: slides.length };
})()`;

const r = await send("Runtime.evaluate", {
  expression: expr,
  awaitPromise: true,
  returnByValue: true,
});
console.log(JSON.stringify(r.result?.value ?? r.exceptionDetails?.exception?.description));
ws.close();

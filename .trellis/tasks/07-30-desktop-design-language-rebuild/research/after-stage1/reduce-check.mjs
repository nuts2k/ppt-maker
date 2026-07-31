// 必须在同一 CDP 会话内完成「设模拟 → 查询」：setEmulatedMedia 随会话关闭而失效。
const CDP="http://127.0.0.1:9222";
const l=await (await fetch(`${CDP}/json/list`)).json();
const p=l.find(t=>t.type==="page");
const ws=new WebSocket(p.webSocketDebuggerUrl);
await new Promise(r=>{ws.onopen=r});
let id=0;const pend=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);}};
const send=(m,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method:m,params}))});

const probe = `(() => {
  const dot = [...document.querySelectorAll('[title*="执行中"]')][0];
  const moving = [...document.querySelectorAll('*')].filter(el => {
    const cs = getComputedStyle(el);
    const pos = (s) => s.split(',').some(v => parseFloat(v) > 0.05);
    return (cs.animationName !== 'none' && pos(cs.animationDuration)) || pos(cs.transitionDuration);
  }).length;
  const c = dot ? getComputedStyle(dot) : null;
  return {
    减弱动效生效: matchMedia('(prefers-reduced-motion: reduce)').matches,
    仍在动的元素数: moving,
    执行中点: c ? { 动画时长: c.animationDuration, 光环: c.boxShadow === 'none' ? '无' : c.boxShadow.slice(0, 46) } : '未找到',
  };
})()`;

for (const [label, value] of [["常规", "no-preference"], ["减弱动效", "reduce"]]) {
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value }],
  });
  await new Promise(r => setTimeout(r, 300));
  const r = await send("Runtime.evaluate", { expression: probe, returnByValue: true });
  console.log(`── ${label} ──`);
  console.log(JSON.stringify(r.result.value, null, 2));
}
// 还原，避免把模拟状态留给后续截图
await send("Emulation.setEmulatedMedia", { features: [] });
ws.close();

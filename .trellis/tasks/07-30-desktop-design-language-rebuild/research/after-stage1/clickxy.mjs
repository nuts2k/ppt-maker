const CDP="http://127.0.0.1:9222";
const l=await (await fetch(`${CDP}/json/list`)).json();
const p=l.find(t=>t.type==="page");
const ws=new WebSocket(p.webSocketDebuggerUrl);
await new Promise(r=>{ws.onopen=r});
let id=0;const pend=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m.result);pend.delete(m.id);}};
const send=(method,params={})=>new Promise(res=>{const i=++id;pend.set(i,res);ws.send(JSON.stringify({id:i,method,params}))});
const [x,y]=[Number(process.argv[2]),Number(process.argv[3])];
for(const type of ["mousePressed","mouseReleased"])
  await send("Input.dispatchMouseEvent",{type,x,y,button:"left",clickCount:1});
console.log(`已点击 (${x}, ${y})`);
ws.close();

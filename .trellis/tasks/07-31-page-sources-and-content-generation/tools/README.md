# 桌面端走查工具

子任务④ 的 U1–U13 真机走查（2026-08-02）用的那一套，原样留给阶段三。
**这不是产品代码**，不参与构建与测试，只是走查脚手架。

## 起环境

```bash
.trellis/tasks/07-31-page-sources-and-content-generation/tools/restart.sh
```

单实例重启 `pnpm desktop`，renderer 调试口 9222、main 调试口 5858，并把选择框桩
打进主进程。**每次改了 renderer 代码想重新走查，都重跑它**（HMR 可能留下半新半旧的
组件状态，重启最省事）。日志在 `/tmp/ppt-maker-desktop-dev.log`。

## 驱动界面

```bash
cd .trellis/tasks/07-31-page-sources-and-content-generation/tools

node cdp.mjs text                          # 读 body innerText，最常用
node cdp.mjs shot /tmp/x.png               # 截 renderer（不受窗口是否可见影响）
node cdp.mjs eval 'return document.title;' # 表达式**必须自带 return**
node main-cdp.mjs eval 'return 1+1;'       # 同样，但跑在主进程里
```

`eval` 的内容被包进 `(async () => { … })()`，所以可以直接 `await`。点按钮一律按文案找：

```js
[...document.querySelectorAll("button")].find(x => x.textContent.trim() === "添加页面").click();
```

dev 模式下 vite 按原路径提供模块且是单例，可以直接拿到界面正在用的那个 store：

```js
const m = await import("/stores/deck-store.ts");
return m.useDeckStore.getState().deckPath;
```

## 喂原生对话框

`patch-dialog.js` 已由 `restart.sh` 注入，两个队列都在主进程的 `globalThis.__wt`：

```bash
# 下一次「选择…」返回这个路径（目录框给目录，文件框给文件；多选给多个）
node main-cdp.mjs eval 'globalThis.__wt.openQueue.push(["/Users/kelin/test/x.pdf"]); return "ok";'

# 下一次确认框按第几个按钮（0 = 确认，1 = 取消）；队列空时一律按取消
node main-cdp.mjs eval 'globalThis.__wt.boxQueue.push(0); return "ok";'

# 看所有被拦到的对话框及其完整选项（U13 那种「框里写了什么」的取证靠它）
node main-cdp.mjs eval 'return JSON.stringify(globalThis.__wt.log, null, 1);'
```

**为什么要打桩而不是真的去点**（本机实测，2026-08-02）：

- osascript 能读 UI、能 AXPress 点击，但 **`keystroke` 被拒**（错误 1002），
  于是原生文件框里没法用 ⌘⇧G 输入路径。
- **屏幕一锁全部失效**：截图全黑、`count of windows` 为 0；更糟的是此时弹原生
  `showMessageBox` 会把 main **卡在嵌套 run loop** 里，连 9222 的 HTTP 端点都不响应，
  只能 `kill -9`。走查跑得久，锁屏几乎必然发生。

打桩换掉的只是「用户在 Finder 里点哪个文件」和「用户按了确认还是取消」，
**调用本身没有被绕过**：`showMessageBox` 确实在发起生成之前被调用，按取消确实一页都不生成。
唯一拿不到的是那个框在屏幕上的样子——要补这一眼，得在屏幕解锁时人工点一次。

## 比对「其它页零变化」

```bash
tools/snap.sh ~/test/some-deck /tmp/before.txt
# …做换源 / 追加…
tools/snap.sh ~/test/some-deck /tmp/after.txt
diff /tmp/before.txt /tmp/after.txt
```

逐页状态 + 每页目录内容指纹一起比。只比 `deck status` 的字段不够——A3 问的是
「已确认产物有没有被动过」，那要靠 shasum。（`snap.sh` 走 `apps/cli/dist`，
先 `pnpm --filter @ppt-maker/cli build`。）

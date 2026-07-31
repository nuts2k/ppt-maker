// OKLCH → sRGB hex + WCAG 对比度验算。
// PRD AC6 要求逐组合验算，不靠肉眼。

const clamp01 = (n) => Math.min(1, Math.max(0, n));

function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;

  const lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const gamma = (u) =>
    u <= 0.0031308 ? 12.92 * u : 1.055 * Math.abs(u) ** (1 / 2.4) - 0.055;

  return [gamma(lr), gamma(lg), gamma(lb)].map(clamp01);
}

const toHex = (rgb) =>
  "#" + rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");

// WCAG 相对亮度用线性化的 sRGB 分量
function luminance(rgb) {
  const [r, g, b] = rgb.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// ── 校样台调色板（Restrained，亮色）────────────────────────────
// 中性阶一律 chroma 0：真中性白，不是奶油/米色。
const T = {
  canvas:          [1.000, 0,     0],
  surface:         [0.976, 0,     0],
  "surface-sunken":[0.945, 0,     0],
  // hairline 只做装饰性分隔，不承担 WCAG 1.4.11 的 3:1 责任
  hairline:        [0.902, 0,     0],
  // border 是控件边界（输入框、次级按钮），必须 ≥3:1
  border:          [0.640, 0,     0],
  "border-strong": [0.520, 0,     0],
  // 焦点环：墨色 + 2px 白色 offset，任何浅色面上都远超 3:1
  focus:           [0.220, 0,     0],

  ink:             [0.220, 0,     0],
  // 近黑按钮的 hover 应当变亮、按压才变暗；反过来在深色上几乎看不出变化
  "ink-hover":     [0.300, 0,     0],
  "ink-pressed":   [0.120, 0,     0],
  "ink-secondary": [0.440, 0,     0],
  "ink-muted":     [0.530, 0,     0],

  // 校对红 —— 全屏唯一高饱和色，只标「差异」与「待我处理」
  "proof":         [0.520, 0.190, 25],
  "proof-hover":   [0.575, 0.190, 25],
  "proof-strong":  [0.430, 0.170, 25],
  "proof-wash":    [0.960, 0.022, 25],

  // 状态语义（与品牌色彻底分离）
  "state-running": [0.500, 0.150, 250],
  "state-stale":   [0.520, 0.120, 75],
  "state-failed":  [0.450, 0.170, 15],
};

const rgb = Object.fromEntries(
  Object.entries(T).map(([k, v]) => [k, oklchToRgb(...v)]),
);

console.log("令牌\t\tOKLCH\t\t\tHEX");
for (const [k, v] of Object.entries(T)) {
  console.log(`${k.padEnd(16)}oklch(${v[0]} ${v[1]} ${v[2]})`.padEnd(48) + toHex(rgb[k]));
}

// ── 对比度验算 ────────────────────────────────────────────────
const PAIRS = [
  ["ink", "canvas", 4.5, "正文 / 纸"],
  ["ink", "surface", 4.5, "正文 / 面板"],
  ["ink", "surface-sunken", 4.5, "正文 / 凹陷面"],
  ["ink-secondary", "canvas", 4.5, "次要文字 / 纸"],
  ["ink-secondary", "surface", 4.5, "次要文字 / 面板"],
  ["ink-muted", "canvas", 4.5, "弱化文字+占位符 / 纸"],
  ["ink-muted", "surface", 4.5, "弱化文字 / 面板"],
  ["proof", "canvas", 4.5, "校对红文字 / 纸"],
  ["proof", "proof-wash", 4.5, "校对红文字 / 校对红淡底"],
  ["proof-strong", "canvas", 4.5, "校对红加深 / 纸"],
  ["state-running", "canvas", 4.5, "进行中文字 / 纸"],
  ["state-stale", "canvas", 4.5, "失效文字 / 纸"],
  ["state-failed", "canvas", 4.5, "失败文字 / 纸"],
  ["focus", "canvas", 3.0, "焦点环 / 纸"],
  ["focus", "surface", 3.0, "焦点环 / 面板"],
  ["focus", "surface-sunken", 3.0, "焦点环 / 凹陷面"],
  ["border", "canvas", 3.0, "控件边框 / 纸"],
  ["border", "surface", 3.0, "控件边框 / 面板"],
  ["border-strong", "canvas", 3.0, "强边框 / 纸"],
  ["state-running", "canvas", 3.0, "进行中状态点 / 纸"],
  ["state-stale", "canvas", 3.0, "失效状态点 / 纸"],
  ["proof", "surface", 3.0, "校对红状态点 / 面板"],
];

console.log("\n验算（阈值 4.5 = 正文，3.0 = 大字/非文本）");
let fail = 0;
for (const [fg, bg, min, label] of PAIRS) {
  const r = contrast(rgb[fg], rgb[bg]);
  const ok = r >= min;
  if (!ok) fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(6)} : 1  (需 ${min})  ${label}`,
  );
}

// 反白：墨底上的白字
const white = [1, 1, 1];
for (const [bg, min, label] of [
  ["ink", 4.5, "白字 / 墨底(主按钮)"],
  ["ink-hover", 4.5, "白字 / 墨底 hover"],
  ["ink-pressed", 4.5, "白字 / 墨底按压"],
  ["proof", 4.5, "白字 / 校对红底"],
  ["proof-hover", 4.5, "白字 / 校对红 hover"],
  ["proof-strong", 4.5, "白字 / 校对红按压"],
  ["state-failed", 4.5, "白字 / 失败底"],
]) {
  const r = contrast(white, rgb[bg]);
  const ok = r >= min;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${r.toFixed(2).padStart(6)} : 1  (需 ${min})  ${label}`);
}

console.log(`\n${fail === 0 ? "全部通过" : `${fail} 项不达标`}`);

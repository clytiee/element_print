// 预览页：读 payload → 渲染 → 版式设置（即时生效）→ 打印 / 导出单文件 HTML

import {
  DEFAULT_SETTINGS,
  THEME_PRESETS,
  MARGIN_PRESETS,
  FONT_PRESETS,
  loadSettings,
  saveSettings,
} from "../shared/settings.js";

const params = new URLSearchParams(location.search);
const payloadId = params.get("id") || "";
const STORAGE_KEY = "ep:payload:" + payloadId;

const $ = (id) => document.getElementById(id);

const state = {
  settings: { ...DEFAULT_SETTINGS },
  payload: null,
  lang: "zh",
  ready: false,
};

/* ---------- 工具 ---------- */

function pad(n) {
  return String(n).padStart(2, "0");
}

function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function esc(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeFileName(title) {
  const base = String(title || "element-print")
    .replace(/\s+/g, " ")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim()
    .slice(0, 60);
  return base || "element-print";
}

/* ---------- 渲染 ---------- */

const BLOCKISH = new Set([
  "P", "DIV", "SECTION", "ARTICLE", "LI", "UL", "OL", "TD", "TH", "TR",
  "BLOCKQUOTE", "FIGURE", "FIGCAPTION", "HEADER", "FOOTER", "PRE", "TABLE",
  "DL", "DD", "DT", "H1", "H2", "H3", "H4", "H5", "H6", "IMG", "HR",
  "ASIDE", "MAIN", "NAV", "FORM", "FIELDSET",
]);

function hasBlockChild(node) {
  return Array.from(node.children).some((child) => BLOCKISH.has(child.tagName));
}

// 段落开头已经手打了 2 字空格（两个全角，或四个半角）的不再加 CSS 缩进
function hasManualIndent(node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (!first || !first.data) return false;
  const lead = first.data.match(/^[\s\u3000]*/)[0];
  if (!lead) return false;
  // 源码换行带来的排版空白不算，只取最后一个换行之后连续的空格
  const tail = lead.split(/[\n\r\t]/).pop() || "";
  const wide = (tail.match(/\u3000/g) || []).length;
  const narrow = (tail.match(/ /g) || []).length;
  return wide + narrow / 2 >= 1.5;
}

// 把「只装文字、没有块级子节点」的 div/section 标成段落，
// 否则这些站点的正文不吃首行缩进（它们的段落不是 <p>）
function markParagraphs(root) {
  root.querySelectorAll("p, div, section, article, dd").forEach((node) => {
    const isTextBlock = node.tagName === "P" || !hasBlockChild(node);
    if (!isTextBlock || !node.textContent.trim()) return;
    if (node.tagName !== "P") node.classList.add("ep-para");
    if (hasManualIndent(node)) node.classList.add("ep-no-indent");
  });
}

// 正文以拉丁字母为主时按西文规则排版（不缩进、靠段间距分段、允许断词）
function detectLang(root) {
  const text = (root.textContent || "").slice(0, 20000);
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  if (!cjk && !latin) return "zh";
  return latin / (latin + cjk) > 0.65 ? "en" : "zh";
}

function setSheetLang(lang) {
  const sheet = $("sheet");
  sheet.dataset.lang = lang;
  if (lang === "en") sheet.setAttribute("lang", "en");
  else sheet.setAttribute("lang", "zh-CN");
}

function showError(text) {
  $("error").textContent = text;
  $("error").hidden = false;
  $("sheetWrap").hidden = true;
  $("printBtn").disabled = true;
  $("exportBtn").disabled = true;
}

function siteNameOf(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || "网页";
  } catch (e) {
    return "网页";
  }
}

function render(payload) {
  document.title = payload.title + " · Element Print";
  $("title").textContent = payload.title;
  $("body").innerHTML = payload.html;
  markParagraphs($("body"));
  state.lang = detectLang($("body"));
  setSheetLang(state.lang);

  const link = $("siteLink");
  link.textContent = siteNameOf(payload.sourceUrl);
  link.href = payload.sourceUrl;

  const url = $("metaUrl");
  url.textContent = payload.sourceUrl;
  url.href = payload.sourceUrl;
  $("metaTime").textContent = fmtTime(payload.createdAt);
}

/* ---------- @page（含页边距盒里的页眉页脚与页码） ---------- */

function cssString(text) {
  return '"' + String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function labelText(node) {
  return ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
}

const GUTTER_FONT = '"EP Plex Sans", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

function buildPageRule(s) {
  const head = $("pageHead");
  const brand = labelText(head && head.querySelector(".ep-gutter__title")) || "Element Print";
  const src = labelText($("pageSource"));


  // 左右两块各占 50%，边框拼成一条整线（页边距盒不能跨盒连画）
  const top =
    `font-family:${GUTTER_FONT};font-size:8pt;width:50%;vertical-align:bottom;` +
    `padding:0 0 1.2mm;margin:0 0 6mm;border-bottom:0.5pt solid #c9ccd1;`;
  const bottom =
    `font-family:${GUTTER_FONT};font-size:8pt;width:50%;vertical-align:top;` +
    `padding:1.2mm 0 0;margin:4mm 0 0;border-top:0.5pt solid #c9ccd1;`;

  const headBoxes = s.showHeader === false
    ? ""
    : `@top-left{content:${cssString(brand)};${top}text-align:left;font-weight:500;letter-spacing:.06em;color:#4a4f57;}` +
      `@top-right{content:${cssString(src)};${top}text-align:right;color:#6b6b6b;}`;
  // 页码在页脚右侧，关掉页脚时页码一起不出现
  const footBoxes = s.showFooter === false
    ? ""
    : `@bottom-left{content:${cssString(brand)};${bottom}text-align:left;color:#6b6b6b;}` +
      `@bottom-right{content:counter(page) " / " counter(pages);${bottom}text-align:right;color:#6b6b6b;font-variant-numeric:tabular-nums;}`;

  return (
    `@page{size:A4;margin:${s.marginTop}mm ${s.marginRight}mm ${s.marginBottom}mm ${s.marginLeft}mm;` +
    headBoxes +
    footBoxes +
    `}`
  );
}

/* ---------- 版式 ---------- */

// 正文字体栈：选了「自动」且正文是西文时，换成纯拉丁衬线，不挂中文兜底
function bodyFontStack(key, lang) {
  const preset = FONT_PRESETS[key] || FONT_PRESETS.auto;
  if (key === "auto" && lang === "en") {
    return '"Times New Roman", Georgia, "Liberation Serif", serif';
  }
  return preset.stack;
}

// 标题字体：「继承（跟随正文）」时直接复用正文栈
function titleFontStack(s, lang) {
  if (!s.titleFont || s.titleFont === "inherit") return bodyFontStack(s.bodyFont, lang);
  return (FONT_PRESETS[s.titleFont] || FONT_PRESETS.auto).stack;
}

function applySettings() {
  const s = state.settings;
  const root = document.documentElement;

  root.style.setProperty("--ep-font-size", s.fontSize + "pt");
  root.style.setProperty("--ep-title-size", s.titleSize + "pt");
  root.style.setProperty(
    "--ep-line-height",
    s.lineHeightMode === "fixed" ? s.lineHeightFixed + "pt" : String(s.lineHeight)
  );
  root.style.setProperty("--ep-para-before", s.paraBefore + "px");
  root.style.setProperty("--ep-para-after", s.paraAfter + "px");
  root.style.setProperty("--ep-columns", s.columns === 2 ? "2" : "1");
  root.style.setProperty("--ep-indent", s.indent + "em");
  root.style.setProperty("--ep-mt", s.marginTop + "mm");
  root.style.setProperty("--ep-mr", s.marginRight + "mm");
  root.style.setProperty("--ep-mb", s.marginBottom + "mm");
  root.style.setProperty("--ep-ml", s.marginLeft + "mm");

  $("sheet").dataset.theme = s.theme || "paper";
  $("sheet").classList.toggle("is-span-head", Boolean(s.spanHead));

  root.style.setProperty("--ep-body-font", bodyFontStack(s.bodyFont, state.lang));
  root.style.setProperty("--ep-title-font", titleFontStack(s, state.lang));

  $("pageHead").hidden = s.showHeader === false;
  $("pageFoot").hidden = s.showFooter === false;

  $("pageRule").textContent = buildPageRule(s);

  $("metaUrl").hidden = !s.showUrl;
  $("metaTime").hidden = !s.showTime;
  $("meta").hidden = !s.showUrl && !s.showTime;

  fit();
}

function syncControls() {
  const s = state.settings;
  const fixedLine = s.lineHeightMode === "fixed";

  $("bodyFont").value = s.bodyFont || "auto";
  $("titleFont").value = s.titleFont || "inherit";
  $("fontSize").value = String(s.fontSize);
  $("titleSize").value = String(s.titleSize);

  // 行距滑块在两种模式间换量程、步长与单位
  const lh = $("lineHeight");
  lh.min = fixedLine ? "10" : "1.2";
  lh.max = fixedLine ? "40" : "2.4";
  lh.step = fixedLine ? "0.5" : "0.05";
  lh.value = String(fixedLine ? s.lineHeightFixed : s.lineHeight);

  $("paraBefore").value = String(s.paraBefore);
  $("paraAfter").value = String(s.paraAfter);
  $("indent").value = String(s.indent);
  $("marginTop").value = String(s.marginTop);
  $("marginRight").value = String(s.marginRight);
  $("marginBottom").value = String(s.marginBottom);
  $("marginLeft").value = String(s.marginLeft);

  $("showUrl").checked = s.showUrl;
  $("showTime").checked = s.showTime;
  $("spanHead").checked = Boolean(s.spanHead);
  $("showHeader").checked = s.showHeader !== false;
  $("showFooter").checked = s.showFooter !== false;

  $("vFontSize").textContent = s.fontSize + "pt";
  $("vTitleSize").textContent = s.titleSize + "pt";
  $("vLineHeight").textContent = fixedLine ? s.lineHeightFixed + "pt" : s.lineHeight.toFixed(2) + "×";
  $("vParaBefore").textContent = s.paraBefore + "px";
  $("vParaAfter").textContent = s.paraAfter + "px";
  $("vIndent").textContent = s.indent === 0 ? "无" : s.indent + " 字";
  $("vMarginTop").textContent = s.marginTop + "mm";
  $("vMarginRight").textContent = s.marginRight + "mm";
  $("vMarginBottom").textContent = s.marginBottom + "mm";
  $("vMarginLeft").textContent = s.marginLeft + "mm";

  // 四边正好等于某个预置时，对应胶囊高亮
  const activePreset = Object.keys(MARGIN_PRESETS).find((key) => {
    const p = MARGIN_PRESETS[key];
    return (
      p.marginTop === s.marginTop &&
      p.marginRight === s.marginRight &&
      p.marginBottom === s.marginBottom &&
      p.marginLeft === s.marginLeft
    );
  });
  Array.from($("segMarginPreset").querySelectorAll("button")).forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.value === activePreset);
  });

  Array.from($("segColumns").querySelectorAll("button")).forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.value) === s.columns);
  });

  Array.from($("segTheme").querySelectorAll("button")).forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.value === (s.theme || "paper"));
  });

  Array.from($("segLineMode").querySelectorAll("button")).forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.value === (s.lineHeightMode || "ratio"));
  });
}

let fitFrame = 0;

function fit() {
  if (fitFrame) cancelAnimationFrame(fitFrame);
  fitFrame = requestAnimationFrame(() => {
    fitFrame = 0;
    const vp = $("viewport");
    const wrap = $("sheetWrap");
    const sheet = $("sheet");
    if (!vp || !sheet) return;

    const sheetW = sheet.offsetWidth || 794;
    const sheetH = sheet.offsetHeight || 1123;
    const availW = vp.clientWidth - 64;
    const scale = Math.max(0.4, Math.min(1, availW / sheetW));

    document.documentElement.style.setProperty("--ep-scale", scale.toFixed(3));
    wrap.style.width = Math.round(sheetW * scale) + "px";
    wrap.style.height = Math.round(sheetH * scale) + "px";
  });
}

/* ---------- 编辑 ---------- */

let editing = false;

function setEditing(on) {
  if (on && trimming) setTrimming(false);
  editing = on;
  [ $("title"), $("body"), $("pageHead"), $("pageFoot") ].forEach((node) => {
    node.contentEditable = on ? "true" : "false";
    node.spellcheck = false;
  });
  $("sheet").classList.toggle("is-editing", on);
  $("editBtn").textContent = on ? "完成" : "编辑";
  $("editBtn").classList.toggle("is-on", on);
  if (!on && document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
  if (!on && state.settings) $("pageRule").textContent = buildPageRule(state.settings);
  fit();
}

/* ---------- 删减 ---------- */

const TRIM_BLOCKS = new Set([
  "DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "UL", "OL",
  "FIGURE", "FIGCAPTION", "TABLE", "BLOCKQUOTE", "PRE", "IMG",
  "SECTION", "ARTICLE", "HEADER", "FOOTER", "ADDRESS", "DL", "DT", "DD", "HR",
]);

const HINT_TEXT = $("hintText").textContent;

let trimming = false;
let trimHover = null;

// 从指针下的节点往上找最近的内容块（不算正文容器本身）
function trimTarget(node) {
  const body = $("body");
  let cur = node && node.nodeType === 1 ? node : null;
  while (cur && cur !== body) {
    if (TRIM_BLOCKS.has(cur.tagName)) return cur;
    cur = cur.parentElement;
  }
  return null;
}

function clearTrimHover() {
  if (trimHover) trimHover.classList.remove("ep-trim-hover");
  trimHover = null;
}

function onTrimMove(e) {
  const target = trimTarget(e.target);
  if (target === trimHover) return;
  clearTrimHover();
  if (target) {
    trimHover = target;
    target.classList.add("ep-trim-hover");
  }
}

function onTrimClick(e) {
  const target = trimTarget(e.target);
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  clearTrimHover();
  target.remove();
  fit();
}

function setTrimming(on) {
  if (on && editing) setEditing(false);
  trimming = on;
  const body = $("body");
  body.classList.toggle("is-trimming", on);
  $("trimBtn").classList.toggle("is-on", on);
  $("trimBtn").textContent = on ? "退出删减" : "删减";
  $("hintText").textContent = on ? "点击要删除的块 · Esc 退出删减" : HINT_TEXT;
  if (on) {
    body.addEventListener("mousemove", onTrimMove);
    body.addEventListener("click", onTrimClick, true);
  } else {
    body.removeEventListener("mousemove", onTrimMove);
    body.removeEventListener("click", onTrimClick, true);
    clearTrimHover();
  }
}

/* ---------- 有无图 ---------- */

let hideImages = false;

function setImagesHidden(on) {
  hideImages = on;
  $("sheet").classList.toggle("is-noimg", on);
  $("imgBtn").classList.toggle("is-on", on);
  $("imgBtn").textContent = on ? "无图" : "有图";
  fit();
}

/* ---------- 交互 ---------- */

function update(patch) {
  state.settings = { ...state.settings, ...patch };
  syncControls();
  applySettings();
  saveSettings(state.settings);
}

// 切版式：整套参数按该版式的推荐值重置，之后仍可单项微调
function switchTheme(theme) {
  const preset = THEME_PRESETS[theme];
  if (!preset) return;
  state.settings = { ...preset };
  syncControls();
  applySettings();
  saveSettings(state.settings);
}

function bindControls() {
  $("segTheme").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    switchTheme(btn.dataset.value);
  });
  $("segColumns").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    update({ columns: Number(btn.dataset.value) });
  });

  $("segLineMode").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn || btn.dataset.value === state.settings.lineHeightMode) return;
    update({ lineHeightMode: btn.dataset.value });
  });

  $("fontSize").addEventListener("input", (e) => update({ fontSize: Number(e.target.value) }));
  $("bodyFont").addEventListener("change", (e) => update({ bodyFont: e.target.value }));
  $("titleFont").addEventListener("change", (e) => update({ titleFont: e.target.value }));
  $("titleSize").addEventListener("input", (e) => update({ titleSize: Number(e.target.value) }));
  $("lineHeight").addEventListener("input", (e) => {
    const value = Number(e.target.value);
    update(
      state.settings.lineHeightMode === "fixed"
        ? { lineHeightFixed: value }
        : { lineHeight: value }
    );
  });
  $("paraBefore").addEventListener("input", (e) => update({ paraBefore: Number(e.target.value) }));
  $("paraAfter").addEventListener("input", (e) => update({ paraAfter: Number(e.target.value) }));
  $("indent").addEventListener("input", (e) => update({ indent: Number(e.target.value) }));

  $("segMarginPreset").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    const preset = MARGIN_PRESETS[btn.dataset.value];
    if (preset) update({ ...preset });
  });

  ["marginTop", "marginRight", "marginBottom", "marginLeft"].forEach((key) => {
    $(key).addEventListener("input", (e) => update({ [key]: Number(e.target.value) }));
  });

  $("showUrl").addEventListener("change", (e) => update({ showUrl: e.target.checked }));
  $("showTime").addEventListener("change", (e) => update({ showTime: e.target.checked }));
  $("spanHead").addEventListener("change", (e) => update({ spanHead: e.target.checked }));
  $("showHeader").addEventListener("change", (e) => update({ showHeader: e.target.checked }));
  $("showFooter").addEventListener("change", (e) => update({ showFooter: e.target.checked }));

  $("resetBtn").addEventListener("click", () => {
    switchTheme(state.settings.theme || "paper");
  });

  $("printBtn").addEventListener("click", () => {
    clearTrimHover();
    window.print();
  });

  // 打印前重建 @page，确保页眉里改过的文字进到页边距盒
  window.addEventListener("beforeprint", () => {
    if (state.settings) $("pageRule").textContent = buildPageRule(state.settings);
  });
  $("exportBtn").addEventListener("click", () => {
    exportHtml().catch((err) => showError("导出失败：" + ((err && err.message) || err)));
  });

  $("editBtn").addEventListener("click", () => setEditing(!editing));
  $("trimBtn").addEventListener("click", () => setTrimming(!trimming));
  $("imgBtn").addEventListener("click", () => setImagesHidden(!hideImages));

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && trimming) {
      e.preventDefault();
      setTrimming(false);
    }
  });

  window.addEventListener("resize", fit);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fit).catch(() => {});
  }
}

/* ---------- 导出单文件 HTML ---------- */

// 导出成单文件时字体要内联成 data URL，否则相对路径在本地文件里失效
async function inlineFontFaces() {
  try {
    const url = chrome.runtime.getURL("src/assets/fonts/ibm-plex-sans-latin.woff2");
    const bytes = new Uint8Array(await fetch(url).then((res) => res.arrayBuffer()));
    let bin = "";
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    const src = `url(data:font/woff2;base64,${btoa(bin)}) format("woff2")`;
    return (
      `@font-face{font-family:"EP Plex Sans";font-style:normal;font-weight:400;font-display:swap;src:${src}}\n` +
      `@font-face{font-family:"EP Plex Sans";font-style:normal;font-weight:500;font-display:swap;src:${src}}`
    );
  } catch (e) {
    return "";
  }
}

async function buildExportHtml() {
  const s = state.settings;
  const cssPaths = ["src/shared/article.css", "src/shared/themes/academic.css"];
  const css = (
    await Promise.all(
      cssPaths.map((path) => fetch(chrome.runtime.getURL(path)).then((res) => res.text()))
    )
  ).join("\n");
  const fontFaces = await inlineFontFaces();
  const vars = [
    `--ep-font-size:${s.fontSize}pt`,
    `--ep-title-size:${s.titleSize}pt`,
    `--ep-line-height:${s.lineHeightMode === "fixed" ? s.lineHeightFixed + "pt" : s.lineHeight}`,
    `--ep-para-before:${s.paraBefore}px`,
    `--ep-para-after:${s.paraAfter}px`,
    `--ep-columns:${s.columns === 2 ? 2 : 1}`,
    `--ep-indent:${s.indent}em`,
    `--ep-body-font:${bodyFontStack(s.bodyFont, state.lang)}`,
    `--ep-title-font:${titleFontStack(s, state.lang)}`,
    `--ep-mt:${s.marginTop}mm`,
    `--ep-mr:${s.marginRight}mm`,
    `--ep-mb:${s.marginBottom}mm`,
    `--ep-ml:${s.marginLeft}mm`,
  ].join(";");

  const sheetCopy = $("sheet").cloneNode(true);
  sheetCopy.classList.remove("is-editing");
  sheetCopy.querySelectorAll(".ep-trim-hover, .is-trimming").forEach((node) => {
    node.classList.remove("ep-trim-hover");
    node.classList.remove("is-trimming");
  });
  sheetCopy.querySelectorAll("[contenteditable]").forEach((node) => {
    node.removeAttribute("contenteditable");
    node.removeAttribute("spellcheck");
  });
  const sheetHtml = sheetCopy.innerHTML;
  const title = state.payload ? state.payload.title : "Element Print";

  return `<!DOCTYPE html>
<html lang="${state.lang === "en" ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
${css}
${fontFaces}
:root{${vars};--ep-scale:1}
body{margin:0;background:#fff}
.ep-sheet{margin:0 auto}
${buildPageRule(s)}
@media screen{body{padding:24px}}
@media print{body{padding:0}}
</style>
</head>
<body>
<div class="ep-sheet${s.spanHead ? " is-span-head" : ""}" data-theme="${s.theme || "paper"}" data-lang="${state.lang}" lang="${state.lang === "en" ? "en" : "zh-CN"}">
${sheetHtml}
</div>
</body>
</html>
`;
}

async function exportHtml() {
  if (!state.payload) return;
  const html = await buildExportHtml();
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = safeFileName(state.payload.title) + ".html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

/* ---------- 启动 ---------- */

// 字体下拉的选项直接由 FONT_PRESETS 生成，避免两处各写一份
function fillFontSelects() {
  const entries = Object.entries(FONT_PRESETS);
  const options = entries
    .map(([key, preset]) => `<option value="${key}">${esc(preset.label)}</option>`)
    .join("");
  $("bodyFont").innerHTML = options;
  $("titleFont").innerHTML = `<option value="inherit">跟随正文</option>` + options;
}

async function init() {
  state.settings = await loadSettings();
  fillFontSelects();
  syncControls();
  bindControls();

  if (!payloadId) {
    showError("没有拿到要打印的内容，请回到页面重新选取元素。");
    return;
  }

  let payload = null;
  try {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    payload = got[STORAGE_KEY] || null;
  } catch (err) {
    showError("读取内容失败：" + ((err && err.message) || err));
    return;
  }

  if (!payload) {
    showError("内容已失效（窗口刷新会清掉缓存），请回到页面重新选取一次。");
    return;
  }

  state.payload = payload;
  chrome.storage.local.remove(STORAGE_KEY).catch(() => {});

  render(payload);
  applySettings();
  state.ready = true;
}

init();

// 预览页：读 payload → 渲染 → 版式设置（即时生效）→ 打印 / 导出单文件 HTML

import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../shared/settings.js";

const params = new URLSearchParams(location.search);
const payloadId = params.get("id") || "";
const STORAGE_KEY = "ep:payload:" + payloadId;

const $ = (id) => document.getElementById(id);

const state = {
  settings: { ...DEFAULT_SETTINGS },
  payload: null,
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

function showError(text) {
  $("error").textContent = text;
  $("error").hidden = false;
  $("sheetWrap").hidden = true;
  $("printBtn").disabled = true;
  $("exportBtn").disabled = true;
}

function render(payload) {
  document.title = payload.title + " · Element Print";
  $("title").textContent = payload.title;
  $("body").innerHTML = payload.html;

  const url = $("metaUrl");
  url.textContent = payload.sourceUrl;
  url.href = payload.sourceUrl;
  $("metaTime").textContent = fmtTime(payload.createdAt);

  const source = payload.pageTitle || "";
  $("sourceInfo").textContent = source
    ? `${payload.pageTitle}  ·  <${payload.tag}>`
    : `<${payload.tag}>`;
}

/* ---------- 版式 ---------- */

function applySettings() {
  const s = state.settings;
  const root = document.documentElement;

  root.style.setProperty("--ep-font-size", s.fontSize + "pt");
  root.style.setProperty("--ep-line-height", String(s.lineHeight));
  root.style.setProperty("--ep-para-before", s.paraBefore + "px");
  root.style.setProperty("--ep-para-after", s.paraAfter + "px");
  root.style.setProperty("--ep-columns", s.columns === 2 ? "2" : "1");
  root.style.setProperty("--ep-margin", s.margin + "mm");

  $("pageRule").textContent = `@page{size:A4;margin:${s.margin}mm}`;

  $("metaUrl").hidden = !s.showUrl;
  $("metaTime").hidden = !s.showTime;
  $("meta").hidden = !s.showUrl && !s.showTime;

  fit();
}

function syncControls() {
  const s = state.settings;

  $("fontSize").value = String(s.fontSize);
  $("lineHeight").value = String(s.lineHeight);
  $("paraBefore").value = String(s.paraBefore);
  $("paraAfter").value = String(s.paraAfter);
  $("margin").value = String(s.margin);
  $("showUrl").checked = s.showUrl;
  $("showTime").checked = s.showTime;

  $("vFontSize").textContent = s.fontSize + "pt";
  $("vLineHeight").textContent = s.lineHeight.toFixed(2);
  $("vParaBefore").textContent = s.paraBefore + "px";
  $("vParaAfter").textContent = s.paraAfter + "px";
  $("vMargin").textContent = s.margin + "mm";

  Array.from($("segColumns").querySelectorAll("button")).forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.value) === s.columns);
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

/* ---------- 交互 ---------- */

function update(patch) {
  state.settings = { ...state.settings, ...patch };
  syncControls();
  applySettings();
  saveSettings(state.settings);
}

function bindControls() {
  $("segColumns").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    update({ columns: Number(btn.dataset.value) });
  });

  $("fontSize").addEventListener("input", (e) => update({ fontSize: Number(e.target.value) }));
  $("lineHeight").addEventListener("input", (e) => update({ lineHeight: Number(e.target.value) }));
  $("paraBefore").addEventListener("input", (e) => update({ paraBefore: Number(e.target.value) }));
  $("paraAfter").addEventListener("input", (e) => update({ paraAfter: Number(e.target.value) }));
  $("margin").addEventListener("input", (e) => update({ margin: Number(e.target.value) }));

  $("showUrl").addEventListener("change", (e) => update({ showUrl: e.target.checked }));
  $("showTime").addEventListener("change", (e) => update({ showTime: e.target.checked }));

  $("resetBtn").addEventListener("click", () => {
    state.settings = { ...DEFAULT_SETTINGS };
    syncControls();
    applySettings();
    saveSettings(state.settings);
  });

  $("printBtn").addEventListener("click", () => window.print());
  $("exportBtn").addEventListener("click", () => {
    exportHtml().catch((err) => showError("导出失败：" + ((err && err.message) || err)));
  });

  window.addEventListener("resize", fit);
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(fit).catch(() => {});
  }
}

/* ---------- 导出单文件 HTML ---------- */

async function buildExportHtml() {
  const s = state.settings;
  const css = await (await fetch(chrome.runtime.getURL("src/shared/article.css"))).text();
  const vars = [
    `--ep-font-size:${s.fontSize}pt`,
    `--ep-line-height:${s.lineHeight}`,
    `--ep-para-before:${s.paraBefore}px`,
    `--ep-para-after:${s.paraAfter}px`,
    `--ep-columns:${s.columns === 2 ? 2 : 1}`,
    `--ep-margin:${s.margin}mm`,
  ].join(";");

  const sheetHtml = $("sheet").innerHTML;
  const title = state.payload ? state.payload.title : "Element Print";

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<style>
${css}
:root{${vars};--ep-scale:1}
body{margin:0;background:#fff}
.ep-sheet{margin:0 auto}
@page{size:A4;margin:${s.margin}mm}
@media screen{body{padding:24px}}
@media print{body{padding:0}}
</style>
</head>
<body>
<div class="ep-sheet">
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

async function init() {
  state.settings = await loadSettings();
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

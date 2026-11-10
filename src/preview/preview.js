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
  biShown: false, // 本次窗口里由工具栏「翻译」临时开出的对照视图，不写进设置
};

// 「自动翻译」开关常驻生效；工具栏「翻译」只是这一次显示对照，不改开关
function biActive() {
  return Boolean(state.settings.bilingual) || state.biShown;
}

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

  // 双语对照时正文由 #bilingual 呈现，原 #body 只是数据源
  const biOn = biActive() && !$("bilingual").hidden;
  $("sheet").classList.toggle("is-bi", biOn);
  $("body").hidden = biOn;
  // 对照行本身就是左右两列，页面再分栏会变成四列，故双语时锁单栏
  if (biOn) root.style.setProperty("--ep-columns", "1");
  root.style.setProperty("--ep-split", (s.biSplit || 58) + "%");

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

  $("bilingualOn").checked = Boolean(s.bilingual);  $("deeplKey").value = s.deeplKey || "";
  $("biSplit").value = String(s.biSplit);
  $("vBiSplit").textContent = s.biSplit + " / " + (100 - s.biSplit);

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
  // 双语对照时栏数用不上（固定单栏），按钮置灰并给一句说明
  const biNow = biActive() && !$("bilingual").hidden;
  $("segColumns").classList.toggle("is-disabled", biNow);
  $("columnsNote").textContent = biNow ? "双语对照下固定单栏" : "";

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

// 编辑作用的容器：平时是 #body；双语对照时是左栏原文列（改动回写到 #body）
function editRoot() {
  return biActive() ? $("bilingual") : $("body");
}

// 双语对照时左栏可编辑的块（每行的原文克隆，改动同步回 #body 的对应节点）
function biEditTargets() {
  const out = [];
  $("bilingual").querySelectorAll(".ep-bi__src").forEach((col) => {
    if (col.firstElementChild) out.push(col.firstElementChild);
  });
  return out;
}

// 编辑时浏览器可能把一句拆成多个块（Enter / 粘贴），这里把它们压回单块 + <br>，
// 否则回写到 #body 后，一个段落会被 collectBiRows 认成好几段
const BI_BLOCKISH = new Set([
  "DIV", "P", "SECTION", "ARTICLE", "LI", "UL", "OL", "TABLE", "TR", "TD", "TH",
  "BLOCKQUOTE", "PRE", "H1", "H2", "H3", "H4", "H5", "H6", "FIGURE", "ADDRESS",
]);

function flattenBiBlocks(root) {
  const blocks = Array.from(root.children).filter((c) => BI_BLOCKISH.has(c.tagName));
  if (!blocks.length) return;
  const out = [];
  Array.from(root.childNodes).forEach((node) => {
    if (node.nodeType === 1 && BI_BLOCKISH.has(node.tagName)) {
      flattenBiBlocks(node); // 先递归压平内层
      if (out.length) out.push(document.createElement("br"));
      Array.from(node.childNodes).forEach((child) => out.push(child));
    } else {
      out.push(node);
    }
  });
  root.replaceChildren(...out);
}

// 左栏一改就回写原文，保证 #body 始终是唯一数据源
function syncBiEdit(e) {
  const col = e.target && e.target.closest ? e.target.closest(".ep-bi__src") : null;
  if (!col || !col.firstElementChild) return;
  const row = col.firstElementChild.__epRow;
  if (!row || !row.node || !row.node.isConnected) return;
  flattenBiBlocks(col.firstElementChild);
  row.node.innerHTML = col.firstElementChild.innerHTML;
}

function setEditing(on) {
  if (on && trimming) setTrimming(false);
  editing = on;
  const bi = biActive();
  [ $("title"), $("pageHead"), $("pageFoot") ].forEach((node) => {
    node.contentEditable = on ? "true" : "false";
    node.spellcheck = false;
  });
  // 正文：双语时编辑左栏原文列，否则编辑 #body 本体
  $("body").contentEditable = on && !bi ? "true" : "false";
  $("body").spellcheck = false;
  $("bilingual").removeEventListener("input", syncBiEdit);
  biEditTargets().forEach((node) => {
    node.contentEditable = on && bi ? "true" : "false";
    node.spellcheck = false;
  });
  if (on && bi) $("bilingual").addEventListener("input", syncBiEdit);
  $("sheet").classList.toggle("is-editing", on);
  $("formatBar").hidden = !on;
  $("editBtn").textContent = on ? "完成" : "编辑";
  $("editBtn").classList.toggle("is-on", on);
  if (!on && document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
  if (!on && state.settings) $("pageRule").textContent = buildPageRule(state.settings);
  // 退出编辑时重排一次对照层：刚改过的段落立刻变成红色「更改」
  if (!on && bi) refreshBilingual();
  fit();
}

// 光标所在的段落块（正文里的 p / div / li 等）
const PARAGRAPH_SELECTOR = "p, div, li, dd, dt, h1, h2, h3, h4, h5, h6, blockquote, figcaption";

function blockAtCaret() {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  let node = sel.anchorNode;
  if (node && node.nodeType === 3) node = node.parentElement;
  if (!node || !node.closest) return null;
  const root = editRoot();
  const block = node.closest(PARAGRAPH_SELECTOR);
  if (!block || block === root || !root.contains(block)) return null;
  return block;
}

// 段落实际首行缩进（含版面设置带来的缩进，不只行内值）
function blockIndentPx(block) {
  if (!block) return 0;
  const px = parseFloat(getComputedStyle(block).textIndent);
  return Number.isFinite(px) ? px : 0;
}

// 段首缩进切换：有无之间来回切，切到无时打上 ep-no-indent 免得被版面缩进设置盖回去
function toggleIndent() {
  if (!editing) return;
  const block = blockAtCaret();
  if (!block) return;
  if (block.tagName !== "P") block.classList.add("ep-para");
  if (blockIndentPx(block) > 0.5) {
    block.style.textIndent = "0";
    block.classList.add("ep-no-indent");
  } else {
    block.style.textIndent = "2em";
    block.classList.remove("ep-no-indent");
  }
  // 双语对照时改的是左栏克隆，直接改样式不触发 input，手动回写一次
  if (biActive()) {
    const col = block.closest ? block.closest(".ep-bi__src") : null;
    const row = col && col.firstElementChild ? col.firstElementChild.__epRow : null;
    if (row && row.node && row.node.isConnected) row.node.innerHTML = block.innerHTML;
  }
  syncFormatState();
}

// 格式按钮的高亮态：选区在加粗/斜体里时按钮点亮
function syncFormatState() {
  if (!editing) return;
  $("formatBar").querySelectorAll("button[data-cmd]").forEach((btn) => {
    if (btn.dataset.cmd === "indent") {
      btn.classList.toggle("is-on", blockIndentPx(blockAtCaret()) > 0.5);
      return;
    }
    let on = false;
    try {
      on = document.queryCommandState(btn.dataset.cmd);
    } catch {
      on = false;
    }
    btn.classList.toggle("is-on", on);
  });
}

// 粗体 / 斜体 / 下划线 / 删除线 / 左右对齐，作用于当前选区
function applyFormat(cmd) {
  if (!editing) return;
  if (cmd === "indent") {
    toggleIndent();
    return;
  }
  try {
    document.execCommand("styleWithCSS", false, true);
    document.execCommand(cmd, false, null);
  } catch {
    /* 命令不可用时静默，不改动内容 */
  }
  syncFormatState();
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
// 双语对照时一块内容对应一整行对照，悬停/删除都作用在那一行
function trimTarget(node) {
  const bi = biActive();
  const root = bi ? $("bilingual") : $("body");
  let cur = node && node.nodeType === 1 ? node : null;
  if (bi) {
    const row = cur && cur.closest ? cur.closest(".ep-bi__row") : null;
    return row && row.parentElement === root ? row : null;
  }
  while (cur && cur !== root) {
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
  if (biActive()) {
    // 删对照行时连 #body 里对应的原文块一起删，导出才不会留残段
    const col = target.querySelector(".ep-bi__src");
    const row = col && col.firstElementChild ? col.firstElementChild.__epRow : null;
    if (row && row.node && row.node.isConnected) row.node.remove();
  }
  target.remove();
  fit();
}

function setTrimming(on) {
  if (on && editing) setEditing(false);
  trimming = on;
  const root = biActive() ? $("bilingual") : $("body");
  $("body").classList.toggle("is-trimming", on);
  $("trimBtn").classList.toggle("is-on", on);
  $("trimBtn").textContent = on ? "退出删减" : "删减";
  $("hintText").textContent = on ? "点击要删除的块 · Esc 退出删减" : HINT_TEXT;
  if (on) {
    root.addEventListener("mousemove", onTrimMove);
    root.addEventListener("click", onTrimClick, true);
  } else {
    root.removeEventListener("mousemove", onTrimMove);
    root.removeEventListener("click", onTrimClick, true);
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

/* ---------- 双语对照（左原文 / 右译文，逐段成对） ---------- */

// 整块不翻译：表格、图、代码这类没有逐句对照的意义，单列铺满一行
const BI_WIDE = new Set(["TABLE", "FIGURE", "IMG", "IFRAME", "VIDEO", "PRE", "HR", "BLOCKQUOTE"]);

const biCache = new Map(); // 段落键 → 译文：内存镜像，启动时从 storage 灌入
const biUsage = new Map(); // 段落键 → 最近使用时间，用于裁旧
const biFresh = new Set(); // 本轮真正发出去翻译过的段落键；不在里面的就是缓存命中

function biStatus(text, isError) {
  const el = $("translateStatus");
  if (!el) return;
  el.textContent = text || "";
  el.classList.toggle("is-error", Boolean(isError));
}

// 正文顶层块即「段」；每段取纯文本送翻，一样一段
function collectBiRows() {
  const rows = [];
  const walk = (node) => {
    Array.from(node.children).forEach((child) => {
      // 表格、图、代码块：整块不切成句，单列铺满一行
      if (BI_WIDE.has(child.tagName)) {
        rows.push({ node: child, text: "", wide: true });
        return;
      }
      // 只装文字的块就是一段（含 div 冒充的段落）
      if (!hasBlockChild(child)) {
        const text = (child.textContent || "").replace(/\s+/g, " ").trim();
        if (!text) return; // 空块不进对照，免得留一行空白
        rows.push({ node: child, text, wide: false });
        return;
      }
      walk(child);
    });
  };
  walk($("body"));
  return rows;
}

/* 段落级译文缓存：按段落文本发请求、按段落存，落盘到 chrome.storage.local。
   只存译文，键是段落文本的双哈希，所以库里不出现任何原文。 */
const BI_CACHE_KEY = "ep:bi:cache";
const BI_CACHE_MAX = 1500; // 超过就按最近使用时间裁掉旧的

// 段落文本 → 缓存的键（长度 + 两个不同种子的 32 位哈希，撞车概率可忽略）
function biTextKey(text) {
  const t = String(text);
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < t.length; i += 1) {
    const c = t.charCodeAt(i);
    h1 = ((h1 * 33) ^ c) >>> 0;
    h2 = ((h2 * 31) + c) >>> 0;
  }
  return t.length + ":" + h1.toString(36) + "." + h2.toString(36);
}

let biCacheTimer = 0;

async function loadBiCache() {
  try {
    const got = await chrome.storage.local.get(BI_CACHE_KEY);
    const rows = got[BI_CACHE_KEY] || {};
    Object.entries(rows).forEach(([k, v]) => {
      if (Array.isArray(v) && typeof v[0] === "string") biCache.set(k, v[0]);
    });
  } catch {
    /* 读不到就用内存缓存，不影响功能 */
  }
}

function persistBiCache() {
  clearTimeout(biCacheTimer);
  biCacheTimer = setTimeout(() => {
    if (biCache.size > BI_CACHE_MAX) {
      const keep = new Set(
        Array.from(biUsage.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, BI_CACHE_MAX)
          .map(([k]) => k)
      );
      Array.from(biCache.keys()).forEach((k) => {
        if (!keep.has(k)) {
          biCache.delete(k);
          biUsage.delete(k);
        }
      });
    }
    const payload = {};
    biCache.forEach((v, k) => {
      payload[k] = [v, biUsage.get(k) || 0];
    });
    chrome.storage.local.set({ [BI_CACHE_KEY]: payload }).catch(() => {});
  }, 500);
}

async function lookUpTranslations(texts) {
  const s = state.settings;
  const pending = [];
  const pendingTexts = [];

  texts.forEach((t) => {
    if (!t) return;
    const key = biTextKey(t);
    if (biCache.has(key)) {
      biUsage.set(key, Date.now()); // 记一次使用，裁旧时优先保留常用的
      return;
    }
    if (pendingTexts.indexOf(t) === -1) {
      pending.push(key);
      pendingTexts.push(t);
    }
  });
  if (!pendingTexts.length) return { error: null };

  let resp;
  try {
    resp = await chrome.runtime.sendMessage({
      type: "ep:translate",
      texts: pendingTexts,
      key: s.deeplKey,
      targetLang: s.targetLang || "ZH",
    });
  } catch (err) {
    return { error: "和后台通信失败：" + String((err && err.message) || err) };
  }
  // 返回 undefined：后台还是旧版本（没重载扩展），消息没人接
  if (resp === undefined) {
    return { error: "后台没有响应，请在 chrome://extensions 里点「重新加载」后再试" };
  }
  if (!resp.ok) return { error: resp.error || "翻译失败" };

  pending.forEach((key, i) => {
    const value = (resp.translations && resp.translations[i]) || "";
    if (!value) return;
    biCache.set(key, value);
    biUsage.set(key, Date.now());
    biFresh.add(key);
  });
  persistBiCache();
  return { error: null };
}

// 译文段落右上角的标签：缓存命中（绿）／译文已更新（蓝）／原文改过待译（红）
let biPending = 0; // 待译段落数，决定「翻译」按钮是否可点

function biBadge(tgt, kind) {
  const badge = document.createElement("span");
  badge.className = "ep-bi__badge ep-bi__badge--" + kind;
  badge.textContent = kind === "todo" ? "更改" : kind === "done" ? "已译" : "缓存";
  tgt.appendChild(badge);
}

function buildBilingual(rows) {
  const box = $("bilingual");
  box.innerHTML = "";
  biPending = 0;
  rows.forEach((row) => {
    const line = document.createElement("div");
    line.className = "ep-bi__row" + (row.wide ? " is-wide" : "");

    const src = document.createElement("div");
    src.className = "ep-bi__col ep-bi__src";
    const clone = row.node.cloneNode(true);
    clone.__epRow = row; // 编辑/删减时靠它把改动写回 #body 的原块
    src.appendChild(clone);
    line.appendChild(src);

    if (!row.wide) {
      const key = row.text ? biTextKey(row.text) : "";
      const text = key ? biCache.get(key) : "";
      // 原文是标题时译文也用同级标题元素，跟着版式的标题样式走，而不是缩成正文小字
      const heading = /^H[1-6]$/.test(row.node.tagName);
      const tgt = document.createElement(heading ? row.node.tagName.toLowerCase() : "div");
      tgt.className = "ep-bi__col ep-bi__tgt" + (heading ? " is-head" : "");
      if (text) {
        tgt.textContent = text;
        biBadge(tgt, biFresh.has(key) ? "done" : "cache");
      } else {
        // 没有译文：原文是刚改过（或从未翻过）的段落，等点「翻译」
        tgt.classList.add("ep-bi__tgt--none");
        biPending += 1;
        biBadge(tgt, "todo");
      }
      line.appendChild(tgt);
    }
    box.appendChild(line);
  });
  box.hidden = false;
  syncBiButton();
  // 重排后新克隆丢了 contenteditable，编辑态下要重新挂上
  if (editing) setEditing(true);
}

// 有未译段落才让「翻译」可点；对照未显示时工具栏按钮仍作为入口
function syncBiButton() {
  const pending = biPending > 0;
  $("translateBtn").disabled = !pending;
  $("biBtn").disabled = biActive() && !pending;
}

// 译文是否已经就绪：记住上次成功翻译时的原文指纹，内容没变就不再打 API
let biDone = false;
let biSig = "";

// 原文指纹：段落文本拼起来的长度 + 简易 32 位哈希，够分辨「同一篇」和「换了一篇」
function biSignatureOf(rows) {
  const joined = rows.map((row) => row.text).join("\u0001");
  let h = 5381;
  for (let i = 0; i < joined.length; i += 1) h = ((h * 33) ^ joined.charCodeAt(i)) >>> 0;
  return joined.length + ":" + h.toString(36);
}

async function refreshBilingual(opts = {}) {
  const s = state.settings;
  if (!biActive()) {
    const box = $("bilingual");
    box.hidden = true;
    box.innerHTML = "";
    biStatus("");
    syncBiButton();
    applySettings();
    return;
  }

  const rows = collectBiRows();
  const sig = biSignatureOf(rows);
  biFresh.clear();

  const texts = rows.filter((row) => !row.wide).map((row) => row.text);
  const hit = texts.filter((t) => biCache.has(biTextKey(t))).length;
  // 本篇一段译文都没有（首次进来）：自动翻一次，不必先点按钮
  const initial = !biDone && hit === 0;
  const wantSend = Boolean(opts.send) || initial;

  if (!wantSend) {
    // 只渲染缓存命中的段落，改过的段落留「更改」红标，等点「翻译」
    biStatus("");
    buildBilingual(rows);
    applySettings();
    return;
  }

  let error = null;
  if (!s.deeplKey) {
    error = "未填 DeepL Auth Key";
  } else {
    biStatus("翻译中…");
    const res = await lookUpTranslations(texts);
    error = res.error;
    if (!error) {
      biDone = true;
      biSig = sig;
    }
  }

  if (error) {
    // 失败就留在原文视图，不要给出一片空白右列让人以为是版式没生效
    const box = $("bilingual");
    box.hidden = true;
    box.innerHTML = "";
    biStatus("翻译未成功：" + error, true);
    console.warn("[Element Print] 翻译未成功：", error);
    applySettings();
    return;
  }

  biStatus("");
  buildBilingual(rows);
  applySettings();
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
  // Key 这类跨版式保留的字段不跟着重置
  const keep = {
    deeplKey: state.settings.deeplKey,
    deeplFree: state.settings.deeplFree,
    targetLang: state.settings.targetLang,
    bilingual: state.settings.bilingual,
  };
  state.settings = { ...preset, ...keep };
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

  // 双语对照：开时先退出编辑/删减（改的是原文 #body，对照层只是只读副本）
  $("bilingualOn").addEventListener("change", (e) => {
    if (e.target.checked) {
      setEditing(false);
      setTrimming(false);
    } else {
      state.biShown = false; // 关掉开关时，顺手把「翻译」临时开出的视图也收掉
    }
    update({ bilingual: e.target.checked });
    refreshBilingual();
  });
  $("deeplKey").addEventListener("input", (e) => update({ deeplKey: e.target.value }));
  $("translateBtn").addEventListener("click", () => {
    // 只翻「更改」标着的段落，其余用缓存
    refreshBilingual({ send: true });
  });
  $("biSplit").addEventListener("input", (e) => update({ biSplit: Number(e.target.value) }));

  // 工具栏「翻译」：单次行为，只让这一个窗口显示对照，不去动「自动翻译」开关
  $("biBtn").addEventListener("click", () => {
    if (!state.settings.deeplKey) {
      $("hintText").textContent = "先在右栏填 DeepL Auth Key";
      setTimeout(() => {
        $("hintText").textContent = HINT_TEXT;
      }, 2600);
      return;
    }
    if (!biActive()) {
      setEditing(false);
      setTrimming(false);
      state.biShown = true;
      refreshBilingual(); // 首次自动翻；之后按缓存渲染，改过的段落标红
      return;
    }
    refreshBilingual({ send: true }); // 已在对照视图里：只补「更改」的段落
  });

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

  $("editBtn").addEventListener("click", () => {
    setEditing(!editing);
  });

  // 按下时就阻止默认，避免按钮抢走输入焦点导致选区丢失
  $("formatBar").addEventListener("mousedown", (e) => {
    if (e.target.closest("button[data-cmd]")) e.preventDefault();
  });
  $("formatBar").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-cmd]");
    if (btn) applyFormat(btn.dataset.cmd);
  });
  document.addEventListener("selectionchange", syncFormatState);

  // 双语左栏编辑：Enter 只插一个 <br>（否则浏览器会新起一个块，一段被拆成好几段），粘贴只留纯文本
  $("bilingual").addEventListener("keydown", (e) => {
    if (!editing || !biActive()) return;
    if (e.key !== "Enter" || e.isComposing) return;
    e.preventDefault();
    try {
      document.execCommand("insertLineBreak");
    } catch {
      document.execCommand("insertHTML", false, "<br>");
    }
  });
  $("bilingual").addEventListener("paste", (e) => {
    if (!editing || !biActive()) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text/plain") || "";
    document.execCommand("insertText", false, text.replace(/\r\n?/g, "\n"));
  });
  $("trimBtn").addEventListener("click", () => {
    setTrimming(!trimming);
  });
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
  const cssPaths = [
    "src/shared/article.css",
    "src/shared/themes/academic.css",
    "src/shared/themes/gov.css",
  ];
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
    `--ep-columns:${biActive() ? 1 : s.columns === 2 ? 2 : 1}`,
    `--ep-split:${(s.biSplit || 58)}%`,
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
  // 「缓存」小标签只是编辑时的提示，不进导出的文档
  sheetCopy.querySelectorAll(".ep-bi__badge").forEach((node) => node.remove());
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
  await loadBiCache(); // 上次留下的段落译文先灌进内存，命中就不必再打 API
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
  if (state.settings.bilingual) refreshBilingual();
  state.ready = true;
}

init();

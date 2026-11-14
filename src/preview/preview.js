// 预览页：读 payload → 渲染 → 版式设置（即时生效）→ 打印 / 导出单文件 HTML

import {
  DEFAULT_SETTINGS,
  THEME_PRESETS,
  MARGIN_PRESETS,
  FONT_PRESETS,
  BODY_WEIGHTS,
  EREADER_DEFAULTS,
  MOBILE_DEFAULTS,
  LAYOUT_KEYS,
  profileKey,
  pickLayout,
  pickShared,
  loadSettings,
  saveSettings,
  flushSettings,
} from "../shared/settings.js";
import { QUOTES, QUOTES_EN } from "../shared/quotes.js";

const params = new URLSearchParams(location.search);
const payloadId = params.get("id") || "";
const STORAGE_KEY = "ep:payload:" + payloadId;

const $ = (id) => document.getElementById(id);

// 正文图片显示档位：只改预览/打印里的最大宽度，不动抽取下来的原图
const IMG_SIZE_MAX = { small: "40%", mid: "65%", full: "100%" };

// 10.3″ 掌阅 iReader：1404×1872，4:3 竖屏，页面按 157×209mm 排
const EREADER_PAGE = {
  w: "157mm",
  h: "209mm",
  mt: 11,
  mr: 10,
  mb: 11,
  ml: 10,
};

// 华为 Pura 70 Pro：1260×2844，6.77″ 可视矩形约 69.7×157.2mm，取整 70×157mm
const MOBILE_PAGE = {
  w: "70mm",
  h: "157mm",
  mt: 3,
  mr: 3,
  mb: 3,
  ml: 3,
};

// 电纸书默认排版由 settings.js 统一提供

function applyEreaderDefaults(force = false) {
  const s = state.settings;
  if (force || s.bodyWeight === DEFAULT_SETTINGS.bodyWeight) s.bodyWeight = EREADER_DEFAULTS.bodyWeight;
  if (force || s.fontSize === DEFAULT_SETTINGS.fontSize) s.fontSize = EREADER_DEFAULTS.fontSize;
  if (force || s.lineHeightMode === DEFAULT_SETTINGS.lineHeightMode) s.lineHeightMode = EREADER_DEFAULTS.lineHeightMode;
  if (force || s.lineHeight === DEFAULT_SETTINGS.lineHeight) s.lineHeight = EREADER_DEFAULTS.lineHeight;
  if (force || s.paraAfter === DEFAULT_SETTINGS.paraAfter) s.paraAfter = EREADER_DEFAULTS.paraAfter;
}

const isEreader = (s) => s.pageFormat === "ereader";
const isMobile = (s) => s.pageFormat === "mobile";

const state = {
  settings: { ...DEFAULT_SETTINGS },
  profiles: {},
  payload: null,
  lang: "zh",
  ready: false,
  biShown: false, // 本次窗口里由工具栏「翻译」临时开出的对照视图，不写进设置
  view: "source", // source（原文） | mixed（中英混排） | bi（左右对照）
};

// 当前是否处于左右对照视图
function biActive() {
  return state.view === "bi";
}

// 当前是否处于原始中英混排视图
function mixedActive() {
  return state.view === "mixed";
}

// 手机下「翻译」的隐含串行形式：原文段落后紧跟译文段落，上下堆叠
function serialActive() {
  return state.view === "serial";
}

// 记住工具栏所选视图；串行是手机下翻译的内部形式，落盘仍记为 bi
function persistView() {
  state.settings.view = state.view === "serial" ? "bi" : state.view;
  saveSettings(state.settings, state.profiles);
}

// 是否存在可还原的混排快照（抽取时识别到内联译文才会有）
function hasMixed() {
  return Boolean(state.payload && state.payload.mixedHtml);
}

// 翻译引擎：两家凭据各存一份，界面按当前引擎只显示自己那组
function syncBiCreds() {
  const s = state.settings;
  const baidu = s.engine === "baidu";
  $("deeplKeyRow").hidden = baidu;
  $("baiduAppIdRow").hidden = !baidu;
  $("baiduKeyRow").hidden = !baidu;
  $("engineNote").textContent = baidu
    ? "免费版约 5 万字符/月，QPS 约 1"
    : "Key 以 :fx 结尾自动走免费端点";
}

function engineReady(s) {
  return s.engine === "baidu"
    ? Boolean(s.baiduAppId && s.baiduKey)
    : Boolean(s.deeplKey);
}

function engineMissingText(s) {
  return s.engine === "baidu"
    ? "翻译须先在右栏填百度 APP ID 和密钥"
    : "翻译须先在右栏填 DeepL Auth Key";
}

/* ---------- 工具 ---------- */

function pad(n) {
  return String(n).padStart(2, "0");
}

function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatPubDate(value) {
  return String(value || "").trim();
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
// 标题被剪走、或页面本来就只有个空壳时，正文里会留下空的 <h1></h1>、
// 空 <p></p>：它们在版面上占一段留白，还会被当成段落参与排版，这里统一清掉
function dropEmptyBlocks() {
  Array.from($("body").querySelectorAll("h1,h2,h3,h4,h5,h6,p,div,section,li")).forEach((node) => {
    if (!node.isConnected) return;
    // 还装着图片/表格/列表骨架的不算空
    if (node.querySelector("img,table,hr,figure,pre,ul,ol,blockquote,audio,canvas")) return;
    const text = (node.textContent || "").replace(/\u00a0/g, " ").replace(/\s+/g, "").trim();
    if (text) return;
    node.remove();
  });
}

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

// 标题译文：页面翻译过标题时，中文贴在英文标题下面；只在翻译视图里出现
function syncTitleTrans() {
  const el = $("titleTrans");
  const text = (state.payload && state.payload.titleTrans) || "";
  el.textContent = text;
  el.hidden = !text || !(biActive() || serialActive());
}

// 摘要译文：跟标题译文一样，只在对照 / 串行翻译视图里出现
function syncExcerptTrans() {
  const el = $("excerptTrans");
  const text = (state.payload && state.payload.excerptTrans) || "";
  el.textContent = text;
  el.hidden = !text || !(biActive() || serialActive());
}

function updateDocumentTitle() {
  const base = state.payload && state.payload.title ? state.payload.title : "Element Print";
  const suffix = isEreader(state.settings) ? " - e-ink" : "";
  document.title = `${base}${suffix} · Element Print`;
}

function render(payload) {
  updateDocumentTitle();
  $("title").textContent = payload.title;
  syncTitleTrans();
  $("body").innerHTML = payload.html;
  dropEmptyBlocks();
  markParagraphs($("body"));
  $("mixed").innerHTML = payload.mixedHtml || "";
  markParagraphs($("mixed"));
  seedPageTranslations(payload);
  state.lang = detectLang($("body"));
  setSheetLang(state.lang);
  // 语言判定后基线会随中英体例变化（缩进 / 段后 / 标题字体），
  // 需重算一遍虚线框与重置按钮，避免沿用默认 zh 基线的旧标记
  syncModifiedMarks();
  syncResetBtn();
  refreshWordCount();
  syncTitleTrans(); // 语言判定完才知道能不能进对照视图

  const link = $("siteLink");
  link.textContent = siteNameOf(payload.sourceUrl);
  link.href = payload.sourceUrl;

  const url = $("metaUrl");
  url.textContent = payload.sourceUrl;
  url.href = payload.sourceUrl;
  $("metaTime").textContent = fmtTime(payload.createdAt);

  const author = (payload.author || "").trim();
  const pubDate = formatPubDate(payload.publishedTime);
  $("metaAuthor").textContent = author;
  $("metaAuthor").hidden = !author;
  $("metaPubDate").textContent = pubDate;
  $("metaPubDate").hidden = !pubDate;

  const excerpt = (payload.excerpt || "").trim();
  $("excerpt").textContent = excerpt;
  $("excerpt").hidden = !excerpt;
  syncExcerptTrans();
}

/* ---------- @page（含页边距盒里的页眉页脚与页码） ---------- */

// 页脚格言：每次打开预览随机取一句，同一窗口内保持不变；西文正文配英文格言
let quoteLine = "";
let quoteLang = "";

function pickQuote() {
  const pool = state.lang === "en" ? QUOTES_EN : QUOTES;
  if (!pool.length) return "";
  const q = pool[Math.floor(Math.random() * pool.length)];
  return q.t + (state.lang === "en" ? " — " : " —— ") + q.a;
}

function renderQuote() {
  const el = $("pageQuote");
  const endEl = $("endQuote");
  const mob = isMobile(state.settings);
  if (!el) return;
  if (state.settings.showQuote === false) {
    el.textContent = "";
    el.hidden = true;
    if (endEl) { endEl.textContent = ""; endEl.hidden = true; }
    return;
  }
  if (!quoteLine || quoteLang !== state.lang) {
    quoteLine = pickQuote();
    quoteLang = state.lang;
  }
  if (mob && endEl) {
    el.textContent = "";
    el.hidden = true;
    endEl.hidden = false;
    endEl.textContent = quoteLine;
  } else {
    if (endEl) { endEl.textContent = ""; endEl.hidden = true; }
    el.hidden = false;
    el.textContent = quoteLine;
  }
}


function cssString(text) {
  return '"' + String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
}

function labelText(node) {
  return ((node && node.textContent) || "").replace(/\s+/g, " ").trim();
}

const GUTTER_FONT = '"EP Plex Sans", "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';
// 字标与页脚格言用 Georgia；页眉网址用 Verdana；页码/时间戳保持无衬线（Georgia 数字是旧式）
const BRAND_FONT = 'Georgia, "Constantia", "Times New Roman", serif';
const QUOTE_FONT = 'Georgia, "Constantia", "Times New Roman", serif';
const URL_FONT = 'Verdana, "Segoe UI", sans-serif';

function buildPageRule(s) {
  const er = isEreader(s);
  const mob = isMobile(s);
  const sizePage = er ? EREADER_PAGE : mob ? MOBILE_PAGE : null;
  const head = $("pageHead");
  const brand = labelText(head && head.querySelector(".ep-gutter__title")) || "Element Print";
  const src = labelText($("pageSource"));
  // 页脚左下角：随机格言（关闭时留空，右下品牌名仍保留）
  const quote = s.showQuote === false ? "" : quoteLine;


  // 左右两块各占 50%，边框拼成一条整线（页边距盒不能跨盒连画）
  const top = (fam) =>
    `font-family:${fam};font-size:8pt;width:50%;vertical-align:bottom;` +
    `padding:0 0 1.2mm;margin:0 0 6mm;border-bottom:0.5pt solid #c9ccd1;`;
  // 名言较长，页脚左盒放宽到 74%，页码只占剩下的一点
  const bottom = (w, fam) =>
    `font-family:${fam};font-size:8pt;width:${w};vertical-align:top;` +
    `padding:1.2mm 0 0;margin:4mm 0 0;border-top:0.5pt solid #c9ccd1;`;

  const headBoxes = er || mob || s.showHeader === false
    ? ""
    : `@top-left{content:${cssString(brand)};${top(BRAND_FONT)}text-align:left;font-weight:500;letter-spacing:.12em;color:#4a4f57;}` +
      `@top-right{content:${cssString(src)};${top(URL_FONT)}text-align:right;color:#6b6b6b;}`;
  // 电纸书：页脚只保留格言；手机版：无重复页脚，格言在文末；A4：名言 + 页码，受页脚开关控制
  const footBoxes = mob
    ? ""
    : er
      ? `@bottom-left{content:${cssString(quote)};${bottom("100%", QUOTE_FONT)}text-align:left;color:#6b6b6b;}`
      : s.showFooter === false
        ? ""
        : `@bottom-left{content:${cssString(quote)};${bottom(quote ? "74%" : "50%", QUOTE_FONT)}text-align:left;color:#6b6b6b;}` +
          `@bottom-right{content:counter(page) " / " counter(pages);${bottom(quote ? "24%" : "50%", GUTTER_FONT)}text-align:right;color:#6b6b6b;font-variant-numeric:tabular-nums;}`;

  const size = sizePage ? `${sizePage.w} ${sizePage.h}` : "A4";
  const margin = mob
    ? `${MOBILE_PAGE.mt}mm ${MOBILE_PAGE.mr}mm ${MOBILE_PAGE.mb}mm ${MOBILE_PAGE.ml}mm`
    : `${s.marginTop}mm ${s.marginRight}mm ${s.marginBottom}mm ${s.marginLeft}mm`;

  return (
    `@page{size:${size};margin:${margin};` +
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
  const er = isEreader(s);
  const mob = isMobile(s);
  const sizePage = er ? EREADER_PAGE : mob ? MOBILE_PAGE : null;

  root.style.setProperty("--ep-font-size", s.fontSize + "pt");
  root.style.setProperty("--ep-title-size", s.titleSize + "pt");
  root.style.setProperty(
    "--ep-line-height",
    s.lineHeightMode === "fixed" ? s.lineHeightFixed + "pt" : String(s.lineHeight)
  );
  root.style.setProperty("--ep-para-before", s.paraBefore + "px");
  root.style.setProperty("--ep-para-after", s.paraAfter + "px");
  root.style.setProperty("--ep-page-w", sizePage ? sizePage.w : "210mm");
  root.style.setProperty("--ep-page-h", sizePage ? sizePage.h : "297mm");
  root.style.setProperty("--ep-columns", s.columns === 2 ? "2" : "1");
  root.style.setProperty("--ep-img-max", IMG_SIZE_MAX[s.imgSize] || IMG_SIZE_MAX.full);
  root.style.setProperty("--ep-indent", s.indent + "em");
  root.style.setProperty(
    "--ep-mt",
    mob ? MOBILE_PAGE.mt + "mm" : s.marginTop + "mm"
  );
  root.style.setProperty(
    "--ep-mr",
    mob ? MOBILE_PAGE.mr + "mm" : s.marginRight + "mm"
  );
  root.style.setProperty(
    "--ep-mb",
    mob ? MOBILE_PAGE.mb + "mm" : s.marginBottom + "mm"
  );
  root.style.setProperty(
    "--ep-ml",
    mob ? MOBILE_PAGE.ml + "mm" : s.marginLeft + "mm"
  );

  $("sheet").dataset.theme = s.theme || "paper";
  $("sheet").dataset.pageFormat = s.pageFormat || "a4";
  $("sheet").dataset.bodyWeight = s.bodyWeight || "normal";
  $("sheet").dataset.lineHeightMode = s.lineHeightMode || "ratio";
  $("sheet").classList.toggle("is-span-head", Boolean(s.spanHead));
  // 段落可跨页：不区分原文/译文层，所有可见正文容器统一放开 break-inside
  $("body").classList.toggle("is-breakable", Boolean(s.allowBreak));
  $("mixed").classList.toggle("is-breakable", Boolean(s.allowBreak));
  $("bilingual").classList.toggle("is-breakable", Boolean(s.allowBreak));
  $("serial").classList.toggle("is-breakable", Boolean(s.allowBreak));

  // 对照视图由 #bilingual 呈现；混排视图由 #mixed 呈现；手机串行翻译由 #serial 呈现
  const biOn = biActive();
  const mixedOn = mixedActive();
  const serialOn = serialActive();
  $("sheet").classList.toggle("is-bi", biOn);
  $("body").hidden = biOn || mixedOn || serialOn;
  $("mixed").hidden = !mixedOn;
  $("bilingual").hidden = !biOn;
  $("serial").hidden = !serialOn;
  // 对照/串行翻译不再左右分栏；手机竖屏固定单栏
  if (biOn || serialOn || mob) root.style.setProperty("--ep-columns", "1");
  root.style.setProperty("--ep-split", (s.biSplit || 57) + "%");
  if (biResizer) biResizer.hidden = !biOn;

  root.style.setProperty("--ep-body-font", bodyFontStack(s.bodyFont, state.lang));
  root.style.setProperty("--ep-body-weight", String(BODY_WEIGHTS[s.bodyWeight] || 400));
  root.style.setProperty("--ep-title-font", titleFontStack(s, state.lang));

  $("pageHead").hidden = er || mob || s.showHeader === false;
  // 电纸书固定打开页脚，只显示格言；手机版隐藏重复页脚，格言移到文末；A4 页脚受开关控制并显示页码
  $("pageFoot").hidden = mob || (!er && s.showFooter === false);
  $("pageNo").hidden = er || mob;
  renderQuote();

  $("pageRule").textContent = buildPageRule(s);

  $("metaUrl").hidden = !s.showUrl;
  $("metaTime").hidden = !s.showTime;
  updateDocumentTitle();
  const hasAuthor = Boolean((state.payload && state.payload.author || "").trim());
  const hasPubDate = Boolean(formatPubDate(state.payload && state.payload.publishedTime));
  $("meta").hidden = !(s.showUrl || s.showTime || hasAuthor || hasPubDate);

  syncResetBtn();
  fit();
}

function fieldOf(id) {
  const node = $(id);
  return node ? node.closest(".ep-field, .ep-check") : null;
}

const MODIFIED_TARGETS = {
  columns: () => fieldOf("segColumns"),
  bodyFont: () => fieldOf("bodyFont"),
  bodyWeight: () => fieldOf("segBodyWeight"),
  titleFont: () => fieldOf("titleFont"),
  fontSize: () => fieldOf("fontSize"),
  titleSize: () => fieldOf("titleSize"),
  lineHeightMode: () => fieldOf("segLineMode"),
  lineHeight: () => fieldOf("lineHeight"),
  paraBefore: () => fieldOf("paraBefore"),
  paraAfter: () => fieldOf("paraAfter"),
  indent: () => fieldOf("indent"),
  marginTop: () => fieldOf("marginTop"),
  marginRight: () => fieldOf("marginRight"),
  marginBottom: () => fieldOf("marginBottom"),
  marginLeft: () => fieldOf("marginLeft"),
  showUrl: () => fieldOf("showUrl"),
  showTime: () => fieldOf("showTime"),
  spanHead: () => fieldOf("spanHead"),
  allowBreak: () => fieldOf("allowBreak"),
  showHeader: () => fieldOf("showHeader"),
  showFooter: () => fieldOf("showFooter"),
  showQuote: () => fieldOf("showQuote"),
  biSplit: () => fieldOf("biSplit"),
};

function settingsEqual(key, s, baseline) {
  let actual = s[key];
  let expected = baseline[key];
  if (key === "lineHeight") {
    const fixed = s.lineHeightMode === "fixed";
    actual = fixed ? s.lineHeightFixed : s.lineHeight;
    expected = fixed ? baseline.lineHeightFixed : baseline.lineHeight;
  } else if (key === "titleFont") {
    actual = titleFontStack(s, state.lang);
    expected = titleFontStack({ titleFont: expected, bodyFont: baseline.bodyFont }, state.lang);
  }
  return actual === expected;
}

function syncModifiedMarks() {
  const s = state.settings;
  const baseline = getBaseline();
  const colForced = biActive() || serialActive() || isMobile(s);
  Object.entries(MODIFIED_TARGETS).forEach(([key, target]) => {
    const node = target();
    if (!node) return;
    if (key === "columns" && colForced) {
      node.classList.remove("is-modified");
      return;
    }
    node.classList.toggle("is-modified", !settingsEqual(key, s, baseline));
  });
}

function syncControls() {
  const s = state.settings;
  const fixedLine = s.lineHeightMode === "fixed";

  $("bodyFont").value = s.bodyFont || "auto";
  Array.from($("segBodyWeight").querySelectorAll("button")).forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.value === (BODY_WEIGHTS[s.bodyWeight] ? s.bodyWeight : "normal"));
  });
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
  $("allowBreak").checked = Boolean(s.allowBreak);
  $("showHeader").checked = s.showHeader !== false;
  $("showFooter").checked = s.showFooter !== false;
  $("showQuote").checked = s.showQuote !== false;
  $("closeAfterPrint").checked = Boolean(s.closeAfterPrint);

  $("bilingualOn").checked = Boolean(s.bilingual);
  $("deeplKey").value = s.deeplKey || "";
  $("biEngine").value = s.engine === "baidu" ? "baidu" : "deepl";
  $("baiduAppId").value = s.baiduAppId || "";
  $("baiduKey").value = s.baiduKey || "";
  syncBiCreds();
  $("biSplit").value = String(s.biSplit);
  $("vBiSplit").textContent = s.biSplit + " / " + (100 - s.biSplit);
  $("biCacheMax").value = String(s.biCacheMax);

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

  Array.from($("segPageFormat").querySelectorAll("button")).forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.value === (s.pageFormat || "a4"));
  });

  Array.from($("segColumns").querySelectorAll("button")).forEach((btn) => {
    btn.classList.toggle("is-active", Number(btn.dataset.value) === s.columns);
  });

  Array.from($("segImgSize").querySelectorAll("button")).forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.value === (s.imgSize || "full"));
  });
  // 双语对照、手机竖屏固定单栏；电纸书默认单栏但允许改成双栏
  const erNow = isEreader(s);
  const mobNow = isMobile(s);
  const biNow = biActive() || serialActive();
  $("segColumns").classList.toggle("is-disabled", biNow || mobNow);
  $("columnsNote").textContent = biNow
    ? "双语对照下固定单栏"
    : mobNow
      ? "手机阅读固定单栏"
      : "";

  // 单栏/固定单栏时，标题跨栏没有意义：禁用并取消勾选
  const twoCol = Number(s.columns) === 2 && !biNow && !mobNow;
  $("spanHead").disabled = !twoCol;
  if (!twoCol) {
    s.spanHead = false;
    $("spanHead").checked = false;
  } else {
    $("spanHead").checked = Boolean(s.spanHead);
  }

  // 手机阅读不渲染页眉页脚，对应开关禁用并保持未选中
  $("showHeader").disabled = mobNow;
  $("showFooter").disabled = mobNow;
  if (mobNow) {
    s.showHeader = false;
    s.showFooter = false;
    $("showHeader").checked = false;
    $("showFooter").checked = false;
  }

  // 手机不套用版式模板，模板选择器置灰
  $("segTheme").classList.toggle("is-disabled", mobNow);

  Array.from($("segTheme").querySelectorAll("button")).forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.value === (s.theme || "paper"));
  });

  Array.from($("segLineMode").querySelectorAll("button")).forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.value === (s.lineHeightMode || "ratio"));
  });

  syncModifiedMarks();
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

// 进入编辑时留一份内容快照：Esc 退出时用来判断有没有改动，取消则按快照还原
let editSnapshot = null;

const EDIT_REGIONS = ["title", "titleTrans", "body", "pageHead", "pageFoot", "excerpt", "excerptTrans", "metaAuthor", "metaPubDate"];

function takeEditSnapshot() {
  const snap = {};
  EDIT_REGIONS.forEach((id) => {
    snap[id] = $(id).innerHTML;
  });
  return snap;
}

function editChanged() {
  if (!editSnapshot) return false;
  return EDIT_REGIONS.some((id) => editSnapshot[id] !== $(id).innerHTML);
}

function restoreEditSnapshot() {
  if (!editSnapshot) return;
  EDIT_REGIONS.forEach((id) => {
    if (editSnapshot[id] !== $(id).innerHTML) $(id).innerHTML = editSnapshot[id];
  });
  if (state.payload) {
    state.payload.author = $("metaAuthor").textContent.replace(/\s+/g, " ").trim();
    state.payload.publishedTime = $("metaPubDate").textContent.replace(/\s+/g, " ").trim();
    state.payload.excerpt = $("excerpt").textContent.replace(/\s+/g, " ").trim();
    state.payload.titleTrans = $("titleTrans").textContent.replace(/\s+/g, " ").trim();
    state.payload.excerptTrans = $("excerptTrans").textContent.replace(/\s+/g, " ").trim();
    $("metaAuthor").hidden = !state.payload.author;
    $("metaPubDate").hidden = !state.payload.publishedTime;
    $("excerpt").hidden = !state.payload.excerpt;
    $("titleTrans").hidden = !state.payload.titleTrans;
    $("excerptTrans").hidden = !state.payload.excerptTrans;
  }
  editSnapshot = null;
  refreshWordCount();
  fit();
}

function setEditing(on) {
  if (on && trimming) setTrimming(false);
  if (on && pickingTitle) setPickingTitle(false);
  editing = on;
  if (on) editSnapshot = takeEditSnapshot();
  const bi = biActive();
  [
    $("title"),
    $("titleTrans"),
    $("pageHead"),
    $("pageFoot"),
    $("excerpt"),
    $("excerptTrans"),
    $("metaAuthor"),
    $("metaPubDate"),
  ].forEach((node) => {
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
  if (!on) closeReplacePanel();
  setHint(on ? "可直接改字，格式用下方图标 · Esc 取消（不保存）" : baseHint());
  $("editBtn").textContent = on ? "完成" : "编辑";
  $("editBtn").classList.toggle("is-on", on);
  if (!on && document.activeElement && document.activeElement.blur) {
    document.activeElement.blur();
  }
  if (!on && state.settings) $("pageRule").textContent = buildPageRule(state.settings);
  // 退出编辑时重排一次对照层：刚改过的段落立刻变成红色「更改」
  if (!on && bi) refreshBilingual();
  // 进入编辑不主动落光标：没有选区就是没有选区，格式栏全部熄灭，点正文之后才跟段落走
  if (on) syncFormatState();
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
  const bar = $("formatBar");
  const root = editRoot();
  const sel = window.getSelection();
  // 光标不在可编辑区（比如刚点完按钮、选区已被浏览器清掉）时全部熄灭，别误亮
  if (!sel || !sel.rangeCount || !root.contains(sel.getRangeAt(0).startContainer)) {
    bar.querySelectorAll("button[data-cmd]").forEach((btn) => btn.classList.remove("is-on"));
    return;
  }
  bar.querySelectorAll("button[data-cmd]").forEach((btn) => {
    if (btn.dataset.cmd === "fontUp" || btn.dataset.cmd === "fontDown") return;
    if (btn.dataset.cmd === "clearFormat") return;
    if (btn.dataset.cmd === "indent") {
      btn.classList.toggle("is-on", blockIndentPx(blockAtCaret()) > 0.5);
      return;
    }
    if (btn.dataset.cmd === "h2" || btn.dataset.cmd === "h3") {
      const block = blockAtCaret();
      const want = btn.dataset.cmd.toUpperCase();
      btn.classList.toggle("is-on", Boolean(block) && block.closest(want) !== null);
      return;
    }
    if (btn.dataset.cmd === "quote") {
      const block = blockAtCaret();
      btn.classList.toggle("is-on", Boolean(block) && block.closest("BLOCKQUOTE") !== null);
      return;
    }
    const execCmd =
      btn.dataset.cmd === "ol" ? "insertOrderedList"
      : btn.dataset.cmd === "ul" ? "insertUnorderedList"
      : btn.dataset.cmd;
    let on = false;
    try {
      on = document.queryCommandState(execCmd);
    } catch {
      on = false;
    }
    btn.classList.toggle("is-on", on);
  });
}

// 双语对照时改的是左栏克隆，直接改样式不触发 input，手动回写一次
function syncBiClone(block) {
  if (!biActive() || !block) return;
  const col = block.closest ? block.closest(".ep-bi__src") : null;
  const row = col && col.firstElementChild ? col.firstElementChild.__epRow : null;
  if (row && row.node && row.node.isConnected) row.node.innerHTML = block.innerHTML;
}

// 字号增减：有选区就包一层带 font-size 的 span，光标没选区就改整段
const FONT_MIN_PX = 8;
const FONT_MAX_PX = 48;

function changeFontSize(delta) {
  if (!editing) return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const root = editRoot();
  if (!root.contains(range.startContainer)) return;
  const baseEl = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : range.startContainer;
  const cur = parseFloat(getComputedStyle(baseEl).fontSize) || 16;
  const next = Math.min(FONT_MAX_PX, Math.max(FONT_MIN_PX, Math.round(cur + delta)));

  if (range.collapsed) {
    const block = blockAtCaret();
    if (!block) return;
    block.style.fontSize = next + "px";
    syncBiClone(block);
  } else {
    const frag = range.extractContents();
    const span = document.createElement("span");
    span.style.fontSize = next + "px";
    span.appendChild(frag);
    range.insertNode(span);
    const after = document.createRange();
    after.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(after);
    if (baseEl.closest) syncBiClone(baseEl.closest(PARAGRAPH_SELECTOR));
  }
  syncFormatState();
}

// 块级切换：一级标题（h2）/ 二级标题（h3），已是该块时再点一次退回普通段落
// 正文里的大标题被提到 #body 之外，h2 才是正文最高一级，也因此由「标题跨栏」管
function toggleBlock(name) {
  if (!editing) return;
  const block = blockAtCaret();
  if (!block) return;
  const cur = block.tagName.toLowerCase();
  const target = cur === name ? "p" : name;
  try {
    document.execCommand("formatBlock", false, "<" + target + ">");
  } catch {
    return;
  }
  const next = blockAtCaret();
  if (next) next.classList.remove("ep-no-indent");
  syncBiClone(next || block);
  syncFormatState();
}

// 光标在容器内的纯文本偏移 / 按偏移把光标放回去：
// 拆改 DOM 后浏览器会丢掉原来的选区，不还原的话下一次点按钮就取不到所在段落
function caretTextOffset(root) {
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.endContainer)) return null;
  const pre = range.cloneRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.endContainer, range.endOffset);
  return pre.toString().length;
}

function placeCaretAt(root, offset) {
  if (!root) return;
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let left = Math.max(0, offset || 0);
  let node = walker.nextNode();
  while (node) {
    const len = node.nodeValue.length;
    if (left <= len) {
      range.setStart(node, left);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    left -= len;
    node = walker.nextNode();
  }
  range.selectNodeContents(root);
  range.collapse(false);
  sel.removeAllRanges();
  sel.addRange(range);
}

// 引文块只有一个：已在 blockquote 里再点就取消，而不是往里套第二层
function toggleQuote() {
  if (!editing) return;
  const block = blockAtCaret();
  if (!block) return;
  const outer = block.closest("blockquote");
  if (!outer || !editRoot().contains(outer)) {
    try {
      document.execCommand("formatBlock", false, "<blockquote>");
    } catch {
      return;
    }
    syncBiClone(blockAtCaret());
    syncFormatState();
    return;
  }
  // 取消：拆掉外层 blockquote，把里面的内容还原成普通段落（不留裸文本）
  const offset = caretTextOffset(outer);
  const kids = Array.from(outer.children);
  let replacement = null;
  if (kids.length === 1 && /^(P|DIV)$/.test(kids[0].tagName)) {
    replacement = kids[0];
    outer.replaceWith(replacement);
  } else if (kids.length === 0) {
    replacement = document.createElement("p");
    replacement.innerHTML = outer.innerHTML;
    outer.replaceWith(replacement);
  } else {
    const frag = document.createDocumentFragment();
    kids.forEach((node) => frag.appendChild(node));
    replacement = kids[0];
    outer.replaceWith(frag);
  }
  // 把光标放回替代节点，否则下一次点击取不到段落，按钮就像失效了
  placeCaretAt(replacement, offset);
  const inner = blockAtCaret();
  if (inner) {
    inner.classList.remove("ep-no-indent");
    syncBiClone(inner);
  }
  syncFormatState();
}

// 清除格式：行内格式、字号、缩进、标题/引文/列表一律还原成普通段落
function clearFormatting() {
  if (!editing) return;
  const sel = window.getSelection();
  if (!sel || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  const root = editRoot();
  if (!root.contains(range.startContainer)) return;
  const block = blockAtCaret();

  try {
    document.execCommand("removeFormat");
  } catch {
    /* 命令不可用时继续做元素级清理 */
  }

  // 行内样式（字号、缩进是前面的按钮写进去的，removeFormat 未必带走）
  const scopeEl = range.collapsed
    ? block
    : (range.commonAncestorContainer.nodeType === 3
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer);
  if (scopeEl && scopeEl.querySelectorAll) {
    [scopeEl].concat(Array.from(scopeEl.querySelectorAll("[style]"))).forEach((node) => {
      if (!node.style) return;
      node.style.fontSize = "";
      node.style.textIndent = "";
      node.classList.remove("ep-no-indent");
      if (!node.getAttribute("style")) node.removeAttribute("style");
    });
  }

  // 块级：列表先退出，再把 h1/h3/blockquote 还原成 p
  if (block) {
    const list = block.closest("ol, ul");
    if (list) {
      try {
        document.execCommand(list.tagName === "OL" ? "insertOrderedList" : "insertUnorderedList", false, null);
      } catch {
        /* 忽略 */
      }
    }
    if (/^(H1|H2|H3|H4|H5|H6|BLOCKQUOTE)$/.test(block.tagName)) {
      try {
        document.execCommand("formatBlock", false, "<p>");
      } catch {
        /* 忽略 */
      }
    }
  }
  syncBiClone(blockAtCaret() || block);
  syncFormatState();
}

// 粗体 / 斜体 / 下划线 / 删除线 / 左右对齐，作用于当前选区
// 查找并替换：在标题、正文、页眉页脚的文本节点内全局替换，替换文本留空即删除全部匹配；
// 跨多个标签被切开的片段无法命中（如 Na<sup>+</sup>），属已知边界
let replaceOpen = false;

function closeReplacePanel() {
  replaceOpen = false;
  $("replacePanel").hidden = true;
}

function toggleReplacePanel() {
  if (replaceOpen) {
    closeReplacePanel();
    return;
  }
  replaceOpen = true;
  $("replacePanel").hidden = false;
  $("replaceFind").focus();
}

function replaceInNode(root, find, repl) {
  let count = 0;
  const collect = () => {
    const nodes = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) nodes.push(n);
    return nodes;
  };
  const locate = (nodes, charIdx) => {
    let acc = 0;
    for (const node of nodes) {
      const end = acc + node.nodeValue.length;
      if (charIdx < end) return { node, off: charIdx - acc };
      acc = end;
    }
    const last = nodes[nodes.length - 1];
    return { node: last, off: last ? last.nodeValue.length : 0 };
  };
  let nodes = collect();
  let full = nodes.map((n) => n.nodeValue).join("");
  let idx = full.indexOf(find);
  while (idx >= 0) {
    const end = idx + find.length;
    const start = locate(nodes, idx);
    const endPos = locate(nodes, end);
    const range = document.createRange();
    range.setStart(start.node, start.off);
    range.setEnd(endPos.node, endPos.off);
    range.deleteContents();
    if (repl) range.insertNode(document.createTextNode(repl));
    count++;
    nodes = collect();
    full = nodes.map((n) => n.nodeValue).join("");
    idx = full.indexOf(find);
  }
  return count;
}

function runReplace() {
  const find = $("replaceFind").value;
  const repl = $("replaceRepl").value;
  if (!find) {
    flashHint("查找文本不能为空");
    return;
  }
  let count = 0;
  if (biActive()) {
    biEditTargets().forEach((col) => {
      count += replaceInNode(col, find, repl);
      const row = col.__epRow;
      if (row && row.node && row.node.isConnected) row.node.innerHTML = col.innerHTML;
    });
  } else {
    count += replaceInNode($("body"), find, repl);
  }
  [$("title"), $("pageHead"), $("pageFoot")].forEach((r) => {
    count += replaceInNode(r, find, repl);
  });
  flashHint(count ? `已替换 ${count} 处` : "未找到匹配");
  refreshWordCount();
  fit();
  closeReplacePanel();
}

function applyFormat(cmd) {
  if (!editing) return;
  if (cmd === "replace") {
    toggleReplacePanel();
    return;
  }
  if (cmd === "clearFormat") {
    clearFormatting();
    return;
  }
  if (cmd === "indent") {
    toggleIndent();
    return;
  }
  if (cmd === "fontUp" || cmd === "fontDown") {
    changeFontSize(cmd === "fontUp" ? 1 : -1);
    return;
  }
  if (cmd === "h2" || cmd === "h3") {
    toggleBlock(cmd);
    return;
  }
  if (cmd === "quote") {
    toggleQuote();
    return;
  }
  if (cmd === "ol" || cmd === "ul") {
    try {
      document.execCommand("styleWithCSS", false, true);
      document.execCommand(cmd === "ol" ? "insertOrderedList" : "insertUnorderedList", false, null);
    } catch {
      return;
    }
    const block = blockAtCaret();
    syncBiClone(block);
    syncFormatState();
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
let hintTimer = 0;

// 重跑提示条底部那道蓝光（进页面一次，之后每次换文案再来一次）
function restartHintSweep() {
  const node = $("hintText");
  node.classList.remove("is-sweeping");
  void node.offsetWidth; // 强制回流，动画才能重新开始
  node.classList.add("is-sweeping");
}

// 提示条统一入口：文案真变了才重播蓝光
function setHint(text) {
  const node = $("hintText");
  if (node.textContent === text) return;
  node.textContent = text;
  restartHintSweep();
}

// 回到基线提示：翻译引擎凭据没填时显示缺什么，否则显示默认说明
function baseHint() {
  const s = state.settings;
  if (s && !engineReady(s) && biAllowed()) return engineMissingText(s);
  return HINT_TEXT;
}

// 临时占用提示条（几秒后自动回落），用于按钮被拒时的说明
function flashHint(text, ms) {
  clearTimeout(hintTimer);
  setHint(text);
  hintTimer = setTimeout(() => {
    setHint(baseHint());
  }, ms || 2600);
}

/* ---------- 原文字数统计（工具栏正中） ---------- */

let countTimer = 0;

function refreshWordCount() {
  const el = $("wordCount");
  if (!el) return;
  // 只数正文：#body 在双语时仍是原文本身，标题不计入
  const body = ($("body") && $("body").textContent) || "";
  const cjk = (body.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const words = (body.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length;
  const total = cjk + words;
  // 字符数按非空白字符计，空格与换行不算
  const chars = body.replace(/\s/g, "").length;
  if (!total && !chars) {
    el.textContent = "";
    return;
  }
  // 中文只报字数（汉字本身就是字符，再报字符数意义不大）；西文报词数 + 字符数
  el.textContent =
    state.lang === "en"
      ? total.toLocaleString() + " words · " + chars.toLocaleString() + " chars"
      : "共 " + total.toLocaleString() + " 字";
}

function scheduleWordCount() {
  clearTimeout(countTimer);
  countTimer = setTimeout(refreshWordCount, 300);
}

let trimming = false;
let trimHover = null;
let trimPinned = false; // 按 ↑ 选过上级后，光标移动不再跟着重新选
let trimPointerTarget = null; // ↓ 回到指针下的元素用

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

// ↑：把当前悬停块上移一级到最近的内容块（对照模式行已是顶层，不再上爬）
function trimClimb() {
  if (!trimHover) return;
  if (biActive()) return;
  let parent = trimHover.parentElement;
  while (parent && parent !== $("body")) {
    if (TRIM_BLOCKS.has(parent.tagName)) {
      clearTrimHover();
      trimHover = parent;
      trimPinned = true;
      parent.classList.add("ep-trim-hover");
      return;
    }
    parent = parent.parentElement;
  }
}

// ↓：解除锁定，回到指针下的元素
function trimDescend() {
  trimPinned = false;
  const target = trimTarget(trimPointerTarget);
  clearTrimHover();
  if (target) {
    trimHover = target;
    target.classList.add("ep-trim-hover");
  }
}

function onTrimMove(e) {
  trimPointerTarget = e.target;
  if (trimPinned && trimHover) return; // 锁定后光标移动不重选
  const target = trimTarget(e.target);
  if (target === trimHover) return;
  clearTrimHover();
  if (target) {
    trimHover = target;
    target.classList.add("ep-trim-hover");
  }
}

function onTrimClick(e) {
  let target;
  if (trimPinned && trimHover) {
    // 点在锁定选区之外：解除锁定并回到指针下的元素，不删除；点在选区里才删
    if (!trimHover.contains(e.target)) {
      trimPinned = false;
      target = trimTarget(e.target);
      clearTrimHover();
      if (target) {
        trimHover = target;
        target.classList.add("ep-trim-hover");
      }
      return;
    }
    target = trimHover;
  } else {
    target = trimTarget(e.target);
  }
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  trimPinned = false;
  clearTrimHover();
  if (biActive()) {
    // 删对照行时连 #body 里对应的原文块一起删，导出才不会留残段
    const col = target.querySelector(".ep-bi__src");
    const row = col && col.firstElementChild ? col.firstElementChild.__epRow : null;
    if (row && row.node && row.node.isConnected) row.node.remove();
  }
  target.remove();
  refreshWordCount();
  fit();
}

function setTrimming(on) {
  if (on && editing) setEditing(false);
  if (on && pickingTitle) setPickingTitle(false);
  trimming = on;
  const root = biActive() ? $("bilingual") : $("body");
  $("body").classList.toggle("is-trimming", on);
  $("trimBtn").classList.toggle("is-on", on);
  $("trimBtn").textContent = on ? "退出删减" : "删减";
  setHint(on ? "点击要删除的块 · ↑ 选上级 / ↓ 回到指针 · Esc 退出删减" : baseHint());
  if (on) {
    root.addEventListener("mousemove", onTrimMove);
    root.addEventListener("click", onTrimClick, true);
  } else {
    root.removeEventListener("mousemove", onTrimMove);
    root.removeEventListener("click", onTrimClick, true);
    clearTrimHover();
    trimPinned = false;
    trimPointerTarget = null;
  }
}

/* ---------- 选取一段当标题 ---------- */

let pickingTitle = false;

function onPickMove(e) {
  const target = trimTarget(e.target);
  if (target === trimHover) return;
  clearTrimHover();
  if (target) {
    trimHover = target;
    target.classList.add("ep-trim-hover");
  }
}

function onPickClick(e) {
  const target = trimTarget(e.target);
  if (!target) return;
  e.preventDefault();
  e.stopPropagation();
  clearTrimHover();
  const text = (target.textContent || "").replace(/\s+/g, " ").trim();
  if (!text) return;
  // 换成标题：页面上那行大字与导出用的标题一起换掉
  $("title").textContent = text;
  if (state.payload) {
    state.payload.title = text;
    state.payload.titleTrans = ""; // 页面原带的那句标题译文对新标题已不成立
  }
  syncTitleTrans();
  updateDocumentTitle();
  // 剪切：这一块从正文里拿走（双语时连 #body 里对应的原文块、以及整行对照一起拿）
  let line = null;
  if (biActive()) {
    line = target.closest(".ep-bi__row");
    const col = target.querySelector(".ep-bi__src");
    const row = col && col.firstElementChild ? col.firstElementChild.__epRow : null;
    if (row && row.node && row.node.isConnected) row.node.remove();
  }
  // 只摘克隆会留下空的 <h1>/<p> 和一根空行，连外层行容器一起剪掉
  if (line) {
    if (line.querySelector(".ep-bi__tgt--none")) biPending = Math.max(0, biPending - 1);
    line.remove();
  }
  target.remove();
  dropEmptyBlocks(); // 剪走标题块后，别让空 <h1>/<p> 留在原位
  syncBiButton();
  refreshWordCount();
  setPickingTitle(false);
  fit();
}

function setPickingTitle(on) {
  if (on && editing) setEditing(false);
  if (on && trimming) setTrimming(false);
  pickingTitle = on;
  const root = biActive() ? $("bilingual") : $("body");
  $("body").classList.toggle("is-trimming", on);
  $("titleBtn").classList.toggle("is-on", on);
  $("titleBtn").textContent = on ? "退出选取" : "标题";
  setHint(on ? "点击要用作标题的块 · Esc 退出" : baseHint());
  if (on) {
    root.addEventListener("mousemove", onPickMove);
    root.addEventListener("click", onPickClick, true);
  } else {
    root.removeEventListener("mousemove", onPickMove);
    root.removeEventListener("click", onPickClick, true);
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
  $("imgBtn").title = on ? "当前隐藏图片：再点恢复显示图片" : "切换图片显示：无图时图片不参与排版与打印";
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

// 工具栏右下方的浮层提示：翻译中 / 已翻译 N 段
let toastTimer = 0;

function showToast(text, done) {
  const el = $("translateToast");
  if (!el) return;
  clearTimeout(toastTimer);
  $("translateToastText").textContent = text;
  el.classList.toggle("is-done", Boolean(done));
  el.hidden = false;
}

function hideToast(delay) {
  clearTimeout(toastTimer);
  if (!delay) {
    $("translateToast").hidden = true;
    return;
  }
  toastTimer = setTimeout(() => {
    $("translateToast").hidden = true;
  }, delay);
}

// 页面上本来就带着译文（浏览器翻译插件插入的中文）：直接把这段译文进缓存，
// 对照视图里就不用再打翻译 API，也不会把钱花在已经翻过的段落上。
let biPageKeys = new Set();

function seedPageTranslations(payload) {
  const list = (payload && payload.pageTranslations) || [];
  biPageKeys = new Set();
  if (!list.length) return;
  list.forEach((item) => {
    const src = String((item && item.src) || "").replace(/\s+/g, " ").trim();
    const dst = String((item && item.dst) || "").trim();
    if (!src || !dst) return;
    const key = biTextKey(src);
    biCache.set(key, dst);
    biUsage.set(key, Date.now());
    biPageKeys.add(key);
  });
  persistBiCache();
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

// 段落级译文缓存：按段落文本发请求、按段落存，落盘到 chrome.storage.local。
// 只存译文，键是段落文本的双哈希，所以库里不出现任何原文。
const BI_CACHE_KEY = "ep:bi:cache";
const BI_CACHE_DEFAULT_MAX = 5000; // 上限由设置里的「缓存上限」控制

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

function biCacheLimit() {
  const n = Number(state.settings && state.settings.biCacheMax);
  return Number.isFinite(n) && n > 0 ? n : BI_CACHE_DEFAULT_MAX;
}

function biCachePayload() {
  const payload = {};
  biCache.forEach((v, k) => {
    payload[k] = [v, biUsage.get(k) || 0];
  });
  return payload;
}

// 面板里显示「多少段 / 多少 MB」：按实际 JSON 的 UTF-8 字节数算
function refreshBiCacheSize() {
  const el = $("biCacheSize");
  if (!el) return;
  const json = JSON.stringify(biCachePayload());
  const bytes = new TextEncoder().encode(json).length;
  const mb = bytes / (1024 * 1024);
  el.textContent = "当前 " + biCache.size + " 段 · " + (mb < 0.1 ? "<0.1" : mb.toFixed(2)) + " MB";
}

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
  refreshBiCacheSize();
}

function persistBiCache() {
  clearTimeout(biCacheTimer);
  biCacheTimer = setTimeout(() => {
    const limit = biCacheLimit();
    if (biCache.size > limit) {
      const keep = new Set(
        Array.from(biUsage.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([k]) => k)
      );
      Array.from(biCache.keys()).forEach((k) => {
        if (!keep.has(k)) {
          biCache.delete(k);
          biUsage.delete(k);
        }
      });
    }
    chrome.storage.local.set({ [BI_CACHE_KEY]: biCachePayload() }).catch(() => {});
    refreshBiCacheSize();
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
      engine: s.engine === "baidu" ? "baidu" : "deepl",
      texts: pendingTexts,
      key: s.deeplKey,
      appid: s.baiduAppId,
      baiduKey: s.baiduKey,
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
  badge.textContent =
    kind === "todo" ? "更改" : kind === "done" ? "已译" : kind === "page" ? "页面" : "缓存";
  tgt.appendChild(badge);
}

let biResizer = null;

function ensureBiResizer() {
  const box = $("bilingual");
  if (!biResizer) {
    biResizer = document.createElement("div");
    biResizer.id = "biResizer";
    biResizer.className = "ep-bi-resizer";
    biResizer.addEventListener("pointerdown", onBiResizerDown);
  }
  if (biResizer.parentElement !== box) box.appendChild(biResizer);
  return biResizer;
}

function onBiResizerDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  const box = $("bilingual");
  const rect = box.getBoundingClientRect();
  biResizer.classList.add("is-dragging");
  const move = (ev) => {
    const ratio = ((ev.clientX - rect.left) / rect.width) * 100;
    const split = Math.round(Math.min(70, Math.max(35, ratio)));
    update({ biSplit: split });
  };
  const up = () => {
    biResizer.classList.remove("is-dragging");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function buildBilingual(rows) {
  const box = $("bilingual");
  box.innerHTML = "";
  ensureBiResizer();
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
        // 页面自带译文优先标注，其次是本次刚翻出来的、再是缓存命中
        biBadge(
          tgt,
          biPageKeys.has(key) ? "page" : biFresh.has(key) ? "done" : "cache"
        );
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

// 手机隐含串行翻译：原文段落在上，译文段落紧跟在下，不做左右两栏
function buildSerial(rows) {
  const box = $("serial");
  box.innerHTML = "";
  biPending = 0;
  rows.forEach((row) => {
    const line = document.createElement("div");
    line.className = "ep-bi__row is-serial" + (row.wide ? " is-wide" : "");

    const src = document.createElement("div");
    src.className = "ep-bi__col ep-bi__src";
    const clone = row.node.cloneNode(true);
    clone.__epRow = row;
    src.appendChild(clone);
    line.appendChild(src);

    if (!row.wide) {
      const key = row.text ? biTextKey(row.text) : "";
      const text = key ? biCache.get(key) : "";
      const heading = /^H[1-6]$/.test(row.node.tagName);
      const tgt = document.createElement(heading ? row.node.tagName.toLowerCase() : "div");
      tgt.className = "ep-bi__col ep-bi__tgt" + (heading ? " is-head" : "");
      if (text) {
        tgt.textContent = text;
        biBadge(
          tgt,
          biPageKeys.has(key) ? "page" : biFresh.has(key) ? "done" : "cache"
        );
      } else {
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
}

// 有未译段落才让「翻译」可点；对照未显示时工具栏按钮仍作为入口
function syncBiButton() {
  const active = biActive() || serialActive();
  const pending = biPending > 0;
  const allowed = biAllowed();
  const hasMix = hasMixed();
  $("translateBtn").disabled = !allowed || !pending;
  $("biBtn").disabled = !allowed || (active && !pending);
  $("mixBtn").hidden = !hasMix;
  $("mixSep").hidden = !hasMix;
  $("origMixSep").hidden = !hasMix;
  // 当前处在哪个视图，就把对应那块点亮（原文不再靠置灰表示当前态，置灰会淡得看不见）
  $("origBtn").classList.toggle("is-on", state.view === "source");
  $("mixBtn").classList.toggle("is-on", state.view === "mixed");
  $("biBtn").classList.toggle("is-on", biActive() || serialActive());
  syncTitleTrans(); // 标题译文只跟翻译视图一起出现/隐藏
  syncExcerptTrans();
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

// 页面自带逐段译文时，即使正文被识别成中文，也允许打开对照/串行查看
function hasPageTranslations() {
  return Boolean(
    state.payload && state.payload.pageTranslations && state.payload.pageTranslations.length
  );
}

// 中文正文没有翻译意义：把入口按钮禁掉，避免误点白烧额度
function biAllowed() {
  return state.lang !== "zh" || hasPageTranslations();
}

async function refreshBilingual(opts = {}) {
  const s = state.settings;
  if (!biAllowed()) {
    const box = $("bilingual");
    box.hidden = true;
    $("serial").hidden = true;
    box.innerHTML = "";
    state.biShown = false;
    if (state.view === "bi" || state.view === "serial") state.view = "source";
    biStatus("中文正文不需要翻译");
    hideToast();
    syncBiButton();
    applySettings();
    return;
  }
  if (!biActive() && !serialActive()) {
    const box = $("bilingual");
    box.hidden = true;
    $("serial").hidden = true;
    box.innerHTML = "";
    biStatus("");
    hideToast();
    syncBiButton();
    applySettings();
    return;
  }

  const rows = collectBiRows();
  const renderRows = biActive() ? buildBilingual : buildSerial;
  const sig = biSignatureOf(rows);
  biFresh.clear();

  const texts = rows.filter((row) => !row.wide).map((row) => row.text);
  const hit = texts.filter((t) => biCache.has(biTextKey(t))).length;
  // 本篇一段译文都没有（首次进来）：自动翻一次，不必先点按钮
  // 页面自带译文时不自动发请求：没配上的段落等用户点「翻译」，别替人烧额度
  const initial = !biDone && hit === 0 && biPageKeys.size === 0;
  const wantSend = Boolean(opts.send) || initial;

  if (!wantSend) {
    // 只渲染缓存命中的段落，改过的段落留「更改」红标，等点「翻译」
    biStatus("");
    renderRows(rows);
    applySettings();
    return;
  }

  let error = null;
  if (!engineReady(s)) {
    error = engineMissingText(s);
  } else {
    const miss = texts.length - hit;
    biStatus("翻译中…");
    showToast(miss > 0 ? "正在翻译 " + miss + " 段…" : "正在翻译…");
    const res = await lookUpTranslations(texts);
    error = res.error;
    if (!error) {
      biDone = true;
      biSig = sig;
      showToast(miss > 0 ? "已翻译 " + miss + " 段" : "译文已是最新", true);
      hideToast(1800);
    }
  }

  if (error) {
    // 失败时保留对照层（左原文右空位），只在状态行写清楚原因：
    // 之前直接把整层收掉，看起来像「切回了原文」，反而看不出是翻译失败
    hideToast();
    biStatus("翻译未成功：" + error, true);
    console.warn("[Element Print] 翻译未成功：", error);
    renderRows(rows);
    applySettings();
    return;
  }

  biStatus("");
  renderRows(rows);
  applySettings();
}

/* ---------- 交互 ---------- */

function update(patch) {
  state.settings = { ...state.settings, ...patch };
  rememberCurrentProfile();
  syncControls();
  applySettings();
  saveSettings(state.settings, state.profiles);
}

// 英文期刊体例：段落不缩进，靠段后留白分隔；中文仍是两字符缩进、段间不留白
function langFitPreset(preset, lang) {
  if (preset.theme !== "academic" || lang !== "en") return preset;
  const fontPx = preset.fontSize * 4 / 3; // pt → px（96dpi）
  return {
    ...preset,
    indent: 0,
    paraAfter: Math.round(fontPx * 0.55),
    titleFont: "auto",
  };
}

function getBaseline() {
  const s = state.settings;
  if (isMobile(s)) {
    return { ...DEFAULT_SETTINGS, ...MOBILE_DEFAULTS };
  }
  const preset = langFitPreset(THEME_PRESETS[s.theme || "paper"], state.lang) || {};
  const baseline = { ...DEFAULT_SETTINGS, ...preset };
  if (isEreader(s)) Object.assign(baseline, EREADER_DEFAULTS);
  return baseline;
}

// 「重置版式」只在当前组合参数偏离该组合默认值时可点
function syncResetBtn() {
  const s = state.settings;
  const btn = $("resetBtn");
  if (!btn) return;

  const baseline = getBaseline();
  const colForced = biActive() || serialActive() || isMobile(s);
  const dirty = LAYOUT_KEYS.some((key) => {
    if (key === "columns" && colForced) return false;
    return !settingsEqual(key, s, baseline);
  });
  const formatLabel = isEreader(s) ? "电纸书" : isMobile(s) ? "手机" : "A4纸";
  const themeName = themeLabel(baseline.theme || s.theme || "paper");
  btn.disabled = !dirty;
  btn.title = dirty
    ? `重置版式：把当前「${themeName} · ${formatLabel}」恢复默认值`
    : `当前就是「${themeName} · ${formatLabel}」的默认设置，没有可重置的改动`;
}

function themeLabel(theme) {
  return theme === "academic" ? "学术期刊" : theme === "gov" ? "公文" : "原版";
}

function rememberCurrentProfile() {
  const key = profileKey(state.settings.theme, state.settings.pageFormat);
  state.profiles[key] = pickLayout(state.settings);
}

function loadThemeProfile(theme, pageFormat, reset = false) {
  const isMob = pageFormat === "mobile";
  const preset = isMob
    ? {}
    : langFitPreset(THEME_PRESETS[theme], state.lang) || {};
  const saved = reset ? {} : state.profiles[profileKey(theme, pageFormat)] || {};
  if (isMob) {
    const mobileBase = { ...DEFAULT_SETTINGS, ...MOBILE_DEFAULTS };
    state.settings = reset
      ? { ...mobileBase, ...pickShared(state.settings), theme, pageFormat }
      : { ...state.settings, ...mobileBase, ...saved, theme, pageFormat };
    state.settings.columns = 1;
    return true;
  }
  if (reset) {
    const shared = pickShared(state.settings);
    state.settings = { ...DEFAULT_SETTINGS, ...preset, ...shared, theme, pageFormat };
  } else {
    state.settings = { ...state.settings, ...preset, ...saved, theme, pageFormat };
  }
  if (pageFormat === "ereader" && Object.keys(saved).length === 0) {
    Object.assign(state.settings, EREADER_DEFAULTS);
  }
  return true;
}

// 切版式：整套参数按该版式的推荐值或已保存的组合档案加载，之后仍可单项微调
function switchTheme(theme, reset = false) {
  if (!reset) rememberCurrentProfile();
  if (!loadThemeProfile(theme, state.settings.pageFormat, reset)) return;
  if (reset) delete state.profiles[profileKey(theme, state.settings.pageFormat)];
  syncControls();
  applySettings();
  saveSettings(state.settings, state.profiles);
}

function bindControls() {
  $("segTheme").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn || $("segTheme").classList.contains("is-disabled")) return;
    switchTheme(btn.dataset.value);
  });
  $("segColumns").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn || $("segColumns").classList.contains("is-disabled")) return;
    const cols = Number(btn.dataset.value);
    update({ columns: cols, spanHead: cols === 2 ? Boolean(state.settings.spanHead) : false });
  });
  $("segPageFormat").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    const pageFormat = btn.dataset.value;
    if (pageFormat === state.settings.pageFormat) return;
    rememberCurrentProfile();
    loadThemeProfile(state.settings.theme, pageFormat);
    // 翻译视图随输出对象自动切换形式：手机串行，A4/电纸书左右对照
    if (biActive() || serialActive()) {
      state.view = pageFormat === "mobile" ? "serial" : "bi";
      persistView();
      refreshBilingual();
    }
    syncControls();
    applySettings();
    saveSettings(state.settings, state.profiles);
    flushSettings(); // 页面格式选择立刻落盘，不等防抖，避免关窗后丢失
  });
  $("segImgSize").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    update({ imgSize: btn.dataset.value });
  });

  $("segLineMode").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn || btn.dataset.value === state.settings.lineHeightMode) return;
    update({ lineHeightMode: btn.dataset.value });
  });

  $("fontSize").addEventListener("input", (e) => update({ fontSize: Number(e.target.value) }));
  $("bodyFont").addEventListener("change", (e) => update({ bodyFont: e.target.value }));
  $("segBodyWeight").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-value]");
    if (!btn) return;
    update({ bodyWeight: btn.dataset.value });
  });
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
  $("allowBreak").addEventListener("change", (e) => update({ allowBreak: e.target.checked }));
  $("showHeader").addEventListener("change", (e) => update({ showHeader: e.target.checked }));
  $("showFooter").addEventListener("change", (e) => update({ showFooter: e.target.checked }));
  $("showQuote").addEventListener("change", (e) => update({ showQuote: e.target.checked }));
  $("closeAfterPrint").addEventListener("change", (e) => update({ closeAfterPrint: e.target.checked }));

  // 双语对照：开时先退出编辑/删减（改的是原文 #body，对照层只是只读副本）
  $("bilingualOn").addEventListener("change", (e) => {
    if (e.target.checked) {
      setEditing(false);
      setTrimming(false);
      state.view = "bi";
    } else {
      state.biShown = false; // 关掉开关时，顺手把「翻译」临时开出的视图也收掉
      state.view = "source";
    }
    update({ bilingual: e.target.checked });
    refreshBilingual();
  });
  $("deeplKey").addEventListener("input", (e) => update({ deeplKey: e.target.value }));
  $("baiduAppId").addEventListener("input", (e) => update({ baiduAppId: e.target.value }));
  $("baiduKey").addEventListener("input", (e) => update({ baiduKey: e.target.value }));
  $("biEngine").addEventListener("change", (e) => {
    update({ engine: e.target.value === "baidu" ? "baidu" : "deepl" });
    // 换引擎等于换一门翻译：把「已翻过」的记号清掉，下次进来会重新尝试
    biDone = false;
    biSig = "";
    syncBiCreds();
    if (biActive() || serialActive()) refreshBilingual();
  });
  $("translateBtn").addEventListener("click", () => {
    if (!biAllowed()) return; // 中文正文：按钮虽已置灰，再兜一层
    // 只翻「更改」标着的段落，其余用缓存
    refreshBilingual({ send: true });
  });
  $("biSplit").addEventListener("input", (e) => update({ biSplit: Number(e.target.value) }));
  $("biCacheMax").addEventListener("change", (e) => {
    update({ biCacheMax: Number(e.target.value) });
    persistBiCache(); // 改小上限就立刻裁一次，并把新大小显示出来
  });

  // 工具栏「翻译」：单次行为，只让这一个窗口显示对照，不去动「自动翻译」开关
  $("biBtn").addEventListener("click", () => {
    if (!biAllowed()) return;
    if (!engineReady(state.settings) && !hasPageTranslations()) {
      flashHint(engineMissingText(state.settings));
      return;
    }
    if (!biActive() && !serialActive()) {
      setEditing(false);
      setTrimming(false);
      state.biShown = true;
      // 手机隐含串行翻译；A4/电纸书走左右对照
      state.view = isMobile(state.settings) ? "serial" : "bi";
      persistView();
      refreshBilingual(); // 首次自动翻；之后按缓存渲染，改过的段落标红
      return;
    }
    refreshBilingual({ send: true }); // 已在翻译视图里：只补「更改」的段落
  });

  // 「混排」：还原抽取时保留的原始中英交错快照
  $("mixBtn").addEventListener("click", () => {
    if (state.view === "mixed") return;
    setEditing(false);
    setTrimming(false);
    state.biShown = false;
    state.view = "mixed";
    persistView();
    refreshBilingual();
    applySettings();
  });

  // 「原文」：收起对照/混排视图，回到单栏原文；开着自动翻译就顺手关掉，否则下次刷新又会弹回来
  $("origBtn").addEventListener("click", () => {
    if (state.view === "source") return;
    setEditing(false);
    setTrimming(false);
    state.biShown = false;
    state.view = "source";
    persistView();
    if (state.settings.bilingual) update({ bilingual: false });
    refreshBilingual();
    applySettings();
  });

  $("resetBtn").addEventListener("click", () => {
    switchTheme(state.settings.theme || "paper", true);
  });

  $("printBtn").addEventListener("click", () => {
    clearTrimHover();
    window.print();
  });

  // 打印前重建 @page，确保页眉里改过的文字进到页边距盒
  window.addEventListener("beforeprint", () => {
    if (state.settings) $("pageRule").textContent = buildPageRule(state.settings);
  });
  window.addEventListener("afterprint", () => {
    if (state.settings && state.settings.closeAfterPrint) {
      flushSettings();
      window.close();
      chrome.runtime.sendMessage({ type: "ep:closePreview" }).catch(() => {});
    }
  });
  $("exportBtn").addEventListener("click", () => {
    exportHtml().catch((err) => showError("导出失败：" + ((err && err.message) || err)));
  });

  $("editBtn").addEventListener("click", () => {
    setEditing(!editing);
  });

  $("replaceGo").addEventListener("click", runReplace);
  $("replaceClose").addEventListener("click", closeReplacePanel);
  [$("replaceFind"), $("replaceRepl")].forEach((inp) => {
    inp.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        runReplace();
      }
      e.stopPropagation();
    });
  });

  // 编辑/删减都会改变字数，sheet 上的 input 冒泡统一接住（双语左栏也在 sheet 里）
  $("sheet").addEventListener("input", scheduleWordCount);

  // 标题区元信息：编辑后写回 payload，空内容自动隐藏
  const bindMetaEdit = (id, key) => {
    $(id).addEventListener("input", () => {
      const text = $(id).textContent.replace(/\s+/g, " ").trim();
      if (state.payload) state.payload[key] = text;
      $(id).hidden = !text;
    });
  };
  bindMetaEdit("metaAuthor", "author");
  bindMetaEdit("metaPubDate", "publishedTime");
  bindMetaEdit("excerpt", "excerpt");
  bindMetaEdit("excerptTrans", "excerptTrans");
  bindMetaEdit("titleTrans", "titleTrans");

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
  $("titleBtn").addEventListener("click", () => {
    setPickingTitle(!pickingTitle);
  });
  $("imgBtn").addEventListener("click", () => setImagesHidden(!hideImages));

  document.addEventListener("keydown", (e) => {
    if (trimming && e.key === "ArrowUp") {
      e.preventDefault();
      trimClimb();
      return;
    }
    if (trimming && e.key === "ArrowDown") {
      e.preventDefault();
      trimDescend();
      return;
    }
    if (replaceOpen && e.key === "Escape") {
      e.preventDefault();
      closeReplacePanel();
      return;
    }
    if (e.key !== "Escape") return;
    if (trimming) {
      e.preventDefault();
      setTrimming(false);
    } else if (pickingTitle) {
      e.preventDefault();
      setPickingTitle(false);
    } else if (editing) {
      e.preventDefault();
      // 有改动时先确认；确认「取消」等于不保存，按快照还原后退出
      if (editChanged() && window.confirm("文章有改动，确认取消（不保存）吗？")) {
        restoreEditSnapshot();
      }
      setEditing(false);
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
  const er = isEreader(s);
  const mob = isMobile(s);
  const sizePage = er ? EREADER_PAGE : mob ? MOBILE_PAGE : null;
  const vars = [
    `--ep-font-size:${s.fontSize}pt`,
    `--ep-title-size:${s.titleSize}pt`,
    `--ep-line-height:${s.lineHeightMode === "fixed" ? s.lineHeightFixed + "pt" : s.lineHeight}`,
    `--ep-para-before:${s.paraBefore}px`,
    `--ep-para-after:${s.paraAfter}px`,
    `--ep-columns:${biActive() || serialActive() || mob ? 1 : s.columns === 2 ? 2 : 1}`,
    `--ep-img-max:${IMG_SIZE_MAX[s.imgSize] || IMG_SIZE_MAX.full}`,
    `--ep-split:${(s.biSplit || 57)}%`,
    `--ep-indent:${s.indent}em`,
    `--ep-body-font:${bodyFontStack(s.bodyFont, state.lang)}`,
    `--ep-body-weight:${BODY_WEIGHTS[s.bodyWeight] || 400}`,
    `--ep-title-font:${titleFontStack(s, state.lang)}`,
    `--ep-page-w:${sizePage ? sizePage.w : "210mm"}`,
    `--ep-page-h:${sizePage ? sizePage.h : "297mm"}`,
    `--ep-mt:${mob ? MOBILE_PAGE.mt : s.marginTop}mm`,
    `--ep-mr:${mob ? MOBILE_PAGE.mr : s.marginRight}mm`,
    `--ep-mb:${mob ? MOBILE_PAGE.mb : s.marginBottom}mm`,
    `--ep-ml:${mob ? MOBILE_PAGE.ml : s.marginLeft}mm`,
  ].join(";");

  const sheetCopy = $("sheet").cloneNode(true);
  sheetCopy.classList.remove("is-editing");
  // 「缓存」小标签只是编辑时的提示，不进导出的文档
  sheetCopy.querySelectorAll(".ep-bi__badge, .ep-bi-resizer").forEach((node) => node.remove());
  sheetCopy.querySelectorAll(".ep-trim-hover, .is-trimming").forEach((node) => {
    node.classList.remove("ep-trim-hover");
    node.classList.remove("is-trimming");
  });
  sheetCopy.querySelectorAll("[contenteditable]").forEach((node) => {
    node.removeAttribute("contenteditable");
    node.removeAttribute("spellcheck");
  });
  // 导出/打印只保留当前视图：原文、混排、对照三选一，其余数据源层整块剔除
  sheetCopy.querySelectorAll("#body, #mixed, #bilingual").forEach((node) => {
    const keep =
      node.id === "body" ? !biActive() && !mixedActive() && !serialActive()
        : node.id === "mixed" ? mixedActive()
          : node.id === "serial" ? serialActive()
            : biActive();
    if (!keep) node.remove();
  });
  const sheetHtml = sheetCopy.innerHTML;
  const title = state.payload ? state.payload.title : "Element Print";
  const docTitle = er ? `${title} - e-ink` : title;

  return `<!DOCTYPE html>
<html lang="${state.lang === "en" ? "en" : "zh-CN"}">
<head>
<meta charset="utf-8">
<title>${esc(docTitle)}</title>
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
<div class="ep-sheet${s.spanHead ? " is-span-head" : ""}" data-theme="${s.theme || "paper"}" data-page-format="${s.pageFormat || "a4"}" data-lang="${state.lang}" lang="${state.lang === "en" ? "en" : "zh-CN"}">
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
  const suffix = isEreader(state.settings) ? "-e-ink" : "";
  a.download = safeFileName(state.payload.title) + suffix + ".html";
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
  const loaded = await loadSettings();
  state.profiles = loaded.profiles || {};
  delete loaded.profiles;
  state.settings = loaded;
  if (isEreader(state.settings)) applyEreaderDefaults();
  await loadBiCache(); // 上次留下的段落译文先灌进内存，命中就不必再打 API
  fillFontSelects();
  syncControls();
  bindControls();
  window.addEventListener("pagehide", flushSettings);

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
  syncBiButton();
  // 记住上次工具栏所选视图：原文 / 混排 / 翻译；翻译在手机下内部解析为串行
  const hasPageTrans = Boolean(
    payload.pageTranslations && payload.pageTranslations.length
  );
  const savedView = state.settings.view;
  let startSerial = false;
  let startMixed = false;
  let startBi = false;

  if (savedView === "mixed" && hasMixed()) {
    startMixed = true;
  } else if (savedView === "bi" && biAllowed()) {
    startSerial = isMobile(state.settings);
    startBi = !startSerial;
    state.biShown = true;
  } else if (savedView !== "source") {
    // 没有可沿用的记忆时，按内容与输出对象给默认视图
    if (isMobile(state.settings) && hasPageTrans) {
      startSerial = true;
      state.biShown = true;
    } else if (hasMixed()) {
      startMixed = true;
    } else if (state.settings.bilingual || hasPageTrans) {
      startBi = biAllowed();
      state.biShown = startBi;
    }
  }

  state.view = startSerial ? "serial" : startMixed ? "mixed" : startBi ? "bi" : "source";
  applySettings(); // 初始视图是在首次 applySettings 之后才确定，需同步一次容器显隐
  if (startBi || startSerial) refreshBilingual();
  syncBiButton();
  if (startSerial) flashHint("手机阅读：已按原文/译文串行排列");
  else if (startBi && hasPageTrans) flashHint("页面自带译文，已放进右栏对照");
  state.ready = true;
  restartHintSweep(); // 进页面先扫一遍
}

init();

// 历史记录页：读取 ep:history 索引，支持搜索、按域名筛选、分页、多选删除与导出 HTML。

const HISTORY_KEY = "ep:history";
const PAYLOAD_PREFIX = "ep:payload:";
const PAGE_SIZE = 100;

const t = (key, subs) => {
  try {
    return chrome.i18n.getMessage(key, subs) || key;
  } catch (err) {
    return key;
  }
};

const $ = (id) => document.getElementById(id);

let all = [];
let query = "";
let site = "";
let page = 1;
const selected = new Set();

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (err) {
    return "";
  }
}

function dayKey(at) {
  const d = new Date(at);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(key) {
  const today = dayKey(Date.now());
  if (key === today) return t("dateToday");
  const yesterday = dayKey(Date.now() - 86400000);
  if (key === yesterday) return t("dateYesterday");
  return key;
}

function timeLabel(at) {
  const d = new Date(at);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function filtered() {
  const q = query.trim().toLowerCase();
  return all.filter((rec) => {
    if (site && hostOf(rec.url) !== site) return false;
    if (!q) return true;
    return (
      String(rec.title || "").toLowerCase().includes(q) ||
      String(rec.url || "").toLowerCase().includes(q)
    );
  });
}

function pageCount(total) {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}

function openOriginal(url) {
  if (!url) return;
  chrome.tabs.create({ url, active: true });
}

function chip(text) {
  const el = document.createElement("span");
  el.className = "ep-hist__day";
  el.textContent = text;
  return el;
}

function render() {
  const list = $("list");
  const rows = filtered();
  const pages = pageCount(rows.length);
  if (page > pages) page = pages;
  const start = (page - 1) * PAGE_SIZE;
  const slice = rows.slice(start, start + PAGE_SIZE);

  list.textContent = "";
  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "ep-hist__empty";
    empty.textContent = all.length ? t("historyNoMatch") : t("historyEmpty");
    list.appendChild(empty);
  } else {
    let lastDay = "";
    slice.forEach((rec) => {
      const key = dayKey(rec.at);
      if (key !== lastDay) {
        list.appendChild(chip(dayLabel(key)));
        lastDay = key;
      }
      list.appendChild(rowOf(rec));
    });
  }

  $("pageInfo").textContent = t("historyPageInfo", [String(page), String(pages), String(rows.length)]);
  $("btnPrev").disabled = page <= 1;
  $("btnNext").disabled = page >= pages;
  $("btnDelete").disabled = !selected.size;
  updateSelectedCount();
  updateSiteTag();
  syncSelectPage();
}

// 图标按钮：文字只作 title/aria，视觉上只剩图形；图标取自 Lucide（src/shared/icons.js）
function iconButton(name, label, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "ep-hist__icon";
  btn.title = label;
  btn.setAttribute("aria-label", label);
  const svg = window.ElementPrintIcons && window.ElementPrintIcons.svg(name, { size: 16, stroke: 2 });
  if (svg) btn.appendChild(svg);
  else btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function rowOf(rec) {
  const row = document.createElement("div");
  row.className = "ep-hist__row";

  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = selected.has(rec.id);
  box.addEventListener("change", () => {
    if (box.checked) selected.add(rec.id);
    else selected.delete(rec.id);
    updateSelectedCount();
    syncSelectPage();
  });
  const time = document.createElement("span");
  time.className = "ep-hist__time";
  time.textContent = timeLabel(rec.at);

  const main = document.createElement("div");
  main.className = "ep-hist__main";

  const title = document.createElement("a");
  title.className = "ep-hist__title";
  title.textContent = rec.title || rec.url || "(untitled)";
  title.title = t("historyOpenTip");
  if (rec.url) {
    title.href = rec.url;
    title.rel = "noopener noreferrer";
    title.target = "_blank";
  } else {
    title.href = "#";
    title.addEventListener("click", (e) => e.preventDefault());
  }

  const url = document.createElement("span");
  url.className = "ep-hist__url";
  url.textContent = rec.url || "";

  main.append(title, url);

  const acts = document.createElement("div");
  acts.className = "ep-hist__acts";

  const host = hostOf(rec.url);
  if (host) {
    acts.appendChild(
      iconButton("filter", t("historySiteFilter"), () => {
        site = host;
        page = 1;
        render();
      })
    );
  }
  acts.appendChild(iconButton("trash-2", t("historyDelete"), () => removeRecords([rec.id])));

  row.append(box, time, main, acts);
  return row;
}

function updateSelectedCount() {
  $("selectedCount").textContent = selected.size ? t("historySelected", [String(selected.size)]) : "";
}

function currentPageIds() {
  const rows = filtered();
  const start = (page - 1) * PAGE_SIZE;
  return rows.slice(start, start + PAGE_SIZE).map((rec) => rec.id);
}

function syncSelectPage() {
  const ids = currentPageIds();
  const box = $("selectPage");
  box.checked = ids.length > 0 && ids.every((id) => selected.has(id));
}

function updateSiteTag() {
  const tag = $("siteTag");
  tag.hidden = !site;
  $("siteTagText").textContent = site ? t("historySiteTag", [site]) : "";
}

async function load() {
  const got = await chrome.storage.local.get(HISTORY_KEY);
  all = (Array.isArray(got[HISTORY_KEY]) ? got[HISTORY_KEY] : [])
    .filter((rec) => rec && rec.id)
    .sort((a, b) => (b.at || 0) - (a.at || 0));
  // 已删除的记录不应继续留在选中集合里
  Array.from(selected).forEach((id) => {
    if (!all.some((rec) => rec.id === id)) selected.delete(id);
  });
  render();
}

async function removeRecords(ids) {
  if (!ids.length) return;
  const keep = all.filter((rec) => !ids.includes(rec.id));
  await chrome.storage.local.set({ [HISTORY_KEY]: keep });
  await chrome.storage.local.remove(ids.map((id) => PAYLOAD_PREFIX + id));
  ids.forEach((id) => selected.delete(id));
  await load();
}

function esc(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildExportHtml(rows) {
  const groups = new Map();
  rows.forEach((rec) => {
    const key = dayKey(rec.at);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  });
  const parts = [];
  groups.forEach((items, key) => {
    // 导出文件是长期留档，分组标签一律用具体日期，不用「今天/昨天」
    parts.push(`<h2>${esc(key)}</h2>`);
    parts.push("<ul>");
    items.forEach((rec) => {
      parts.push(
        `<li><time>${esc(timeLabel(rec.at))}</time> <a href="${esc(rec.url)}">${esc(
          rec.title || rec.url || "(untitled)"
        )}</a></li>`
      );
    });
    parts.push("</ul>");
  });
  const title = t("historyTitle");
  return `<!doctype html>
<html lang="${document.documentElement.lang || "zh-CN"}">
<head>
<meta charset="utf-8">
<title>${esc(title)} · Element Print</title>
<style>
body{margin:32px auto;max-width:760px;padding:0 20px;color:#1f2430;
font:14px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}
h1{font-size:20px;margin:0 0 18px}
h2{font-size:13px;font-weight:600;color:#5f6775;margin:22px 0 6px;letter-spacing:.04em}
ul{margin:0;padding:0;list-style:none}
li{padding:6px 0;border-bottom:1px solid #e3e6eb}
time{color:#5f6775;font-variant-numeric:tabular-nums;margin-right:8px}
a{color:#1f2430;text-decoration:none}
a:hover{color:#2f5fd0;text-decoration:underline}
</style>
</head>
<body>
<h1>${esc(title)}</h1>
${parts.join("\n")}
</body>
</html>`;
}

async function exportHtml() {
  const rows = filtered();
  if (!rows.length) return;
  const html = buildExportHtml(rows);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const name = `element-print-history-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.html`;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function bind() {
  const lang = (chrome.i18n.getUILanguage() || "en").toLowerCase();
  document.documentElement.lang = lang.startsWith("zh") ? "zh-CN" : "en";
  document.title = t("historyTitle") + " · Element Print";
  $("title").textContent = t("historyTitle");
  $("search").placeholder = t("historySearch");
  $("search").addEventListener("input", (e) => {
    query = e.target.value;
    page = 1;
    render();
  });
  $("siteTagClear").addEventListener("click", () => {
    site = "";
    page = 1;
    render();
  });
  $("btnExport").addEventListener("click", () => exportHtml());
  $("btnDelete").addEventListener("click", async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (!confirm(t("historyConfirmDelete", [String(ids.length)]))) return;
    await removeRecords(ids);
  });
  $("btnClear").addEventListener("click", async () => {
    if (!all.length) return;
    if (!confirm(t("historyConfirmClear"))) return;
    await removeRecords(all.map((rec) => rec.id));
    selected.clear();
    page = 1;
    await load();
  });
  $("selectPage").addEventListener("change", (e) => {
    const ids = currentPageIds();
    if (e.target.checked) ids.forEach((id) => selected.add(id));
    else ids.forEach((id) => selected.delete(id));
    render();
  });
  $("btnPrev").addEventListener("click", () => {
    if (page > 1) {
      page -= 1;
      render();
    }
  });
  $("btnNext").addEventListener("click", () => {
    if (page < pageCount(filtered().length)) {
      page += 1;
      render();
    }
  });
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.dataset.i18n;
    if (key) node.textContent = t(key);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[HISTORY_KEY]) load();
  });
}

bind();
load();

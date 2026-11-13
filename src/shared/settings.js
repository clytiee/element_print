// 版面设置的默认值与持久化（chrome.storage.local）

// 正文字体 / 标题字体预设：库里只存 key，渲染时换成 font-family 栈。
// 所有栈都按「先拉丁、后中文」排列，混排时西文与汉字各自命中合适的字体。
export const FONT_PRESETS = {
  auto: {
    label: "自动（中文宋体 · 西文 Times）",
    stack:
      '"Times New Roman", Georgia, "Noto Serif SC", "Source Han Serif SC", "思源宋体 CN", "Songti SC", "SimSun", serif',
  },
  song: {
    label: "宋体（思源宋 / 宋体）",
    stack:
      '"Times New Roman", Georgia, "Noto Serif SC", "Source Han Serif SC", "思源宋体 CN", "Songti SC", "SimSun", serif',
  },
  hei: {
    label: "黑体（思源黑 / 雅黑）",
    stack:
      '"Segoe UI", Arial, "Noto Sans SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", "SimHei", sans-serif',
  },
  kai: {
    label: "楷体",
    stack: '"Times New Roman", Georgia, KaiTi, "Kaiti SC", STKaiti, "楷体", serif',
  },
  fangsong: {
    label: "仿宋",
    stack: '"Times New Roman", Georgia, FangSong, STFangsong, "仿宋", "华文仿宋", serif',
  },
  times: {
    label: "Times New Roman（西文衬线）",
    stack: '"Times New Roman", Times, "Liberation Serif", serif',
  },
  georgia: {
    label: "Georgia（西文衬线）",
    stack: 'Georgia, "Times New Roman", serif',
  },
  sans: {
    label: "无衬线（Segoe / 苹方）",
    stack: '"Segoe UI", -apple-system, "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  },
};

export const BODY_WEIGHTS = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

export const DEFAULT_SETTINGS = {
  theme: "paper", // paper（原版报纸感） | academic（学术期刊）
  columns: 1, // 1 | 2
  fontSize: 12, // pt
  titleSize: 22.8, // pt，标题字号独立设
  lineHeightMode: "ratio", // ratio（倍数） | fixed（固定磅值）
  lineHeight: 1.75, // 倍数模式下的行高倍数
  lineHeightFixed: 26, // 固定磅值模式下的行距（pt）
  paraBefore: 0, // px
  paraAfter: 9, // px
  indent: 0, // 首行缩进（字）
  bodyFont: "auto", // FONT_PRESETS 的 key
  bodyWeight: "normal", // BODY_WEIGHTS 的 key
  titleFont: "inherit", // inherit（跟随正文）| FONT_PRESETS 的 key
  spanHead: false, // 双栏时一级标题是否跨栏
  allowBreak: true, // 段落可否跨页（默认允许段落从中间断开）
  marginTop: 15, // mm
  marginRight: 15,
  marginBottom: 15,
  marginLeft: 15,
  showUrl: true,
  showTime: false,
  showHeader: true, // 页眉（Element Print / 摘自 域名）
  showFooter: true, // 页脚（品牌 + 页码）
  showQuote: true, // 页脚左下角随机显示一句名言
  pageFormat: "a4", // a4 | ereader（10.3″ 4:3 电纸书）| mobile（手机竖屏）
  bilingual: false, // 双语对照：左原文 / 右译文（逐段对齐）
  biSplit: 57, // 原文列宽（%），中西文宽度差明显，默认原文略宽
  biCacheMax: 5000, // 最多保留多少段译文缓存，超出按最近使用裁旧
  imgSize: "full", // 正文图片显示档位：small（小）| mid（中）| full（原大）
  deeplKey: "", // DeepL Auth Key（仅存本地）
  deeplFree: true, // true 走免费端点 api-free.deepl.com
  engine: "deepl", // 翻译引擎：deepl / baidu
  baiduAppId: "", // 百度翻译开放平台 APP ID
  baiduKey: "", // 百度翻译开放平台密钥
  targetLang: "ZH", // 目标语言（DeepL 用大写码，百度用小写码，后台换算）
  view: "source", // source（原文） | mixed（中英混排） | bi（翻译；手机下内部解析为串行）
};

// 电纸书默认排版；切到该格式时套用，之后仍可单项微调
export const EREADER_DEFAULTS = {
  bodyWeight: "semibold",
  fontSize: 12.5,
  lineHeightMode: "ratio",
  lineHeight: 1.25,
  paraAfter: 6,
};

// 手机竖屏默认排版：单列、宽松行距、无页眉页脚与来源信息，格言作为文末收尾
export const MOBILE_DEFAULTS = {
  columns: 1,
  fontSize: 10,
  titleSize: 13,
  lineHeightMode: "ratio",
  lineHeight: 1.35,
  paraAfter: 6,
  indent: 0,
  bodyFont: "auto",
  bodyWeight: "normal",
  titleFont: "inherit",
  marginTop: 3, // mm
  marginRight: 3,
  marginBottom: 3,
  marginLeft: 3,
  showHeader: false,
  showFooter: false,
  showUrl: false,
  showTime: false,
  showQuote: true,
};

// 随「版式 × 页面格式」分别记忆的排版项
export const LAYOUT_KEYS = [
  "columns",
  "fontSize",
  "titleSize",
  "lineHeightMode",
  "lineHeight",
  "lineHeightFixed",
  "paraBefore",
  "paraAfter",
  "indent",
  "bodyFont",
  "bodyWeight",
  "titleFont",
  "spanHead",
  "allowBreak",
  "biSplit",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "showUrl",
  "showTime",
  "showHeader",
  "showFooter",
  "showQuote",
];

// 跨组合共享的全局项
const SHARED_KEYS = [
  "bilingual",
  "biCacheMax",
  "imgSize",
  "engine",
  "deeplKey",
  "deeplFree",
  "baiduAppId",
  "baiduKey",
  "targetLang",
  "pageFormat",
  "view",
];

export function profileKey(theme, pageFormat) {
  if (pageFormat === "mobile") return "mobile";
  const fmt = pageFormat === "ereader" ? "ereader" : "a4";
  return `${theme || "paper"}:${fmt}`;
}

export function pickLayout(settings) {
  const out = {};
  LAYOUT_KEYS.forEach((key) => {
    if (settings[key] !== undefined) out[key] = settings[key];
  });
  return out;
}

export function pickShared(settings) {
  const out = {};
  SHARED_KEYS.forEach((key) => {
    if (settings[key] !== undefined) out[key] = settings[key];
  });
  return out;
}

// 切版式时套用的整套参数；之后仍可单独微调
export const THEME_PRESETS = {
  paper: {
    theme: "paper",
    columns: 1,
    fontSize: 12,
    titleSize: 22.8,
    lineHeightMode: "ratio",
    lineHeight: 1.75,
    lineHeightFixed: 26,
    paraBefore: 0,
    paraAfter: 9,
    indent: 0,
    bodyFont: "auto",
    bodyWeight: "normal",
    titleFont: "inherit",
    spanHead: false,
    allowBreak: true,
    biSplit: 57,
    marginTop: 15,
    marginRight: 15,
    marginBottom: 15,
    marginLeft: 15,
    showUrl: true,
    showTime: false,
    showHeader: true,
    showFooter: true,
    showQuote: true,
  },
  academic: {
    theme: "academic",
    columns: 2,
    fontSize: 10.5,
    titleSize: 18.4,
    lineHeightMode: "ratio",
    lineHeight: 1.55,
    lineHeightFixed: 15.5,
    paraBefore: 0,
    paraAfter: 0,
    indent: 2,
    bodyFont: "auto",
    bodyWeight: "normal",
    titleFont: "hei",
    spanHead: false,
    allowBreak: true,
    biSplit: 57,
    marginTop: 22,
    marginRight: 20,
    marginBottom: 20,
    marginLeft: 20,
    showUrl: false,
    showTime: false,
    showHeader: true,
    showFooter: true,
    showQuote: true,
  },
  // 党政机关公文（GB/T 9704）：三号仿宋、固定行距 28pt、非对称页边距
  gov: {
    theme: "gov",
    columns: 1,
    fontSize: 16, // 三号
    titleSize: 22, // 二号
    lineHeightMode: "fixed",
    lineHeight: 1.75,
    lineHeightFixed: 28,
    paraBefore: 0,
    paraAfter: 0,
    indent: 2,
    bodyFont: "fangsong",
    bodyWeight: "normal",
    titleFont: "song",
    spanHead: false,
    allowBreak: true,
    biSplit: 57,
    marginTop: 37,
    marginRight: 26,
    marginBottom: 35,
    marginLeft: 28,
    showUrl: false,
    showTime: false,
    showHeader: false, // 公文页眉位置留给份号/密级，正文摘录不画
    showFooter: true, // 页码在版心底（地脚）
    showQuote: true,
  },
};

// 页边距预置：窄 / 中 / 宽（学术期刊用「宽」）
export const MARGIN_PRESETS = {
  narrow: { marginTop: 10, marginRight: 10, marginBottom: 10, marginLeft: 10 },
  medium: { marginTop: 15, marginRight: 15, marginBottom: 15, marginLeft: 15 },
  wide: { marginTop: 22, marginRight: 20, marginBottom: 20, marginLeft: 20 },
};

const THEMES = Object.keys(THEME_PRESETS);

const STORAGE_KEY = "ep:settings";

function clamp(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

function normalizeShared(raw, base) {
  if (raw.pageFormat === "ereader" || raw.pageFormat === "mobile") {
    base.pageFormat = raw.pageFormat;
  } else {
    base.pageFormat = "a4";
  }
  if (raw.view === "mixed" || raw.view === "bi") base.view = raw.view;
  else base.view = "source";
  if (typeof raw.bilingual === "boolean") base.bilingual = raw.bilingual;
  base.biCacheMax = clamp(raw.biCacheMax, 100, 20000, base.biCacheMax);
  if (raw.imgSize === "small" || raw.imgSize === "mid" || raw.imgSize === "full") {
    base.imgSize = raw.imgSize;
  }
  if (typeof raw.deeplKey === "string") base.deeplKey = raw.deeplKey.trim().slice(0, 200);
  if (typeof raw.deeplFree === "boolean") base.deeplFree = raw.deeplFree;
  if (raw.engine === "baidu" || raw.engine === "deepl") base.engine = raw.engine;
  if (typeof raw.baiduAppId === "string") base.baiduAppId = raw.baiduAppId.trim().slice(0, 60);
  if (typeof raw.baiduKey === "string") base.baiduKey = raw.baiduKey.trim().slice(0, 60);
  if (typeof raw.targetLang === "string" && /^[A-Za-z-]{2,8}$/.test(raw.targetLang)) {
    base.targetLang = raw.targetLang.toUpperCase();
  }
}

function normalizeLayout(raw, base) {
  if (raw.columns === 2) base.columns = 2;
  if (raw.lineHeightMode === "fixed") base.lineHeightMode = "fixed";

  base.fontSize = clamp(raw.fontSize, 9, 20, base.fontSize);
  base.titleSize = clamp(raw.titleSize, 12, 40, base.titleSize);
  base.lineHeight = clamp(raw.lineHeight, 1.2, 2.4, base.lineHeight);
  base.lineHeightFixed = clamp(raw.lineHeightFixed, 10, 40, base.lineHeightFixed);
  base.paraBefore = clamp(raw.paraBefore, 0, 40, base.paraBefore);
  base.paraAfter = clamp(raw.paraAfter, 0, 48, base.paraAfter);
  base.indent = clamp(raw.indent, 0, 4, base.indent);

  // 旧版只有一个统一 margin，迁移成四边相同
  const legacy = clamp(raw.margin, 3, 40, base.marginTop);
  base.marginTop = clamp(raw.marginTop, 3, 40, legacy);
  base.marginRight = clamp(raw.marginRight, 3, 40, legacy);
  base.marginBottom = clamp(raw.marginBottom, 3, 40, legacy);
  base.marginLeft = clamp(raw.marginLeft, 3, 40, legacy);

  if (typeof raw.spanHead === "boolean") base.spanHead = raw.spanHead;
  if (typeof raw.allowBreak === "boolean") base.allowBreak = raw.allowBreak;
  if (typeof raw.showUrl === "boolean") base.showUrl = raw.showUrl;
  if (typeof raw.showTime === "boolean") base.showTime = raw.showTime;
  if (typeof raw.showHeader === "boolean") base.showHeader = raw.showHeader;
  if (typeof raw.showFooter === "boolean") base.showFooter = raw.showFooter;
  if (typeof raw.showQuote === "boolean") base.showQuote = raw.showQuote;
  base.biSplit = clamp(raw.biSplit, 35, 70, base.biSplit);
  if (FONT_PRESETS[raw.bodyFont]) base.bodyFont = raw.bodyFont;
  if (BODY_WEIGHTS[raw.bodyWeight]) base.bodyWeight = raw.bodyWeight;
  if (raw.titleFont === "inherit" || FONT_PRESETS[raw.titleFont]) {
    base.titleFont = raw.titleFont;
  }
}

function normalize(raw) {
  const base = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return base;

  if (THEMES.includes(raw.theme)) base.theme = raw.theme;
  normalizeShared(raw, base);

  const profiles = raw.profiles && typeof raw.profiles === "object" ? { ...raw.profiles } : {};
  const key = profileKey(base.theme, base.pageFormat);
  let saved = profiles[key];
  // 兼容旧的按「版式 × 手机」存下的档案：并入统一 mobile 档案
  if (!saved && base.pageFormat === "mobile") {
    saved = profiles[`${base.theme}:mobile`] || null;
  }
  if (!saved && LAYOUT_KEYS.some((k) => raw[k] !== undefined)) saved = raw;

  const layoutBase =
    base.pageFormat === "mobile"
      ? { ...DEFAULT_SETTINGS, ...MOBILE_DEFAULTS }
      : { ...DEFAULT_SETTINGS, ...(THEME_PRESETS[base.theme] || {}) };
  normalizeLayout(saved || {}, layoutBase);
  if (base.pageFormat === "mobile") {
    layoutBase.columns = 1;
    layoutBase.showHeader = false;
    layoutBase.showFooter = false;
  }
  if (layoutBase.columns !== 2) layoutBase.spanHead = false;
  const hasSaved = saved && Object.keys(saved).length > 0;
  if (base.pageFormat === "ereader" && !hasSaved) {
    Object.assign(layoutBase, EREADER_DEFAULTS);
  }

  // layoutBase 只保留版式项；共享项以 base 为准，避免默认 pageFormat 覆盖已保存格式
  delete layoutBase.theme;
  delete layoutBase.pageFormat;
  SHARED_KEYS.forEach((key) => delete layoutBase[key]);

  return { ...base, ...layoutBase, profiles };
}

export async function loadSettings() {
  try {
    const got = await chrome.storage.local.get(STORAGE_KEY);
    return normalize(got[STORAGE_KEY]);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

let saveTimer = 0;
let lastSettings = null;
let lastProfiles = null;

async function persistSettings(settings, profiles) {
  try {
    const existing = await chrome.storage.local.get(STORAGE_KEY);
    const prev = existing[STORAGE_KEY] || {};
    const mergedProfiles =
      prev.profiles && typeof prev.profiles === "object" ? { ...prev.profiles } : {};
    if (profiles && typeof profiles === "object") {
      Object.entries(profiles).forEach(([key, value]) => {
        mergedProfiles[key] = value;
      });
    }
    const key = profileKey(settings.theme, settings.pageFormat);
    mergedProfiles[key] = pickLayout(settings);
    const out = {
      ...pickShared(settings),
      theme: settings.theme,
      pageFormat: settings.pageFormat,
      profiles: mergedProfiles,
    };
    await chrome.storage.local.set({ [STORAGE_KEY]: out });
  } catch {
    // 存储不可用时保留内存态，下次设置变更再重试
  }
}

export function saveSettings(settings, profiles) {
  lastSettings = settings;
  lastProfiles = profiles;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    persistSettings(lastSettings, lastProfiles);
    lastSettings = null;
    lastProfiles = null;
  }, 260);
}

// 预览页关闭前把还在防抖队列里的设置立刻落盘，避免页面格式这类选择丢失
export function flushSettings() {
  if (!lastSettings) return;
  clearTimeout(saveTimer);
  persistSettings(lastSettings, lastProfiles);
  lastSettings = null;
  lastProfiles = null;
}

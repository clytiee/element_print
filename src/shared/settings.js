// 版面设置的默认值与持久化（chrome.storage.local）

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
  spanHead: false, // 双栏时一级标题是否跨栏
  marginTop: 15, // mm
  marginRight: 15,
  marginBottom: 15,
  marginLeft: 15,
  showUrl: true,
  showTime: false,
};

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
    spanHead: false,
    marginTop: 15,
    marginRight: 15,
    marginBottom: 15,
    marginLeft: 15,
    showUrl: true,
    showTime: false,
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
    spanHead: true,
    marginTop: 22,
    marginRight: 20,
    marginBottom: 20,
    marginLeft: 20,
    showUrl: false,
    showTime: false,
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

function normalize(raw) {
  const base = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return base;

  if (THEMES.includes(raw.theme)) base.theme = raw.theme;
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
  const legacy = clamp(raw.margin, 6, 40, base.marginTop);
  base.marginTop = clamp(raw.marginTop, 6, 40, legacy);
  base.marginRight = clamp(raw.marginRight, 6, 40, legacy);
  base.marginBottom = clamp(raw.marginBottom, 6, 40, legacy);
  base.marginLeft = clamp(raw.marginLeft, 6, 40, legacy);

  if (typeof raw.spanHead === "boolean") base.spanHead = raw.spanHead;
  if (typeof raw.showUrl === "boolean") base.showUrl = raw.showUrl;
  if (typeof raw.showTime === "boolean") base.showTime = raw.showTime;
  return base;
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

export function saveSettings(settings) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    chrome.storage.local.set({ [STORAGE_KEY]: settings }).catch(() => {});
  }, 260);
}

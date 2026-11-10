// 版面设置的默认值与持久化（chrome.storage.local）

export const DEFAULT_SETTINGS = {
  columns: 1, // 1 | 2
  fontSize: 15.5, // pt
  lineHeight: 1.75,
  paraBefore: 0, // px
  paraAfter: 9, // px
  showUrl: true,
  showTime: false,
  margin: 15, // mm
};

const STORAGE_KEY = "ep:settings";

function normalize(raw) {
  const base = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return base;
  if (raw.columns === 2) base.columns = 2;
  if (Number.isFinite(raw.fontSize)) base.fontSize = Math.min(22, Math.max(10, raw.fontSize));
  if (Number.isFinite(raw.lineHeight)) base.lineHeight = Math.min(2.4, Math.max(1.2, raw.lineHeight));
  if (Number.isFinite(raw.paraBefore)) base.paraBefore = Math.min(40, Math.max(0, raw.paraBefore));
  if (Number.isFinite(raw.paraAfter)) base.paraAfter = Math.min(48, Math.max(0, raw.paraAfter));
  if (typeof raw.showUrl === "boolean") base.showUrl = raw.showUrl;
  if (typeof raw.showTime === "boolean") base.showTime = raw.showTime;
  if (Number.isFinite(raw.margin)) base.margin = Math.min(35, Math.max(6, raw.margin));
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

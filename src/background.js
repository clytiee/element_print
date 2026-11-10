// Service worker：工具栏按钮 → 注入选取器；收到选取结果 → 打开预览窗口。

const PICKER_CSS = ["src/content/selector.css"];
const PICKER_JS = ["src/shared/extract.js", "src/content/selector.js"];
const PREVIEW_URL = "src/preview/preview.html";

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || !tab.id) return;
  const url = tab.url || "";
  // activeTab 只在用户操作后授权，仍需排除浏览器内部页面
  if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(url)) {
    return;
  }
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: PICKER_CSS });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: PICKER_JS });
  } catch (err) {
    console.warn("[Element Print] 注入选取器失败：", err);
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "ep:openPreview") {
    openPreview(msg.id)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  // 翻译放在后台发：manifest 里有 host_permissions，可绕过页面的跨域限制
  if (msg && msg.type === "ep:translate") {
    translateTexts(msg)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  return false;
});

// DeepL 一次最多 50 段，按 40 段分批
const DEEPL_BATCH = 40;

async function translateTexts({ texts, key, targetLang }) {
  if (!Array.isArray(texts) || !texts.length) return { ok: true, translations: [] };
  const authKey = String(key || "").trim();
  if (!authKey) return { ok: false, error: "未填 DeepL Auth Key" };

  // Key 以 :fx 结尾的是免费版，只能走 api-free；其余走付费端点。
  // 选错端点 DeepL 会回 403，所以这里不信任界面上的开关，直接按 Key 判定。
  const endpoint = authKey.endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";
  const lang = targetLang || "ZH";
  const translations = [];

  for (let i = 0; i < texts.length; i += DEEPL_BATCH) {
    const batch = texts.slice(i, i + DEEPL_BATCH).map((t) => String(t));
    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "DeepL-Auth-Key " + authKey,
        },
        body: JSON.stringify({ text: batch, target_lang: lang }),
      });
    } catch (err) {
      return { ok: false, error: "网络请求失败：" + String((err && err.message) || err) };
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const hint =
        res.status === 403
          ? "（Key 无效，或端点与 Key 类型不符：免费版 Key 以 :fx 结尾）"
          : res.status === 456
            ? "（免费额度已用完）"
            : res.status === 429
              ? "（请求太频繁，稍后再试）"
              : "";
      return { ok: false, error: `DeepL ${res.status}${hint} ${detail.slice(0, 160)}`.trim() };
    }
    const data = await res.json().catch(() => null);
    const list = (data && data.translations) || [];
    list.forEach((item) => translations.push(String((item && item.text) || "")));
  }

  if (!translations.length) return { ok: false, error: "DeepL 没有返回译文" };
  return { ok: true, translations };
}

async function openPreview(id) {
  if (!id) throw new Error("缺少 payload id");
  const url =
    chrome.runtime.getURL(PREVIEW_URL) + "?id=" + encodeURIComponent(id);
  const win = await chrome.windows.create({
    url,
    type: "popup",
    width: 1040,
    height: 1000,
  });
  return win;
}

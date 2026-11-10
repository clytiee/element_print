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
  return false;
});

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

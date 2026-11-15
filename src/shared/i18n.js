// 扩展 i18n 帮助方法：内容脚本注入时挂到全局，预览页可直接使用 chrome.i18n。

window.ElementPrintI18n = {
  t(key, substitutions) {
    try {
      return chrome.i18n.getMessage(key, substitutions) || key;
    } catch {
      return key;
    }
  },
};

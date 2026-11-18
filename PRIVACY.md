# Element Print 隐私政策 / Privacy Policy

生效日期：2026-11-18
适用版本：Element Print 1.1.0 及以后

---

## 中文

### 一句话说明

Element Print 不收集、不上传你浏览的内容。抽取、排版、打印、导出全部在你的本机完成。

### 我们不收集什么

- 不收集浏览历史、搜索记录、Cookie、剪贴板或个人身份信息。
- 不设账号体系，无登录、无云端同步。
- 不含任何统计、埋点、广告、崩溃上报或 A/B 实验代码。
- 不把网页正文、图片或导出文件发送到开发者自己的服务器（本扩展没有自有服务器）。

### 哪些数据会存在你的本机

以下数据仅写入浏览器的本地存储（`chrome.storage.local`），不会离开设备：

| 数据 | 用途 | 保留与删除 |
| --- | --- | --- |
| 版式设置（每个「版式 × 页面格式」组合一套参数） | 下次打开沿用上次的排版 | 随扩展卸载或清除浏览器数据删除 |
| 视图偏好（原文 / 混排 / 翻译） | 下次打开恢复视图 | 同上 |
| 历史记录（标题、网址、提取时间，上限 1000 条） | 历史记录页的检索、按站点筛选、再次打开 | 可在历史记录页单条、多选或一键清空；超出 1000 条时最旧一条自动删除 |
| 提取的正文载荷（含内嵌图片） | 打开预览、重新导出、历史记录中再次打开 | 与对应历史记录同步删除 |
| 翻译缓存（按段落） | 已译过的段落不重复请求 | 可在设置中用「缓存上限」控制容量，或在设置中移除 |
| 你自己填入的 DeepL Auth Key / 百度 APP ID 与密钥 | 仅作为调用翻译接口的凭据 | 可在设置中随时清空；卸载扩展即删除 |

历史记录、翻译缓存与密钥始终可以由你自行删除，扩展不设任何无法清除的隐藏副本。

### 什么时候会发生网络请求

1. 翻译（默认关闭，需你手动开启并填入密钥）：仅把**待翻译的文本段落**发送到你选择的引擎（DeepL 或百度翻译），并附带你的密钥作为鉴权。请求直接由你的浏览器发往对应服务商，不经开发者中转。这些服务商对数据的处理适用其各自的隐私政策。
2. 图片内嵌：为了让导出的 HTML 离线可用，扩展会向**被提取页面的原站点**请求图片二进制；请求不携带 Cookie（`credentials: "omit"`）与 Referer。
3. 除上述两类，扩展不会发起任何其他外部请求。

### 权限与用途

- `activeTab`、`scripting`：仅在你点击图标后读取**当前页面**的 DOM，用于选取与抽取。
- `storage`、`unlimitedStorage`：保存上表中的设置、历史、正文与缓存。
- `contextMenus`：在图标右键菜单中提供「整页提取」开关与「历史记录」入口。
- `api-free.deepl.com` / `api.deepl.com` / `fanyi-api.baidu.com`：仅在启用翻译时用于调用对应接口。

### 第三方内容与许可

- 正文识别使用本地打包的 Mozilla Readability（Apache-2.0）。
- 界面图标取自 Lucide（ISC）。
- 字体遵循各自 OFL 许可。

这些组件均随扩展一同分发，不联网加载。

### 儿童

本扩展不面向儿童，也不收集任何年龄相关信息。

### 政策变更

如数据处理方式发生变化，会更新本文件的生效日期并在扩展说明中提示。继续使用即视为接受更新后的政策。

### 联系方式

邮箱：`（待填：你的联系邮箱）`
项目主页：`https://github.com/<用户名>/element_print`

---

## English

### Summary

Element Print does not collect or upload what you browse. Extraction, layout, printing, and export all happen on your device.

### What we do not collect

- No browsing history, search history, cookies, clipboard content, or personal identifiers.
- No account system, no sign-in, no cloud sync.
- No analytics, telemetry, advertising, crash reporting, or experiment code.
- No webpage content, images, or exported files are sent to a developer-owned server; the extension has no such server.

### Data stored locally on your device

The following is written only to browser local storage (`chrome.storage.local`) and never leaves the device:

| Data | Purpose | Retention and deletion |
| --- | --- | --- |
| Layout settings (one set per template × output format) | Reuse your last layout | Removed when the extension is uninstalled or browser data is cleared |
| View preference (source / mixed / translation) | Restore your last view | Same as above |
| History (title, URL, extraction time; up to 1,000 entries) | Search, site filter, and reopening from the History page | Delete one, several, or all entries on the History page; the oldest entry is dropped beyond 1,000 |
| Extracted article payloads (including embedded images) | Open the preview, re-export, reopen from History | Deleted together with the corresponding history entry |
| Translation cache (per paragraph) | Avoid re-requesting translated paragraphs | Capacity is controlled by the cache limit setting and can be cleared in settings |
| Your DeepL Auth Key / Baidu APP ID and secret | Credentials for translation API calls | Can be cleared in settings at any time; removed on uninstall |

History, cache, and keys are always deletable by you; the extension keeps no hidden copy that cannot be removed.

### When network requests happen

1. Translation (off by default; you must enable it and enter your own key): only the **text segments to be translated** are sent to the engine you choose (DeepL or Baidu Translate), together with your key for authentication. Requests go from your browser directly to that provider, never through a developer relay. Those providers handle the data under their own privacy policies.
2. Image embedding: to make exported HTML work offline, the extension requests image binaries from the **original site of the page you extracted**. Requests are sent without cookies (`credentials: "omit"`) and without a referrer.
3. Other than these two cases, the extension makes no external requests.

### Permissions and their use

- `activeTab`, `scripting`: read the DOM of the **current page only**, and only after you click the icon.
- `storage`, `unlimitedStorage`: keep the settings, history, articles, and cache described above.
- `contextMenus`: provide the "full-page extraction" toggle and the History entry in the icon's context menu.
- `api-free.deepl.com` / `api.deepl.com` / `fanyi-api.baidu.com`: used only for translation requests when translation is enabled.

### Third-party components

- Article detection uses Mozilla Readability (Apache-2.0), bundled locally.
- Interface icons come from Lucide (ISC).
- Bundled fonts follow their respective OFL licenses.

All of these ship with the extension and are never loaded remotely.

### Children

The extension is not directed to children and collects no age-related information.

### Changes

If data handling changes, the effective date above will be updated and the change noted in the extension description. Continued use means acceptance of the updated policy.

### Contact

Email: `(to fill: your contact email)`
Project: `https://github.com/<username>/element_print`

---

## 发布为可访问 URL 的方式

商店需要一个公网可访问的政策链接，以下任一方式即可：

1. GitHub Pages：把本文件改名为 `privacy.html` 或 `privacy.md`，放进仓库 `docs/` 分支并开启 Pages，得到 `https://<用户名>.github.io/element_print/privacy.html`。
2. 仓库内的 Markdown 原始链接也可用（`https://github.com/<用户名>/element_print/blob/main/PRIVACY.md`），但审查员更偏好干净的网页，HTML 更稳。
3. 已有个人站点时，直接挂一个静态页即可，无需其他内容。

发布后把该 URL 填进商店「隐私政策网址」，并同步替换上面的联系邮箱占位。

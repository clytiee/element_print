# Chrome Web Store 上架材料（Element Print v1.1.0）

说明：商店后台的「详细说明」不解析 Markdown，直接粘贴下方纯文本段落；不要粘贴 `#`、`**`、反引号、表格或代码块语法。
本文件按后台表单顺序排列，逐项对应填写即可。隐私政策见同目录 `PRIVACY.md`。

---

## 1. 基本信息

| 后台字段 | 填写内容 |
| --- | --- |
| 名称（≤45 字符） | `Element Print` |
| 类别 | 生产力工具（Productivity） |
| 语言 | English（默认，与 manifest `default_locale` 一致）；已提供 中文（简体） |
| 版本 | 1.1.0 |
| 定价 | 免费 |
| 地区 | 全球（如需排除特定地区可单独设置） |
| 项目主页 | `https://github.com/<用户名>/element_print`（按实际填写） |
| 隐私政策网址 | 见 `PRIVACY.md`，需发布为可公开访问的 URL 后填入 |
| 支持邮箱 | `（待填：你的联系邮箱）` |

---

## 2. 简短说明（manifest description，≤132 字符）

英文（与 `_locales/en` 一致）：

Off the glowing screen, read on paper or e-ink. Turn any web page into a clean, beautifully formatted PDF — in one click.

中文（与 `_locales/zh_CN` 一致）：

离开发光屏幕，在你喜欢的介质上阅读：无论是纸张还是电纸书。一键把网页变成排版精良、适宜阅读的 PDF。

商店后台的「简短说明」与 manifest 是两个独立字段，两处保持一致即可。

---

## 3. 中文详细说明（直接粘贴到商店后台）

把网页内容排成适合纸张、电纸书和手机阅读的版式

Element Print 不做网页截图，而是先抽取页面正文与图片，再在预览里按版面重新排版：字号、行距、栏数、边距、字体、字重、页眉页脚都可调节，最终打印成 PDF，或导出与预览一致的单文件 HTML。预览纸面、打印规则和导出文件使用同一套设置，不会出现「预览两栏、PDF 一栏」。

两种提取方式

• 手动选取：悬停高亮元素，点击要打印的段落、文章或卡片，自主决定抽取范围；↑ 选上级、↓ 回到指针。
• 整页提取：右键图标开启后，点图标即基于 Mozilla Readability 自动识别正文容器，去掉导航、侧栏、评论、广告等页面噪音。

版式与输出对象

• 预置三套版式：原版（报纸杂志感）、学术期刊（双栏、首行缩进、紧凑行距）、党政公文（仿宋、固定行距、非对称边距）。
• 三种输出对象：A4 纸、10.3 英寸电纸书（类纸墨水屏尺寸）、手机阅读（固定单栏，关闭页眉页脚）。
• 可调节：栏数、正文字号、标题字号、正文 / 标题字体、字重、行距（倍数或固定磅值）、段前段后间距、首行缩进、四边页边距、标题跨栏、跨页控制、图片大小。
• 页眉页脚可显隐：网址、发布日期、作者、时间戳、格言按组合开关；电纸书页脚只保留格言，手机阅读不显示页眉页脚。
• 设置按「版式 × 页面格式」分别记忆，切换互不干扰；偏离默认值的参数以虚线框标出，可一键重置当前组合。

原文、混排与双语对照

• 三种视图：原文、中英混排、翻译；退出前记住所选视图，下次打开按记忆恢复。
• A4 / 电纸书为左原文、右译文并排，栏宽可拖拽；手机端自动转为上下串行翻译。
• 页面自带译文自动与原文、标题、摘要配对；缺失译文可通过 DeepL 或百度翻译补发，译文带本地缓存，重复打开不必重新翻译。
• 参考文献整条作为一条对照，不再按人名、缩写、标题碎片逐段拆开。

编辑、删减与标题

• 预览页可直接改标题、正文与页眉页脚，支持粗体、斜体、下划线、对齐、首行缩进、标题层级、引文、列表与清除格式。
• 删减模式：点一下即可去掉某段、某张图或某张表；也可从正文里挑一个块替换标题。
• 查找替换：支持批量替换或留空删除匹配文本。
• 图片可整体隐藏，隐藏后不参与排版与打印。

摘要与元信息

• 标题、摘要、作者、日期可在预览页直接编辑。
• 摘要优先读取页面可见 Abstract；元数据中的完整摘要与可见摘要会比较取舍，避免使用被省略号截断的 description。
• 日期优先采用 <time> 标签内的可见日期，不默认回退 ISO 时间。

历史记录

• 提取过的网页自动记录，可按标题或网址搜索、按同网站筛选、翻页浏览。
• 支持多选删除、导出 HTML、一键清空；记录上限 1000 条，超出后最旧一条连同其已存正文一并删除。

导出与打印

• 打印：调起浏览器打印对话框，另存为 PDF，版面随 A4、电纸书或手机尺寸生效；可开启打印后自动关闭预览页。
• 导出 HTML：生成单文件，图片以 base64 内嵌，可离线打开、再投递到阅读器。
• 保留加粗、斜体、链接、列表、表格、代码块等语义格式。

数据与隐私

• 抽取、预览、排版、导出均在本机完成，扩展不收集浏览历史，也不把正文上传到自有服务器。
• 仅当主动启用翻译并填入对应引擎密钥时，待翻译文本才按所选引擎（DeepL / 百度翻译）发出。
• 图片取不到二进制时保留原链接，不丢占位。

使用许可说明（可选，如后台允许填写）

本项目代码采用 PolyForm Noncommercial 1.0.0，个人学习、研究、自用免费；商业用途需事先授权。

---

## 4. English detailed description

Element Print extracts webpage content for reading, note-taking, printing, and archiving. Select an element manually or auto-extract the main article, then adjust a print-ready layout before printing to PDF or exporting a single-file HTML.

Features:

- Manual selection or Readability-based full-page extraction; preserves paragraphs, lists, tables, quotes, links, and images. In manual mode, hover to highlight and click the block you want; use ↑ / ↓ to walk up to the parent or back to the pointer.
- Newspaper, academic journal, and official document templates; adjustable columns, body and title font size, body and title font family, weight, line height (ratio or fixed points), spacing before and after paragraphs, first-line indent, margins on all four sides, title spanning, page-break control, and image size.
- Built for A4 paper, 10.3-inch e-ink readers, and mobile reading; mobile uses a fixed single column with headers and footers hidden. Settings are remembered per template × output format.
- Source, mixed bilingual, and translation views; the last selected view is remembered. A4 and e-ink use side-by-side translation with a draggable column width, while mobile uses stacked source and translation.
- Existing translations are paired with source text, titles, and abstracts automatically; missing translations can be completed through DeepL or Baidu Translate, with a local translation cache.
- Reference entries are paired as whole entries instead of being split by author initials, title fragments, or source labels.
- Edit the title, body, headers, and footers directly in the preview, including bold, italic, underline, alignment, indent, headings, quotes, lists, and clear formatting. Trim mode removes a paragraph, image, or table in one click, and the title can be replaced by picking a block from the body. Find and replace is included, and images can be hidden from layout and printing.
- Visible abstracts are preferred over truncated metadata descriptions, and visible <time> dates are preferred over ISO timestamps.
- History keeps every extracted page, searchable by title or URL and filterable by site, with multi-select delete, HTML export, and clearing. Up to 1,000 records are kept; the oldest entry and its stored article are dropped beyond that.
- Print directly to PDF or export a self-contained HTML with embedded images; an optional setting closes the preview after printing.

Use it for paper excerpts, long-article printing, web archiving, bilingual reading, and e-reader or mobile layouts.

Privacy: the extension does not store browsing history on any server. Translation requests send only the texts selected for translation; API keys and the translation cache are stored locally in browser storage.

---

## 5. 搜索词（最多 21 个）

print webpage, extract article, PDF printer, bilingual translation, e-reader, academic paper, article reader, export HTML, web clipping, reading layout, webpage clipping, translation comparison, paper layout, long article reader, offline HTML, DeepL, Baidu Translate, e-ink, mobile reading, academic layout, print article

建议优先级：`print webpage` / `PDF printer` / `extract article` / `web clipping` / `bilingual translation` / `e-reader` 为主要流量词，其余做长尾覆盖。

---

## 6. Single purpose（单一用途说明，必填）

中文：

Element Print 的唯一用途是把用户在当前网页上选取的元素或识别出的正文，按用户设定的版式重新排版，输出为可打印的 PDF 版面或单文件 HTML，用于打印和离线阅读。

English:

Element Print has a single purpose: convert the webpage content a user selects (or the main article it identifies) into a re-typeset, print-ready page that the user can print to PDF or export as a single offline HTML file.

---

## 7. 权限用途说明（Permissions justification，逐条，英文填写）

| 权限 | 后台填写文本 |
| --- | --- |
| `activeTab` | Grants temporary access to the current tab only after the user clicks the extension icon. Used to read the page the user explicitly asked to extract. No background access to other tabs. |
| `scripting` | Injects the element picker and the extraction routine into the active tab at the moment the user starts an extraction. Used only for the user-initiated read of the current page. |
| `storage` | Saves layout settings, the remembered view mode, the translation cache, and the history index in the browser's local storage. |
| `unlimitedStorage` | Extracted articles, embedded images, and the translation cache can exceed the default local quota; this keeps archiving and offline export working without truncation. |
| `contextMenus` | Provides the right-click menu item on the extension icon that toggles full-page (Readability) extraction versus manual selection. |
| Host `https://api-free.deepl.com/*`, `https://api.deepl.com/*` | Used only when the user enables translation and enters their own DeepL Auth Key. Sends the selected text segments to DeepL and returns translations. |
| Host `https://fanyi-api.baidu.com/*` | Used only when the user enables translation and enters their own Baidu Translate APP ID and key. Sends the selected text segments to Baidu and returns translations. |
| 无 `tabs` / `webRequest` / `cookies` / `<all_urls>` | The extension does not request them and does not access pages without a user gesture. |

可在备注里补充一句：

No permission is used for advertising, analytics, profiling, or affiliate purposes. All processing happens locally except the optional translation requests described above.

---

## 8. 数据使用（Privacy practices 问卷，逐项勾选）

| 问题 | 选择 | 备注 |
| --- | --- | --- |
| 是否收集用户数据？ | 否（Does not collect user data） | 「收集」按商店定义指传输到开发者或第三方服务器；本扩展全部数据只存在用户本机 |
| 网站内容 / 网页历史 / 用户活动 | 不勾选 | 提取的网页正文与网址只写入本机 `chrome.storage.local`，不上传 |
| 身份验证信息 | 不勾选 | 用户自填的 DeepL / 百度密钥存储在本机，仅作为请求凭据发往对应翻译接口，开发者无法获取 |
| 个人身份、健康、财务、位置、通信 | 不勾选 | 均不涉及 |
| 是否出售数据给第三方 | 否 | |
| 是否将数据用于与核心功能无关的用途 | 否 | |
| 是否将数据用于判定信用、贷款等 | 否 | |
| 是否使用远程代码（Remote code） | 否 | 全部脚本随包分发；Readability、图标、字体均为本地文件，不使用 eval 或远程脚本 |
| 是否有遥测 / 分析 / 崩溃上报 | 无 | 无任何统计上报 |
| 是否含广告 | 无 | |

如果后台要求为「网页历史」单独声明，可填：网页历史仅保存在本机，用于历史记录页的检索与再次打开，从不外传，用户可随时单条或全部删除。

---

## 9. Notes for certification（<2,000 字符，英文）

Element Print extracts selected webpage content or the main article for reading, layout adjustment, PDF printing, and single-file HTML export. It preserves text, links, lists, tables, quotes, and images; it does not take screenshots.

Testing flow:
1. Open a public article, blog, news page, or academic page.
2. Click the extension icon. In manual mode, hover to highlight an element and click the article, paragraph, or card. Use ↑ / ↓ to move between parent and pointer.
3. Optional: right-click the icon to toggle full-page extraction, then click the icon to let Readability identify the main content.
4. In the preview, switch output format (A4, 10.3-inch e-reader, mobile), layout template, columns, body and title size, line height, spacing, indentation, margins, headers and footers, and the footer quote.
5. Switch Source, Mixed, and Translation views. A4/e-reader use side-by-side translation; mobile uses stacked source and translation.
6. Edit the title, abstract, author, and date. Use Trim to remove blocks, or the title picker to replace the title. Print opens the browser dialog for PDF; Export HTML saves a self-contained file with embedded images.
7. Open History from the icon's right-click menu to search, filter by site, export, or delete records.

Translation is optional and off by default. Enable translation and enter a DeepL Auth Key or Baidu App ID and secret to test. Only selected text segments needing translation are sent to the chosen engine; keys and the cache stay in local browser storage.

Permissions:
- activeTab, scripting: read and clean the current page DOM after the user starts extraction.
- storage, unlimitedStorage: save settings, view preference, history, translation cache, and extracted articles locally.
- contextMenus: right-click toggle for full-page extraction.
- DeepL/Baidu host permissions are used only when translation is enabled with valid credentials.

The extension does not collect browsing history on a server, does not upload content to a developer-owned server, contains no analytics, and requires no account.

---

## 10. 图片素材清单（需在后台单独上传）

| 素材 | 规格 | 数量 | 状态 |
| --- | --- | --- | --- |
| 商店图标 | 128×128 PNG | 1 | 已有 `icons/icon128.png`（必要时另出 128×128 独立图） |
| 截图 | 1280×800 或 640×400，PNG / JPG，最多 5 张 | 1–5 | 待出 |
| 小型宣传图（Small promo tile） | 440×280，PNG / JPG | 1 | 待出 |
| 大型宣传图（Marquee，参与推荐时才需要） | 1400×560 | 0–1 | 待出 |
| 演示视频 | 仅 YouTube 链接 | 0–1 | 可选 |

截图建议顺序（每张只表达一个卖点）：

1. 选取状态：页面上元素被蓝色描边、标签显示 `标签.类名 尺寸`，右侧带操作提示。
2. 原版版式预览 + 右侧设置面板：A4 纸、单栏、标题下横线。
3. 学术期刊双栏 + 首行缩进 + 栏间细线，或公文仿宋固定行距。
4. 双语对照：左原文右译文，或手机/电纸书上下串行。
5. 导出 HTML 或历史记录页。

出图要求：1280×800 画布内不要让 UI 贴边，留 40–60px 边距；系统字体需清晰可读；不要出现第三方网页的品牌标识与个人信息。

---

## 11. 发布前检查项

- [ ] `manifest.json` 版本号与后台填写一致，`name` / `description` 走 `__MSG_*__` 且两个 locale 都已补全
- [ ] 打包时排除 `.git`、`demo`、`.workbuddy`、`*.md`（`README.md`、`STORE_LISTING.md`、`PRIVACY.md` 不必进包）
- [ ] `icons/` 四个尺寸齐全，图标非透明像素不要裁掉内容
- [ ] 隐私政策已发布到公网 URL，并填入「隐私政策网址」
- [ ] 权限用途、单一用途、远程代码、数据使用四项问卷已按第 6–8 节填写
- [ ] 截图 1 张以上、宣传图已上传，素材尺寸符合后台提示
- [ ] 开发者账号已完成邮箱验证与身份（Trader / Non-trader）声明
- [ ] 首次提交如触发人工审核，把第 9 节全文粘进「认证说明」

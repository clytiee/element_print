# Edge / Chrome 商店文案

说明：商店后台的「详细说明」不解析 Markdown，直接粘贴下方纯文本段落；不要粘贴 `#`、`**`、反引号、表格或代码块语法。

## 简短说明（manifest description，≤132 字符）

选取网页元素或整页正文，提取富文本，按报纸、学术期刊、公文版式预览、双语对照、打印或导出单文件 HTML。

## 中文详细说明（直接粘贴到商店后台）

### 把网页内容排成适合纸张、电纸书和手机阅读的版式

Element Print 不做网页截图，而是先抽取页面正文与图片，再在预览里按版面重新排版：字号、行距、栏数、边距、字体、字重、页眉页脚都可调节，最终打印成 PDF，或导出与预览一致的单文件 HTML。预览纸面、打印规则和导出文件使用同一套设置，不会出现「预览两栏、PDF 一栏」。

### 两种提取方式

- **手动选取**：悬停高亮元素，点击要打印的段落、文章或卡片，自主决定抽取范围。
- **整页提取**：基于 Mozilla Readability 自动识别正文容器，去掉导航、侧栏、评论、广告等页面噪音。

### 版式与输出对象

- 预置三套版式：**原版**（报纸杂志感）、**学术期刊**（双栏、首行缩进、紧凑行距）、**党政公文**（仿宋、固定行距、非对称边距）。
- 三种输出对象：**A4 纸**、**10.3 英寸电纸书**（类纸墨水屏尺寸）、**手机阅读**（固定单栏，关闭页眉页脚）。
- 可调节：栏数、正文字号、标题字号、正文 / 标题字体、字重、行距（倍数或固定磅值）、段前段后间距、首行缩进、四边页边距、标题跨栏、跨页控制。
- 页眉页脚可显隐：网址、发布日期、作者、时间戳、格言按组合开关；电纸书页脚只保留格言，手机阅读不显示页眉页脚。
- 设置按「版式 × 页面格式」分别记忆，切换互不干扰；偏离默认值的参数以虚线框标出，可一键重置当前组合。

### 原文、混排与双语对照

- 三种视图：**原文**、**中英混排**、**翻译**；退出前记住所选视图，下次打开按记忆恢复。
- A4 / 电纸书为左原文、右译文并排，栏宽可拖拽；手机端自动转为上下串行翻译。
- 页面自带译文自动与原文、标题、摘要配对；缺失译文可通过 DeepL 或百度翻译补发，译文带本地缓存，重复打开不必重新翻译。
- 参考文献整条作为一条对照，不再按人名、缩写、标题碎片逐段拆开。

### 摘要与元信息

- 标题、摘要、作者、日期可在预览页直接编辑。
- 摘要优先读取页面可见 Abstract；元数据中的完整摘要与可见摘要会比较取舍，避免使用被省略号截断的 description。
- 日期优先采用 `<time>` 标签内的可见日期，不默认回退 ISO 时间。

### 导出与打印

- **打印**：调起浏览器打印对话框，另存为 PDF，版面随 A4、电纸书或手机尺寸生效；可开启打印后自动关闭预览页。
- **导出 HTML**：生成单文件，图片以 base64 内嵌，可离线打开、再投递到阅读器。
- 保留加粗、斜体、链接、列表、表格、代码块等语义格式。

### 数据与隐私

- 抽取、预览、排版、导出均在本机完成，扩展不收集浏览历史，也不把正文上传到自有服务器。
- 仅当主动启用翻译并填入对应引擎密钥时，待翻译文本才按所选引擎（DeepL / 百度翻译）发出。
- 图片取不到二进制时保留原链接，不丢占位。

## English detailed description

Element Print extracts webpage content for reading, note-taking, and printing. Select an element manually or auto-extract the main article, then adjust a print-ready layout before printing to PDF or exporting a single-file HTML.

Features:

- Manual selection or Readability-based full-page extraction; preserves paragraphs, lists, tables, quotes, links, and images.
- Newspaper, academic journal, and official document templates; adjustable columns, font size, title size, line height, spacing, indentation, margins, headers, and footers.
- Built for A4 paper, 10.3-inch e-ink readers, and mobile reading; mobile uses a fixed single column with headers and footers hidden.
- Source, mixed bilingual, and translation views; the last selected view is remembered. A4 and e-ink use side-by-side translation, while mobile uses stacked source and translation.
- Existing translations are paired with source text, titles, and abstracts automatically; missing translations can be completed through DeepL or Baidu Translate, with a local translation cache.
- Reference entries are paired as whole entries instead of being split by author initials, title fragments, or source labels.
- Edit title, abstract, author, and date directly in the preview; visible abstracts are preferred over truncated metadata descriptions, and visible `<time>` dates are preferred over ISO timestamps.
- Print directly to PDF or export a self-contained HTML with embedded images; an optional setting closes the preview after printing.

Use it for paper excerpts, long-article printing, web archiving, bilingual reading, and e-reader or mobile layouts.

Privacy: the extension does not store browsing history. Translation requests send only the texts selected for translation; API keys are stored locally in browser storage.

## 搜索词（最多 21 个）

print webpage, extract article, PDF printer, bilingual translation, e-reader, academic paper, article reader, export HTML, web clipping, reading layout, webpage clipping, translation comparison, paper layout, long article reader, offline HTML, DeepL, Baidu Translate, e-ink, mobile reading, academic layout, print article

## Notes for certification（<2,000 characters）

Element Print extracts selected webpage content or the main article for reading, layout adjustment, PDF printing, and single-file HTML export. It preserves text, links, lists, tables, quotes, and images; it does not take screenshots.

Testing flow:
1. Open a public article, blog, news page, or academic page.
2. Click the extension icon. In manual mode, hover to highlight an element and click the article, paragraph, or card.
3. Optional: right-click the icon to toggle full-page extraction, then click the icon to let Readability identify the main content.
4. In the preview, switch output format (A4, 10.3-inch e-reader, mobile), layout template, columns, font size, title size, line height, spacing, indentation, margins, headers/footers, and quote footer.
5. Switch Source, Mixed, and Translation views. A4/e-reader use side-by-side translation; mobile uses stacked source and translation.
6. Edit title, abstract, author, and date. Print opens the browser dialog for PDF; Export HTML saves a self-contained file with embedded images.

Translation is optional and off by default. Enable translation and enter a DeepL Auth Key or Baidu App ID and secret to test. Only selected texts needing translation are sent to the chosen engine; keys and cache stay in local browser storage.

Permissions:
- activeTab, scripting: read and clean the current page DOM after the user starts extraction.
- storage, unlimitedStorage: save settings, view preference, translation cache, and temporary payload locally.
- contextMenus: right-click toggle for full-page extraction.
- DeepL/Baidu host permissions are used only when translation is enabled with valid credentials.

The extension does not collect browsing history, upload content to an extension-owned server, or require an account.

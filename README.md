# element_print

选取网页元素或整页正文，提取富文本，按报纸、学术期刊、公文版式预览；支持中英混排还原、左右双语对照、手机串行翻译、打印为 PDF 或导出单文件 HTML。

## 插件截图
### 原文模式
<img width="2053" height="1985" alt="image" src="https://github.com/user-attachments/assets/87ab6758-1456-4a90-b89c-4bd76f6a57e0" />

### 翻译模式
支持将已全文对照翻译的英中文混排提取为左原文、右译文的翻译模式。
原网页（已全文翻译）：
<img width="1279" height="1688" alt="image" src="https://github.com/user-attachments/assets/2da75b31-0800-43bf-a25b-c175e6aaec21" />

插件提取后的翻译模式：
<img width="2053" height="1985" alt="image" src="https://github.com/user-attachments/assets/a09bee87-cf12-42c0-8779-148c010fb129" />

## 安装（已解压扩展）

1. 打开 Chrome / Edge 扩展页：`chrome://extensions` 或 `edge://extensions`
2. 开启「开发者模式」
3. 「加载已解压的扩展程序」，选择本仓库根目录

## 使用

1. 打开目标页面；右键插件图标可开启「整页提取」，默认关闭。开启后点插件图标走自动识别，未开启走手动选取
2. 手动模式下鼠标悬停时元素被蓝色描边，标签显示 `标签.类名 尺寸`，点击要打印的元素；整页提取模式由 Readability 识别正文容器后直接提取
3. 提取完成后弹出预览窗口
4. 右侧面板先选**输出对象**（A4 纸 / 10.3″ 电纸书 / 手机阅读），再选**版式**（原版 / 学术期刊 / 公文），调整栏数、字号、标题字号、行距、段前后间距、缩进、四边页边距、页眉页脚等
5. 视图可在原文、中英混排、翻译之间切换；A4/电纸书为左右对照，手机为上下串行
6. 「打印」调起浏览器打印；「导出 HTML」得到与预览一致的单文件（图片 base64 内嵌）

## 三套版式

- **原版**：单栏、12pt 宋体、行高 1.75、段后 9px、边距 15mm、标题宋体粗体＋2px 横线
- **学术期刊**：双栏、10.5pt、行高 1.55、段后 0、边距 20mm、首行缩进 2 字、栏间细分线、标题黑体居中＋细线、网址/时间戳默认关
- **公文**：单栏、16pt 仿宋、固定行距 28pt、非对称公文边距，页眉默认关

切版式会把整套参数换成该版式的推荐值，之后仍可单项微调；参数按「版式 × 页面格式」分别记忆。

## 版式规则

- 正文首个非空行提为大标题并从正文剥离，标题下压一道 2px 横线
- 默认 A4 纵向、四周 15mm，正文两端对齐
- 两栏用 CSS 多栏（`column-count`），分页时按栏流动

## 目录

```
manifest.json
icons/                 icon16 / 32 / 48 / 128
src/
  background.js        工具栏点击 → 注入选取器 / 打开预览窗口
  content/
    selector.js        悬停描边、点击捕获、Esc 退出
    selector.css       浮层样式（insertCSS 注入，不受页面 CSP 影响）
    auto.js            整页自动提取：Readability 结果接回抽取管线
  shared/
    extract.js         富文本抽取：去噪、链接绝对化、图片内嵌、首行提标题
    article.css        版面与排版（预览页与导出文件共用同一份）
    settings.js        版式默认值与 chrome.storage.local 持久化
    vendor/            第三方库：Mozilla Readability（Apache-2.0，见目录内 LICENSE）
  preview/
    preview.html       预览 + 设置面板
    preview.css        预览外壳（画布、面板、打印时只留纸张）
    preview.js         渲染、版式联动、打印、导出
```

## 已知取舍

- 抽取时剥掉元素自带的 `class` / `id` / `style`，排版统一交给版面样式（粗体、斜体、链接、列表、表格、代码块语义保留）
- 跨域图片取不到二进制时保留原 URL：预览可能裂图，但不丢占位
- 预览窗口刷新后提取结果失效，需回页面重新选取

// 整页自动提取：Readability 先挑正文容器，结果再交给原有抽取管线清洗/拆译文/内嵌图片。

(() => {
  const FLAG = "__elementPrintAuto";
  if (window[FLAG]) return;
  window[FLAG] = true;

  if (!window.ElementPrintExtract) {
    console.warn("[Element Print] 提取模块未注入，无法自动提取");
    return;
  }
  if (typeof window.Readability === "undefined") {
    console.warn("[Element Print] Readability 库未注入，无法自动提取");
    return;
  }

  let toastNode = null;

  function toast(text, sticky) {
    if (!toastNode) {
      toastNode = document.createElement("div");
      toastNode.style.cssText =
        "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:2147483647;" +
        "padding:8px 14px;border-radius:8px;background:#1f2937;color:#fff;font:13px/1.4 sans-serif;" +
        "box-shadow:0 4px 16px rgba(0,0,0,.25);max-width:70vw;";
      document.documentElement.appendChild(toastNode);
    }
    toastNode.textContent = text;
    toastNode.style.display = "block";
    if (!sticky) setTimeout(() => (toastNode.style.display = "none"), 2600);
  }

  function normText(s) {
    return String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function transMarks(el) {
    const attrRe = /^(data[-_](deep)?translat|data[-_]trans$)/i;
    const classRe = /(^|\s)(translated|translation|deep-trans|trans-text)\b/i;
    const out = [];
    const walk = (node) => {
      Array.from(node.children || []).forEach((child) => {
        const marked =
          Array.from(child.attributes || []).some((a) => attrRe.test(a.name.toLowerCase())) ||
          classRe.test(child.getAttribute("class") || "");
        if (marked) out.push(child);
        else walk(child);
      });
    };
    walk(el);
    return out;
  }

  // Readability 只把正文放进提取容器；标题自带的中文译文要回原页面标题节点里取
  function readTitleTranslation(title) {
    const wanted = normText(title);
    if (!wanted) return "";
    const candidates = Array.from(
      document.querySelectorAll("h1, h2, h3, [class*=hed], [class*=headline], [class*=title]")
    );
    for (const el of candidates) {
      const marks = transMarks(el);
      if (!marks.length) continue;
      const dst = normText(marks[marks.length - 1].textContent);
      const src = normText(normText(el.textContent).replace(dst, ""));
      const same =
        src === wanted ||
        (src.length >= 8 && wanted.length >= 8 && (src.includes(wanted) || wanted.includes(src)));
      if (same) return dst;
    }
    return "";
  }

  function sameText(src, wanted) {
    if (!src || !wanted) return false;
    if (src === wanted || src.includes(wanted) || wanted.includes(src)) return true;
    const min = Math.min(src.length, wanted.length);
    if (min < 12) return false;
    let i = 0;
    while (i < min && src[i] === wanted[i]) i += 1;
    return i / min >= 0.8;
  }

  // 摘要译文：优先直接定位页面 Abstract 容器/标题，不依赖导语文本是否匹配
  function readAbstractTranslation() {
    const scopes = Array.from(
      document.querySelectorAll(
        ".hlFld-Abstract, .abstractSection, .abstractInFull, [class*=abstract], [class*=excerpt], [class*=summary]"
      )
    );
    for (const el of scopes) {
      const marks = transMarks(el);
      if (marks.length) {
        const longest = marks.sort((a, b) => b.textContent.length - a.textContent.length)[0];
        return normText(longest.textContent);
      }
    }
    const heads = Array.from(document.querySelectorAll("h1, h2, h3"));
    for (const head of heads) {
      if (!/abstract|摘要|抽象的/i.test(head.textContent)) continue;
      const next = head.nextElementSibling || head.parentElement;
      const marks = next ? transMarks(next) : [];
      if (marks.length) {
        const longest = marks.sort((a, b) => b.textContent.length - a.textContent.length)[0];
        return normText(longest.textContent);
      }
    }
    return "";
  }

  // 摘要/导语译文：回原页面摘要节点里按原文模糊匹配
  function readExcerptTranslation(excerpt) {
    const wanted = normText(excerpt);
    if (!wanted) return "";
    const candidates = document.querySelectorAll(
      "p,div,section,blockquote,[class*=abstract],[class*=excerpt],[class*=summary],[class*=lead]"
    );
    for (const el of candidates) {
      const marks = transMarks(el);
      if (!marks.length) continue;
      const dst = normText(marks.map((m) => m.textContent).join(" "));
      const src = normText(el.textContent.replace(dst, ""));
      if (!src.length) continue;
      const lenRatio = Math.max(src.length, wanted.length) / Math.min(src.length, wanted.length);
      if (lenRatio <= 2 && sameText(src, wanted)) return dst;
    }
    return "";
  }

  const BLOCK_TAG_SET = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT",
    "FIELDSET", "FIGCAPTION", "FIGURE", "FORM", "H1", "H2", "H3", "H4",
    "H5", "H6", "HEADER", "LI", "MAIN", "NAV", "OL", "P", "PRE", "SECTION",
    "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
  ]);

  function elementSignature(el) {
    return {
      tag: el.tagName.toLowerCase(),
      cls: Array.from(el.classList || []).slice().sort().join("."),
      text: normText(el.textContent),
    };
  }

  // Readability 副本脱离原文档后读不到外部 CSS；回原页面实时元素取计算样式并打标记
  function markHolderInlineDisplay(holder) {
    const originals = Array.from(document.body.querySelectorAll("*")).filter(
      (o) => !holder.contains(o)
    );
    const byId = new Map();
    const byClassText = new Map();
    const byText = new Map();

    originals.forEach((orig) => {
      if (orig.id && !byId.has(orig.id)) byId.set(orig.id, orig);
      const sig = elementSignature(orig);
      if (!sig.text) return;
      const classTextKey = `${sig.cls}|${sig.text}`;
      if (!byClassText.has(classTextKey)) byClassText.set(classTextKey, orig);
      if (sig.text.length >= 4) {
        if (!byText.has(sig.text)) byText.set(sig.text, orig);
      }
    });

    holder.querySelectorAll("*").forEach((el) => {
      // 默认 inline 的 span/a/strong 等不需要补标记；只处理被 CSS 改成 inline 的块级容器
      if (!BLOCK_TAG_SET.has(el.tagName)) return;
      const sig = elementSignature(el);
      let orig = el.id ? byId.get(el.id) : null;
      if (!orig && sig.text) {
        orig = byClassText.get(`${sig.cls}|${sig.text}`) ||
          (sig.text.length >= 4 ? byText.get(sig.text) : null);
      }
      if (!orig) return;
      const display = getComputedStyle(orig).display;
      if (/^inline/.test(display)) {
        el.setAttribute("data-ep-display", display);
      }
    });
  }

  async function run() {
    toast("正在自动识别正文…", true);

    // Readability 会删脚本、改候选节点，先克隆文档，避免动到当前页面
    let article;
    try {
      article = new window.Readability(document.cloneNode(true)).parse();
    } catch (err) {
      throw new Error((err && err.message) || "正文识别失败");
    }

    if (!article || !article.content || !(article.textContent || "").trim()) {
      throw new Error("未能识别到正文，可改用手动选取");
    }

    const holder = document.createElement("div");
    holder.innerHTML = article.content;
    // 脱离文档树时 getComputedStyle 只能拿到默认 block；临时挂到离屏位置，保留页面原始 inline 显示方式
    holder.style.cssText =
      "position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;";
    document.body.appendChild(holder);
    markHolderInlineDisplay(holder);

    const titleText = article.title || document.title || "";
    // Readability 在缺少 meta/JSON-LD 摘要时会用正文首段兜底；这类首段不作为摘要，避免和正文重复
    const excerptText = article.excerptFallback ? "" : article.excerpt || "";
    let payload;
    try {
      payload = await window.ElementPrintExtract.extract(holder, {
        sourceUrl: location.href,
        title: titleText,
        pageTitle: titleText,
        titleTrans: readTitleTranslation(article.title),
        author: article.byline || "",
        publishedTime: article.publishedTime || "",
        excerpt: excerptText,
        excerptTrans: readAbstractTranslation() || readExcerptTranslation(excerptText),
        styleRoot: document,
      });
    } finally {
      holder.remove();
    }
    if (article.title && article.title.trim()) {
      payload.title = article.title.trim();
    }

    payload.debug = {
      source: "readability",
      title: article.title || "",
      byline: article.byline || "",
      publishedTime: article.publishedTime || "",
      excerpt: excerptText,
      excerptFallback: Boolean(article.excerptFallback),
      html: article.content || "",
    };

    await window.ElementPrintExtract.savePayload(payload);
    toast("已提取", false);
    setTimeout(() => {
      window[FLAG] = false;
    }, 500);
  }

  run().catch((err) => {
    const msg = (err && err.message) || String(err);
    toast("提取失败：" + msg, false);
    window[FLAG] = false;
  });
})();

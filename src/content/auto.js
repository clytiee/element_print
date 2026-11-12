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

    const titleText = article.title || document.title || "";
    const payload = await window.ElementPrintExtract.extract(holder, {
      sourceUrl: location.href,
      title: titleText,
      pageTitle: titleText,
      titleTrans: readTitleTranslation(article.title),
      author: article.byline || "",
      publishedTime: article.publishedTime || "",
      excerpt: article.excerpt || "",
    });
    if (article.title && article.title.trim()) {
      payload.title = article.title.trim();
    }

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

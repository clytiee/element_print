// 整页自动提取：Readability 先挑正文容器，结果再交给原有抽取管线清洗/拆译文/内嵌图片。

(() => {
  const t = window.ElementPrintI18n ? window.ElementPrintI18n.t : (k) => k;
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
    // 与 extract.js 保持一致：Edge 版 DeepTranslate 把译文装在 bt-copied-node-wrapper /
    // bt-target-wrapper 里，外层 bt-translate-status 那个元素原译文都在，不能当标记
    const classRe =
      /(^|\s)(translated|translation|deep-trans|trans-text|bt-copied-node-wrapper|bt-target-wrapper|bt-target-block)\b/i;
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

  // 摘要直接用 Readability 摘出来的 excerpt（它自己按 og:description / description / JSON-LD
  // 选，都没有时用正文首段兜底并标记 excerptFallback）
  function readabilityExcerpt(article) {
    if (!article || article.excerptFallback) return "";
    return normText(article.excerpt || "");
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
        ".hlFld-Abstract, .abstractSection, .abstractInFull, [class*=abstract], [class*=excerpt], [class*=summary], [class*=dek], [class*=standfirst]"
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
      const src = normText(normText(el.textContent).replace(dst, ""));
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

  // 翻译插件标记译文节点的类名（Chrome 版 / Edge 版 DeepTranslate 等），
  // Readability 要把这些类原样留着，后续才认得出译文
  const TRANS_MARK_CLASSES = [
    "translated", "translation", "deep-trans", "trans-text",
    "bt-copied-node-wrapper", "bt-target-wrapper", "bt-target-block",
  ];

  function elementSignature(el) {
    return {
      tag: el.tagName.toLowerCase(),
      cls: Array.from(el.classList || []).slice().sort().join("."),
      text: normText(el.textContent),
    };
  }

  // 正文里第一段实义文字之前已有图片，就认为首图已经在了，不再补题图
  function hasLeadMedia(root) {
    const media = root.querySelector("figure, img, picture");
    if (!media) return false;
    const firstP = Array.from(root.querySelectorAll("p")).find(
      (p) => normText(p.textContent).length >= 40
    );
    if (!firstP) return true;
    return Boolean(media.compareDocumentPosition(firstP) & Node.DOCUMENT_POSITION_FOLLOWING);
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

  // 有些页面把推广语、图片说明、作者署名也写成 <p>，且排在正文前面。
  // 所以不取「第一个段落」，而是取候选段落里出现字数最多的那一种字号/行距组合
  const SKIP_CLASS_RE =
    /(newsletter|subscribe|signup|caption|credit|byline|promo|advert|sponsor|related|comment|share|footer|breadcrumb|cookie|consent|toolbar|nav)/i;
  const BODY_MIN_CHARS = 40;

  function looksLikeBodyParagraph(node) {
    if (!node || !node.isConnected) return false;
    if (normText(node.textContent).length < BODY_MIN_CHARS) return false;
    let walker = node.parentElement;
    for (let i = 0; walker && i < 3; i += 1) {
      if (/^(FIGCAPTION|FOOTER|ASIDE|NAV)$/.test(walker.tagName)) return false;
      if (SKIP_CLASS_RE.test(String(walker.className || ""))) return false;
      walker = walker.parentElement;
    }
    return true;
  }

  function pickBodyParagraph(list, fallback) {
    const groups = new Map();
    for (const node of list) {
      if (!looksLikeBodyParagraph(node)) continue;
      const cs = getComputedStyle(node);
      const key = `${cs.fontSize}|${cs.lineHeight}|${cs.marginTop}|${cs.marginBottom}`;
      const hit = groups.get(key) || { node, chars: 0 };
      hit.chars += normText(node.textContent).length;
      groups.set(key, hit);
    }
    let best = null;
    for (const hit of groups.values()) {
      if (!best || hit.chars > best.chars) best = hit;
    }
    return best ? best.node : fallback;
  }

  // 同字号、同行的段落里，占字数最多的那组（段前、段后）边距
  function dominantMargins(node) {
    const base = getComputedStyle(node);
    if (!base) return null;
    const pool = Array.from(document.querySelectorAll("p, li, dd")).filter((p) => {
      const cs = getComputedStyle(p);
      return (
        cs.fontSize === base.fontSize &&
        cs.lineHeight === base.lineHeight &&
        normText(p.textContent).length >= 40
      );
    });
    if (pool.length < 3) return null;
    const groups = new Map();
    pool.forEach((p) => {
      const cs = getComputedStyle(p);
      const key = `${cs.marginTop}|${cs.marginBottom}`;
      const hit =
        groups.get(key) || { chars: 0, mt: parseFloat(cs.marginTop) || 0, mb: parseFloat(cs.marginBottom) || 0 };
      hit.chars += normText(p.textContent).length;
      groups.set(key, hit);
    });
    let best = null;
    for (const hit of groups.values()) {
      if (!best || hit.chars > best.chars) best = hit;
    }
    // 主体段落本身就没有外边距时，保持原样（用空行式间距的站点不该被硬塞间距）
    return best;
  }

  // Readability 的正文容器是离屏副本，读不到页面样式；在原文档上找对应节点取计算样式
  function pageFontInfo(title, samples, headTexts) {
    const computed = (node) => {
      if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
      const cs = getComputedStyle(node);
      const stack = (cs && cs.fontFamily ? cs.fontFamily : "").trim();
      if (!stack) return null;
      const sizePx = parseFloat(cs.fontSize) || 0;
      const linePx = parseFloat(cs.lineHeight) || 0;
      const lineRatio = sizePx && linePx ? Math.round((linePx / sizePx) * 100) / 100 : 0;
      const paraBefore = Math.round(parseFloat(cs.marginTop) || 0);
      const paraAfter = Math.round(parseFloat(cs.marginBottom) || 0);
      const rawAlign = String(cs.textAlign || "").trim().toLowerCase();
      return {
        stack,
        sizePx,
        sizePt: sizePx ? Math.round(sizePx * 0.75 * 10) / 10 : 0,
        lineRatio,
        paraBefore,
        paraAfter,
        align: rawAlign && rawAlign !== "start" ? rawAlign : "",
        weight: weightValue(cs.fontWeight),
        color: darkColorOf(cs.color),
      };
    };
    // computedStyle 的字重有时是 bold/normal 关键字，统一换成 100–900
    const weightValue = (raw) => {
      const text = String(raw || "").trim().toLowerCase();
      if (text === "bold") return 700;
      if (text === "normal") return 400;
      const num = parseFloat(text);
      return Number.isFinite(num) ? Math.round(num) : 400;
    };
    // 只有够深的文字色才搬：浅色多半是深色主题下的白字，印到白纸上会看不见
    const darkColorOf = (raw) => {
      const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i.exec(String(raw || ""));
      if (!m) return "";
      if (m[4] !== undefined && Number(m[4]) < 0.5) return "";
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      if (luma > 0.62) return "";
      const hex = (n) => n.toString(16).padStart(2, "0");
      return `#${hex(r)}${hex(g)}${hex(b)}`;
    };
    const wanted = normText(title);
    let titleNode = null;
    if (wanted) {
      // 标题标签优先：div.storytitle 这类容器只是把 <h1> 包起来，字体是从 h1 继承/共用，
      // 但容器自己的字重是 normal，先取容器会把粗体标题记成常规
      const heads = Array.from(document.querySelectorAll("h1, h2, h3"));
      const boxes = Array.from(
        document.querySelectorAll("[class*=title], [class*=headline], [class*=hed], [class*=heading]")
      );
      const pick = (nodes, exactOnly) =>
        nodes.find((node) => {
          const txt = normText(node.textContent);
          if (!txt) return false;
          if (txt === wanted) return true;
          return !exactOnly && wanted.length >= 8 && txt.includes(wanted);
        }) || null;
      titleNode = pick(heads, true) || pick(heads, false) || pick(boxes, true) || pick(boxes, false);
      // 网页 og:title 与页面大标题不是同一句时，允许大标题只是标题的一部分
      if (!titleNode) {
        titleNode =
          heads.find((node) => {
            const txt = normText(node.textContent);
            return txt.length >= 10 && wanted.includes(txt);
          }) || null;
      }
    }
    // 文字都对不上时退回文档里第一个 h1/h2：标题字体样式几乎总写在它身上
    if (!titleNode) titleNode = document.querySelector("h1") || document.querySelector("h2");
    // 正文：先用 Readability 抽出的真实正文段落回原页面找同文段落，找到就以它为准；
    // 找不到再退到「正文容器里字数最多的字号组合」，最后退到整页第一个有字段落
    let bodyNode = null;
    if (samples && samples.length) {
      const all = document.querySelectorAll("p, li, dd, dt, blockquote");
      for (const sample of samples) {
        const head = sample.slice(0, 40);
        const match = Array.from(all).find((node) => {
          const txt = normText(node.textContent);
          return txt.length >= 30 && (txt.slice(0, 40) === head || txt.includes(head));
        });
        if (match) {
          bodyNode = match;
          break;
        }
      }
    }
    if (!bodyNode) {
      const containers = document.querySelectorAll(
        "article p, main p, [class*=content] p, [class*=article] p, [class*=post] p"
      );
      const firstText =
        Array.from(containers).find((n) => normText(n.textContent).length >= 12) ||
        Array.from(document.querySelectorAll("p")).find((n) => normText(n.textContent).length >= 12);
      bodyNode = pickBodyParagraph(Array.from(containers), firstText);
    }
    const body = computed(bodyNode);
    // 段间距可能只写在部分段落上：有的站用 p + p { margin-top }，首段 margin-top 是 0；
    // 有的首段还被单独去掉外边距。单个节点取不到时，按同字号同行的段落里占比最大的
    // 那组上下边距作为代表值，避免整篇的段间距被记成 0
    if (body && bodyNode) {
      const group = dominantMargins(bodyNode);
      if (group) {
        body.paraBefore = Math.round(group.mt);
        body.paraAfter = Math.round(group.mb);
      }
    }
    const titleFont = computed(titleNode);
    // 各级标题的字体：拿 Readability 正文里的标题文字回原页面找同一个标题节点；
    // 找不到就退到正文容器内文字最多的同级标题（避开导航、侧栏的小标题样式）
    const heads = {};
    ["h1", "h2", "h3", "h4", "h5", "h6"].forEach((tag) => {
      const texts = ((headTexts && headTexts[tag]) || [])
        .map((t) => normText(t).slice(0, 40))
        .filter(Boolean);
      const pool = Array.from(document.querySelectorAll(tag)).filter(
        (n) => n.isConnected && normText(n.textContent)
      );
      let node = null;
      if (texts.length) {
        node =
          pool.find((n) => {
            const txt = normText(n.textContent);
            return texts.some((w) => txt.slice(0, 40) === w || txt.includes(w));
          }) || null;
      }
      if (!node) {
        const inArticle = pool.filter(
          (n) =>
            n.closest("article, main, [class*=content], [class*=post], [class*=article]") &&
            n !== titleNode
        );
        const use = inArticle.length ? inArticle : pool.filter((n) => n !== titleNode);
        use.sort((a, b) => normText(b.textContent).length - normText(a.textContent).length);
        node = use[0] || null;
      }
      const font = computed(node);
      if (font) heads[tag] = font;
    });
    if (!body && !titleFont) return null;
    // 引文块：拿正文里的引文文字回原页面找同一个 blockquote，取它的字体
    let quoteNode = null;
    const quoteTexts = ((headTexts && headTexts.quote) || [])
      .map((t) => normText(t).slice(0, 40))
      .filter(Boolean);
    const quotes = Array.from(document.querySelectorAll("blockquote")).filter(
      (n) => n.isConnected && normText(n.textContent)
    );
    if (quoteTexts.length) {
      quoteNode =
        quotes.find((n) => {
          const txt = normText(n.textContent);
          return quoteTexts.some((w) => txt.slice(0, 40) === w || txt.includes(w));
        }) || null;
    }
    if (!quoteNode && quotes.length) {
      quotes.sort((a, b) => normText(b.textContent).length - normText(a.textContent).length);
      quoteNode = quotes[0];
    }
    // 引文的字体通常写在块里那一段 p 上，blockquote 自身多半只是继承正文
    const quotePara =
      quoteNode &&
      (Array.from(quoteNode.querySelectorAll("p")).find((n) => normText(n.textContent)) ||
        quoteNode);
    // 同时把框线、缩进、底色这些结构样式一起记下（只记字体会丢格式）
    let quoteStyle = null;
    if (quoteNode) {
      const bs = getComputedStyle(quoteNode);
      const ps = quotePara && quotePara !== quoteNode ? getComputedStyle(quotePara) : null;
      const px = (v) => Math.round(parseFloat(v) || 0);
      quoteStyle = {
        mt: px(bs.marginTop),
        mr: px(bs.marginRight),
        mb: px(bs.marginBottom),
        ml: px(bs.marginLeft),
        pl: px(bs.paddingLeft),
        pr: px(bs.paddingRight),
        pt: px(bs.paddingTop),
        pb: px(bs.paddingBottom),
        borderW: px(bs.borderLeftWidth),
        borderStyle: bs.borderLeftStyle,
        borderColor: bs.borderLeftColor,
        bg: bs.backgroundColor,
        pbg: ps ? ps.backgroundColor : "",
        ppl: ps ? px(ps.paddingLeft) : 0,
        ppr: ps ? px(ps.paddingRight) : 0,
        ppt: ps ? px(ps.paddingTop) : 0,
        ppb: ps ? px(ps.paddingBottom) : 0,
        pmt: ps ? px(ps.marginTop) : 0,
        pmb: ps ? px(ps.marginBottom) : 0,
      };
    }
    return { body, title: titleFont, heads, quote: computed(quotePara), quoteStyle };
  }

  async function run() {
    toast(t("detecting"), true);

    // Readability 会删脚本、改候选节点，先克隆文档，避免动到当前页面
    let article;
    try {
      article = new window.Readability(document.cloneNode(true), {
        // Readability 默认会清掉正文里所有 class；翻译插件正是靠 class 标记译文节点，
        // 清掉就认不出译文了，所以把这些标记类加进保留白名单
        classesToPreserve: TRANS_MARK_CLASSES,
      }).parse();
    } catch (err) {
      throw new Error((err && err.message) || t("articleDetectFailed"));
    }

    if (!article || !article.content || !(article.textContent || "").trim()) {
      throw new Error(t("articleDetectFailed"));
    }

    const holder = document.createElement("div");
    holder.innerHTML = article.content;
    // Readability 会丢掉正文容器之外的首图（标题上方的题图及图注），这里补回正文开头。
    // 正文本身已经有靠前的图就不动，避免重复。
    let contentHtml = article.content || "";
    try {
      if (!hasLeadMedia(holder)) {
        const leadHtml = window.ElementPrintExtract.leadImage(
          article.title || document.title || ""
        );
        // 同一张图正文里已有（文件名相同）就不重复插入
        const leadName = (/src="[^"]*\/([^"\/?#]+)/.exec(leadHtml || "") || [])[1];
        if (leadHtml && (!leadName || !contentHtml.includes(leadName))) {
          holder.insertAdjacentHTML("afterbegin", leadHtml);
          contentHtml = leadHtml + contentHtml;
        }
      }
    } catch (err) {
      /* 补图失败不影响正文提取 */
    }
    // 脱离文档树时 getComputedStyle 只能拿到默认 block；临时挂到离屏位置，保留页面原始 inline 显示方式
    holder.style.cssText =
      "position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;";
    document.body.appendChild(holder);
    markHolderInlineDisplay(holder);

    const titleText = article.title || document.title || "";
    // 从 Readability 正文里取几段做样本，回原页面按同文段落定位，取样正文的真实样式
    const bodySamples = [];
    const headTexts = {};
    try {
      const parsed = new DOMParser().parseFromString(article.content || "", "text/html");
      parsed.querySelectorAll("p, li, blockquote").forEach((node) => {
        if (bodySamples.length >= 6) return;
        const txt = normText(node.textContent);
        if (txt.length >= 40) bodySamples.push(txt);
      });
      parsed.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((node) => {
        const tag = node.tagName.toLowerCase();
        const txt = normText(node.textContent);
        if (!txt) return;
        headTexts[tag] = headTexts[tag] || [];
        if (headTexts[tag].length < 4) headTexts[tag].push(txt);
      });
      parsed.querySelectorAll("blockquote").forEach((node) => {
        const txt = normText(node.textContent);
        if (!txt) return;
        headTexts.quote = headTexts.quote || [];
        if (headTexts.quote.length < 3) headTexts.quote.push(txt);
      });
    } catch (err) {
      /* 解析失败就只用启发式 */
    }
    // 摘要就取 Readability 的 excerpt（首段兜底的那种不算，避免和正文重复）
    const excerptText = readabilityExcerpt(article);
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
        pageFont: pageFontInfo(titleText, bodySamples, headTexts),
      });
    } finally {
      holder.remove();
    }

    payload.debug = {
      source: "readability",
      title: article.title || "",
      byline: article.byline || "",
      publishedTime: article.publishedTime || "",
      excerpt: excerptText,
      excerptFallback: Boolean(article.excerptFallback),
      html: contentHtml,
    };

    await window.ElementPrintExtract.savePayload(payload);
    toast(t("extracted"), false);
    setTimeout(() => {
      window[FLAG] = false;
    }, 500);
  }

  run().catch((err) => {
    const msg = (err && err.message) || String(err);
    toast(t("extractFailedPrefix") + msg, false);
    window[FLAG] = false;
  });
})();

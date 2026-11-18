// 富文本抽取：克隆命中元素 → 去噪、绝对化链接、内嵌图片 → 首行提为标题并剥离。
// 以全局对象挂出，供 content/selector.js 在同一内容脚本世界里直接调用。

(() => {
  if (window.ElementPrintExtract) return;

  const BLOCK_TAGS = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DD", "DIV", "DL", "DT",
    "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3",
    "H4", "H5", "H6", "HEADER", "HR", "LI", "MAIN", "NAV", "OL", "P", "PRE",
    "SECTION", "TABLE", "TBODY", "TD", "TFOOT", "TH", "THEAD", "TR", "UL",
  ]);

  const DROP_SELECTOR = [
    "script", "style", "link", "meta", "iframe", "embed", "object", "noscript",
    "template", "canvas", "audio", "video", "source", "track", "form", "input",
    "button", "select", "textarea", "progress", "meter", "dialog",
  ].join(",");

  // 工具条/评论/收藏/分享/提示气泡这类控件容器的类名片段；正文段落一般不带
  const UI_CLASS_RE =
    /(tooltip|popover|screen-reader|sr-only|visually-hidden|visuallyhidden|divider|comment|bookmark|share|social|toolbar|actions|preferred-source)/i;

  // 只保留版式需要的属性，页面自带的 style/class/id 一律剥掉，避免污染版面
  const KEEP_ATTRS = new Set([
    "href", "src", "alt", "title", "colspan", "rowspan", "start", "reversed",
    "value", "datetime", "lang", "dir", "cite", "scope", "width", "height",
    "data-ep-display",
  ]);

  const IMG_LIMIT = 40;
  const IMG_MAX_BYTES = 4 * 1024 * 1024;
  const IMG_TOTAL_CHARS = 24 * 1024 * 1024;

  function absUrl(raw, base) {
    if (!raw) return raw;
    if (/^(data:|blob:|#)/i.test(raw)) return raw;
    try {
      return new URL(raw, base).href;
    } catch {
      return raw;
    }
  }

  function pickLargestFromSrcset(srcset) {
    const parts = srcset.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return "";
    const last = parts[parts.length - 1];
    return last.split(/\s+/)[0] || "";
  }

  function absolutize(root, base) {
    root.querySelectorAll("a[href]").forEach((a) => {
      const href = a.getAttribute("href");
      if (!href || /^(javascript|mailto|tel):/i.test(href)) return;
      a.setAttribute("href", absUrl(href, base));
    });

    root.querySelectorAll("img").forEach((img) => {
      const srcset = img.getAttribute("srcset");
      let src = img.getAttribute("src") || "";
      if (!src && srcset) src = pickLargestFromSrcset(srcset);
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
      img.removeAttribute("loading");
      img.removeAttribute("decoding");
      if (src) img.setAttribute("src", absUrl(src, base));
    });

    root.querySelectorAll("source[src]").forEach((s) => {
      s.setAttribute("src", absUrl(s.getAttribute("src"), base));
    });
  }

  // 带 role="img" / 可访问名 / 内嵌文字，或在图注容器里的 SVG 视为正文插图，保留；
  // 其余只画图标的装饰性 SVG（评论、书签、分享等小图标）随控件一起清掉。
  function isContentSvg(svg) {
    if (svg.getAttribute("role") === "img") return true;
    if (svg.hasAttribute("aria-label") || svg.hasAttribute("aria-labelledby")) return true;
    if (svg.querySelector("text")) return true;
    if (svg.closest("figure,figcaption")) return true;
    return false;
  }

  // 抽取前清理网页控件残留：提示气泡、分隔线、评论/收藏/分享工具条、纯图标链接。
  // 只清交互外壳，不删正文里的图片、表格与插图 SVG。
  function cleanUiChrome(root) {
    Array.from(root.querySelectorAll("*")).forEach((el) => {
      if (UI_CLASS_RE.test(el.getAttribute("class") || "")) el.remove();
    });
    root.querySelectorAll('[role="tooltip"]').forEach((el) => el.remove());

    root.querySelectorAll("svg").forEach((svg) => {
      if (!isContentSvg(svg)) svg.remove();
    });

    root.querySelectorAll("a").forEach((a) => {
      const href = a.getAttribute("href") || "";
      const text = normText(a.textContent);
      const keepsMedia = Boolean(a.querySelector("img,figure"));
      const countOnly = /^\d{1,4}$/.test(text);
      const emptyControl = !text && !keepsMedia;
      const inPageCount = href.startsWith("#") && keepsMedia === false && (countOnly || !text);
      if (emptyControl || inPageCount) a.remove();
    });

    pruneEmpty(root);
  }

  function cleanAttributes(root) {
    const nodes = root.querySelectorAll("*");
    nodes.forEach((node) => {
      Array.from(node.attributes).forEach((attr) => {
        if (!KEEP_ATTRS.has(attr.name.toLowerCase())) {
          node.removeAttribute(attr.name);
        }
      });
    });
    Array.from(root.attributes).forEach((attr) => {
      if (!KEEP_ATTRS.has(attr.name.toLowerCase())) {
        root.removeAttribute(attr.name);
      }
    });
  }

  // 页面上被 CSS 改成 inline/inline-block 的 div 等元素，在克隆上保留原始显示方式
  function markInlineDisplay(origRoot, cloneRoot, styleRoot) {
    const walk = (orig, clone) => {
      if (!orig || !clone) return;
      if (orig.nodeType === Node.ELEMENT_NODE && clone.nodeType === Node.ELEMENT_NODE) {
        if (!BLOCK_TAGS.has(clone.tagName)) return;
        // 整页提取时 holder 是 Readability 重建的离屏容器；优先按 id 回原页面取计算样式
        let source = orig;
        // styleRoot 可能是 Document，也可能是手动选取时的普通元素节点（没有 getElementById）
        const doc = styleRoot && styleRoot.ownerDocument ? styleRoot.ownerDocument : styleRoot;
        if (doc && orig.id && typeof doc.getElementById === "function") {
          const matched = doc.getElementById(orig.id);
          if (matched) source = matched;
        }
        const display = getComputedStyle(source).display;
        if (/^inline/.test(display)) {
          clone.setAttribute("data-ep-display", display);
        }
      }
      const origChildren = Array.from(orig.children);
      const cloneChildren = Array.from(clone.children);
      origChildren.forEach((child, index) => walk(child, cloneChildren[index]));
    };
    walk(origRoot, cloneRoot);
  }

  function beforeMarkText(el, root) {
    const block = nearestBlock(el, root);
    const range = document.createRange();
    range.setStart(block, 0);
    range.setEndBefore(el);
    return normText(range.toString());
  }

  // 混排是阅读重排，不还原原网页格式：整句译文另起一行，短语/人名译文留在句内并补空格。
  function markMixedTranslations(root, marks) {
    marks.forEach((el) => {
      if (!root.contains(el)) return;
      const dst = normText(el.textContent);
      if (!dst) return;
      const before = beforeMarkText(el, root);
      const heading = el.closest("h1,h2,h3,h4,h5,h6");
      const fullSentence =
        Boolean(heading) ||
        (SENT_END_RE.test(before) && SENT_END_RE.test(dst));
      el.classList.add(fullSentence ? "ep-mixed-trans--block" : "ep-mixed-trans");
      if (!fullSentence) {
        const prev = el.previousSibling;
        if (
          prev &&
          prev.nodeType === 3 &&
          prev.textContent &&
          /[A-Za-z0-9]$/.test(prev.textContent) &&
          !/\s$/.test(prev.textContent)
        ) {
          prev.textContent += " ";
        }
      }
    });
  }

  function tokenize(root) {
    const toks = [];
    const rec = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          toks.push({ type: "text", node: child });
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.tagName === "BR") {
            toks.push({ type: "nl" });
            continue;
          }
          if (child.tagName === "IMG") {
            toks.push({ type: "media" });
            continue;
          }
          const isBlock = BLOCK_TAGS.has(child.tagName);
          if (isBlock) toks.push({ type: "nl" });
          rec(child);
          if (isBlock) toks.push({ type: "nl" });
        }
      }
    };
    rec(root);
    return toks;
  }

  // 取首个非空行，并从 DOM 里把这行字符删掉（跨内联节点也照删）
  function takeTitle(root) {
    const toks = tokenize(root);
    const chars = [];
    const map = [];
    for (const tok of toks) {
      if (tok.type === "nl") {
        chars.push("\n");
        map.push(null);
      } else if (tok.type === "media") {
        chars.push("\uFFFC");
        map.push(null);
      } else {
        const data = tok.node.data;
        for (let i = 0; i < data.length; i += 1) {
          chars.push(data[i]);
          map.push({ node: tok.node, index: i });
        }
      }
    }

    let start = -1;
    for (let i = 0; i < chars.length; i += 1) {
      if (chars[i] !== "\n" && chars[i] !== "\uFFFC" && !/\s/.test(chars[i])) {
        start = i;
        break;
      }
    }
    if (start < 0) return "";

    let end = start;
    while (end < chars.length && chars[end] !== "\n") end += 1;
    const title = chars
      .slice(start, end)
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (!title) return "";

    // 按文本节点归组要删的下标
    const dead = new Map();
    for (let i = start; i < end; i += 1) {
      const ref = map[i];
      if (!ref) continue;
      if (!dead.has(ref.node)) dead.set(ref.node, new Set());
      dead.get(ref.node).add(ref.index);
    }
    dead.forEach((indices, node) => {
      let kept = "";
      for (let i = 0; i < node.data.length; i += 1) {
        if (!indices.has(i)) kept += node.data[i];
      }
      node.data = kept;
    });

    pruneEmpty(root);
    return title;
  }

  // 这些标签即使没有文字也要保留：图片、分隔线与表格骨架
  const KEEP_EMPTY = new Set([
    "IMG", "BR", "HR", "VIDEO", "AUDIO", "CANVAS", "INPUT",
    "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TD", "TH", "COL", "COLGROUP",
  ]);

  // ---------- 页面自带的译文（浏览器翻译插件插入的中文）----------
  // 这类元素带 data-deeptranslate-translated / data-translated 之类的标记，
  // 抽正文时要把它们从原句里摘出来，单独作为译文交给预览页的右栏，
  // 否则原文列会中英夹在一起。
  // 注意：DeepTranslate（Edge 版）在外层元素上写 bt-translate-status="translated"，
  // 那个元素里原文和译文都有，不能当标记；真正装译文的是里面的 bt-copied-node-wrapper /
  // bt-target-wrapper，只认这两个类。
  const TRANS_ATTR_RE = /^(data[-_](deep)?translat|data[-_]trans$)/i;
  const TRANS_CLASS_RE =
    /(^|\s)(translated|translation|deep-trans|trans-text|bt-copied-node-wrapper|bt-target-wrapper|bt-target-block)\b/i;

  function isTransMarked(el) {
    for (const attr of el.attributes) {
      if (TRANS_ATTR_RE.test(attr.name.toLowerCase())) return true;
    }
    return TRANS_CLASS_RE.test(el.getAttribute("class") || "");
  }

  function normText(s) {
    return String(s || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  // 往上找最近的块级祖先（段落、列表项、表格单元格…），限定在抽取范围内
  function nearestBlock(el, root) {
    let node = el.parentElement;
    while (node && node !== root.parentElement) {
      if (node === root || BLOCK_TAGS.has(node.tagName)) return node;
      node = node.parentElement;
    }
    return root;
  }

  // 这些块可以按译文位置切成多段；表格里的单元格、行不能切
  const SPLIT_TAGS = new Set([
    "P", "DIV", "LI", "DD", "DT", "BLOCKQUOTE", "SECTION", "ARTICLE",
    "H1", "H2", "H3", "H4", "H5", "H6", "FIGCAPTION",
  ]);

  function hasContent(frag) {
    if (!frag) return false;
    if (normText(frag.textContent)) return true;
    return Boolean(frag.querySelector && frag.querySelector("img,table,hr"));
  }

  function hasBlockChild(node) {
    return Boolean(node && Array.from(node.children).some((c) => BLOCK_TAGS.has(c.tagName)));
  }

  // 参考文献条目整体作为一个配对单元：作者、缩写、标题、来源都属于同一条引用，
  // 不能退到 surname / given-names / article-title 这类内层小容器里逐词配对。
  function citationEntry(el) {
    const ref = el.closest(".ref, .reference");
    if (ref) return ref;
    return el.closest(".citation, .mixed-citation");
  }

  // 这一段译文该跟谁配对：
  //   译文在叶子块里（只装行内内容）→ 就是那个块，按段落口径配对；
  //   译文在「还套着别的块」的外层容器里（作者名、按钮这类）→ 退到最近的行内容器，
  //   否则会把整块（含下面几段地址）都当成它的原文。
  function pairUnit(el, root) {
    const citation = citationEntry(el);
    if (citation) return citation;
    const block = nearestBlock(el, root);
    if (block && !hasBlockChild(block)) return block;
    let node = el;
    while (node.parentElement && node.parentElement !== root.parentElement) {
      const parent = node.parentElement;
      if (parent === root || hasBlockChild(parent)) break;
      node = parent;
    }
    return node;
  }

  function depthOf(el, root) {
    let depth = 0;
    let node = el;
    while (node && node !== root) {
      if (node.parentElement && BLOCK_TAGS.has(node.parentElement.tagName)) depth += 1;
      node = node.parentElement;
    }
    return depth;
  }

  function makeBlock(tag, frag) {
    const el = document.createElement(tag.toLowerCase());
    el.appendChild(frag);
    return el;
  }

  // 译文单独成块（整块都是中文）时，把译文挂到上一段正文上
  function attachToPrev(block, dst, root) {
    let prev = block.previousElementSibling;
    while (prev && !normText(prev.textContent)) prev = prev.previousElementSibling;
    const prevText = prev ? normText(prev.textContent) : "";
    if (!prevText) return "";
    return prevText;
  }

  // 拼译文碎片：两边都是汉字/全角标点时直接相连，否则补一个空格
  const CJK_CHAR_RE = /[\u2e80-\u9fff\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/;

  function joinDst(parts) {
    let out = "";
    parts.forEach((part) => {
      const text = normText(part);
      if (!text) return;
      if (!out) {
        out = text;
        return;
      }
      const prev = out[out.length - 1];
      const next = text[0];
      const needSpace = !CJK_CHAR_RE.test(prev) && !CJK_CHAR_RE.test(next);
      out += (needSpace ? " " : "") + text;
    });
    return out;
  }

  // 句末标点（允许后面跟空白、引号、右括号）
  const SENT_END_RE = /[.!?。！？…]\s*["'”’）)\]】]*$/;

  /**
   * 一个块里可能混着两种截然不同的东西：
   *   ① 半句被翻译插件切开——「...introduce the [人名译文] ...」，句子没完，
   *      译文是碎片，不能在这里断段，否则整段被切成一地鸡毛；
   *   ② 原文本身就是一段接一段——「英文段 + 整段中文」，这里才该断开。
   * 判据：紧挨译文之前的原文（同一处文字，不是累计文本）收在句末标点上、
   * 且紧随其后的译文也收在句末标点上。只看累计文本会把句与句之间误判成断段。
   * 返回需要断段的那些标记元素。
   */
  // 导语/摘要可能来自 meta 或 JSON-LD，和正文段落的空白、截断略有差异；
  // 精确匹配失败时，再按包含关系或前缀重合度找一次对应译文。
  function findExcerptPair(excerptText, pairs) {
    if (!excerptText) return null;
    const list = pairs || [];
    const exact = list.find((pair) => pair.src === excerptText);
    if (exact) return exact;
    if (excerptText.length < 12) return null;
    return (
      list.find((pair) => {
        const src = pair.src;
        if (!src) return false;
        if (src.includes(excerptText) || excerptText.includes(src)) return true;
        const min = Math.min(src.length, excerptText.length);
        let i = 0;
        while (i < min && src[i] === excerptText[i]) i += 1;
        return min >= 12 && i / min >= 0.8;
      }) || null
    );
  }

  function findParagraphCuts(block, marks) {
    const markSet = new Set(marks);
    const order = [];
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === 3) {
          order.push({ type: "text", node: child });
        } else if (child.nodeType === 1) {
          if (markSet.has(child)) order.push({ type: "mark", node: child });
          else walk(child);
        }
      });
    };
    walk(block);

    const cuts = new Set();
    let srcBuf = "";
    let prevText = "";
    let dstParts = [];
    let lastMark = null;
    order.forEach((item) => {
      if (item.type === "mark") {
        dstParts.push(normText(item.node.textContent));
        lastMark = item.node;
        return;
      }
      const text = normText(item.node.data);
      if (!text) return;
      // 上一段已经完整收尾（紧挨着的原文有句末点、译文也有），就从上一处译文断段；
      // 紧邻的原文太短（"et al." 这类缩写）不算一段的结尾
      if (
        lastMark &&
        dstParts.length &&
        srcBuf.trim().length >= 20 &&
        prevText.length >= 20 &&
        SENT_END_RE.test(prevText) &&
        SENT_END_RE.test(joinDst(dstParts))
      ) {
        cuts.add(lastMark);
        srcBuf = "";
        dstParts = [];
        prevText = "";
        lastMark = null;
      }
      prevText = text;
      srcBuf += (srcBuf ? " " : "") + text;
    });
    return cuts;
  }

  /**
   * 把译文元素从句子里摘出来，返回 [{ src, dst }]。
   * src 与预览页 collectBiRows() 的口径一致（空白折叠、去首尾），
   * 这样预览页可以直接用它填译文缓存，不去打翻译 API。
   *
   * 只在「原文本身一段接一段」的位置断段；句中被打散的碎片译文并回整段，
   * 避免把一句话切成若干残段。
   */
  function splitTranslations(root) {
    const pairs = [];
    const marked = Array.from(root.querySelectorAll("*")).filter(isTransMarked);
    if (!marked.length) return pairs;
    // 嵌套标记交给最外层处理，避免同一句被拆两次
    const tops = marked.filter((el) => !marked.some((m) => m !== el && m.contains(el)));

    // 先归组：按配对待（叶子块 / 行内容器）归并；本身就是块级元素的标记算「整块译文」
    const groups = new Map();
    const loneBlocks = [];
    tops.forEach((el) => {
      if (BLOCK_TAGS.has(el.tagName)) {
        loneBlocks.push(el);
        return;
      }
      const unit = pairUnit(el, root);
      if (!unit) {
        loneBlocks.push(el);
        return;
      }
      if (!groups.has(unit)) groups.set(unit, []);
      groups.get(unit).push(el);
    });

    // 深层先处理：外层容器配对时要读到已经被清掉译文的干净原文
    Array.from(groups.entries())
      .sort((a, b) => depthOf(b[0], root) - depthOf(a[0], root))
      .forEach(([block, marks]) => {
      const parent = block.parentNode;
      const allDst = joinDst(marks.map((m) => normText(m.textContent)));
      if (!allDst) {
        marks.forEach((m) => m.remove());
        return;
      }

      // 参考文献条目：整条作为一条对照，内部人名、标题、来源不再断段；
      // 链接里的 URL / 菜单标签不进入译文。
      if (citationEntry(block)) {
        marks.forEach((m) => m.remove());
        const src = normText(block.textContent);
        const dst = joinDst(
          marks.filter((m) => !m.closest("a")).map((m) => normText(m.textContent))
        );
        if (src && dst && src !== dst) pairs.push({ src, dst, cite: true });
        return;
      }

      // 行内容器（作者名、按钮文字这类）：只摘译文、不切块
      if (!BLOCK_TAGS.has(block.tagName)) {
        marks.forEach((m) => m.remove());
        const src = normText(block.textContent);
        if (src && src !== allDst) pairs.push({ src, dst: allDst });
        return;
      }

      // 整块只有译文、没有可配的原文：挂到上一段，否则就把它当正文留着
      if (normText(block.textContent) === allDst) {
        marks.forEach((m) => m.remove());
        const src = attachToPrev(block, allDst, root);
        if (src) {
          pairs.push({ src, dst: allDst });
          block.remove();
        }
        return;
      }

      if (!parent || !SPLIT_TAGS.has(block.tagName)) {
        // 不可切的块（表格单元格、行）：整块当作一句原文
        marks.forEach((m) => m.remove());
        pairs.push({ src: normText(block.textContent), dst: allDst });
        return;
      }

      const cuts = findParagraphCuts(block, marks);
      if (!cuts.size) {
        // 全是句中的碎片译文：整段并成一段原文，译文拼起来
        marks.forEach((m) => m.remove());
        const src = normText(block.textContent);
        if (src) pairs.push({ src, dst: allDst });
        return;
      }

      // 每段各自的译文：边界标记的译文属于它结束的那一段
      const segDsts = [[]];
      marks.forEach((m) => {
        const dst = normText(m.textContent);
        if (cuts.has(m)) {
          segDsts[segDsts.length - 1].push(dst);
          segDsts.push([]);
          return;
        }
        segDsts[segDsts.length - 1].push(dst);
      });

      // 句中的碎片标记先进范围里摘掉，免得中文被带进原文段
      marks.forEach((m) => {
        if (!cuts.has(m)) m.remove();
      });

      const segs = [];
      let cursor = null;
      Array.from(cuts).sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1)).forEach((cut, i) => {
        const r = document.createRange();
        if (cursor) r.setStartAfter(cursor);
        else r.setStart(block, 0);
        r.setEndBefore(cut);
        segs.push({ frag: r.extractContents(), dst: joinDst(segDsts[i] || []) });
        cursor = cut;
      });

      // 最后一段
      const tailRange = document.createRange();
      if (cursor) tailRange.setStartAfter(cursor);
      else tailRange.setStart(block, 0);
      tailRange.setEnd(block, block.childNodes.length);
      segs.push({ frag: tailRange.extractContents(), dst: joinDst(segDsts[cuts.size] || []) });
      Array.from(cuts).forEach((m) => m.remove());

      const out = [];
      segs.forEach((seg) => {
        if (!hasContent(seg.frag)) {
          // 空段（相邻两处断点之间没有正文）：译文并到上一段
          const last = out[out.length - 1];
          if (last && seg.dst) last.dst = joinDst([last.dst, seg.dst]);
          return;
        }
        out.push({ node: makeBlock(block.tagName, seg.frag), dst: seg.dst });
      });

      out.forEach((seg) => {
        parent.insertBefore(seg.node, block);
        const src = normText(seg.node.textContent);
        if (seg.dst && src) pairs.push({ src, dst: seg.dst });
      });
      block.remove();
    });

    loneBlocks.forEach((el) => {
      const dst = normText(el.textContent);
      if (!dst) {
        if (el.parentNode) el.remove();
        return;
      }
      // 整块就是译文：挂到上一段原文；挂不上就当正文留着，不删内容
      const block = BLOCK_TAGS.has(el.tagName) ? el : nearestBlock(el, root);
      const src = block ? attachToPrev(block, dst, root) : "";
      if (src) {
        pairs.push({ src, dst });
        (block || el).remove();
        return;
      }
      if (BLOCK_TAGS.has(el.tagName)) return; // 它本身就是正文，保留
      if (block) block.appendChild(el);
    });

    // 配对条数上限仍按 2000 控制，但正文先占额度、参考文献只用剩下的：
    // 文献条目多且先入表，按条数一刀切会把正文段落整批挤掉
    const PAIR_LIMIT = 2000;
    const bodyPairs = pairs.filter((pair) => !pair.cite).slice(0, PAIR_LIMIT);
    const room = Math.max(0, PAIR_LIMIT - bodyPairs.length);
    const citePairs = pairs.filter((pair) => pair.cite).slice(0, room);
    return [...bodyPairs, ...citePairs].map((pair) => ({ src: pair.src, dst: pair.dst }));
  }

  function isEmptyNode(node) {
    if (!node || node.nodeType !== 1) return false;
    if (KEEP_EMPTY.has(node.tagName)) return false;
    if (node.textContent.replace(/\u00a0/g, " ").trim()) return false;
    // 只剩图片/表格/列表结构时保留，避免把内容骨架当空块删掉
    if (node.querySelector("img,table,hr,figure,pre,ul,ol,blockquote")) return false;
    return true;
  }

  function pruneEmpty(root) {
    // 标题被拎走后留下的空包裹元素一并去掉，避免版面里留出空段
    const all = Array.from(root.querySelectorAll("*")).reverse();
    all.forEach((node) => {
      if (!root.contains(node)) return;
      if (isEmptyNode(node)) node.remove();
    });
    Array.from(root.childNodes).forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE && !node.data.trim()) node.remove();
    });
    // 清掉行首/行尾的空块
    while (root.firstElementChild && isEmptyNode(root.firstElementChild)) {
      root.firstElementChild.remove();
    }
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("read failed"));
      reader.readAsDataURL(blob);
    });
  }

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
    ]);
  }

  // 图片尽力转成 base64 内嵌；取不到就保留绝对 URL（预览时可能裂图，但不丢占位）。
  // 返回仍未内嵌的图片数，用于提示「存档里这些图还是外链」
  async function inlineImages(root) {
    const all = Array.from(root.querySelectorAll("img"));
    const imgs = all.slice(0, IMG_LIMIT);
    let total = 0;
    await Promise.all(
      imgs.map(async (img) => {
        if (total > IMG_TOTAL_CHARS) return;
        const src = img.getAttribute("src") || "";
        if (!src || /^data:/i.test(src)) return;
        try {
          const res = await withTimeout(
            fetch(src, { credentials: "omit", referrerPolicy: "no-referrer" }),
            8000
          );
          if (!res || !res.ok) return;
          const blob = await res.blob();
          if (!/^image\//i.test(blob.type)) return;
          if (blob.size > IMG_MAX_BYTES) return;
          const dataUrl = await blobToDataURL(blob);
          total += dataUrl.length;
          img.setAttribute("src", dataUrl);
        } catch {
          /* 保留原 URL */
        }
      })
    );
    let external = 0;
    for (const img of all) {
      const src = img.getAttribute("src") || "";
      if (src && !/^data:/i.test(src)) external += 1;
    }
    return { total: all.length, external };
  }

  function toPlainText(root) {
    return (root.textContent || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  // 正文里的第一个「纯段落」：只认不含块级子节点的块，否则会拿到外层的整篇容器，
  // 一旦被当成首段，整篇正文会被误判成导语并从正文里摘走
  function firstTextBlock(root) {
    const candidates = root.querySelectorAll(
      "p, div, li, dd, dt, blockquote, h1, h2, h3, h4, h5, h6"
    );
    let fallback = null;
    for (const node of candidates) {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (!fallback) fallback = node;
      if (!hasBlockChild(node)) return node;
    }
    return fallback;
  }

  // 学术页面常把摘要放在 .abstractSection / .abstractInFull / .hlFld-Abstract 里；
  // 这类可见摘要优先作为导语，避免回退到被 meta 截断的 description。
  function findAbstractParagraph(root) {
    if (!root) return null;
    const selectors = [
      ".hlFld-Abstract p",
      ".abstractSection p",
      ".abstractInFull p",
      "[class*='abstract'] p",
    ];
    for (const sel of selectors) {
      const found = Array.from(root.querySelectorAll(sel)).find((n) => normText(n.textContent));
      if (found) return found;
    }
    // 类名被清洗/缺失时，再按 Abstract 标题后面的段落兜底
    const heads = Array.from(root.querySelectorAll("h1, h2, h3"));
    for (const head of heads) {
      const label = normText(head.textContent).toLowerCase();
      if (label === "abstract" || label.includes("abstract") || label === "摘要" || label === "抽象的") {
        const next = head.nextElementSibling;
        const p = next ? (next.matches("p") ? next : next.querySelector("p")) : null;
        if (p && normText(p.textContent)) return p;
      }
    }
    return null;
  }

  function matchesMetaText(text, author, date) {
    const t = normText(text);
    if (!t) return false;
    if (author && (t === author || t.toLowerCase() === "by " + author.toLowerCase())) {
      return true;
    }
    if (date && t === date) return true;
    if (author && date) {
      const compact = t.toLowerCase().replace(/^by\s+/, "");
      if (
        compact.includes(author.toLowerCase()) &&
        compact.includes(date.toLowerCase()) &&
        compact.length <= author.length + date.length + 8
      ) {
        return true;
      }
    }
    return false;
  }

  const DATE_MONTH =
    "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
  const DATE_WEEKDAY =
    "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday";
  const DATE_ORDINAL = "\\d{1,2}(?:st|nd|rd|th)?";

  function extractDateText(text) {
    if (!text) return "";
    const s = String(text);
    const usNumeric = s.match(
      /\b\d{1,2}\/\d{1,2}\/\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:AM|PM|am|pm))?(?:\s+[A-Z]{2,5})?/
    );
    if (usNumeric) return usNumeric[0];
    // 日-月-年（英式）：27 Jan 2026。必须先匹配，否则下面的「月+日」会把年份前两位当成日
    const dayFirst = s.match(
      new RegExp("\\b\\d{1,2}\\s+(?:" + DATE_MONTH + ")\\s+\\d{4}\\b", "i")
    );
    if (dayFirst) return dayFirst[0];
    const en = s.match(new RegExp("(?:" + DATE_MONTH + ")\\s+\\d{1,2},?\\s+\\d{4}", "i"));
    if (en) return en[0];
    const weekdayMonthDay = s.match(
      new RegExp(
        "(?:" + DATE_WEEKDAY + ")\\s*,?\\s*(?:" + DATE_MONTH + ")\\s+" + DATE_ORDINAL +
          "(?:,?\\s+\\d{4})?",
        "i"
      )
    );
    if (weekdayMonthDay) return weekdayMonthDay[0];
    const monthDay = s.match(
      new RegExp("(?:" + DATE_MONTH + ")\\s+" + DATE_ORDINAL + "(?!\\d)", "i")
    );
    if (monthDay) return monthDay[0];
    const iso = s.match(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}[^\s]*)?\b/);
    return iso ? iso[0] : "";
  }

  function cleanAuthor(name) {
    if (!name) return "";
    let s = String(name).replace(/\s+/g, " ").trim();
    s = s.replace(/^\s*by\s+/i, "");
    s = s.replace(new RegExp("\\b(?:" + DATE_MONTH + ")\\s+\\d{1,2},?\\s+\\d{4}\\b", "gi"), "");
    s = s.replace(
      new RegExp(
        "(?:" + DATE_WEEKDAY + ")\\s*,?\\s*(?:" + DATE_MONTH + ")\\s+" + DATE_ORDINAL +
          "(?:,?\\s+\\d{4})?",
        "gi"
      ),
      ""
    );
    s = s.replace(new RegExp("\\b\\d{1,2}\\s+(?:" + DATE_MONTH + ")\\s+\\d{4}\\b", "gi"), "");
    s = s.replace(new RegExp("(?:" + DATE_MONTH + ")\\s+" + DATE_ORDINAL + "(?!\\d)", "gi"), "");
    s = s.replace(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}[^\s]*)?\b/g, "");
    s = s.replace(/\s*[·,|]\s*$/, "").trim();
    return s;
  }

  const EXCERPT_TRUNC_RE = /(\.\.\.|…|。。。)\s*$/;

  function excerptCandidate(list) {
    const clean = list.map((s) => normText(s || "")).filter(Boolean);
    const complete = clean.filter((s) => !EXCERPT_TRUNC_RE.test(s));
    const pool = complete.length ? complete : clean;
    pool.sort((a, b) => b.length - a.length);
    return pool[0] || "";
  }

  function readVisibleDate() {
    const selectors = [
      "time[datetime]",
      '[itemprop="datePublished"]',
      ".post__title__author-date",
      "[class*='byline']",
      "[class*='author']",
      "[class*='meta']",
      "[class*='post']",
      "[class*='date']",
    ];
    let isoFallback = "";
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const visible = extractDateText(el.textContent);
      if (visible) return visible;
      const attrDate = el.getAttribute ? extractDateText(el.getAttribute("datetime") || "") : "";
      if (attrDate) return attrDate;
    }
    return isoFallback;
  }

  function metaContent(selector, attr = "content") {
    const el = document.querySelector(selector);
    if (!el) return "";
    return (el.getAttribute(attr) || el.textContent || "").trim();
  }

  function ldValue(node, key) {
    if (!node || typeof node !== "object") return "";
    const v = node[key];
    if (typeof v === "string") return v.trim();
    if (Array.isArray(v)) {
      return v
        .map((x) => (x && typeof x === "object" ? x.name : x))
        .filter(Boolean)
        .join(", ")
        .trim();
    }
    if (v && typeof v.name === "string") return v.name.trim();
    return "";
  }

  function readLdMetadata() {
    let author = "";
    let publishedTime = "";
    let excerpt = "";
    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      if (author && publishedTime && excerpt) return;
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        return;
      }
      const nodes = Array.isArray(data && data["@graph"]) ? data["@graph"] : [data];
      nodes.forEach((node) => {
        author = author || ldValue(node, "author");
        publishedTime = publishedTime || ldValue(node, "datePublished");
        excerpt = excerpt || ldValue(node, "description");
      });
    });
    return { author, publishedTime, excerpt };
  }

  // 手动选取时 Readability 不在场，从 meta / JSON-LD 兜底取作者、发布日期、导语
  function readPageMeta() {
    const ld = readLdMetadata();
    return {
      author:
        metaContent('meta[name="author"]', "content") ||
        metaContent('meta[property="article:author"]', "content") ||
        metaContent('meta[name="byline"]', "content") ||
        metaContent('[class*="byline"]') ||
        metaContent('[class*="author"]') ||
        metaContent('[class*="meta"]') ||
        metaContent('[class*="post"]') ||
        ld.author,
      publishedTime:
        readVisibleDate() ||
        metaContent('meta[property="article:published_time"]', "content") ||
        metaContent('meta[name="pub-date"]', "content") ||
        metaContent('meta[name="date"]', "content") ||
        ld.publishedTime,
      excerpt: excerptCandidate([
        metaContent('meta[property="og:description"]', "content"),
        metaContent('meta[property="dc:description"]', "content"),
        metaContent('meta[name="dc.description"]', "content"),
        metaContent('meta[name="description"]', "content"),
        metaContent('meta[name="twitter:description"]', "content"),
        ld.excerpt,
      ]),
    };
  }

  /**
   * @param {Element} el 命中的元素
   * @param {{sourceUrl?:string, pageTitle?:string}} opts
   */
  // 记录原页面的字体与段落节奏：字体栈原样保留（含全部兜底项），这样同一台机器上
  // 浏览器命中的字体与网页当时一致；字号、行距倍数、段前段后（px）一并记下
  function computedFont(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE || !node.isConnected) return null;
    const cs = getComputedStyle(node);
    const stack = (cs && cs.fontFamily ? cs.fontFamily : "").trim();
    if (!stack) return null;
    const sizePx = parseFloat(cs.fontSize) || 0;
    const linePx = parseFloat(cs.lineHeight) || 0;
    const lineRatio = sizePx && linePx ? Math.round((linePx / sizePx) * 100) / 100 : 0;
    const paraBefore = Math.round(parseFloat(cs.marginTop) || 0);
    const paraAfter = Math.round(parseFloat(cs.marginBottom) || 0);
    // 标题居左/居中写在网页的 text-align 上，原版要让标题和它下面的译文都跟着走
    const rawAlign = String(cs.textAlign || "").trim().toLowerCase();
    const align = rawAlign && rawAlign !== "start" ? rawAlign : "";
    // 字重数值化成 100–900，供原版恢复标题/正文的粗细。
    // 关键字（bold/normal）在部分页面里会原样出现，parseFloat 会得到 NaN，
    // 直接回落 400 会把粗体标题记成常规
    const weight = weightValue(cs.fontWeight);
    return {
      stack,
      sizePx,
      sizePt: sizePx ? Math.round(sizePx * 0.75 * 10) / 10 : 0,
      lineRatio,
      paraBefore,
      paraAfter,
      align,
      weight,
      color: darkColorOf(cs.color),
    };
  }

  // computedStyle 的字重有时是 bold/normal 这类关键字，统一换算成 100–900
  function weightValue(raw) {
    const text = String(raw || "").trim().toLowerCase();
    if (text === "bold") return 700;
    if (text === "normal") return 400;
    const num = parseFloat(text);
    return Number.isFinite(num) ? Math.round(num) : 400;
  }

  // 网页文字色：只有够深的颜色才搬，浅色多半是深色主题下的白字，搬到白纸上会看不见
  function darkColorOf(raw) {
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i.exec(String(raw || ""));
    if (!m) return "";
    if (m[4] !== undefined && Number(m[4]) < 0.5) return "";
    const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
    // 感知亮度（sRGB 加权），0.62 以上视为浅色
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    if (luma > 0.62) return "";
    const hex = (n) => n.toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  }

  // 在原页面按标题文本回找标题节点（Readability 与手动选取都适用）
  // 优先真正的标题标签，其次才看 class 里带 title/heading 的容器：
  // 容器的字号往往比标题本身大得多（或干脆写在外层），取错会把标题字号放大
  function titleRank(node) {
    if (node.tagName === "H1") return 0;
    if (node.tagName === "H2") return 1;
    if (node.tagName === "H3") return 2;
    return 3;
  }

  function findTitleNode(title) {
    const wanted = normText(title);
    if (!wanted) return null;
    const list = Array.from(
      document.querySelectorAll(
        "h1, h2, h3, [class*=title], [class*=headline], [class*=hed], [class*=heading]"
      )
    );
    const exact = list.filter((node) => normText(node.textContent) === wanted);
    if (exact.length) {
      // 同档里取最内层（子孙元素最少的那个），避免把整个标题区当成标题
      exact.sort((a, b) => {
        const r = titleRank(a) - titleRank(b);
        if (r) return r;
        return a.querySelectorAll("*").length - b.querySelectorAll("*").length;
      });
      return exact[0];
    }
    // 标题带站点名后缀时只能靠包含匹配，同样先看标题标签，且不允许明显长于标题
    const loose = list.filter((node) => {
      const txt = normText(node.textContent);
      if (!txt) return false;
      if (txt.includes(wanted)) return titleRank(node) < 3 || txt.length <= wanted.length + 20;
      // 反过来也允许：网页 og:title 与页面大标题不是同一句时（NPR 这类），
      // 大标题只是 og:title 的一部分，取够长的标题标签节点
      return titleRank(node) < 3 && txt.length >= 10 && wanted.includes(txt);
    });
    if (loose.length) {
      loose.sort((a, b) => {
        const r = titleRank(a) - titleRank(b);
        if (r) return r;
        return normText(b.textContent).length - normText(a.textContent).length;
      });
      return loose[0];
    }
    // 文字完全对不上（编辑给的标题、og:title、页面大标题三套各说各话）时，
    // 退回文档里第一个 h1/h2：标题的字体样式几乎总是写在它身上
    return document.querySelector("h1") || document.querySelector("h2") || null;
  }

  // 题图兜底：Readability 只输出它选中的正文容器，标题上方的题图（常带图注）在容器之外，
  // 会整块丢掉。这里按标题节点向上找邻近的 figure/img，挑一张像题图的拼成 figure 片段，
  // 由调用方前置到正文开头；找不到就返回空串，不做任何改动。
  const LEAD_SKIP_RE =
    /(logo|avatar|icon|badge|sprite|share|social|button|advert|sponsor|banner|promo|thumb|related)/i;
  const LEAD_MIN_W = 320;
  const LEAD_SKIP_TAGS = /^(NAV|FOOTER|ASIDE|FORM|TABLE)$/;

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function imgSrc(img) {
    const direct = img.currentSrc || img.getAttribute("src") || "";
    if (direct && !/^data:/i.test(direct)) return direct;
    for (const attr of ["data-src", "data-original", "data-lazy-src", "data-url"]) {
      const v = img.getAttribute(attr);
      if (v) return v;
    }
    const srcset = img.getAttribute("srcset") || img.getAttribute("data-srcset") || "";
    if (srcset) return pickLargestFromSrcset(srcset);
    const noscript = img.parentElement && img.parentElement.querySelector("noscript");
    if (noscript) {
      const m = /src=["']([^"']+)["']/.exec(noscript.textContent || "");
      if (m) return m[1];
    }
    return direct;
  }

  // 尺寸尽量不读布局（getBoundingClientRect 会强制回流，整页图扫一遍会明显拖慢提取）：
  // 先用已加载的 naturalWidth/Height，再退到 width/height 属性，最后才量一次矩形
  function leadSize(img) {
    const nw = img.naturalWidth || 0;
    const nh = img.naturalHeight || 0;
    if (nw && nh) return { w: nw, h: nh };
    const aw = Number(img.getAttribute("width")) || 0;
    const ah = Number(img.getAttribute("height")) || 0;
    if (aw && ah) return { w: aw, h: ah };
    const rect = img.getBoundingClientRect();
    return { w: rect.width, h: rect.height };
  }

  function looksLikeLeadImage(img, box) {
    if (!img || !img.isConnected) return false;
    let walker = img.parentElement;
    for (let i = 0; walker && i < 3; i += 1) {
      if (LEAD_SKIP_TAGS.test(walker.tagName)) return false;
      walker = walker.parentElement;
    }
    const cls = [
      String(box && box.id),
      String(box && box.className),
      String(img.id),
      String(img.className),
    ]
      .join(" ")
      .trim();
    if (cls && LEAD_SKIP_RE.test(cls)) return false;
    if (img.getAttribute("role") === "presentation") return false;
    const { w, h } = leadSize(img);
    if (!w || w < LEAD_MIN_W) return false;
    if (h && (h / w > 3 || h / w < 0.35)) return false;
    return true;
  }

  function leadCaption(box, img) {
    if (box && box.querySelector) {
      const fc = box.querySelector("figcaption");
      const txt = fc ? normText(fc.textContent) : "";
      if (txt) return txt;
    }
    // 图下一两张说明块：只认带 caption/credit/photo 字样的，避免把导语当成图注
    let node = (box && box !== img ? box : img).nextElementSibling;
    for (let i = 0; node && i < 3; i += 1, node = node.nextElementSibling) {
      const cls = String(node.className || "");
      if (!/^(P|DIV|SPAN|SMALL|FIGCAPTION)$/.test(node.tagName)) continue;
      const txt = normText(node.textContent);
      if (!txt || txt.length > 400) continue;
      if (/(caption|credit|photo|source|fig)/i.test(cls)) return txt;
    }
    return "";
  }

  function leadImage(title) {
    const titleEl = findTitleNode(title);
    if (!titleEl) return "";
    const base = location.href;
    const ogRaw =
      metaContent('meta[property="og:image"]', "content") ||
      metaContent('meta[property="og:image:url"]', "content") ||
      metaContent('meta[name="twitter:image"]', "content");
    const og = ogRaw ? absUrl(ogRaw, base).replace(/[?#].*$/, "") : "";

    let picked = null;
    // 优先：src 与 og:image 同源的那张（只比对 URL，命中了才量尺寸）
    if (og) {
      const imgs = Array.from(document.querySelectorAll("img")).slice(0, 120);
      for (const img of imgs) {
        const src = absUrl(imgSrc(img), base).replace(/[?#].*$/, "");
        if (src !== og) continue;
        if (!looksLikeLeadImage(img, img.closest("figure"))) continue;
        picked = { img, box: img.closest("figure") || img };
        break;
      }
    }
    if (!picked) {
      // 其次：标题上方、由近及远（最多向上 4 层）的最后一张合格图片。
      // 先按文档顺序收候选（纯 DOM 读，不触发布局），再从末尾起验证，通常只量 1–2 张
      let scope = titleEl.parentElement;
      for (let depth = 0; scope && depth < 4; depth += 1, scope = scope.parentElement) {
        const raw = [];
        scope.querySelectorAll("figure, img").forEach((el) => {
          const img = el.tagName === "IMG" ? el : el.querySelector("img");
          if (!img || !imgSrc(img)) return;
          // 只取文档顺序在标题之前的图
          const rel = el.compareDocumentPosition(titleEl);
          if (!(rel & Node.DOCUMENT_POSITION_FOLLOWING)) return;
          raw.push({ el, img });
        });
        for (let i = raw.length - 1; i >= 0 && i >= raw.length - 6; i -= 1) {
          const item = raw[i];
          const box = item.el.tagName === "FIGURE" ? item.el : item.img.closest("figure");
          if (!looksLikeLeadImage(item.img, box)) continue;
          picked = { img: item.img, box: box || item.img };
          break;
        }
        if (picked) break;
      }
    }
    if (!picked) return "";
    const src = imgSrc(picked.img);
    if (!src) return "";
    const alt = normText(picked.img.getAttribute("alt") || "");
    const cap = leadCaption(picked.box, picked.img);
    return (
      '<figure class="ep-lead-figure">' +
      `<img src="${escHtml(absUrl(src, base))}" alt="${escHtml(alt)}">` +
      (cap ? `<figcaption>${escHtml(cap)}</figcaption>` : "") +
      "</figure>"
    );
  }

  // 段落候选里可能有导语、图片说明、推广语；按「字数最多的字号/行距组合」定正文样式
  const PAGE_SKIP_CLASS_RE =
    /(newsletter|subscribe|signup|caption|credit|byline|promo|advert|sponsor|related|comment|share|footer|breadcrumb|cookie|consent|toolbar|nav)/i;
  const PAGE_BODY_MIN_CHARS = 40;

  function looksLikeBodyParagraph(node) {
    if (!node || !node.isConnected) return false;
    if (normText(node.textContent).length < PAGE_BODY_MIN_CHARS) return false;
    let walker = node.parentElement;
    for (let i = 0; walker && i < 3; i += 1) {
      if (/^(FIGCAPTION|FOOTER|ASIDE|NAV)$/.test(walker.tagName)) return false;
      if (PAGE_SKIP_CLASS_RE.test(String(walker.className || ""))) return false;
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

  // 网页自托管的 webfont：预览页是另一个文档，只带字体名渲染不出来，
  // 所以把拉丁字体（woff2 优先）内嵌成 data: URL 一起带给预览页；中文大字体不内嵌
  const FONT_FACE_LIMIT = 30;
  const FONT_FILE_MAX = 400 * 1024;
  const FONT_TOTAL_MAX = 2 * 1024 * 1024;
  const GENERIC_FAMILIES = new Set([
    "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
    "ui-serif", "ui-sans-serif", "ui-monospace", "inherit", "initial", "unset",
  ]);

  function fontFamilies(stack) {
    return String(stack || "")
      .split(",")
      .map((name) => name.trim().replace(/^["']|["']$/g, ""))
      .filter((name) => name && !GENERIC_FAMILIES.has(name.toLowerCase()));
  }

  // unicode-range 覆盖不到大写 A 的，就是纯非拉丁子集，预览里给西文用不上
  function coversLatin(unicodeRange) {
    const text = String(unicodeRange || "").trim();
    if (!text) return true; // 没声明范围时交给体积上限兜底
    for (const part of text.split(",")) {
      const m = part.trim().match(/u\+([0-9a-f]{1,6})(?:-([0-9a-f]{1,6}))?/i);
      if (!m) continue;
      const lo = parseInt(m[1], 16);
      const hi = m[2] ? parseInt(m[2], 16) : lo;
      if (lo <= 0x41 && hi >= 0x41) return true;
    }
    return false;
  }

  function fontFaceSrc(rule) {
    const src = rule.style.getPropertyValue("src") || "";
    const list = [];
    const re = /url\(\s*(['"]?)([^'")]+)\1\s*\)(?:\s*format\(\s*["']?([^"')]+)["']?\s*\))?/gi;
    let m;
    while ((m = re.exec(src))) list.push({ url: m[2].trim(), format: (m[3] || "").toLowerCase() });
    const rank = (format) => (format.includes("woff2") ? 0 : format.includes("woff") ? 1 : 2);
    list.sort((a, b) => rank(a.format) - rank(b.format));
    return list[0] || null;
  }

  function bytesToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  // 跨域样式表（Google Fonts、Typekit 等）读不到 rules，但把 CSS 文本取回来可以自己解析
  function parseFontFaceRules(cssText) {
    // 构造样式表不接受 @import / @charset，而 Google Fonts、Typekit 的 CSS 常以它们开头
    const cleaned = String(cssText || "")
      .replace(/@charset\s+[^;]+;/gi, "")
      .replace(/@import\s+(?:url\([^)]*\)|"[^"]*"|'[^']*')[^;]*;/gi, "");
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(cleaned);
      return Array.from(sheet.cssRules || []).filter((rule) => rule.type === CSSRule.FONT_FACE_RULE);
    } catch (err) {
      return [];
    }
  }

  async function remoteFontFaceRules() {
    const links = Array.from(document.querySelectorAll('link[rel="stylesheet"][href]'));
    const out = [];
    let fetched = 0;
    for (const link of links) {
      if (fetched >= 8) break;
      const href = link.href;
      if (!href || href.startsWith("data:")) continue;
      try {
        if (new URL(href).origin === location.origin) continue; // 同源的上面已经读到了
      } catch (err) {
        continue;
      }
      try {
        const res = await fetch(href, { credentials: "omit", cache: "force-cache" });
        if (!res.ok) continue;
        const text = await res.text();
        fetched += 1;
        if (text.length > 2 * 1024 * 1024 || !/@font-face/i.test(text)) continue;
        out.push(...parseFontFaceRules(text));
      } catch (err) {
        /* 对方没开 CORS 就取不到，跳过 */
      }
    }
    return out;
  }

  async function collectWebFonts(stacks) {
    const wanted = new Set();
    stacks.forEach((stack) => fontFamilies(stack).forEach((name) => wanted.add(name.toLowerCase())));
    if (!wanted.size) return [];

    const rules = [];
    const visit = (list) => {
      for (const rule of Array.from(list || [])) {
        if (rule.type === CSSRule.FONT_FACE_RULE) rules.push(rule);
        else if (rule.cssRules) visit(rule.cssRules);
      }
    };
    for (const sheet of Array.from(document.styleSheets || [])) {
      // 跨域样式表读不到规则内容，稍后用 fetch 取 CSS 文本补上
      try {
        visit(sheet.cssRules);
      } catch (err) {
        /* 忽略：拿不到字体地址 */
      }
    }
    rules.push(...(await remoteFontFaceRules()));

    // 正文字体家族优先、正体优先、400 字重优先：内嵌名额有限时，
    // 先保证正文能拿到它真正的常规字重，而不是标题的粗体把名额占掉
    const famRank = new Map();
    stacks.forEach((stack, i) => {
      fontFamilies(stack).forEach((name) => {
        const key = name.toLowerCase();
        if (!famRank.has(key)) famRank.set(key, i);
      });
    });
    const weightRank = (w) => {
      const n = parseFloat(String(w).trim()) || 400;
      return Math.abs(n - 400);
    };
    const candidates = [];
    rules.forEach((rule) => {
      const family = (rule.style.getPropertyValue("font-family") || "")
        .trim()
        .replace(/^["']|["']$/g, "");
      if (!family || !wanted.has(family.toLowerCase())) return;
      if (!coversLatin(rule.style.getPropertyValue("unicode-range"))) return;
      candidates.push({
        rule,
        family,
        weight: rule.style.getPropertyValue("font-weight") || "400",
        style: rule.style.getPropertyValue("font-style") || "normal",
      });
    });
    candidates.sort((a, b) => {
      const fa = famRank.get(a.family.toLowerCase()) ?? 99;
      const fb = famRank.get(b.family.toLowerCase()) ?? 99;
      if (fa !== fb) return fa - fb;
      const sa = a.style === "normal" ? 0 : 1;
      const sb = b.style === "normal" ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return weightRank(a.weight) - weightRank(b.weight);
    });

    const faces = [];
    const seen = new Set();
    let total = 0;
    for (const candidate of candidates) {
      if (faces.length >= FONT_FACE_LIMIT) break;
      const { rule, family, weight, style } = candidate;
      const faceKey = `${family.toLowerCase()}|${weight}|${style}`;
      if (seen.has(faceKey)) continue;
      const pick = fontFaceSrc(rule);
      if (!pick) continue;
      // 站点常把字体直接 base64 内嵌在 CSS 里（data:font/woff2;base64,…），
      // 预览页没有那份 CSS，这种也得原样搬过去，否则家族缺失会回退到别家字体
      const inline = pick.url.startsWith("data:");
      const faceSrc = inline ? pick.url : null;
      const inlineBytes = inline ? Math.round((pick.url.length - pick.url.indexOf("base64,") - 7) * 0.75) : 0;
      if (inline && inlineBytes > FONT_FILE_MAX) continue;
      if (inline && total + inlineBytes > FONT_TOTAL_MAX) continue;
      try {
        if (inline) {
          total += inlineBytes;
          seen.add(faceKey);
          faces.push({
            family,
            weight,
            style,
            unicodeRange: rule.style.getPropertyValue("unicode-range") || "",
            src: faceSrc,
          });
          continue;
        }
        const url = new URL(pick.url, document.baseURI).href;
        const res = await fetch(url, { credentials: "omit", cache: "force-cache" });
        if (!res.ok) continue;
        const buf = await res.arrayBuffer();
        if (buf.byteLength > FONT_FILE_MAX) continue;
        if (total + buf.byteLength > FONT_TOTAL_MAX) continue;
        total += buf.byteLength;
        seen.add(faceKey);
        const mime = pick.format.includes("woff2")
          ? "font/woff2"
          : pick.format.includes("woff")
            ? "font/woff"
            : "application/octet-stream";
        faces.push({
          family,
          weight,
          style,
          unicodeRange: rule.style.getPropertyValue("unicode-range") || "",
          src: `data:${mime};base64,${bytesToBase64(buf)}`,
        });
      } catch (err) {
        /* 单个字体取不到不影响整体 */
      }
    }
    return faces;
  }

  function readPageFont(el, title) {
    const fallback = Array.from(el.querySelectorAll("p, li, dd, dt, blockquote")).find(
      (n) => n.isConnected && normText(n.textContent)
    );
    // 用户直接选中的就是一个段落时，以它本身为准
    const bodyNode = /^(P|LI|DD|DT|BLOCKQUOTE)$/.test(el.tagName)
      ? el
      : pickBodyParagraph(Array.from(el.querySelectorAll("p, li, dd, dt, blockquote")), fallback) || el;
    const body = computedFont(bodyNode);
    const titleFont = computedFont(findTitleNode(title));
    // 各级标题的字体也记下来，原版就能让 h1/h2 用回网页自己的字体。
    // 同一级可能有多个节点（导航、侧栏里的短标题样式不一样），取文字最多的那个当代表
    const heads = {};
    ["h1", "h2", "h3", "h4", "h5", "h6"].forEach((tag) => {
      const nodes = Array.from(el.querySelectorAll(tag)).filter(
        (n) => n.isConnected && normText(n.textContent)
      );
      if (!nodes.length) return;
      nodes.sort((a, b) => normText(b.textContent).length - normText(a.textContent).length);
      const font = computedFont(nodes[0]);
      if (font) heads[tag] = font;
    });
    if (!body && !titleFont) return null;
    // 引文块的字体往往写在里面的段落上，而不是 blockquote 本身：优先取块内第一段
    const quoteNodes = Array.from(el.querySelectorAll("blockquote")).filter(
      (n) => n.isConnected && normText(n.textContent)
    );
    quoteNodes.sort((a, b) => normText(b.textContent).length - normText(a.textContent).length);
    const quoteNode = quoteNodes.length
      ? Array.from(quoteNodes[0].querySelectorAll("p")).find((n) => normText(n.textContent)) ||
        quoteNodes[0]
      : null;
    const quote = quoteNode ? computedFont(quoteNode) : null;
    // 引文的框线、缩进、底色都写在 CSS 里，只记字体会丢格式，这里把结构样式一并复制
    let quoteStyle = null;
    if (quoteNodes.length) {
      const block = quoteNodes[0];
      const para = quoteNode && quoteNode !== block ? quoteNode : null;
      const bs = getComputedStyle(block);
      const ps = para ? getComputedStyle(para) : null;
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
    return { body, title: titleFont, heads, quote, quoteStyle };
  }

  async function extract(el, opts = {}) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) {
      throw new Error("没有拿到可提取的元素");
    }
    const base = opts.sourceUrl || location.href;
    const clone = el.cloneNode(true);
    markInlineDisplay(el, clone, opts.styleRoot || el);

    clone.querySelectorAll(DROP_SELECTOR).forEach((n) => n.remove());
    cleanUiChrome(clone);
    absolutize(clone, base);
    // 摘译文之前留一份未拆分的混排副本，供预览的「混排」视图还原原始内联中英交错
    const mixedClone = clone.cloneNode(true);
    // 混排标记要在洗属性前先收引用，洗属性后再按整句/短语补类名
    const mixedMarks = Array.from(mixedClone.querySelectorAll("*")).filter(isTransMarked);
    // 先摘译文再洗属性：标记属性正是判断依据，洗掉就认不出了
    let pageTranslations = splitTranslations(clone);
    // 洗属性会剥掉 class，摘要容器要在清洗前先定位好节点引用
    const abstractNode = findAbstractParagraph(clone);
    const mixedAbstractNode = findAbstractParagraph(mixedClone);
    const mixedAbstractTrans = mixedAbstractNode
      ? normText(
          Array.from(mixedAbstractNode.querySelectorAll("*"))
            .filter(isTransMarked)
            .map((m) => m.textContent)
            .join(" ")
        )
      : "";
    cleanAttributes(clone);
    cleanAttributes(mixedClone);
    markMixedTranslations(mixedClone, mixedMarks);

    const explicitTitle = normText(opts.title || "");
    // 整页提取时标题由 Readability 单独给出；这时不能把正文首段误拎成标题
    const title = explicitTitle || takeTitle(clone) || normText(opts.pageTitle || "") || "未命名内容";
    const matchedTitleTrans =
      (pageTranslations.find((pair) => pair.src === title) || {}).dst || "";
    const titleTrans = normText(opts.titleTrans || matchedTitleTrans);

    // 整页提取时正文容器是离屏副本，读不到页面样式，由 auto.js 事先算好传进来
    const pageFont = opts.pageFont || readPageFont(el, title);
    if (pageFont && !pageFont.faces) {
      pageFont.faces = await collectWebFonts([
        pageFont.body && pageFont.body.stack,
        pageFont.title && pageFont.title.stack,
        ...["h1", "h2", "h3", "h4", "h5", "h6"].map(
          (tag) => pageFont.heads && pageFont.heads[tag] && pageFont.heads[tag].stack
        ),
        pageFont.quote && pageFont.quote.stack,
      ]);
    }

    const imgStats = await inlineImages(clone);

    const pageMeta = readPageMeta();
    const visibleDate = extractDateText(opts.author) || readVisibleDate();
    const authorClean = cleanAuthor(opts.author) || cleanAuthor(pageMeta.author);
    const pubDate = visibleDate || opts.publishedTime || pageMeta.publishedTime;
    let excerptText = excerptCandidate([opts.excerpt, pageMeta.excerpt]);
    const abstractText = abstractNode ? normText(abstractNode.textContent) : "";
    if (abstractText) {
      excerptText = abstractText;
    } else if (EXCERPT_TRUNC_RE.test(excerptText)) {
      // meta / og:description 常被站点截断并带省略号；若正文首段就是同一段导语，用完整首段补全
      const excerptFirst = firstTextBlock(clone);
      const excerptFirstText = excerptFirst ? normText(excerptFirst.textContent) : "";
      // 首段明显比导语长很多时，说明拿到的其实是整篇容器，不能当日志补全
      if (
        excerptText.length >= 20 &&
        excerptFirstText.length > excerptText.length &&
        excerptFirstText.length <= Math.max(excerptText.length * 3, excerptText.length + 400)
      ) {
        let prefix = 0;
        const min = Math.min(excerptText.length, excerptFirstText.length);
        while (prefix < min && excerptText[prefix] === excerptFirstText[prefix]) prefix += 1;
        if (prefix >= Math.min(60, excerptText.length * 0.8)) {
          excerptText = excerptFirstText;
        }
      }
    }
    const excerptTruncated = EXCERPT_TRUNC_RE.test(excerptText);
    const matchedExcerptPair = findExcerptPair(excerptText, pageTranslations);
    const excerptTrans = normText(
      (matchedExcerptPair ? matchedExcerptPair.dst : "") || mixedAbstractTrans || opts.excerptTrans
    );

    // 作者、日期已放在标题区；正文里整块重复的作者行/日期行一并删掉
    const metaRemoved = new Set();
    const walkMeta = (node) => {
      Array.from(node.children).forEach((child) => {
        const text = normText(child.textContent);
        // 只把块级容器当成重复的作者/日期行删掉；段落内同名的内联链接、强调不能移除
        if (BLOCK_TAGS.has(child.tagName) && matchesMetaText(text, authorClean, pubDate)) {
          metaRemoved.add(text);
          child.remove();
          return;
        }
        walkMeta(child);
      });
    };
    walkMeta(clone);
    walkMeta(mixedClone);
    if (metaRemoved.size) {
      for (let i = pageTranslations.length - 1; i >= 0; i--) {
        if (metaRemoved.has(pageTranslations[i].src)) pageTranslations.splice(i, 1);
      }
    }

    // 导语已放在标题区；若正文摘要段与导语相同或导语是其截断前缀，从正文删掉，避免重复
    if (excerptText) {
      const excerptNode = abstractNode || firstTextBlock(clone);
      const excerptNodeText = excerptNode ? normText(excerptNode.textContent) : "";
      // 节点比导语长太多，说明是整篇容器，不是导语段，不能删
      const sizeOk =
        excerptNodeText.length <= Math.max(excerptText.length * 3, excerptText.length + 400);
      const sameAsExcerpt =
        sizeOk &&
        (excerptNodeText === excerptText ||
          (excerptTruncated && excerptNodeText.startsWith(excerptText)));
      if (excerptNode && sameAsExcerpt) {
        excerptNode.remove();
        const mixedNode = mixedAbstractNode || firstTextBlock(mixedClone);
        const mixedNodeText = mixedNode ? normText(mixedNode.textContent) : "";
        const mixedSame =
          mixedNodeText === excerptText ||
          (excerptTruncated && mixedNodeText.startsWith(excerptText));
        if (mixedNode && mixedSame) {
          mixedNode.remove();
        }
        const matched = findExcerptPair(excerptText, pageTranslations);
        const transIdx = matched ? pageTranslations.indexOf(matched) : -1;
        if (transIdx >= 0) pageTranslations.splice(transIdx, 1);
      }
    }

    const html = clone.outerHTML;
    const mixedHtml = pageTranslations.length ? mixedClone.outerHTML : "";
    return {
      title,
      titleTrans,
      html,
      mixedHtml,
      pageTranslations,
      textPreview: toPlainText(clone).slice(0, 400),
      sourceUrl: base,
      pageTitle: opts.pageTitle || document.title || "",
      author: authorClean,
      publishedTime: pubDate,
      excerpt: excerptText,
      excerptTrans,
      tag: el.tagName.toLowerCase(),
      createdAt: Date.now(),
      bytes: html.length,
      imagesExternal: imgStats ? imgStats.external : 0,
      pageFont: pageFont || null,
    };
  }

  // 历史索引：只存标题/网址/时间与载荷 id，正文仍在 ep:payload:<id> 里
  const HISTORY_KEY = "ep:history";
  const HISTORY_LIMIT = 1000;

  async function recordHistory(id, payload) {
    try {
      const got = await chrome.storage.local.get(HISTORY_KEY);
      const list = Array.isArray(got[HISTORY_KEY]) ? got[HISTORY_KEY] : [];
      const rest = list.filter((rec) => rec && rec.id !== id);
      rest.unshift({
        id,
        title: String(payload.title || payload.pageTitle || "").slice(0, 300),
        url: String(payload.sourceUrl || "").slice(0, 2000),
        at: Number(payload.createdAt) || Date.now(),
      });
      const kept = rest.slice(0, HISTORY_LIMIT);
      const dropped = rest.slice(HISTORY_LIMIT);
      await chrome.storage.local.set({ [HISTORY_KEY]: kept });
      // 超出上限的最旧记录，连它对应的载荷一起删，存储不会只增不减
      if (dropped.length) {
        await chrome.storage.local.remove(dropped.map((rec) => "ep:payload:" + rec.id));
      }
    } catch (err) {
      /* 历史写入失败不影响本次提取 */
    }
  }

  async function savePayload(payload) {
    const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await chrome.storage.local.set({ ["ep:payload:" + id]: payload });
    await recordHistory(id, payload);
    const res = await chrome.runtime.sendMessage({ type: "ep:openPreview", id });
    if (res && res.ok === false) throw new Error(res.error || "打开预览窗口失败");
    return id;
  }

  window.ElementPrintExtract = { extract, savePayload, leadImage, findTitleNode };
})();

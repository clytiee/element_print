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
  ]);

  const IMG_LIMIT = 24;
  const IMG_MAX_BYTES = 1.6 * 1024 * 1024;
  const IMG_TOTAL_CHARS = 9 * 1024 * 1024;

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
  const TRANS_ATTR_RE = /^(data[-_](deep)?translat|data[-_]trans$)/i;
  const TRANS_CLASS_RE = /(^|\s)(translated|translation|deep-trans|trans-text)\b/i;

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
        if (src && dst && src !== dst) pairs.push({ src, dst });
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

    return pairs.slice(0, 400);
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

  // 图片尽力转成 base64 内嵌；取不到就保留绝对 URL（预览时可能裂图，但不丢占位）
  async function inlineImages(root) {
    const imgs = Array.from(root.querySelectorAll("img")).slice(0, IMG_LIMIT);
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
  }

  function toPlainText(root) {
    return (root.textContent || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
  }

  function firstTextBlock(root) {
    const candidates = root.querySelectorAll(
      "p, div, li, dd, dt, blockquote, h1, h2, h3, h4, h5, h6"
    );
    for (const node of candidates) {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (text) return node;
    }
    return null;
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

  function extractDateText(text) {
    if (!text) return "";
    const s = String(text);
    const en = s.match(new RegExp("(?:" + DATE_MONTH + ")\\s+\\d{1,2},?\\s+\\d{4}", "i"));
    if (en) return en[0];
    const iso = s.match(/\b\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}[^\s]*)?\b/);
    return iso ? iso[0] : "";
  }

  function cleanAuthor(name) {
    if (!name) return "";
    let s = String(name).replace(/\s+/g, " ").trim();
    s = s.replace(/^\s*by\s+/i, "");
    s = s.replace(new RegExp("\\b(?:" + DATE_MONTH + ")\\s+\\d{1,2},?\\s+\\d{4}\\b", "gi"), "");
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
      if (visible && /[A-Za-z]/.test(visible)) return visible;
      isoFallback = isoFallback || visible;
      const attrDate = el.getAttribute ? extractDateText(el.getAttribute("datetime") || "") : "";
      if (attrDate && /[A-Za-z]/.test(attrDate)) return attrDate;
      isoFallback = isoFallback || attrDate;
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
  async function extract(el, opts = {}) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) {
      throw new Error("没有拿到可提取的元素");
    }
    const base = opts.sourceUrl || location.href;
    const clone = el.cloneNode(true);

    clone.querySelectorAll(DROP_SELECTOR).forEach((n) => n.remove());
    cleanUiChrome(clone);
    absolutize(clone, base);
    // 摘译文之前留一份未拆分的混排副本，供预览的「混排」视图还原原始内联中英交错
    const mixedClone = clone.cloneNode(true);
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

    const explicitTitle = normText(opts.title || "");
    // 整页提取时标题由 Readability 单独给出；这时不能把正文首段误拎成标题
    const title = explicitTitle || takeTitle(clone) || normText(opts.pageTitle || "") || "未命名内容";
    const matchedTitleTrans =
      (pageTranslations.find((pair) => pair.src === title) || {}).dst || "";
    const titleTrans = normText(opts.titleTrans || matchedTitleTrans);

    await inlineImages(clone);

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
      if (excerptText.length >= 20 && excerptFirstText.length > excerptText.length) {
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
        if (matchesMetaText(text, authorClean, pubDate)) {
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
      const sameAsExcerpt =
        excerptNodeText === excerptText ||
        (excerptTruncated && excerptNodeText.startsWith(excerptText));
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
    };
  }

  async function savePayload(payload) {
    const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    await chrome.storage.local.set({ ["ep:payload:" + id]: payload });
    const res = await chrome.runtime.sendMessage({ type: "ep:openPreview", id });
    if (res && res.ok === false) throw new Error(res.error || "打开预览窗口失败");
    return id;
  }

  window.ElementPrintExtract = { extract, savePayload };
})();

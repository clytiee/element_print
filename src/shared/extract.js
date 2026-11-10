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
    absolutize(clone, base);
    cleanAttributes(clone);

    const title = takeTitle(clone) || (opts.pageTitle || "").trim() || "未命名内容";

    await inlineImages(clone);

    const html = clone.outerHTML;
    return {
      title,
      html,
      textPreview: toPlainText(clone).slice(0, 400),
      sourceUrl: base,
      pageTitle: opts.pageTitle || document.title || "",
      tag: el.tagName.toLowerCase(),
      createdAt: Date.now(),
      bytes: html.length,
    };
  }

  window.ElementPrintExtract = { extract };
})();

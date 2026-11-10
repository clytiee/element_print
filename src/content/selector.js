// 选取模式：悬停描边 + 点击捕获 → 提取 → 打开预览窗口。

(() => {
  const FLAG = "__elementPrintPicker";

  // 再次点击工具栏图标 = 退出选取模式
  if (window[FLAG] && typeof window[FLAG].dispose === "function") {
    window[FLAG].dispose();
    return;
  }

  if (!window.ElementPrintExtract) {
    console.warn("[Element Print] 提取模块未注入，无法进入选取模式");
    return;
  }

  let hovered = null;
  let finished = false;

  const ui = {
    box: null,
    tag: null,
    bar: null,
    toast: null,
  };

  function el(className, tagName = "div") {
    const node = document.createElement(tagName);
    node.className = className;
    return node;
  }

  function describe(node) {
    const tag = node.tagName.toLowerCase();
    const cls =
      typeof node.className === "string" && node.className.trim()
        ? "." + node.className.trim().split(/\s+/).slice(0, 2).join(".")
        : "";
    return tag + cls;
  }

  function build() {
    ui.box = el("ep-pick-box ep-pick-ui");
    ui.tag = el("ep-pick-tag ep-pick-ui");
    ui.bar = el("ep-pick-bar ep-pick-ui");

    const hint = el("ep-pick-hint", "span");
    hint.textContent = "点击要打印的元素 · Esc 退出";
    const exit = el("ep-pick-exit", "button");
    exit.type = "button";
    exit.textContent = "退出";
    exit.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dispose();
    });

    ui.bar.appendChild(hint);
    ui.bar.appendChild(exit);

    const root = document.documentElement;
    root.appendChild(ui.box);
    root.appendChild(ui.tag);
    root.appendChild(ui.bar);
  }

  function paint() {
    if (!hovered) return;
    const rect = hovered.getBoundingClientRect();
    const style = {
      left: rect.left + "px",
      top: rect.top + "px",
      width: Math.max(rect.width, 1) + "px",
      height: Math.max(rect.height, 1) + "px",
    };
    for (const key of Object.keys(style)) ui.box.style[key] = style[key];

    const above = rect.top > 26;
    ui.tag.style.left = Math.max(4, Math.min(rect.left, window.innerWidth - 240)) + "px";
    ui.tag.style.top = (above ? rect.top - 24 : rect.bottom + 6) + "px";
    ui.tag.textContent = describe(hovered) + "  " + Math.round(rect.width) + "×" + Math.round(rect.height);
  }

  function hover(node) {
    if (!node || node === hovered) {
      paint();
      return;
    }
    hovered = node;
    paint();
  }

  function onMove(e) {
    if (finished) return;
    const node = document.elementFromPoint(e.clientX, e.clientY);
    if (!node || !node.tagName) return;
    if (node.closest && node.closest(".ep-pick-ui")) return;
    hover(node);
  }

  function swallow(e) {
    if (finished) return;
    const path = e.target;
    if (path && path.closest && path.closest(".ep-pick-ui")) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
  }

  function onClick(e) {
    if (finished) return;
    const target = e.target;
    if (target && target.closest && target.closest(".ep-pick-ui")) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    const node = document.elementFromPoint(e.clientX, e.clientY) || hovered;
    if (!node) return;
    capture(node);
  }

  function onKey(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      dispose();
    }
  }

  function showToast(text, sticky) {
    if (!ui.toast) {
      ui.toast = el("ep-pick-toast ep-pick-ui");
      document.documentElement.appendChild(ui.toast);
    }
    ui.toast.textContent = text;
    ui.toast.classList.add("is-on");
    if (!sticky) {
      clearTimeout(showToast._t);
      showToast._t = setTimeout(() => hideToast(), 2600);
    }
  }

  function hideToast() {
    if (ui.toast) ui.toast.classList.remove("is-on");
  }

  async function capture(node) {
    if (finished) return;
    finished = true;
    removePickUi();
    showToast("正在提取内容…", true);
    try {
      const payload = await window.ElementPrintExtract.extract(node, {
        sourceUrl: location.href,
        pageTitle: document.title,
      });
      const id = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      await chrome.storage.local.set({ ["ep:payload:" + id]: payload });
      const res = await chrome.runtime.sendMessage({ type: "ep:openPreview", id });
      if (res && res.ok === false) throw new Error(res.error || "打开预览窗口失败");
      hideToast();
      teardown();
    } catch (err) {
      const msg = (err && err.message) || String(err);
      showToast("提取失败：" + msg);
      finished = false;
      teardown();
    }
  }

  function removePickUi() {
    [ui.box, ui.tag, ui.bar].forEach((node) => node && node.remove());
    ui.box = ui.tag = ui.bar = null;
  }

  function teardown() {
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("pointerdown", swallow, true);
    window.removeEventListener("click", onClick, true);
    window.removeEventListener("mousedown", swallow, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("scroll", paint, true);
    window.removeEventListener("resize", paint, true);
    removePickUi();
    setTimeout(hideToast, 2600);
    delete window[FLAG];
  }

  function dispose() {
    finished = true;
    teardown();
  }

  build();
  window[FLAG] = { dispose };

  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("pointerdown", swallow, true);
  window.addEventListener("mousedown", swallow, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("scroll", paint, true);
  window.addEventListener("resize", paint, true);
})();

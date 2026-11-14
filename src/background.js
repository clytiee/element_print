// Service worker：工具栏按钮 / 右键菜单 → 注入选取器或自动提取；收到结果 → 打开预览窗口。

const PICKER_CSS = ["src/content/selector.css"];
const PICKER_JS = ["src/shared/extract.js", "src/content/selector.js"];
const AUTO_JS = [
  "src/shared/vendor/readability.js",
  "src/shared/extract.js",
  "src/content/auto.js",
];
const PREVIEW_URL = "src/preview/preview.html";
const MODE_KEY = "ep:extract-mode";
const AUTO_MENU_ID = "ep-auto";

async function getMode() {
  try {
    const got = await chrome.storage.local.get(MODE_KEY);
    return got[MODE_KEY] === "auto" ? "auto" : "manual";
  } catch {
    return "manual";
  }
}

async function setMode(mode) {
  await chrome.storage.local.set({ [MODE_KEY]: mode });
}

function modeTitle(mode) {
  return mode === "auto" ? "√ 整页提取" : "整页提取（点击打开）";
}

function isInternalUrl(url) {
  return /^(chrome|edge|about|devtools|chrome-extension|moz-extension):/i.test(url || "");
}

async function injectManual(tab) {
  if (!tab || !tab.id || isInternalUrl(tab.url)) return;
  try {
    await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: PICKER_CSS });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: PICKER_JS });
  } catch (err) {
    console.warn("[Element Print] 注入选取器失败：", err);
  }
}

async function injectAuto(tab) {
  if (!tab || !tab.id || isInternalUrl(tab.url)) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: AUTO_JS });
  } catch (err) {
    console.warn("[Element Print] 注入自动提取失败：", err);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  const mode = await getMode();
  if (mode === "auto") return injectAuto(tab);
  return injectManual(tab);
});

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.contextMenus.removeAll();
  const mode = await getMode();
  chrome.contextMenus.create({
    id: AUTO_MENU_ID,
    title: modeTitle(mode),
    contexts: ["action"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== AUTO_MENU_ID) return;
  const current = await getMode();
  const next = current === "auto" ? "manual" : "auto";
  await setMode(next);
  await chrome.contextMenus.update(AUTO_MENU_ID, { title: modeTitle(next) });
});

chrome.runtime.onStartup.addListener(async () => {
  const mode = await getMode();
  await chrome.contextMenus
    .update(AUTO_MENU_ID, { title: modeTitle(mode) })
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "ep:openPreview") {
    openPreview(msg.id)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
  // 翻译放在后台发：manifest 里有 host_permissions，可绕过页面的跨域限制
  if (msg && msg.type === "ep:translate") {
    translateTexts(msg)
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
    return true;
  }
  if (msg && msg.type === "ep:closePreview") {
    if (sender.tab && sender.tab.id) {
      chrome.tabs.remove(sender.tab.id).catch(() => {});
    } else if (sender.windowId) {
      chrome.windows.remove(sender.windowId).catch(() => {});
    }
    return true;
  }
  return false;
});

// DeepL 一次最多 50 段，按 40 段分批
const DEEPL_BATCH = 40;

// 百度通用翻译：单次请求把多段用 \n 拼起来，控制在 1200 字以内
const BAIDU_ENDPOINT = "https://fanyi-api.baidu.com/api/trans/vip/translate";
const BAIDU_BATCH_CHARS = 1200;
const BAIDU_QPS_GAP = 260; // 免费版 QPS≈1，请求之间留一点间隔

// 引擎分流：DeepL 用 Key，百度用 APP ID + 密钥
async function translateTexts(msg) {
  if (!Array.isArray(msg.texts) || !msg.texts.length) {
    return { ok: true, translations: [] };
  }
  if (msg.engine === "baidu") return translateBaidu(msg);
  return translateDeepL(msg);
}

async function translateDeepL({ texts, key, targetLang }) {
  const authKey = String(key || "").trim();
  if (!authKey) return { ok: false, error: "未填 DeepL Auth Key" };

  // Key 以 :fx 结尾的是免费版，只能走 api-free；其余走付费端点。
  // 选错端点 DeepL 会回 403，所以这里不信任界面上的开关，直接按 Key 判定。
  const endpoint = authKey.endsWith(":fx")
    ? "https://api-free.deepl.com/v2/translate"
    : "https://api.deepl.com/v2/translate";
  const lang = targetLang || "ZH";
  const translations = [];

  for (let i = 0; i < texts.length; i += DEEPL_BATCH) {
    const batch = texts.slice(i, i + DEEPL_BATCH).map((t) => String(t));
    let res;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "DeepL-Auth-Key " + authKey,
        },
        body: JSON.stringify({ text: batch, target_lang: lang }),
      });
    } catch (err) {
      return { ok: false, error: "网络请求失败：" + String((err && err.message) || err) };
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const hint =
        res.status === 403
          ? "（Key 无效，或端点与 Key 类型不符：免费版 Key 以 :fx 结尾）"
          : res.status === 456
            ? "（免费额度已用完）"
            : res.status === 429
              ? "（请求太频繁，稍后再试）"
              : "";
      return { ok: false, error: `DeepL ${res.status}${hint} ${detail.slice(0, 160)}`.trim() };
    }
    const data = await res.json().catch(() => null);
    const list = (data && data.translations) || [];
    list.forEach((item) => translations.push(String((item && item.text) || "")));
  }

  if (!translations.length) return { ok: false, error: "DeepL 没有返回译文" };
  return { ok: true, translations };
}

// 百度语言码是小写，且只有 zh / en 这类两位码
function baiduLang(targetLang) {
  const t = String(targetLang || "ZH").toUpperCase();
  if (t === "ZH" || t === "ZH-CN" || t === "ZH-HANS") return "zh";
  if (t === "EN" || t === "EN-US" || t === "EN-GB") return "en";
  return t.toLowerCase();
}

// 百度错误码：把冷冰冰的数字换成人能看懂的一句
const BAIDU_ERRORS = {
  52001: "请求超时，稍后再试",
  52002: "百度系统错误，稍后再试",
  52003: "未授权用户：核对 APP ID",
  54000: "必填参数为空",
  54001: "签名错误：核对密钥是否填错",
  54003: "访问频率受限：免费版 QPS 约 1，稍后再试",
  54004: "账户余额不足：本月免费字符已用完",
  54005: "长文本请求频繁，稍后再试",
  58000: "客户端 IP 非法：去开放平台配置 IP 白名单",
  58001: "译文语言方向不支持",
  58002: "服务当前已关闭",
  90107: "认证未通过或未生效",
};

async function baiduRequest(q, appid, secret, targetLang) {
  const salt = String(Date.now());
  const sign = md5(appid + q + salt + secret);
  const body = new URLSearchParams({
    q,
    from: "auto",
    to: baiduLang(targetLang),
    appid,
    salt,
    sign,
  });
  let res;
  try {
    res = await fetch(BAIDU_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    return { error: "网络请求失败：" + String((err && err.message) || err) };
  }
  const data = await res.json().catch(() => null);
  if (!data) return { error: `百度没有返回可解析的结果（HTTP ${res.status}）` };
  if (data.error_code) {
    const code = String(data.error_code);
    const hint = BAIDU_ERRORS[code] || data.error_msg || "未知错误";
    return { error: `百度 ${code}：${hint}`, code };
  }
  const list = data.trans_result || [];
  if (!list.length) return { error: "百度没有返回译文" };
  return { list };
}

async function translateBaidu({ texts, appid, baiduKey, targetLang }) {
  const id = String(appid || "").trim();
  const secret = String(baiduKey || "").trim();
  if (!id) return { ok: false, error: "未填百度 APP ID" };
  if (!secret) return { ok: false, error: "未填百度密钥" };

  const translations = [];
  let i = 0;
  while (i < texts.length) {
    // 拼批：整段整段地塞，超长就另起一批（不切断段落）
    const batch = [];
    let joined = "";
    while (i < texts.length) {
      const t = String(texts[i]);
      const next = joined ? joined + "\n" + t : t;
      if (joined && next.length > BAIDU_BATCH_CHARS) break;
      joined = next;
      batch.push(t);
      i++;
    }

    let result = await baiduRequest(joined, id, secret, targetLang);
    // 频率受限/长文本频繁：退避后重试一次
    if (result.error && (result.code === "54003" || result.code === "54005")) {
      await sleep(1600);
      result = await baiduRequest(joined, id, secret, targetLang);
    }
    if (result.error) return { ok: false, error: result.error };

    const list = result.list;
    // 正常情况返回条数与段落数一一对应；对不上说明段落里本身含换行，退回逐段翻
    if (batch.length === 1) {
      translations.push(list.map((x) => String(x.dst || "")).join("\n"));
    } else if (list.length === batch.length) {
      list.forEach((x) => translations.push(String(x.dst || "")));
    } else {
      for (const t of batch) {
        await sleep(BAIDU_QPS_GAP);
        const one = await baiduRequest(t, id, secret, targetLang);
        if (one.error) return { ok: false, error: one.error };
        translations.push(one.list.map((x) => String(x.dst || "")).join("\n"));
      }
    }
    await sleep(BAIDU_QPS_GAP);
  }

  if (!translations.length) return { ok: false, error: "百度没有返回译文" };
  return { ok: true, translations };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 百度的 sign = md5(appid + q + salt + key)。Service Worker 没有 crypto.subtle 的 MD5，
// 这里用一份纯 JS 实现（输入按 UTF-8 取字节，中文 query 才算得对）。
function md5(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const len = bytes.length;
  const blocks = Math.ceil((len + 9) / 64);
  const buf = new Uint8Array(blocks * 64);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bitLen = len * 8;
  dv.setUint32(blocks * 64 - 8, bitLen >>> 0, true);
  dv.setUint32(blocks * 64 - 4, Math.floor(bitLen / 4294967296), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const S = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
    21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const K = new Uint32Array(64);
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);

  const M = new Uint32Array(16);
  for (let off = 0; off < buf.length; off += 64) {
    for (let j = 0; j < 16; j++) M[j] = dv.getUint32(off + j * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F;
      let g;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      const tmp = D;
      D = C;
      C = B;
      const sum = (A + F + K[i] + M[g]) >>> 0;
      B = (B + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0;
      A = tmp;
    }
    a0 = (a0 + A) >>> 0;
    b0 = (b0 + B) >>> 0;
    c0 = (c0 + C) >>> 0;
    d0 = (d0 + D) >>> 0;
  }

  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setUint32(0, a0, true);
  odv.setUint32(4, b0, true);
  odv.setUint32(8, c0, true);
  odv.setUint32(12, d0, true);
  return Array.from(out, (b) => b.toString(16).padStart(2, "0")).join("");
}


async function openPreview(id) {
  if (!id) throw new Error("缺少 payload id");
  const url =
    chrome.runtime.getURL(PREVIEW_URL) + "?id=" + encodeURIComponent(id);
  // 桌面端用独立弹窗；手机浏览器（狐猴/Kiwi 等）没有多窗口 API，
  // windows.create 会抛错或返回 undefined，此时退回新标签页打开
  try {
    const win = await chrome.windows.create({
      url,
      type: "popup",
      width: 1040,
      height: 1000,
    });
    if (win) return win;
  } catch (e) {
    // 忽略，走下面的新标签页兜底
  }
  await chrome.tabs.create({ url, active: true });
  return null;
}

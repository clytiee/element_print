// 图标库：Lucide（https://lucide.dev，ISC 许可）。
// 只收录用到的图标，几何数据从 lucide-static 的 SVG 原样摘录，避免运行时联网或引入打包器。
// 用法：ElementPrintIcons.svg("globe", { size: 16, stroke: 2 }) → <svg> 元素。
(function () {
  const GEOMETRY = {
    globe: {
      c: [[12, 12, 10]],
      p: ["M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20", "M2 12h20"],
    },
    "trash-2": {
      p: [
        "M3 6h18",
        "M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6",
        "M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2",
      ],
      l: [
        [10, 11, 10, 17],
        [14, 11, 14, 17],
      ],
    },
    search: { c: [[11, 11, 8]], p: ["m21 21-4.3-4.3"] },
    filter: { p: ["M22 3H2l8 9.46V19l4 2v-8.54L22 3z"] },
    x: { p: ["M18 6 6 18", "m6 6 12 12"] },
    download: {
      p: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"],
      pl: ["7 10 12 15 17 10"],
      l: [[12, 15, 12, 3]],
    },
    "chevron-left": { p: ["m15 18-6-6 6-6"] },
    "chevron-right": { p: ["m9 18 6-6-6-6"] },
    "external-link": {
      p: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
    },
    clock: { c: [[12, 12, 10]], p: [], pl: ["12 6 12 12 16 14"] },
    check: { p: ["M20 6 9 17l-5-5"] },
  };

  const NS = "http://www.w3.org/2000/svg";
  const make = (tag, attrs) => {
    const el = document.createElementNS(NS, tag);
    Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
    return el;
  };

  window.ElementPrintIcons = {
    library: "Lucide",
    license: "ISC",
    has: (name) => Boolean(GEOMETRY[name]),
    svg(name, opts) {
      const o = opts || {};
      const geo = GEOMETRY[name];
      if (!geo) return null;
      const svg = make("svg", {
        viewBox: "0 0 24 24",
        width: o.size || 16,
        height: o.size || 16,
        fill: "none",
        stroke: "currentColor",
        "stroke-width": o.stroke || 2,
        "stroke-linecap": "round",
        "stroke-linejoin": "round",
        "aria-hidden": "true",
      });
      (geo.c || []).forEach(([cx, cy, r]) => svg.appendChild(make("circle", { cx, cy, r })));
      (geo.p || []).forEach((d) => svg.appendChild(make("path", { d })));
      (geo.l || []).forEach(([x1, y1, x2, y2]) =>
        svg.appendChild(make("line", { x1, y1, x2, y2 }))
      );
      (geo.pl || []).forEach((points) => svg.appendChild(make("polyline", { points })));
      return svg;
    },
  };
})();

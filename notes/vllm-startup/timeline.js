// Startup timeline for the second vLLM replica, in seconds after the HPA rescale at 14:13:51 UTC.
// Pull and start times: operator/events-final.json. Ready: operator/pod-ready-time.txt.
// Last request (approximate): the run README.
(function () {
  const SEGMENTS = [
    { cls: "pull", name: "Image pull", from: 1, to: 279, value: "4m 38s",
      detail: "14:13:52 to 14:18:30 UTC, kubelet reported 4m 38.3s" },
    { cls: "model", name: "Container start to Ready", short: "To Ready", from: 284, to: 460,
      value: "2m 56s", detail: "14:18:35 to 14:21:31 UTC, not split further" },
  ];
  const MARKERS = [
    { at: 0, label: "HPA asks for 2 replicas", narrow: "Scale-up", row: 1, anchor: "start" },
    { at: 460, label: "Ready, 7m 40s", narrow: "Ready 7:40", row: 1, anchor: "end" },
    { at: 498, label: "Last request finished, about 8m 18s", narrow: "Last request ~8:18", row: 0, anchor: "end" },
  ];
  const MAX = 540;
  const NS = "http://www.w3.org/2000/svg";
  const plot = document.getElementById("timeline");
  const tip = document.getElementById("timeline-tip");

  function add(parent, tag, attrs, text) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    if (text !== undefined) el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function showTip(seg, x, y) {
    tip.textContent = "";
    const value = document.createElement("strong");
    value.textContent = seg.value;
    const name = document.createElement("span");
    name.textContent = " " + seg.name;
    const when = document.createElement("div");
    when.className = "tip-sub";
    when.textContent = seg.detail;
    tip.append(value, name, when);
    tip.hidden = false;
    const box = plot.getBoundingClientRect();
    const left = Math.min(Math.max(x - box.left - tip.offsetWidth / 2, 0), box.width - tip.offsetWidth);
    tip.style.left = left + "px";
    tip.style.top = (y - box.top - tip.offsetHeight - 14) + "px";
  }

  function hideTip() { tip.hidden = true; }

  function render() {
    const w = plot.clientWidth;
    if (!w) return;
    const narrow = w < 520;
    const x = (s) => 1 + (w - 2) * s / MAX;
    const barY = 40, barH = 24, h = 118;
    plot.textContent = "";
    const svg = add(plot, "svg", {
      width: w, height: h, viewBox: `0 0 ${w} ${h}`, role: "img",
      "aria-label": "Timeline of the second replica: image pull from 0:01 to 4:39, container start " +
        "to Ready from 4:44 to 7:40, Ready at 7:40, last request finished at about 8:18.",
    });

    for (let m = 0; m <= 9; m++) {
      const gx = x(m * 60);
      add(svg, "line", { x1: gx, x2: gx, y1: barY - 4, y2: barY + barH + 4, class: "grid" });
      if (narrow && ((m % 2 === 1 && m !== 9) || m === 8)) continue;
      const anchor = m === 0 ? "start" : m === 9 ? "end" : "middle";
      add(svg, "text", { x: gx, y: h - 4, class: "tick", "text-anchor": anchor }, m === 9 ? "9 min" : String(m));
    }

    for (const seg of SEGMENTS) {
      const x0 = x(seg.from) + 1, x1 = x(seg.to) - 1;
      const g = add(svg, "g", { class: "seg " + seg.cls, tabindex: 0, role: "img",
        "aria-label": `${seg.name}, ${seg.value}, ${seg.detail}` });
      add(g, "rect", { x: x0, y: barY, width: x1 - x0, height: barH, rx: 3 });
      add(g, "rect", { x: x0, y: barY - 8, width: x1 - x0, height: barH + 16, class: "hit" });
      const label = add(svg, "text", { x: (x0 + x1) / 2, y: barY + barH + 20, class: "seg-label", "text-anchor": "middle" });
      add(label, "tspan", { class: "seg-value" }, seg.value);
      add(label, "tspan", {}, " " + (narrow && seg.short ? seg.short : seg.name));
      g.addEventListener("pointermove", (e) => showTip(seg, e.clientX, g.getBoundingClientRect().top));
      g.addEventListener("pointerleave", hideTip);
      g.addEventListener("focus", () => {
        const r = g.getBoundingClientRect();
        showTip(seg, r.left + r.width / 2, r.top);
      });
      g.addEventListener("blur", hideTip);
    }

    for (const mk of MARKERS) {
      const mx = x(mk.at);
      const ty = mk.row === 0 ? 11 : 28;
      add(svg, "line", { x1: mx, x2: mx, y1: ty - 9, y2: barY + barH + 4, class: "marker" });
      const tx = mk.anchor === "end" ? mx - 5 : mx + 5;
      add(svg, "text", { x: tx, y: ty, class: "marker-label", "text-anchor": mk.anchor },
        narrow && mk.narrow ? mk.narrow : mk.label);
    }
  }

  render();
  let raf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  });
})();

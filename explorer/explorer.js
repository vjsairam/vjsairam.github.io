"use strict";

(() => {
  const VOLUMES = [10000, 50000, 100000, 500000, 1000000];
  const SHORT_VOLUME = ["10k", "50k", "100k", "500k", "1M"];
  const Y_TICKS = [10, 30, 100, 300, 1000, 3000, 10000];
  const ALLOWED = {
    task: ["classification", "structured-extraction"],
    size: ["short", "medium"],
    util: ["low", "typical", "high"],
    costs: ["a", "low", "typical", "high"],
  };
  const form = document.getElementById("controls");
  let data;
  let chart;

  const fmtUsd = (v) => (v >= 100 ? "$" + Math.round(v).toLocaleString("en-US") : "$" + v.toFixed(2));
  const fmtPct = (q) => (q * 100).toFixed(1) + "%";
  const fmtVolume = (v) => v.toLocaleString("en-US");
  const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : ms + " ms");
  const perThousand = (monthly, volume, quality) => (monthly / (volume * quality)) * 1000;
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const gpus = (n) => (n === 1 ? "1 GPU" : n + " GPUs");

  function readState() {
    const f = new FormData(form);
    return {
      task: f.get("task"),
      volume: Number(form.elements.volume.value),
      size: f.get("size"),
      util: f.get("util"),
      costs: f.get("costs"),
      private: form.elements.private.checked,
    };
  }

  function applyParams() {
    const params = new URLSearchParams(location.search);
    for (const [key, allowed] of Object.entries(ALLOWED)) {
      const value = params.get(key);
      if (!allowed.includes(value)) continue;
      if (key === "task") form.querySelector(`input[name=task][value="${value}"]`).checked = true;
      else form.elements[key].value = value;
    }
    const index = VOLUMES.indexOf(Number(params.get("volume")));
    if (index >= 0) form.elements.volume.value = index;
    form.elements.private.checked = params.get("private") === "1";
  }

  function writeParams(s) {
    const params = new URLSearchParams({
      task: s.task, volume: VOLUMES[s.volume], size: s.size, util: s.util, costs: s.costs,
    });
    if (s.private) params.set("private", "1");
    history.replaceState(null, "", "?" + params.toString());
  }

  function gridRow(s, volume) {
    const view = s.costs === "a" ? "view_a" : "view_b";
    const ops = s.costs === "a" ? "not_applicable" : s.costs;
    return data.grid.find((r) => r.view === view && r.ops === ops && r.size === s.size
      && r.util === s.util && r.volume === volume);
  }

  function measured(task, treatment) {
    return data.runs.find((r) => r.workload === task && r.treatment === treatment);
  }

  function crossoverText(s) {
    const cheaper = VOLUMES.filter((v) => gridRow(s, v).private < gridRow(s, v).managed);
    if (cheaper.length === 0) {
      return "With these settings the hosted API stays cheaper per month all the way from 10,000 to 1,000,000 requests.";
    }
    if (cheaper.length === VOLUMES.length) {
      return "With these settings your own GPU is cheaper per month at every volume shown.";
    }
    const first = VOLUMES.indexOf(cheaper[0]);
    const contiguous = cheaper.every((v, i) => VOLUMES.indexOf(v) === first + i);
    if (contiguous && cheaper[cheaper.length - 1] === VOLUMES[VOLUMES.length - 1]) {
      return `With these settings your own GPU becomes cheaper per month somewhere between ${fmtVolume(VOLUMES[first - 1])} and ${fmtVolume(VOLUMES[first])} requests.`;
    }
    return "With these settings your own GPU is cheaper per month at "
      + cheaper.map(fmtVolume).join(", ") + " requests, and the hosted API at the other volumes shown.";
  }

  function verdict(s, row, hosted, own) {
    const volume = VOLUMES[s.volume];
    const qm = hosted.quality;
    const qp = own.quality;
    const m = fmtUsd(row.managed);
    const p = fmtUsd(row.private);
    const perM = fmtUsd(perThousand(row.managed, volume, qm));
    const perP = fmtUsd(perThousand(row.private, volume, qp));
    const onGpus = gpus(row.replicas);
    const idle = volume / (row.replicas * data.utilization[s.util]) < 0.5 ? ", which sits mostly idle at this volume" : "";
    const target = `Neither option met the benchmark's 95% accuracy target here (the best reached ${fmtPct(Math.max(qm, qp))}), so check the accuracy you actually need before choosing.`;
    if (s.private) {
      if (hosted.met_targets && !own.met_targets) {
        return `With data that can't leave your environment, an open model on your own GPU is the only option, and the 7B model I tested got just ${fmtPct(qp)} of these right. Measure another open model's accuracy and cost on your own documents before committing.`;
      }
      return `With data that can't leave your environment, run the model yourself: about ${p} a month on ${onGpus} at ${fmtVolume(volume)} requests. It got ${fmtPct(qp)} right against ${fmtPct(qm)} for the hosted model, just under the benchmark's 95% target.`;
    }
    if (hosted.met_targets && !own.met_targets) {
      return `Use the hosted API for this task. It was the only option that met its targets, with ${fmtPct(qm)} correct against ${fmtPct(qp)} for the open 7B model. At ${fmtVolume(volume)} requests that's about ${m} a month.`;
    }
    if (perThousand(row.private, volume, qp) < perThousand(row.managed, volume, qm)) {
      return `Your own GPU gives the cheaper correct answer: ${perP} per 1,000 against ${perM} for the hosted API at ${fmtVolume(volume)} requests a month (${p} against ${m} a month). ${target}`;
    }
    return `The hosted API gives the cheaper correct answer: ${perM} per 1,000 against ${perP} on your own GPU${idle} (${m} against ${p} a month at ${fmtVolume(volume)} requests). ${target}`;
  }

  function fillTile(id, monthly, quality, perK, note, out) {
    const tile = document.getElementById(id);
    tile.classList.toggle("out", out);
    tile.querySelector('[data-k="monthly"]').innerHTML = `${fmtUsd(monthly)}<small> a month${note}</small>`;
    const q = tile.querySelector('[data-k="quality"]');
    q.textContent = fmtPct(quality);
    q.classList.toggle("bad", quality < 0.5);
    tile.querySelector('[data-k="per"]').textContent = fmtUsd(perK);
  }

  // Line names drawn at the right end of each line, nudged apart when they would overlap.
  const directLabels = {
    id: "directLabels",
    afterDatasetsDraw(c) {
      const { ctx } = c;
      const placed = [];
      c.data.datasets.forEach((ds, i) => {
        const last = c.getDatasetMeta(i).data.at(-1);
        if (!last) return;
        let y = last.y;
        for (const other of placed) if (Math.abs(other - y) < 16) y = other + (y >= other ? 16 : -16);
        placed.push(y);
        ctx.save();
        ctx.fillStyle = ds.borderColor;
        ctx.font = "600 12.5px Plex, Arial, sans-serif";
        ctx.textBaseline = "middle";
        ctx.fillText(ds.label, last.x + 10, y);
        ctx.restore();
      });
    },
  };

  function drawChart(s) {
    const rows = VOLUMES.map((v) => gridRow(s, v));
    const radius = VOLUMES.map((_, i) => (i === s.volume ? 7 : 3));
    const datasets = [
      { label: "Hosted model API", color: css("--hosted"), values: rows.map((r) => r.managed), hidden: s.private },
      { label: "Your own GPU", color: css("--own"), values: rows.map((r) => r.private), hidden: false },
    ].map((d) => ({
      label: d.label,
      data: VOLUMES.map((v, i) => ({ x: v, y: d.values[i] })),
      borderColor: d.color,
      backgroundColor: d.color,
      pointRadius: radius,
      pointHoverRadius: 8,
      borderWidth: 2.5,
      borderDash: d.hidden ? [6, 6] : [],
      tension: 0,
    }));
    if (chart) {
      chart.data.datasets = datasets;
      chart.update();
      return;
    }
    const text = css("--muted");
    const grid = css("--grid");
    Chart.defaults.font.family = "Plex, Arial, sans-serif";
    Chart.defaults.font.size = 12;
    chart = new Chart(document.getElementById("cost-chart"), {
      type: "line",
      data: { datasets },
      plugins: [directLabels],
      options: {
        maintainAspectRatio: false,
        layout: { padding: { right: 118, top: 8 } },
        animation: { duration: 250 },
        interaction: { mode: "nearest", axis: "x", intersect: false },
        scales: {
          x: {
            type: "logarithmic",
            min: 8000,
            max: 1250000,
            title: { display: true, text: "Requests a month", color: text },
            ticks: { color: text, callback: (v) => (VOLUMES.includes(v) ? SHORT_VOLUME[VOLUMES.indexOf(v)] : "") },
            afterBuildTicks: (axis) => { axis.ticks = VOLUMES.map((v) => ({ value: v })); },
            grid: { drawOnChartArea: false, color: grid },
            border: { color: text },
          },
          y: {
            type: "logarithmic",
            title: { display: true, text: "Cost a month (USD, log scale)", color: text },
            ticks: { color: text, callback: (v) => (Y_TICKS.includes(v) ? fmtUsd(v) : "") },
            grid: { color: (c) => (Y_TICKS.includes(c.tick && c.tick.value) ? grid : "transparent") },
            border: { display: false, dash: [3, 4] },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: (items) => fmtVolume(items[0].parsed.x) + " requests a month",
              label: (item) => `${item.dataset.label}: ${fmtUsd(item.parsed.y)} a month`,
            },
          },
        },
      },
    });
  }

  function render() {
    const s = readState();
    const volume = VOLUMES[s.volume];
    document.getElementById("volume-out").textContent = fmtVolume(volume);
    const row = gridRow(s, volume);
    const hosted = measured(s.task, "t0");
    const own = measured(s.task, "t1");
    const qm = hosted.quality;
    const qp = own.quality;
    document.getElementById("verdict").textContent = verdict(s, row, hosted, own);
    fillTile("tile-managed", row.managed, qm, perThousand(row.managed, volume, qm),
      s.private ? ", not allowed for your data" : "", s.private);
    fillTile("tile-private", row.private, qp, perThousand(row.private, volume, qp), ` on ${gpus(row.replicas)}`, false);
    document.getElementById("crossover").textContent = crossoverText(s);
    drawChart(s);
    writeParams(s);
  }

  function fillMeasured() {
    const names = { t0: "Hosted model API", t1: "Open 7B model on your own GPU", t3: "Mix of both (policy routing)" };
    const colors = { t0: "--hosted", t1: "--own", t3: "--mix" };
    const tasks = { classification: "Sort into categories", "structured-extraction": "Pull fields from documents" };
    const body = document.querySelector("#measured tbody");
    const order = [["classification", "t0"], ["classification", "t1"], ["classification", "t3"],
      ["structured-extraction", "t0"], ["structured-extraction", "t1"]];
    for (const [task, treatment] of order) {
      const r = measured(task, treatment);
      const tr = document.createElement("tr");
      const cells = [tasks[task], null, null, fmtUsd(r.cost_per_correct * 1000),
        fmtMs(r.latency_p50_ms), fmtMs(r.latency_p95_ms)];
      cells.forEach((value, i) => {
        const td = document.createElement("td");
        if (i === 1) {
          const swatch = document.createElement("span");
          swatch.className = "swatch";
          swatch.style.background = `var(${colors[treatment]})`;
          const a = document.createElement("a");
          a.href = r.url;
          a.textContent = names[treatment];
          td.append(swatch, a);
        } else if (i === 2) {
          td.className = "barcell";
          const bar = document.createElement("div");
          bar.className = "bar";
          bar.style.width = (r.quality * 100).toFixed(1) + "%";
          const label = document.createElement("span");
          label.textContent = fmtPct(r.quality);
          td.append(bar, label);
        } else {
          td.textContent = value;
          if (i > 2) td.className = "num";
        }
        tr.append(td);
      });
      body.append(tr);
    }
    const mix = measured("classification", "t3").routing_mix;
    document.getElementById("hybrid-note").textContent = `The mix sent ${mix["private-vllm"]} of ${mix["private-vllm"] + mix["managed-premium"]} requests to the open model and ${mix["managed-premium"]} to the hosted one, using a routing policy that never lets restricted data leave the private path. It landed between the two on cost.`;
    document.getElementById("prices").textContent = `an NVIDIA L4 GPU (AWS g6.xlarge) at $${data.prices.gpu_hourly_usd} an hour on demand, and $${data.prices.managed_per_1m_tokens_usd} per million tokens for the hosted model, as of ${new Date(data.prices.effective_date + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })}`;
  }

  document.getElementById("share").addEventListener("click", async () => {
    const status = document.getElementById("share-status");
    try {
      await navigator.clipboard.writeText(location.href);
      status.textContent = "Link copied.";
    } catch {
      status.textContent = "Copy the address from your browser bar.";
    }
  });

  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (!data) return;
    if (chart) { chart.destroy(); chart = null; }
    render();
  });

  fetch("data.json")
    .then((response) => response.json())
    .then((json) => {
      data = json;
      applyParams();
      fillMeasured();
      render();
      form.addEventListener("input", render);
    });
})();

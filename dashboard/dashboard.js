"use strict";

(() => {
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmtPct = (q) => (q * 100).toFixed(1) + "%";
  const fmtUsd = (v) => "$" + v.toFixed(2);
  const fmtMs = (ms) => (ms >= 1000 ? (ms / 1000).toFixed(1) + " s" : ms + " ms");
  const fmtDuration = (s) => (s >= 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s} s`);
  const set = (id, text) => { document.getElementById(id).textContent = text; };
  const charts = [];

  function baseOptions() {
    const text = css("--muted");
    Chart.defaults.font.family = "Plex, Arial, sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = text;
    return { maintainAspectRatio: false, animation: { duration: 250 }, plugins: { legend: { display: false } } };
  }

  // Thin vertical markers with a short label, used on the scaling chart.
  const markers = {
    id: "markers",
    beforeDatasetsDraw(c, _args, opts) {
      const { ctx, chartArea, scales } = c;
      if (opts.band) {
        const x0 = scales.x.getPixelForValue(opts.band.from);
        const x1 = scales.x.getPixelForValue(opts.band.to);
        ctx.save();
        ctx.fillStyle = opts.bandColor;
        ctx.fillRect(x0, chartArea.top, x1 - x0, chartArea.bottom - chartArea.top);
        ctx.fillStyle = opts.textColor;
        ctx.font = "12px Plex, Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(chartArea.width < 520 ? opts.band.short : opts.band.label, (x0 + x1) / 2, chartArea.top + chartArea.height * 0.55);
        ctx.restore();
      }
    },
    afterDatasetsDraw(c, _args, opts) {
      const { ctx, chartArea, scales } = c;
      for (const m of opts.items || []) {
        const x = scales.x.getPixelForValue(m.at);
        ctx.save();
        ctx.strokeStyle = opts.color;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = opts.textColor;
        ctx.font = "600 12px Plex, Arial, sans-serif";
        ctx.textAlign = m.align || "left";
        ctx.fillText(chartArea.width < 520 ? m.short : m.label, x + (m.align === "right" ? -6 : 6), chartArea.top + 12);
        ctx.restore();
      }
    },
  };

  function render(d) {
    charts.splice(0).forEach((c) => c.destroy());
    const grid = css("--grid");
    const m = d.mix;

    set("k-cost", fmtUsd(m.cost_per_k));
    set("k-cost-sub", `Hosted only ${fmtUsd(m.hosted_only_per_k)}, own GPU only ${fmtUsd(m.own_only_per_k)}`);
    set("k-quality", fmtPct(m.quality));
    set("k-quality-sub", `${m.requests} requests, mixed service levels`);
    set("k-private", fmtPct(m.own_gpu / m.requests));
    set("k-private-sub", `Including all ${m.data_classes.restricted} restricted requests`);
    set("k-latency", fmtMs(m.latency_p50_ms));
    set("k-latency-sub", `Slowest 5%: ${fmtMs(m.latency_p95_ms)}`);

    set("routing-title", `${m.own_gpu} on your own GPU, ${m.hosted} on the hosted API`);
    set("routing-note", `The routing policy decides per request from the data class and service level. Restricted data never left the private path. ${m.fallbacks} requests switched to the backup route during the run.`);
    charts.push(new Chart(document.getElementById("routing-chart"), {
      type: "bar",
      data: {
        labels: ["Requests"],
        datasets: [
          { label: "Your own GPU", data: [m.own_gpu], backgroundColor: css("--own") },
          { label: "Hosted API", data: [m.hosted], backgroundColor: css("--hosted") },
        ],
      },
      options: {
        ...baseOptions(),
        indexAxis: "y",
        plugins: { legend: { display: true, position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } } },
        scales: {
          x: { stacked: true, max: m.requests, grid: { color: grid }, border: { display: false } },
          y: { stacked: true, display: false },
        },
      },
    }));

    charts.push(new Chart(document.getElementById("cost-chart"), {
      type: "bar",
      data: {
        labels: ["Hosted only", "The mix", "Own GPU only"],
        datasets: [{
          data: [m.hosted_only_per_k, m.cost_per_k, m.own_only_per_k],
          backgroundColor: [css("--hosted"), css("--mix"), css("--own")],
          barThickness: 22,
        }],
      },
      options: {
        ...baseOptions(),
        indexAxis: "y",
        layout: { padding: { right: 56 } },
        scales: {
          x: { grid: { color: grid }, border: { display: false }, ticks: { callback: (v) => "$" + v } },
          y: { grid: { display: false } },
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (i) => fmtUsd(i.parsed.x) + " per 1,000 correct answers" } },
        },
      },
      plugins: [{
        id: "values",
        afterDatasetsDraw(c) {
          const { ctx } = c;
          c.getDatasetMeta(0).data.forEach((bar, i) => {
            ctx.save();
            ctx.fillStyle = css("--head");
            ctx.font = "600 12px Plex, Arial, sans-serif";
            ctx.textBaseline = "middle";
            ctx.fillText(fmtUsd(c.data.datasets[0].data[i]), bar.x + 6, bar.y);
            ctx.restore();
          });
        },
      }],
    }));

    const body = document.querySelector("#slo tbody");
    body.replaceChildren();
    for (const cell of m.cells) {
      const tr = document.createElement("tr");
      const status = cell.eligible ? ["ok", "Met"] : ["miss", "Missed"];
      const values = [
        cell.name[0].toUpperCase() + cell.name.slice(1),
        fmtPct(cell.quality[0]), fmtPct(Number(cell.quality[1])),
        fmtMs(cell.first_token_p95_ms[0]), fmtMs(cell.first_token_p95_ms[1]),
        fmtPct(cell.error_rate[0]),
      ];
      values.forEach((v, i) => {
        const td = document.createElement("td");
        td.textContent = v;
        if (i > 0) td.className = "num";
        if ((i === 1 && !cell.quality[2]) || (i === 3 && !cell.first_token_p95_ms[2])) td.classList.add("bad");
        tr.append(td);
      });
      const td = document.createElement("td");
      td.innerHTML = `<span class="flag ${status[0]}">${status[1]}</span>`;
      tr.append(td);
      body.append(tr);
    }
    const missed = m.cells.filter((c) => !c.eligible).map((c) => c.name);
    set("slo-note", missed.length
      ? `${missed.map((n) => n[0].toUpperCase() + n.slice(1)).join(", ")} traffic went to the hosted model, which padded its answers and ran past its token budget, so it missed both its accuracy and first-response targets. The finding to act on: tighten the prompt or route that service level differently.`
      : "Every service level met its targets.");

    const a = d.autoscale;
    set("scale-title", `A second GPU was requested about ${a.trigger_after_first_request_s} s after the load began and reported Ready ${fmtDuration(a.cold_start_s)} later`);
    set("scale-note", `${a.requests.toLocaleString("en-US")} requests at about ${a.requests_per_second} a second on one GPU, with KEDA watching the model server's queue. The replica line shows when the second copy was started; it only began serving at the second marker. The second GPU machine was already running, so the wait is pulling the image and loading the model, not starting a machine.`);
    const minutes = (s) => s / 60;
    charts.push(new Chart(document.getElementById("scale-chart"), {
      type: "line",
      data: {
        datasets: [
          {
            label: "Requests waiting",
            data: a.queue.map(([t, v]) => ({ x: minutes(t), y: v })),
            borderColor: css("--hosted"),
            backgroundColor: css("--hosted"),
            borderWidth: 2,
            pointRadius: 0,
            yAxisID: "y",
          },
          {
            label: "GPU replicas started",
            data: a.replicas.map(([t, v]) => ({ x: minutes(t), y: v })),
            borderColor: css("--own"),
            backgroundColor: css("--own"),
            borderWidth: 2.5,
            pointRadius: 0,
            stepped: true,
            yAxisID: "y2",
          },
        ],
      },
      plugins: [markers],
      options: {
        ...baseOptions(),
        interaction: { mode: "index", intersect: false },
        scales: {
          x: {
            type: "linear",
            min: 0,
            max: minutes(a.queue.at(-1)[0]),
            title: { display: true, text: "Minutes since monitoring started" },
            grid: { display: false },
          },
          y: { title: { display: true, text: "Requests waiting" }, beginAtZero: true, grid: { color: grid }, border: { display: false, dash: [3, 4] } },
          y2: { position: "right", min: 0, max: 2.5, title: { display: true, text: "GPU replicas" }, ticks: { stepSize: 1, callback: (v) => (Number.isInteger(v) ? v : "") }, grid: { display: false } },
        },
        plugins: {
          legend: { display: true, position: "bottom", labels: { boxWidth: 10, boxHeight: 10 } },
          tooltip: { callbacks: { title: (items) => items[0].parsed.x.toFixed(1) + " min" } },
          markers: {
            color: css("--muted"),
            textColor: css("--head"),
            bandColor: css("--select"),
            band: { from: minutes(a.trigger_s), to: minutes(a.ready_s), label: "Second GPU loading the model", short: "Loading model" },
            items: [
              { at: minutes(a.trigger_s), label: "Second GPU requested", short: "Requested" },
              { at: minutes(a.ready_s), label: "Second GPU ready", short: "Ready", align: "right" },
            ],
          },
        },
      },
    }));

    set("drill-pod", `Back in ${fmtDuration(d.drills.pod_delete.outage_s)}`);
    document.getElementById("drill-pod-link").href = d.drills.pod_delete.url;
    set("drill-fault", `${d.drills.provider_fault.failed_over} failed calls rerouted, ${d.drills.provider_fault.client_errors} errors seen by users`);
    document.getElementById("drill-fault-link").href = d.drills.provider_fault.url;
  }

  fetch("data.json")
    .then((response) => response.json())
    .then((d) => {
      render(d);
      matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => render(d));
    });
})();

#!/usr/bin/env python3
"""Build dashboard/data.json for the sample results dashboard.

Uses only published, reviewed runs from github.com/vjsairam/ai-inference-cost-optimization.
Time series keep values and timestamps only; series labels (pod names, addresses) are dropped.

Usage: build_dashboard_data.py [path to the benchmark checkout]
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_URL = "https://github.com/vjsairam/ai-inference-cost-optimization"
SITE = Path(__file__).resolve().parent.parent


def epoch(stamp: str) -> int:
    return int(datetime.strptime(stamp.strip(), "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


def series(path: Path) -> list[list[float]]:
    result = json.loads(path.read_text())["data"]["result"]
    if len(result) != 1:
        raise SystemExit(f"{path.name}: expected one series, found {len(result)}")
    return [[int(t), float(v)] for t, v in result[0]["values"]]


def main() -> int:
    bench = Path(sys.argv[1] if len(sys.argv) > 1 else SITE.parent / "ai-inference-cost-optimization")
    published = bench / "results" / "published"
    by_treatment: dict[str, list[Path]] = {}
    for run_dir in sorted(p for p in published.iterdir() if p.is_dir()):
        treatment = json.loads((run_dir / "summary.json").read_text())["treatment"].split("-")[0]
        by_treatment.setdefault(treatment, []).append(run_dir)
    url = lambda d: f"{REPO_URL}/tree/main/results/published/{d.name}"
    load = lambda d: json.loads((d / "summary.json").read_text())

    # Mixed traffic (hybrid) run
    hybrid_dir = by_treatment["t3"][0]
    hybrid = load(hybrid_dir)
    classification = {}
    for treatment, pick in (("t0", "managed"), ("t1", "private")):
        for d in by_treatment[treatment]:
            s = load(d)
            if s["workload"] == "classification":
                classification[pick] = float(s["cost"]["views"]["view_a"][pick]["cost_per_correct_task_usd"])
    cells = []
    for cell in hybrid["slo"]["per_cell"]:
        checks = cell["checks"]
        cells.append({
            "name": cell["cell"].split("/")[1],
            "eligible": cell["slo_eligible"],
            "quality": [checks["quality_rate"]["actual"], checks["quality_rate"]["target"], checks["quality_rate"]["pass"]],
            "first_token_p95_ms": [round(checks["p95_ttft_ms"]["actual"]), checks["p95_ttft_ms"]["target"], checks["p95_ttft_ms"]["pass"]],
            "error_rate": [checks["error_rate"]["actual"], checks["error_rate"]["target"], checks["error_rate"]["pass"]],
        })
    routing = hybrid["routing_mix"]

    # Failure drills
    drills = {}
    for d in by_treatment["t4"]:
        s, readme = load(d), (d / "README.md").read_text()
        if "Pod-delete" in readme or "Pod was deleted" in readme:
            down, up = re.search(r"deleted at (\d\d:\d\d:\d\d)Z.*?available again at (\d\d:\d\d:\d\d)Z", readme, re.S).groups()
            day = d.name[:4] + "-" + d.name[4:6] + "-" + d.name[6:8]
            drills["pod_delete"] = {"outage_s": epoch(f"{day}T{up}Z") - epoch(f"{day}T{down}Z"),
                                    "requests": int(s["sample_size"]), "url": url(d)}
        else:
            drills["provider_fault"] = {"failed_over": s["fallback_count"], "client_errors": s["errors"]["total"],
                                        "requests": int(s["sample_size"]), "url": url(d)}

    # Autoscaling run
    t5_dir = by_treatment["t5"][0]
    op = t5_dir / "operator"
    wall = (op / "wall-time.txt").read_text()
    start = int(re.search(r"start=(\d+)", wall).group(1))
    trigger = epoch((op / "scaledobject-trigger-time.txt").read_text())
    ready = epoch((op / "pod-ready-time.txt").read_text())
    t5 = load(t5_dir)
    lead = re.search(r"about (\d+) seconds\s+after the first measured request", (t5_dir / "README.md").read_text())
    if not lead:
        raise SystemExit("t5 README no longer states the delay after the first measured request")

    data = {
        "source": REPO_URL,
        "mix": {
            "requests": int(hybrid["sample_size"]),
            "quality": hybrid["quality"]["quality_rate"],
            "cost_per_k": float(hybrid["cost"]["hybrid_combined_view_a"]["cost_per_correct_task_usd"]) * 1000,
            "hosted_only_per_k": classification["managed"] * 1000,
            "own_only_per_k": classification["private"] * 1000,
            "own_gpu": routing["private-vllm"],
            "hosted": routing["managed-premium"],
            "data_classes": hybrid["policy_input_mix"]["data_class"],
            "fallbacks": hybrid["fallback_count"],
            "latency_p50_ms": round(hybrid["latency_ms"]["p50"]),
            "latency_p95_ms": round(hybrid["latency_ms"]["p95"]),
            "cells": cells,
            "url": url(hybrid_dir),
        },
        "drills": drills,
        "autoscale": {
            "start": start,
            "trigger_s": trigger - start,
            "trigger_after_first_request_s": int(lead.group(1)),
            "ready_s": ready - start,
            "cold_start_s": ready - trigger,
            "requests": int(t5["sample_size"]),
            "requests_per_second": round(t5["throughput"]["requests_per_second"], 1),
            "queue": [[t - start, v] for t, v in series(op / "queue-range-extended.json")],
            "replicas": [[t - start, v] for t, v in series(op / "replicas-range-extended.json")],
            "url": url(t5_dir),
        },
    }
    out = SITE / "dashboard" / "data.json"
    out.write_text(json.dumps(data, indent=1) + "\n")
    print(f"wrote {out.relative_to(SITE)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

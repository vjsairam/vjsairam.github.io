#!/usr/bin/env python3
"""Build explorer/data.json from the published runs of the inference cost benchmark.

Every number on the explorer page comes from results/published/ in
github.com/vjsairam/ai-inference-cost-optimization. Nothing here is estimated.

Usage: build_explorer_data.py [path to the benchmark checkout]
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

REPO_URL = "https://github.com/vjsairam/ai-inference-cost-optimization"
SITE = Path(__file__).resolve().parent.parent


def run_cost(summary: dict) -> float:
    """The View A cost per correct task each run's README reports."""
    views = summary["cost"]["views"]["view_a"]
    treatment = summary["treatment"]
    if treatment.startswith("t0-"):
        return float(views["managed"]["cost_per_correct_task_usd"])
    if treatment.startswith("t1-"):
        return float(views["private"]["cost_per_correct_task_usd"])
    return float(summary["cost"]["hybrid_combined_view_a"]["cost_per_correct_task_usd"])


def main() -> int:
    bench = Path(sys.argv[1] if len(sys.argv) > 1 else SITE.parent / "ai-inference-cost-optimization")
    published = bench / "results" / "published"
    runs, grids = [], {}
    for run_dir in sorted(p for p in published.iterdir() if p.is_dir()):
        summary = json.loads((run_dir / "summary.json").read_text())
        treatment = summary["treatment"]
        if treatment.split("-")[0] not in ("t0", "t1", "t3"):
            continue  # failure drills and autoscaling are not cost comparisons
        runs.append({
            "id": run_dir.name,
            "treatment": treatment.split("-")[0],
            "workload": summary["workload"],
            "requests": int(summary["sample_size"]),
            "quality": summary["quality"]["quality_rate"],
            "met_targets": summary["slo"]["slo_eligible"],
            "cost_per_correct": run_cost(summary),
            "latency_p50_ms": round(summary["latency_ms"]["p50"]),
            "latency_p95_ms": round(summary["latency_ms"]["p95"]),
            "routing_mix": summary.get("routing_mix") if treatment.startswith("t3-") else None,
            "url": f"{REPO_URL}/tree/main/results/published/{run_dir.name}",
        })
        if treatment.startswith("t1-"):
            cost = json.loads((run_dir / "cost.json").read_text())
            rows = [r for r in cost["scenario_grid"]["rows"] if r["quality_delta_points"] == 0]
            grids[summary["workload"]] = sorted(
                [{
                    "view": r["view"],
                    "ops": r["operations_sensitivity"],
                    "size": r["token_profile"],
                    "util": r["utilization_tier"],
                    "volume": r["monthly_requests"],
                    "managed": round(float(r["managed_total_usd"]), 2),
                    "private": round(float(r["private_total_usd"]), 2),
                    "replicas": r["replicas"],
                } for r in rows],
                key=lambda r: (r["view"], r["ops"], r["size"], r["util"], r["volume"]))
    # The cost grid does not depend on the workload; refuse to publish if the two ever disagree.
    grid_values = list(grids.values())
    if len(grid_values) != 2 or grid_values[0] != grid_values[1]:
        raise SystemExit("classification and extraction cost grids differ or are missing")
    config = yaml.safe_load((bench / "config" / "cost.example.yaml").read_text())
    grid_config = config["scenario_grid"]
    data = {
        "source": REPO_URL,
        "measured": "2026-08-17",
        "prices": {
            "effective_date": config["effective_date"],
            "gpu": "NVIDIA L4 (AWS g6.xlarge, on demand, us-east-1)",
            "gpu_hourly_usd": float(config["private"]["gpu_node_hourly_usd"]),
            "managed_per_1m_tokens_usd": sorted({float(r["managed_cost_per_1m_provider_billed_tokens_usd"])
                                                 for r in cost["scenario_grid"]["rows"]
                                                 if r["quality_delta_points"] == 0})[0],
        },
        "sizes": grid_config["token_profiles"],
        "utilization": {k: v["requests_per_replica_month"] for k, v in grid_config["utilization_tiers"].items()},
        "operations": {k: {"hours": float(v["hours_per_month"]), "rate": float(v["hourly_rate_usd"]),
                           "share": float(v["allocation_fraction"]), "basis": v["basis"]}
                       for k, v in config["operations"].items()},
        "runs": runs,
        "grid": grid_values[0],
    }
    out = SITE / "explorer" / "data.json"
    out.write_text(json.dumps(data, indent=1) + "\n")
    print(f"wrote {out.relative_to(SITE)}: {len(runs)} runs, {len(data['grid'])} grid rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""Load every page in Chromium and run all explorer scenarios; fail on any script error.

Usage: browser_check.py BASE_URL   (the site served locally, e.g. http://127.0.0.1:8765)
"""
from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

SWEEP = """() => {
  const f = document.getElementById('controls');
  const out = [];
  for (const task of ['classification', 'structured-extraction'])
  for (const vol of [0, 1, 2, 3, 4]) for (const size of ['short', 'medium'])
  for (const util of ['low', 'typical', 'high']) for (const costs of ['a', 'low', 'typical', 'high'])
  for (const priv of [false, true]) {
    f.querySelector(`input[name=task][value="${task}"]`).checked = true;
    f.elements.volume.value = vol; f.elements.size.value = size; f.elements.util.value = util;
    f.elements.costs.value = costs; f.elements.private.checked = priv;
    f.dispatchEvent(new Event('input'));
    const text = document.getElementById('verdict').textContent + ' ' + document.querySelector('.versus').textContent;
    out.push([task, vol, size, util, costs, priv, text]);
  }
  return out;
}"""


def main() -> int:
    base = sys.argv[1].rstrip("/")
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for path in ("/", "/explorer/", "/dashboard/"):
            page = browser.new_page(viewport={"width": 1280, "height": 900})
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(base + path, wait_until="networkidle")
            if path == "/explorer/":
                results = page.evaluate(SWEEP)
                bad = [r for r in results if not r[6].strip() or "undefined" in r[6] or "NaN" in r[6]]
                failures += [f"explorer scenario {r[:6]} rendered: {r[6][:80]!r}" for r in bad]
                print(f"explorer: {len(results)} scenarios, {len(bad)} bad")
            if path == "/dashboard/":
                drawn = page.evaluate("() => [...document.querySelectorAll('canvas')].filter(c => c.width > 0).length")
                if drawn != 3:
                    failures.append(f"dashboard drew {drawn} of 3 charts")
                print(f"dashboard: {drawn} charts drawn")
            failures += [f"{path}: {e}" for e in errors]
            page.close()
        browser.close()
    for failure in failures:
        print(failure)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())

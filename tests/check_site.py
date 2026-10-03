#!/usr/bin/env python3
"""Static checks for the site: data files parse, local links resolve, no em dashes in copy."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

SITE = Path(__file__).resolve().parent.parent
EM_DASH = chr(0x2014)
TEXT = [p for p in SITE.rglob("*") if p.suffix in {".html", ".js", ".css", ".py", ".json"}
        and ".git" not in p.parts and "fonts" not in p.parts]


def main() -> int:
    problems = []
    for path in SITE.glob("*/data.json"):
        try:
            json.loads(path.read_text())
        except ValueError as exc:
            problems.append(f"{path.relative_to(SITE)}: invalid JSON ({exc})")
    for path in TEXT:
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if EM_DASH in line:
                problems.append(f"{path.relative_to(SITE)}:{number}: em dash")
    for page in SITE.rglob("*.html"):
        for ref in re.findall(r'(?:href|src)="([^"#?]+)', page.read_text()):
            if re.match(r"^(https?:|mailto:)", ref):
                continue
            target = (page.parent / ref).resolve()
            if target.is_dir():
                target = target / "index.html"
            if not target.exists():
                problems.append(f"{page.relative_to(SITE)}: broken link {ref}")
    for problem in problems:
        print(problem)
    print(f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

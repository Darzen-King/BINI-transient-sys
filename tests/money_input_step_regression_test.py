"""Regression: every NT$ amount field must accept any whole amount.

A browser rejects a number input value that is not min + k * step. With step="100" a 350 deposit
was refused, and min="1" step="100" refused even 500 (only 1, 101, ... 501 were accepted).
Run from the repository root:
    python tests/money_input_step_regression_test.py
"""
from pathlib import Path
import re
import sys

TEMPLATES = Path(__file__).resolve().parents[1] / "app" / "templates"
MONEY = re.compile(r"amount|deposit|discount|rent|fee|refund|price", re.I)


def main() -> None:
    problems = []
    checked = 0
    for template in sorted(TEMPLATES.glob("*.html")):
        text = template.read_text(encoding="utf-8")
        for tag in re.findall(r"<input\b[^>]*>", text, flags=re.S):
            if 'type="number"' not in tag:
                continue
            name = re.search(r'\b(?:name|id)="([^"]+)"', tag)
            if not name or not MONEY.search(name.group(1)):
                continue
            checked += 1
            step = re.search(r'\bstep="([^"]+)"', tag)
            minimum = re.search(r'\bmin="([^"]+)"', tag)
            step_ok = step is None or step.group(1) in ("1", "any")
            min_ok = minimum is None or re.fullmatch(r"-?\d+", minimum.group(1)) is not None
            if not (step_ok and min_ok):
                problems.append(f"{template.name}: {name.group(1)} step={step.group(1) if step else None} min={minimum.group(1) if minimum else None}")
    assert checked >= 15, f"expected to check the money fields, found {checked}"
    assert not problems, "money inputs that reject whole amounts:\n" + "\n".join(problems)
    print(f"money_input_step_regression_test: OK ({checked} fields)")


if __name__ == "__main__":
    sys.exit(main())

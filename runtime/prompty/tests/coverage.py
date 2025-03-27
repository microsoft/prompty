import json
import sys
from pathlib import Path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Invalid coverage file")
        exit(-1)

    c = Path(sys.argv[1])
    # c = Path("coverage.json")
    if not c.exists():
        print("Invalid coverage file")
        exit(-1)

    # read the coverage file
    with open(c, encoding="utf-8") as f:
        cov = json.load(f)

    print("# Coverage report")
    print("pytest-cov coverage report")
    print("")
    print("## Totals")
    # print the coverage totals
    if "totals" in cov:
        print("Item | Value")
        print("----|------")
        for k, v in cov["totals"].items():
            print(f"{k} | {v}")

    # print the coverage file
    print("\n## Files")
    if "files" in cov:
        print("| file | covered_lines | num_statements | percent_covered | missing_lines | excluded_lines |")
        print("| ---- | ------------: | -------------: | ---------------:| ------------: | ---------------: |")
        for k, v in cov["files"].items():
            pct = int(v["summary"]["percent_covered_display"])
            pct_text = str(pct) + "%"
            if pct < 96:
                pct_text = f"**{pct_text}**"

            print(f"| `{k}` |", end="")
            print(f" {v['summary']['covered_lines']} |", end="")
            print(f" {v['summary']['num_statements']} |", end="")
            print(f" {pct_text} |", end="")
            print(f" {v['summary']['missing_lines']} |", end="")
            print(f" {v['summary']['excluded_lines']} |")

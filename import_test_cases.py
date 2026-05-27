#!/usr/bin/env python3
"""
Import test cases from an Excel file into the LLM Playground Backtesting section.

Usage:
    python import_test_cases.py <excel_file> [--project <project_id_or_name>]

Expected Excel columns:
    - Case name   → test case name
    - PII data    → input_text
    - Asserts     → one or more assertions, separated by " ; "
                    each assertion format:
                    <name> = "<value>" | json_path_exact @<jsonpath> | expected=<value>

If --project is omitted the script lists available projects and asks you to pick one.
"""

import sys
import json
import argparse
import urllib.request
import urllib.error

BASE_URL = "http://localhost:8000/api/v1"


def api_get(path):
    req = urllib.request.Request(f"{BASE_URL}{path}")
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"HTTP {e.code} on GET {path}: {e.read().decode()}")
        sys.exit(1)


def api_post(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{BASE_URL}{path}",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"HTTP {e.code}: {e.read().decode()}")


def build_expected_json(assertions):
    """Build a nested JSON object from assertion paths + expected values.

    This is set as expected_output so the backtest engine knows the model
    output is JSON and strips prose/reasoning before running assertions.
    """
    result = {}
    for a in assertions:
        path = (a.get("path") or "").lstrip("$").lstrip(".")
        expected = a.get("expected")
        if not path or expected is None:
            continue
        keys = path.split(".")
        d = result
        for key in keys[:-1]:
            d = d.setdefault(key, {})
        d[keys[-1]] = expected
    return json.dumps(result) if result else ""


def parse_assertions(asserts_str):
    """Parse the Asserts column into a list of AssertionSpec dicts.

    Format per assertion:
        name = "value" | json_path_exact @$.some.path | expected=value

    Multiple assertions separated by ' ; '
    """
    specs = []
    for chunk in asserts_str.split(" ; "):
        chunk = chunk.strip()
        if not chunk:
            continue
        parts = [p.strip() for p in chunk.split(" | ")]
        if len(parts) < 3:
            print(f"  Warning: skipping malformed assertion: {chunk!r}")
            continue

        name = parts[0]                                   # e.g. document_classification = "Grievance"
        type_part = parts[1]                              # e.g. json_path_exact @$.extracted_data.document_classification
        expected_part = parts[2]                          # e.g. expected=Grievance

        assertion_type = type_part.split(" ")[0].strip()  # json_path_exact
        path = type_part.split("@", 1)[1].strip() if "@" in type_part else None
        expected = expected_part.split("=", 1)[1].strip() if "=" in expected_part else None

        specs.append({
            "name": name,
            "type": assertion_type,
            "path": path,
            "expected": expected,
            "weight": 1.0,
            "options": {"case_insensitive": True},
        })
    return specs


def load_excel(path):
    try:
        import openpyxl
    except ImportError:
        print("openpyxl not found. Run: pip install openpyxl")
        sys.exit(1)

    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        print("Excel file is empty.")
        sys.exit(1)

    headers = [str(h).strip().lower() if h is not None else "" for h in rows[0]]
    print(f"Detected headers: {[str(h).strip() for h in rows[0]]}\n")

    def col(candidates):
        for c in candidates:
            if c.lower() in headers:
                return headers.index(c.lower())
        return None

    name_idx = col(["case name", "name", "title"])
    input_idx = col(["pii data", "input", "input text", "prompt"])
    asserts_idx = col(["asserts", "assertions", "assert"])

    missing = []
    if name_idx is None:
        missing.append("Case name")
    if input_idx is None:
        missing.append("PII data / Input")
    if asserts_idx is None:
        missing.append("Asserts")

    if missing:
        print(f"Could not find columns for: {', '.join(missing)}")
        sys.exit(1)

    cases = []
    for i, row in enumerate(rows[1:], start=2):
        name = str(row[name_idx]).strip() if row[name_idx] is not None else ""
        inp = str(row[input_idx]).strip() if row[input_idx] is not None else ""
        asserts_raw = str(row[asserts_idx]).strip() if row[asserts_idx] is not None else ""

        if not name and not inp and not asserts_raw:
            continue  # blank row

        if not name or not inp or not asserts_raw:
            print(f"  Row {i}: skipping — missing name={bool(name)}, input={bool(inp)}, asserts={bool(asserts_raw)}")
            continue

        assertions = parse_assertions(asserts_raw)
        if not assertions:
            print(f"  Row {i}: skipping — no valid assertions parsed for {name!r}")
            continue

        cases.append({"name": name, "input_text": inp, "assertions": assertions})

    return cases


def select_project(arg):
    projects = api_get("/projects")
    if not projects:
        print("No projects found. Create a project first.")
        sys.exit(1)

    if arg:
        for p in projects:
            if p["id"] == arg or p.get("name", "").lower() == arg.lower():
                return p["id"], p.get("name", p["id"])
        print(f"Project '{arg}' not found. Available:")
        for p in projects:
            print(f"  {p['id']}  {p.get('name', '')}")
        sys.exit(1)

    if len(projects) == 1:
        p = projects[0]
        print(f"Using the only project: {p.get('name', p['id'])}")
        return p["id"], p.get("name", p["id"])

    print("Available projects:")
    for i, p in enumerate(projects):
        print(f"  [{i}] {p.get('name', '(unnamed)')}  ({p['id']})")
    while True:
        choice = input("\nEnter number to select project: ").strip()
        if choice.isdigit() and 0 <= int(choice) < len(projects):
            p = projects[int(choice)]
            return p["id"], p.get("name", p["id"])
        print("Invalid choice.")


def main():
    parser = argparse.ArgumentParser(description="Bulk-import test cases from Excel.")
    parser.add_argument("excel_file", help="Path to the .xlsx file")
    parser.add_argument("--project", "-p", help="Project ID or name (optional)")
    args = parser.parse_args()

    print(f"Reading {args.excel_file} ...")
    cases = load_excel(args.excel_file)
    print(f"Found {len(cases)} test case(s) to import.\n")

    project_id, project_name = select_project(args.project)
    print(f"Target project: {project_name} ({project_id})\n")

    ok = 0
    fail = 0
    for i, case in enumerate(cases, start=1):
        payload = {
            "name": case["name"],
            "input_text": case["input_text"],
            "expected_output": build_expected_json(case["assertions"]),
            "expected_type": "classification",
            "assertions": case["assertions"],
        }
        try:
            api_post(f"/projects/{project_id}/post-training/test-cases", payload)
            print(f"  [{i}/{len(cases)}] OK   {case['name']}  ({len(case['assertions'])} assertion(s))")
            ok += 1
        except RuntimeError as e:
            print(f"  [{i}/{len(cases)}] FAIL {case['name']}: {e}")
            fail += 1

    print(f"\nDone. {ok} imported, {fail} failed.")


if __name__ == "__main__":
    main()

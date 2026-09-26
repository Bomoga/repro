#!/usr/bin/env python3
"""Build-time only: turn rule packs into what the adapters and reproduction step expect.

For each pack, writes
  /opt/repro/rules/<pack>/<pack>.yml         every rule in the pack, deduplicated by id
  /opt/repro/rules/by-id/<pack>/<rule-id>.yml  one file per rule, for single-rule re-runs

Usage: prepare-rules.py <out-root> <pack-name> <rule-file>...
"""
import json
import os
import re
import sys

from ruamel.yaml import YAML  # ships with semgrep

SAFE_ID = re.compile(r"^[A-Za-z0-9._-]+$")


def main() -> None:
    out_root, pack, *files = sys.argv[1:]
    yaml = YAML(typ="safe")
    rules: dict[str, dict] = {}
    for path in files:
        with open(path) as fh:
            doc = yaml.load(fh) or {}
        for rule in doc.get("rules", []):
            rule_id = rule["id"]
            if not SAFE_ID.match(rule_id):
                sys.exit(f"unsafe rule id {rule_id!r} in {path}")
            # Registry packs overlap (p/javascript and p/typescript are the same rules today).
            # Keep the first copy; a differing duplicate would be a real conflict, so fail loudly.
            if rule_id in rules and rules[rule_id] != rule:
                sys.exit(f"conflicting definitions for rule {rule_id!r}")
            rules.setdefault(rule_id, rule)
    if not rules:
        sys.exit(f"no rules found for pack {pack!r}")

    pack_dir = os.path.join(out_root, pack)
    by_id_dir = os.path.join(out_root, "by-id", pack)
    os.makedirs(pack_dir, exist_ok=True)
    os.makedirs(by_id_dir, exist_ok=True)
    # JSON is valid YAML, and avoids re-serialization quirks.
    with open(os.path.join(pack_dir, f"{pack}.yml"), "w") as fh:
        json.dump({"rules": list(rules.values())}, fh)
    for rule_id, rule in rules.items():
        with open(os.path.join(by_id_dir, f"{rule_id}.yml"), "w") as fh:
            json.dump({"rules": [rule]}, fh)
    print(f"{pack}: {len(rules)} rules")


if __name__ == "__main__":
    main()

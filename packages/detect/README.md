# @repro/detect

Lane 2's Deterministic Detection Engine: wrapped scanners as `DetectorAdapter`s, and the
reproduction step, the only code that sets `Finding.reproducible` or writes
`Finding.reproductionOutput`. No model calls anywhere in this package.

```ts
const { findings, failures } = await detect(workspace, executor); // every default adapter
const { findings: confirmed, attempts } = await reproduce(findings, workspace, executor);
```

## Detectors

| `detectorId` | Wraps | Finds | `reproductionCommand` |
|---|---|---|---|
| `semgrep` | Semgrep registry packs (JS/TS, Python) | code vulnerabilities, correctness | `repro-semgrep-rule registry <rule> <file>` |
| `gitleaks` | gitleaks, always `--redact` | hardcoded secrets | `repro-gitleaks-rule <rule> <file>` |
| `privacy-patterns` | Semgrep, Repro's own pack (`sandbox/rules/privacy-patterns`) | the Assurant privacy checks | `repro-semgrep-rule privacy-patterns <rule> <file>` |
| `osv-scanner` | osv-scanner, offline, against the image's OSV snapshot | known-vulnerable dependency versions in npm/PyPI lockfiles | `repro-osv check <lockfile> <package> <advisory>` |

All scanners and rule packs are baked into the sandbox image (`npm run sandbox:build`); containers
run with no network, so a rebuild is what refreshes the Semgrep registry rules and the OSV database.

## Reproduction protocol

Every `reproductionCommand` runs through the Executor and prints `REPRODUCED <tool> <rule> at
<file>:<start>-<end>: ...` with exit 1, `NOT REPRODUCED ...` with exit 0, or exits 2 when it can't
decide. Commands check the whole file, not one line, so Repair and the Challenger can re-run them
after a patch moves lines; at detect time the reproduction step also requires the exact line.

## Candidates considered and skipped

- **`npm audit` / `pip-audit`:** both query live registries, and the sandbox has no network.
  osv-scanner's offline mode covers the same ground deterministically.
- **Dead code and unused dependencies (depcheck, ts-prune, vulture):** high false-positive rates on
  dynamic imports and framework entry points, and "unused function" isn't a finding worth a repair.
- **Outdated dependencies:** needs the live registry, and "outdated" isn't a defect; a version that
  is actually vulnerable is already an `osv-scanner` Finding.

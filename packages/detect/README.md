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
| `privacy-patterns` | Semgrep, Repro's own pack (`sandbox/rules/privacy-patterns`) | the Assurant privacy checks | `repro-canary <check> <file> <function> <line> privacy-patterns <rule>` where the flagged function can be called (Python/JS), else `repro-semgrep-rule privacy-patterns <rule> <file>` |
| `osv-scanner` | osv-scanner, offline, against the image's OSV snapshot | known-vulnerable dependency versions in npm/PyPI lockfiles | `repro-osv check <lockfile> <package> <advisory>` |
| `ruff` | Ruff's Bandit (S, minus S101) and bugbear (B) rules | Python security issues and likely bugs | `repro-ruff-rule <code> <file>` |
| `tests` | the project's own test command (`node --test`, unittest, pytest per test; anything else as a whole) | failing tests | `repro-test check <kind> <file> <line> <test>` |

All scanners and rule packs are baked into the sandbox image (`npm run sandbox:build`); containers
run with no network, so a rebuild is what refreshes the Semgrep registry rules and the OSV database.

`detect()` installs the target's dependencies (`@repro/executor`'s `installDependencies`) after the
static scanners and before `tests`, the only detector that runs the target's code. The Python venv
it builds under `.repro/` is never on PATH; the target's Python runs through `repro-python`, which
uses the venv only once the install step has marked it as built and nothing under `.repro/` is part
of the target's own commit.

`repro-canary` calls the flagged function with a unique canary and checks the rule's sink (logs,
plaintext storage, outbound requests, captured above TLS for the common HTTP clients). A call it
can't observe, or a request whose payload it can't see, is "can't decide", never "fixed": it falls
back to the Semgrep rule, and a function that still reaches the network in a way the canary can't
see into doesn't count as fixed even when the rule stops matching.

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

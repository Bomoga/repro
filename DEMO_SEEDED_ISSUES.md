# Seeded issues in Bomoga/repro-demo

The answer key for [Bomoga/repro-demo](https://github.com/Bomoga/repro-demo), written by Brandon (lane 2). It lives
here, not in that repo, because Repro's agents read every file in the target: with the key in
the repo, Repair and the Challenger would be handed each bug's fix instead of working it out
from the code.

Every issue in repro-demo is planted on purpose for the Repro demo. Every secret is fake: random
values generated for that repo, never valid anywhere. Every third-party host is a reserved
`.example` or `.test` domain.

Notewise is a notes app with an AI assistant: a Python notes API (`api/`, Lambda-style handlers
over SQLite) and a Node assistant service (`src/`, Express). See repro-demo's README.md to run it.

## What Repro finds: 18 findings, all reproduced

Checked with Repro's own lane 2 pipeline (`npm run scan:lane2 -- <a clone of repro-demo>` in this repo)
at commit 1cc38fb: 18 detected, 18 reproduced in the sandbox.

| # | Where | Issue | Detector and rule | Fix |
|---|---|---|---|---|
| 1 | `api/notes.py:16` | SQL injection through `?sort=`, concatenated into `ORDER BY` | semgrep `tainted-sql-string` | **The "obvious fix is wrong" bug, see below** |
| 2 | `api/notes.py:28` | SQL injection through `?q=` and the user id, f-string into `LIKE` | semgrep `tainted-sql-string` | Bind both as parameters |
| 3 | `api/notes.py:39` | SQL injection through the note id path parameter | semgrep `tainted-sql-string` | Bind as a parameter |
| 4 | `api/backup.py:18` | `pickle.loads` on an uploaded backup: remote code execution | semgrep `tainted-pickle-deserialization` | Unpickler whose `find_class` refuses every global (1.x backups are plain dicts and strings), or JSON |
| 5 | `api/export.py:29,31` | Shell command built from `?format=`; the `FORMATS` allowlist exists but is never checked | semgrep `dangerous-subprocess-use`, `subprocess-shell-true` | Check `FORMATS`, pass an argument list without `shell=True` |
| 6 | `api/share.py:17` | Share-link passwords hashed with unsalted MD5 | semgrep `insecure-hash-algorithm-md5`, `md5-used-as-password` | `hashlib.scrypt` or `pbkdf2_hmac` with a salt |
| 7 | `api/share.py:9` | Hardcoded share-link signing secret (fake) | gitleaks `generic-api-key` | Read it from the environment |
| 8 | `src/config.js:6` | Hardcoded model-provider API key (fake) | gitleaks `generic-api-key` | Read it from the environment |
| 9 | `src/server.js:26` | Formula preview `eval`s the query string and writes it into HTML | semgrep `code-string-concat`, `raw-html-format`, `direct-response-write` | Parse arithmetic without `eval`; escape the output |
| 10 | `src/server.js:37` | Post-sign-in redirect to an unchecked `?next=` | semgrep `express-open-redirect` | Only allow same-site relative paths |
| 11 | `src/assistant.js:7` | Every prompt logged to the console unredacted | privacy-patterns `prompt-logging` | Drop it, or log metadata only |
| 12 | `src/telemetry.js:6` | Users' questions sent to an analytics vendor the app never discloses | privacy-patterns `third-party-forwarding` | Send the event name only |
| 13 | `src/history.js:25` | Conversation history written to disk in plain text | privacy-patterns `unencrypted-conversation-storage` | Encrypt at rest, or don't persist |
| 14 | `src/integrations/drive.js:7` | Full `auth/drive` scope, when exporting a note only needs `drive.file` | privacy-patterns `oauth-broad-scope.google` | Request `drive.file` |

Rows 5, 6 and 9 trip more than one rule, which is why 14 issues come out as 18 findings. Rows 1 to
3 share one root cause (SQL built from strings), which is what Diagnose should group. Rows 11 to
14 are the Assurant trust story: what an AI tool does with your conversations.

## The bug whose obvious fix is wrong: `?sort=` in `api/notes.py`

`list_notes` concatenates the `sort` query parameter into `ORDER BY`. It's exploitable: ordering
by a `CASE WHEN (SELECT ... FROM notes WHERE owner_id='u-bob') ...` expression lets one user read
another user's private notes one character at a time, from the order the results come back in.

The first-instinct fix is to parameterize it like every other value: `ORDER BY ?`. SQL can't bind
identifiers, so SQLite binds the string `'title'` as a constant and sorting silently stops
working. Everything that checks the fix says it worked:

- the existing tests pass (they check which notes come back, never their order),
- Semgrep stops flagging the line, so the reproduction re-run says NOT REPRODUCED.

Only a test of the behavior catches it: create notes out of order, ask for `?sort=title`, expect
alphabetical. That passes on the original code and fails on the naive fix, which is exactly the
Challenger's "passes before, fails after" dispute. The correct fix is an allowlist of sortable
columns mapped to fixed SQL. All three behaviors were checked by hand before seeding.

Note for the Repro team (not changed from here): Semgrep's taint tracking also flags some *correct*
allowlist fixes. `"... ORDER BY " + ORDERINGS[sort]`, `ORDERINGS.get(sort)`, and an `in` check
followed by using `sort` all stay flagged, because taint flows through the index. It accepts an
`if`/`elif` or `match` chain that assigns string literals, or `order_by = ORDERINGS[sort]` on its
own line used in an f-string. A correct Repair can still read as "still reproduces" if it picks
one of the flagged shapes.

## The opening "wall"

```
semgrep scan --config p/default --config p/secrets --config p/javascript --config p/python .
gitleaks dir . -v
```

That's 21 Semgrep results plus 2 gitleaks leaks at commit 1cc38fb, with the same lines flagged by
overlapping rules. Repro's pipeline reports 18 (its rule packs, deduplicated, each one reproduced).

## Deliberately not seeded

- **Dependency advisories.** The lockfile is clean (Express 5). Repro's Repair runs without
  network access, so it can't regenerate an npm lockfile, and a seeded npm advisory would be an
  unfixable finding on stage.
- **A null-dereference path, and missing input validation on its own.** No rule in the packs Repro
  runs detects either in this stack. The unused `FORMATS` allowlist in `api/export.py` is the
  missing validation, and it surfaces through the command injection finding (row 5).

## Before the rebuild (commit 21291de)

Only the prompt logging in `src/assistant.js` was detected. The `sk-demo-...` key didn't match any
gitleaks rule (its generic rule skips values containing "demo"), and the SQL injection in the old
`src/db.js` matched no registry rule, so that data layer moved to the Python API. PR #1 in that
repo is a Repro repair from a test run against that older commit.

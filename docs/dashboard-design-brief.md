# Repro dashboard: design brief

This brief covers everything the Repro web dashboard does today: every screen, every piece of data it shows, every action, and every state. The goal is a new visual design that fits this functionality exactly. The design is open. The functionality in "Fixed constraints" is not.

---

## 1. What Repro is

Repro is an automated code repair system. You point it at a repository. It runs security and quality scanners, then **reproduces** each finding in a locked-down sandbox and throws away anything it can't reproduce. For what's left, it diagnoses the root cause, writes a patch, and **verifies** the patch: the tests must pass, the finding must stop reproducing, no new issues may appear, and a second AI (the "Challenger") has to fail to break it. Verified patches wait for a human to merge or reject.

The brand promise is **proof**: nothing gets fixed unless it was reproduced first, and nothing gets merged without evidence. No number on the dashboard comes from an AI model; every figure is computed from stored facts.

**Who uses the dashboard:** the developers running Repro, and people watching a live demo (it was built for a hackathon).

**The page's job:**
1. Show what Repro is doing to your code right now.
2. Put verified patches, with their evidence, in front of a person for the final merge or reject.

---

## 2. Fixed constraints (the design must keep these)

- **People can type exactly two things.**
  - A target to scan: a GitHub repo (`owner/repo`, `owner/repo#branch`, or a github.com URL) or an absolute local path.
  - A merge or reject decision on a verified patch.
  - Nothing else is typed anywhere: no chat box, no prompt field, no search that a model reads, no settings screen. Configuration lives in environment variables.
- **Data refreshes on its own.** The page polls the API; there are no refresh buttons:

  | Data | Refreshes every |
  |---|---|
  | Runs list | 4 s |
  | An open run | 3 s |
  | Review queue | 8 s |
  | Trust ratings | 15 s |
  | Server health | 10 s |

  Numbers, stages and statuses change while the user is looking. Updates must not make the layout jump, and new items should announce themselves gently.
- **Every view has its own URL.** It lives in the hash: `#/overview`, `#/runs`, `#/review`, and a run as `#/<tab>/<runId>` or `#/<tab>/<runId>/<findings|diagnoses|patches|report>`. The browser Back button closes an open run.
- **Keyboard support:**
  - `/` focuses the scan box from anywhere.
  - `Esc` closes an open run.
  - Arrow keys move between tabs.
  - Focus stays inside an open run view.
- **It must work at 1440 px desktop and 390 px phone width**, respect reduced-motion settings, show a visible focus state, and never rely on colour alone to carry meaning.
- **Tech:** React 18, Vite, framer-motion, plain CSS, Google Fonts. No UI kit is required.

---

## 3. Structure

```
Header ─ brand · [Overview] [Runs n] [Review n] ─────────────── server status
│
├── Overview (default)
│     sentence summary · scan box · runs in flight · waiting for your decision · recently finished
├── Runs
│     count · status filters · list of every run
├── Review
│     every verified patch awaiting a decision, grouped by run
│
├── Run detail (opens over whichever tab you're on; currently a large popup)
│     meta · title · status · stage timeline · the sieve · [Findings] [Diagnoses] [Patches] [Report]
│
└── Toasts (bottom centre) · "API unreachable" banner (top of content)
```

Tabs currently use an underline indicator that slides between tabs.

---

## 4. Screens in detail

### 4.1 Header (on every screen)
- **Brand:** the Repro logo and wordmark. Clicking it goes to Overview.
- **Tabs:**
  - Overview.
  - Runs, with a count badge showing the total number of runs.
  - Review, with a count badge showing patches awaiting a decision. This badge is highlighted when the count is above 0, because it's the one thing waiting on the user.
- **Server status**, a small dot and label on the right. It has five states:

  | State | Label | Notes |
  |---|---|---|
  | Connecting | "Connecting" | |
  | OK, in-memory store | "In-memory store" | Tooltip: "Runs live inside the API process and disappear when it restarts. Set MONGODB_URI to keep them." |
  | OK, MongoDB store | "MongoDB store" | |
  | Degraded | "Store unreachable" | The API is up but the database isn't. |
  | Offline | "API offline" | |

- **On a phone:** the brand and status sit on the first row, the tabs on a second row.

### 4.2 Overview

**a. Summary sentence.** One large sentence built from live counts. Examples:
- "Repro is working on **1 run**, with **1 more** queued. **3 verified patches** are waiting for your decision."
- "**2 runs** are queued for the orchestrator." (nothing running)
- "**1** is blocked." is appended when a run is blocked.
- With nothing running, queued or waiting: "Nothing is running. **Scan a repository** to start a run."

**b. Scan box.**
- Label: "Scan a repository".
- Placeholder: "owner/repo, a GitHub URL, or /absolute/path".
- Button: "Scan". It is disabled while the field is empty and reads "Queuing…" while submitting.
- A small `/` key hint sits inside the field (hidden on phones).
- Helper line: "Paths starting with / scan a local checkout. Anything else is treated as a GitHub repository."
- **Error:** the server's message replaces the helper line in the error colour. Example: "Not a GitHub ref (expected owner/repo, owner/repo#rev, or https://github.com/owner/repo): not a ref!"
- **Success:** the field clears, a toast says "Scan queued: octocat/hello-world", the logo plays its animation again, and the new run appears in "In flight" with a brief highlight.

**c. In flight** (section label plus a count). Runs that are queued, running or blocked, in that order: running first, then blocked, then queued. Each run shows:
- **Name:** `owner/repo` for GitHub, the folder name for local (for example `notes-api`).
- **The full ref** in monospace, for example `/demo/notes-api#main`.
- **Status and time:** "Running · 20 min" (time since start) or "Queued · 15m ago".
- **Stage timeline:** five stations, Ingest → Detect → Diagnose → Repair → Verify. Each station has one of six states:

  | State | Meaning |
  |---|---|
  | done | Finished |
  | active | In progress now (should feel alive) |
  | waiting | Queued, about to start (first station only) |
  | pending | Not reached yet |
  | blocked | Stopped, needs attention |
  | failed | Failed here |

  The connector leading into the active station shows movement.
- **One status sentence:**

  | Status / stage | Sentence |
  |---|---|
  | queued | "Queued. It starts when the orchestrator picks it up." |
  | running · ingest | "Cloning the target and indexing its files." |
  | running · detect | "Running detectors. 3 findings so far." (or just "Running detectors.") |
  | running · diagnose | "Diagnosing 2 reproduced findings. 1 done so far." |
  | running · repair | "Writing patches. 1 proposed, 0 verified so far." (or "Writing patches for 2 diagnoses.") |
  | running · verify | "Checking 2 patches against the tests and the Challenger." |
  | blocked | "Blocked during repair. It needs attention before it can continue." |
  | failed | "Failed during ingest." |
  | completed | "Finished. 3 of 5 patches verified from 4 reproduced findings." Variants: "The detectors found nothing." / "None of the 6 findings reproduced, so nothing needed a fix." / "2 findings reproduced, but no patch was written." |

- Clicking a run opens Run detail. If nothing is in flight: "Nothing is in flight. A scan you queue shows up here with its live timeline."

**d. Waiting for your decision.** Up to 4 verified patches, plus a "Review all N" link. Each row shows:
- The fix strategy in one line, truncated.
- The run name and changed files in monospace.
- A trust rating: High, Medium or Low.

Clicking a row opens that run on its Patches tab. If the list is empty: "No patches are waiting. Patches that pass verification land here for you to merge or reject."

**e. Recently finished.** Up to 5 completed or failed runs, plus an "All runs" link. Each row shows the name, the status sentence, the status, and a relative time ("2h ago"). If empty: "No finished runs yet."

**Loading:** skeleton lines. **API down:** a banner above everything: "**Can't reach the Repro API.** Start it with `npm run dev:api`. This page reconnects on its own."

### 4.3 Runs
- **Heading:** "**5 runs**, newest first".
- **Filter chips:** "All 5" plus one chip per status that currently has runs (Running, Queued, Blocked, Completed, Failed), each with its count. Only one filter is active at a time.
- **List columns:**

  | Column | Content |
  |---|---|
  | Target | Name, with the full ref underneath |
  | Stage | A compact 5-segment stage bar, plus status and where it is ("Running at Repair", "Failed at Ingest", "Completed", "Queued") |
  | Findings | Reproduced out of found, "2/3 reproduced", or "—" when there are none |
  | Patches | Verified out of attempted, "0/1 verified", or "—" |
  | Started | Relative time |

- A hover state and an arrow hint show the row is clickable. Clicking opens Run detail. Newly appearing runs get a brief highlight.
- **Phone:** the column headers hide, and each row becomes two lines: name and time, then stage and the two ratios.
- **Empty:** "No runs yet. Scan a repository from the overview to start the first one." With a filter that matches nothing: "No failed runs."

### 4.4 Review
- **Sentence:** "**3 patches** passed verification and are waiting for your decision."
- Patches are grouped by run: the run name (links to the run), its ref, and how long ago it started, followed by that run's patch cards.
- A decided patch animates out of the queue, and the Review badge count drops.
- **Empty:** "Nothing to review. Patches that pass verification show up here for you to merge or reject."

### 4.5 Patch card (used in Review and in Run detail → Patches)

**Top row:**
- The patch status:

  | Status | Label shown |
  |---|---|
  | verified | "Awaiting your decision" (the call to action) |
  | proposed | "Proposed" |
  | merged | "Merged" |
  | rejected | "Rejected" |

- The patch id in monospace.
- For verified and merged patches, the trust rating (High / Medium / Low). Its tooltip lists the reasons.

**Body:**
- **The fix strategy**, prominent, 1–3 lines. Example: "Pass ownerId and noteId to db.query(sql, params) as bound parameters, the way deleteNote already does with its $1/$2 placeholders."
- **Files changed** in monospace, plus "fixes 2 high-severity findings".
- **Four verification checks**, each pass or fail with its own label:
  - Tests pass / Tests fail
  - Finding no longer reproduces / Finding still reproduces
  - Challenger confirmed / Challenger disputed
  - No regressions / 2 regressions
- **The Challenger's notes**, a short quoted paragraph. It is styled differently when the Challenger confirmed versus disputed. Example: "Counter-test: getNoteById(db, '1 OR 1=1') failed before the patch and passes after; the value now reaches the database as a bound parameter."

**Actions:**
- "Show diff" / "Hide diff". This expands:
  - The diff, with added and removed lines coloured.
  - "Reproduction after the patch", a monospace output line, for example "NOT REPRODUCED semgrep … in src/db.js".
  - Any regression findings.
- A "Pull request ↗" link when a PR exists.
- For verified patches, "Reject" (secondary) and "Merge" (primary).
  - Clicking either turns the pair into "Cancel" plus "Confirm merge" (primary) or "Confirm reject" (danger).
  - An unanswered confirmation cancels itself after 5 seconds.
  - While saving, the button reads "Saving…".
  - Afterwards, a toast says "Merged patch_demo_sqli_2" or "Rejected …".

Rejected and proposed cards should read as secondary; today they use a dashed border and muted text.

### 4.6 Run detail (currently a large popup; a side panel or full page is fine as long as the URL and Back behaviour stay)

**Header:**
- **Meta line** in monospace: run id · local/github · trigger (manual/schedule/webhook) · "started Sep 27, 10:31 AM".
- **Close button**, with an `esc` hint.

**Title block:**
- The target name as the title.
- The full ref.
- Status plus the status sentence.

**Stage timeline** (larger version, the same six station states).

**The sieve.** This is the signature chart and it's worth keeping in some form. It shows how many of the run's findings are still standing after each gate:

  | Gate | Example count |
  |---|---|
  | Found | 6 |
  | Reproduced | 4 |
  | Diagnosed | 4 |
  | Patched | 4 |
  | Verified | 4 |
  | Merged | 0 |

- Counts can only go down from gate to gate.
- Each gate shows how many it dropped ("Reproduced −2").
- Caption: "Findings still standing after each gate".
- With no findings yet: "No findings yet. This fills in as soon as detection reports."
- It animates when the run opens: each bar starts at the previous bar's height and settles to its own, leaving an outline of what was filtered out.

**Sub-tabs, with counts:** Findings 6 · Diagnoses 3 · Patches 5 · Report. It opens on **Patches** if any patch awaits a decision, otherwise on **Findings**.

- **Findings.** Reproduced findings come first, then by severity (critical → info).
  - Each row shows:
    - A severity meter plus the word (critical / high / medium / low / info).
    - The message, clamped to 2 lines.
    - `file:line · detector`, for example `src/db.js:6–7 · semgrep`.
    - A badge: "Reproduced" (solid) or "Not reproduced" (muted).
  - Clicking a row expands it to show:
    - "Evidence" (a code excerpt).
    - "Rule" (rule id).
    - "Reproduction command" (monospace).
    - Either "Reproduction output" (monospace), or a note: "This didn't reproduce in the sandbox, so Repro left it alone." / "No reproduction command exists for this rule, so it stays unconfirmed and Repro leaves it alone."
- **Diagnoses.** One card per diagnosis:
  - The root cause, prominent.
  - Labelled rows: Strategy, Risk, Cites (the cited findings as `file:line` chips).
  - The model name and time, small and in monospace.
  - Empty: "No diagnoses yet. Diagnosis starts once findings reproduce."
- **Patches.** Every patch in the run as patch cards: awaiting decision first, then proposed, merged, rejected. Empty: "No patches yet. Repair writes them once a diagnosis is ready."
- **Report.** Label/value pairs:

  | Label | Example value |
  |---|---|
  | Findings reproduced | 4 of 6 |
  | Didn't reproduce | 2 |
  | Patches verified | 3 of 5 · 60% |
  | Merged | 0 |
  | Challenger disputes | 2 |
  | Regressions caught | 1 |
  | Model cost per fix | $0.0042, or "None logged" |
  | Running for / Started | "20 min" while active, the start time once finished |

  Below the table, "Time per stage" is a proportional bar with a legend ("Detect 12 s …"). When there's no timing data: "Stage timings appear once the orchestrator logs this run's stages."

**States:** a loading skeleton, and "Run unavailable" plus the error message if the run can't be loaded.

**Phone:** full screen, with the sieve labels and sub-tabs compressed to fit 390 px.

### 4.7 Toasts
Bottom centre, at most 3 at once. Normal toasts disappear after about 3.6 s; errors use the error colour and stay about 6 s. Wording always repeats the action that caused it: "Scan queued: …", "Merged …", "Rejected …".

---

## 5. Everything that needs a distinct visual state

| Thing | Values |
|---|---|
| Run status | queued · running · blocked · completed · failed |
| Stage station | done · active · waiting · pending · blocked · failed |
| Patch status | proposed · verified (awaiting you) · merged · rejected |
| Finding severity | critical · high · medium · low · info |
| Finding proof | reproduced · not reproduced |
| Verification check | pass · fail |
| Challenger | confirmed · disputed |
| Trust | high · medium · low |
| Server | connecting · ok (memory) · ok (MongoDB) · degraded · offline |
| Diff line | added · removed · context · hunk/meta |

The current build uses a deliberately small palette with one meaning per colour: **live/in progress**, **needs you**, **failed/rejected**, and **done**, plus neutrals. Severity uses a bar meter rather than a colour. The design may redefine this, but should stay minimal.

---

## 6. Data available (exact fields)

- **Run**
  - `id`
  - `target.kind` (`local`|`github`)
  - `target.ref`
  - `trigger` (`manual`|`schedule`|`webhook`)
  - `stage` (`ingest`|`detect`|`diagnose`|`repair`|`verify`|`done`); this is the stage in flight, not the last completed one
  - `status` (`queued`|`running`|`blocked`|`completed`|`failed`)
  - `startedAt`
- **Run counts:** `findings`, `reproducible`, `diagnoses`, `patches`, `verifiedPatches` (the last includes merged).
- **Finding**
  - `id`
  - `detectorId`: semgrep, gitleaks, osv, privacy-patterns, and others
  - `ruleId`
  - `severity`
  - `category`: vulnerability, correctness, privacy, style, …
  - `file`, `lineStart`, `lineEnd`
  - `message`
  - `evidence` (a code excerpt)
  - `reproducible`
  - `reproductionCommand?`
  - `reproductionOutput?`
  - `createdAt`
- **Diagnosis:** `id`, `findingIds[]`, `rootCause`, `proposedStrategy`, `riskNotes`, `model`, `createdAt`.
- **Patch**
  - `id`
  - `diagnosisId`
  - `diff` (git diff text)
  - `filesChanged[]`
  - `testsPassed`
  - `originalFindingReproduces`
  - `reproductionOutputAfter?`
  - `regressionFindings[]`
  - `challengerVerdict` (`confirmed`|`disputed`)
  - `challengerNotes?`
  - `status`
  - `prUrl?`
- **Trust report:** `confidence` (`high`|`medium`|`low`), `reasons[]` (plain sentences).
- **Run report:**
  - Counts: `rawFindings`, `reproducedFindings`, `noiseCut`, `patchesAttempted`, `patchesVerified`, `challengerDisputes`, `patchesMerged`, `regressionsFound`
  - Rates and times: `successRate`, `totalDurationMs`, `avgTimePerStageMs` (per stage), `estimatedCostPerFix`
- **Health:** `status` (`ok`|`degraded`), `store` (`memory`|`mongo`).

Nothing else exists. Please don't design around data that isn't listed, such as user accounts, avatars, charts over time, or settings.

---

## 7. Realistic sample content (the demo data)

**Runs:**

| Name | Ref | State | Findings | Patches |
|---|---|---|---|---|
| seeded-assistant | `/demo/seeded-assistant` | completed, 2h ago | 6 (4 reproduced), 3 diagnoses | 5: 3 verified, 2 rejected |
| notes-api | `/demo/notes-api#main` | running, at Repair | 3 (2 reproduced), 2 diagnoses | 1 proposed, Challenger disputed |
| seeded-assistant | `/demo/seeded-assistant#main` | queued | — | — |
| missing-checkout | `/demo/missing-checkout` | failed during ingest | — | — |

**A finding:**
- high · semgrep · `src/db.js:6–7`
- Message: "Detected string concatenation with a non-literal variable in a SQL statement passed to query(). This could lead to SQL injection if the variable is user-controlled and not properly sanitized."
- Evidence: `const sql = "SELECT id, title, body FROM notes WHERE owner_id = '" + ownerId + "' ORDER BY id";`
- Reproduction output: `REPRODUCED semgrep …node-postgres-sqli at src/db.js:6-7: …`

**Other findings:**
- critical · gitleaks · `src/config.js:5`: "Detected a Generic API Key…" (evidence redacted as `OPENAI_API_KEY: 'REDACTED'`).
- medium · privacy-patterns · `src/assistant.js:7`: "Prompt or conversation content is written to a log without redaction."
- medium · `src/assistant.js:8–15`, not reproduced: "User input is sent to a third-party endpoint…"
- low · `src/db.js:12–13`, not reproduced: "The result of db.query() is indexed without checking that it returned rows."

**A diagnosis:**
- Root cause: "Both queries in src/db.js build SQL by concatenating caller-supplied values into the statement text (ownerId in findNotesByOwner, noteId in getNoteById), so either value can change the structure of the query."
- Risk: "Anyone who controls an owner or note ID can read other users' notes. The fix changes only how values reach the database; results for well-formed IDs are identical."
- Model: gemini-3.1-pro-preview.

**Patches for that diagnosis:**
- **Attempt 1, rejected.** Challenger disputed: "quote() only doubles single quotes, and noteId is interpolated without quotes, so there is nothing for it to escape. The rule stopped firing because the concatenation moved into a template literal, not because the query is parameterized."
- **Attempt 2, verified, high trust.** All four checks pass. The diff replaces the concatenation with `$1` placeholders and `db.query(sql, [ownerId])`.

---

## 8. Motion that exists today (keep, refine, or replace)
- **Logo:** three colour plates start misaligned and slide into one exact mark on load, and again when a scan is queued.
- **Tabs:** the underline slides to the selected tab, and the content crossfades.
- **Lists:** they stagger in on first load. They don't re-animate when polling refreshes the data.
- **Live runs:** the active station breathes, the connector into it carries a moving pulse, and the running status dot pulses.
- **New run:** a brief highlight wash on the new row.
- **Run detail:** the backdrop fades in, the panel springs in, the corner marks draw in, and the sieve bars settle.
- **Patch card:** the diff expands and collapses in height. A decided card slides out of the review queue.
- **Toasts** spring up from the bottom.
- **Reduced motion:** everything becomes instant.

## 9. What the owner wants the design to feel like
- **Minimal and low-saturation**, with few colours. Bright neon was rejected.
- **No decorative backgrounds.** A busy animated background was rejected.
- **Strong Repro branding.**
- **Animated, but purposeful.** "More animated, less bright colours, be smart."
- **Layout choices the owner made:** tab-based navigation with an underline indicator; in-flight scans as a stage timeline with a one-line status; all runs as a list rather than cards; run detail opened on click as an overlay.
- **Current build, for reference only:**
  - Graphite background, paper-white type.
  - Three muted print inks: cyan = live, yellow = needs you, magenta = failed or rejected.
  - A printer's registration-mark logo.
  - Crop marks on the run-detail sheet.
  - The sieve chart.
  - Big Shoulders Display (wordmark and numbers), Hanken Grotesk (UI), Azeret Mono (code and IDs).

  All of this may change.

---

## 10. What to send back

1. **Frames at 1440 px and 390 px:**
   - **Overview:** with data, empty, loading, and with the API-offline banner.
   - **Runs:** all runs, a filtered view, and an empty filter.
   - **Review:** with patches, and empty.
   - **Run detail:** each sub-tab (Findings with one row expanded, Diagnoses, Patches, Report), plus loading.
   - **Patch card states:** awaiting decision, diff open, confirming merge, saving, merged, rejected, proposed.
   - **Scan box:** empty, typing, error.
   - A toast.
2. **Tokens:** colours as hex with their roles; type families, sizes, weights and line heights; spacing scale; radii; shadows. If you design a light theme too, give both palettes.
3. **Component specs** for:
   - Tabs, including count badges and the highlighted state.
   - The server status indicator.
   - The stage timeline, all six station states, large and compact.
   - The sieve.
   - The severity meter and the trust rating.
   - Buttons: primary, secondary, danger, disabled.
   - Filter chips, badges, and the verification checks.
   - Diff lines.
4. **Motion notes:** duration and easing for the moments in section 8, plus any you add.
5. **Format:** a Figma file, or self-contained HTML/CSS that I can translate into the React components.

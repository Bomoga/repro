# Gemini token usage: where it goes, and what's worth cutting

*Research notes, 2026-09-26, lane-2 at `f257520` (main). No pipeline code was changed for this.*

Grounded in Lane 3's merged code (`packages/agents`, `packages/orchestrator`), prompt sizes measured
by running Lane 3's own prompt builders on the demo repo's 18 real findings, and Google's current
docs. Token counts below are estimates at ~4 characters per token.

## Bottom line

1. **Measure before building anything.** Every Gemini call's input, output, cached, and thought
   tokens are already written to the Run Store (`kind: "gemini"` log entries, `response.usage`).
   Nobody here has aggregated them, and this checkout can't reach the Run Store. One query
   answers most of the open questions below.
2. **The biggest lever isn't on the list: how many Diagnoses get repaired per run.** The
   orchestrator runs Repair and the Challenger, up to 2 attempts each, for *every* eligible
   Diagnosis in sequence (`packages/orchestrator/src/pipeline.ts`). Diagnose is one call per run;
   the per-Diagnosis cycles are nearly all of the calls.
3. **Thinking tokens are probably the dominant cost, not prompts.** They bill as output: on Pro
   that's $12/M against $2/M input and $0.20/M cached input, so 1k thinking tokens cost as much as
   6k fresh input or 60k cached input. All three agents run at `high`.
4. **Most of the specific ideas on the list save little**, because implicit caching already
   discounts repeated prefixes by 90% and the fixed prompts are small (under 1k tokens each).

## What a run costs today (structure, measured sizes)

| Agent | Model / thinking | Calls | Measured fixed input per call | Grows with |
|---|---|---|---|---|
| Diagnose | 3.1 Pro / high | 1 per run (2 if the post-check rejects) | system 708, schema ~376 | findings block (5.8k on the demo) + code context (3.1k) |
| Repair | 3.8 Flash / high | up to 16 turns × 2 attempts, per Diagnosis | system 499 + tools 425, resent every turn | conversation history: full-file reads, test output up to 6,000 chars |
| Challenger | 3.1 Pro / high | up to 11 attack turns + verdict (×2 on schema failure), × 2 attempts, per Diagnosis | system 643 + tools 250, resent every turn | history: file reads, counter-test runs (1,500 chars per side) |

Recorded real runs (PROGRESS.md): one Diagnosis end to end took 19 calls in ~2.7 min; a queued-to-done
run took 2m19s. Worst case for one Diagnosis is about 60 calls (2 attempts × up to 17 Repair turns and 13 Challenger calls), plus Diagnose.

Prices (paid tier): 3.1 Pro $2.00 in / $12.00 out / $0.20 cached per 1M; 3.8 Flash $0.75 / $3.75 /
$0.075 through 2026-12-31, doubling on 2027-01-01. Output includes thinking.

## Options, in order of value

### 1. Measure it (do this first)

Aggregate the Run Store's `gemini` log entries: calls, and summed input/output/cached/thought
tokens, grouped by role, per Diagnosis and per run. That settles: what share is thinking, whether
history is re-billed each turn (Google's docs don't say), the cache hit rate, and whether the caps
are ever hit.

- **Saves:** nothing by itself; tells you which of the rest are worth it.
- **Effort:** ~30 min, a script against the store. No pipeline change.
- **Risk:** none.

### 2. Cap Diagnoses repaired per run (not on the brief's list)

Diagnose already returns Diagnoses most urgent first. Repair and challenge only the top K (say 3),
and leave the rest diagnosed but unrepaired, reported as such.

- **Saves:** roughly (eligible − K) / eligible of all Repair and Challenger calls. On the demo repo,
  with an estimated 8–11 Diagnoses and K = 3, that's around 60–70% of a run's calls. It also
  shortens the live demo.
- **Effort:** small, a loop bound plus an env var in Lane 3's orchestrator. Under an hour with tests.
- **Risk to quality:** none per fix, but fewer fixes per run. The unrepaired Diagnoses still exist.

### 3. Thinking level

No per-call override exists today: the level is fixed per role in `ROLE_CONFIG` (gemini.ts).
Supported levels are low/medium/high on both models. 3.1 Pro defaults to high, 3.8 Flash to medium.
The wrapper's type also allows `minimal`, which neither model supports.

- **Repair, high → medium (Flash's own default):** probably the safest real saving. Repair's
  output is checked by tests, detector re-runs, and the Challenger. *Tradeoff:* a weaker fix fails
  those checks and triggers attempt 2, which costs a whole extra cycle. Test on the demo repo first.
- **Challenger verdict call only, → low:** the verdict is nearly mechanical, because
  `decideVerdict` overrides any "confirmed" without a counter-test that failed before and passes
  after. Small saving (one call of ~7–12).
- **Challenger attack phase, or Diagnose:** keep at high. Catching a fix that fools the detector
  is the demo's key beat, and Diagnose's grouping is what reduces the number of cycles.
- **Severity routing (low/info to a lower level):** can only apply per Diagnosis (Repair and
  Challenger), not in Diagnose, which is one call for the whole run. *Tradeoff:* severity is the
  detector's label, not difficulty. The ORDER BY trap in the demo repo is a one-line change that
  needs high reasoning to get right.
- **Saves:** unknown until #1. Thinking is plausibly most of the output bill.
- **Effort:** per-call override in the wrapper plus call-site changes: 1–2 h.
- **Risk:** medium, as above. Flag, don't flip blind.

### 4. Leaner findings block in Diagnose (cheap, contained)

Measured on the demo's 18 findings: the findings JSON is 5.8k tokens, larger than the code context
(3.1k). `reproductionOutput` is 2.1k of it, because each "REPRODUCED …" line repeats the finding's
full message, and Diagnose already sees `status: CONFIRMED`. Compact JSON (no indentation) saves
another ~300.

- **Saves:** ~3.1k of ~9.9k input tokens per Diagnose call (~30%). At one Pro call per run that's
  about $0.006 per run. Small in dollars, but free.
- **Effort:** under an hour in `renderFinding` (Lane 3's `diagnose/prompt.ts`), plus tests.
- **Risk:** low. Keep a short first line of the reproduction output if the model uses it.

### 5. Context sizing in Diagnose

What the code does: any file up to **1,500 lines** is sent whole; only longer files get ±80-line
windows. The "files along a source-to-sink path" in CLAUDE.md is **not implemented**, so there's
nothing there to trim (if anything, it's a quality gap).

- **Saves:** nothing on the demo repo (all its files are short). On real repos it can be large: a
  1,400-line file with one finding costs ~15k tokens whole versus ~2k windowed. Lowering the
  threshold (to ~400 lines), or windowing to the enclosing function, would cut context by around
  75% there.
- **Effort:** 1–2 h (threshold is one constant; enclosing-function windows need per-language
  heuristics).
- **Risk:** medium for quality. Grouping several findings under one root cause is exactly where
  seeing the whole file helps, and it's the reason Diagnose runs on Pro.

### 6. Caching

- **Ordering is already right everywhere.** System instruction and tools are constants. Diagnose
  puts code context before findings, and its retry appends feedback after an identical prefix
  (verified). Repair and the Challenger chain with `previous_interaction_id` and only append new
  turns. So within each conversation, everything after the first ~4k tokens is a stable, cacheable
  prefix.
- **Across conversations it can't help much.** The shared prefix (a system prompt plus tools, and
  for Repair the file index) is ~1–1.2k tokens on the demo repo, under the 4,096-token minimum
  for implicit caching on these models.
- **Explicit caching isn't available.** Google's docs say explicit context caching is "not yet
  available" in the Interactions API, which is what the wrapper uses. Using it would mean moving
  the wrapper to the legacy `generateContent` API. It would also need content above the same
  minimum (the system prompts are ~500–700 tokens) and incur hourly storage fees.
- **Recommendation:** no work. Confirm the cached share in #1.

### 7. Repair's per-turn resend

The resent part is small: 924 tokens (system 499 + tools 425) per turn. Over a 16-turn attempt
that's ~15k tokens, most of it billed at the cached rate after the first turn or two.

- **Shortening the prompt and tool descriptions by a third:** saves ~300 tokens per turn, under
  $0.004 per attempt on Flash even uncached. **Not worth it:** those rules (don't weaken tests, secret
  placeholders, untrusted input) are correctness and safety rails.
- **The actual growth is history.** Every tool result stays in the conversation and is re-read on
  later turns. The cheapest real cut: when `run_tests` or `rerun_detector` passes, return a
  one-line summary instead of up to 6,000 characters of passing output. Failing output stays as it
  is. Saves maybe 1–3k tokens per later turn on noisy suites, mostly at the cached rate.
  Effort ~1 h. Low risk.

### 8. Model tier for the Challenger

The suggested split, Flash to explore and Pro for the verdict, is inverted for this code. The
exploration phase is where the reasoning happens: it writes the counter-tests that catch a
detector-fooling fix. The verdict is one mechanical call the harness overrides anyway.

- **If anything, the reverse:** keep Pro for the attack phase and run the verdict call on Flash at
  low thinking. Google's docs allow mixing models in one chained conversation (outputs must be
  valid input for the next model), but this hasn't been tried here.
- **Whole Challenger on Flash for low-severity Diagnoses:** bigger saving, but unproven. Lane 3's
  record shows only Pro disputing the detector-fooling fix; Flash hasn't been shown to catch it.
- **Saves:** verdict-only is small. Flash for low-severity Diagnoses could be large, depending on
  the severity mix.
- **Effort:** 1–2 h each. **Risk:** high for the attack phase, low for the verdict call.

### 9. Hard caps

No usage logs are reachable from this checkout. The recorded runs (19 calls for one Diagnosis end
to end) are far below the ~60-call worst case, so the caps aren't binding on the happy path. They
matter on the failure path, and a stuck Repair spends its full 16 turns twice.

- **Better than lowering the number:** stop an attempt early when it's clearly stuck, for example
  the same test failure twice in a row, or the same `replace_in_file` failing twice.
- **Effort:** 1–2 h. **Risk:** low if the thresholds are conservative. Decide from #1's data.

## Also worth knowing

- **Request quotas can bind before tokens do.** The wrapper's own comment notes the free tier
  allows 20 requests per day on gemini-3.8-flash. One demo-repo run needs far more, so the demo
  host must be on the billing-linked key. Option 2 cuts requests as well as tokens.
- **Flash prices double on 2027-01-01.** Not a hackathon concern.

## Suggested order, given the time left

1. Measure (#1), 30 min.
2. Cap Diagnoses per run (#2): biggest, lowest-risk cut.
3. Leaner findings block (#4) and summarized passing tool output (#7): about an hour each.
4. Everything touching thinking levels or models (#3, #8) only with #1's numbers in hand, and
   with a demo-repo run afterward to confirm the Challenger still catches the ORDER BY trap.

All of the code involved belongs to Lane 3 (`packages/agents`, `packages/orchestrator`).

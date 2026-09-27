# Running the Repro demo

## One-time setup
1. Start Docker, then build the sandbox every target command runs in: `npm install && npm run sandbox:build`
2. Create `.env` at the repo root (it's gitignored):
   ```
   GEMINI_API_KEY=...        # Diagnose, Repair, and the Challenger; without it runs stop after reproduction
   MONGODB_URI=...           # optional: Atlas keeps runs across restarts; unset = in-memory
   REPRO_GITHUB_TOKEN=...    # optional: opens a PR for each verified patch
   ```

## Run it
`npm run demo` starts everything in one terminal:
- the control plane (API and orchestrator) on http://localhost:4000,
- the dashboard on http://localhost:5173,
- the marketing site on http://localhost:5174.

Ctrl+C stops all three.

Without a Gemini key, `npm run demo` still scans for real: each run ingests, detects, and reproduces in the sandbox, then completes. Diagnose, Repair, and the Challenger are skipped until the key is in `.env`.

`npm run dev:all` shows the same dashboard and site over four seeded demo runs held in memory, with no orchestrator.

## What to show (about 3 minutes)
1. **Site**, http://localhost:5174: the "Proof, not promises." hero and the 412 → 5 before/after. Then click **Sample report**, which opens a finished run in the dashboard.
2. **Dashboard**, http://localhost:5173:
   1. Press `/`, type `Bomoga/repro-demo`, and press Enter.
   2. The run appears under **In flight**. Its timeline walks Ingest → Detect → Diagnose → Repair → Verify.
3. **Open the run.** The sieve shows 18 findings found and 18 reproduced, then how many survive diagnosis, patching, and verification.
4. **The bug whose obvious fix is wrong:** `?sort=` in `api/notes.py`.
   - Parameterizing `ORDER BY` passes the tests, and Semgrep stops flagging it.
   - The Challenger's counter-test catches that sorting silently broke. That patch shows **Challenger disputed** and is rejected. The allowlist fix is verified.
5. **Review tab.** Merge or reject each verified patch with its evidence: checks, Challenger note, diff, and the reproduction after the patch.

The seeded issues and their intended fixes are in `DEMO_SEEDED_ISSUES.md`. Keep that file out of the target repo.

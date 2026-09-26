import { useEffect, useState } from "react";
import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import type { TrustReport } from "@repro/api";
import { api } from "./api.ts";

// Section 8: only inputs are a target ref (to start a Run) and merge/reject on a Patch --
// no chat surface, no free-form prompt box anywhere on this page.
export function App() {
  const [runs, setRuns] = useState<Run[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | undefined>();
  const [targetRef, setTargetRef] = useState("");
  const [error, setError] = useState<string | undefined>();

  const refreshRuns = () => api.listRuns().then(setRuns).catch((e: Error) => setError(e.message));

  useEffect(() => {
    refreshRuns();
    const id = setInterval(refreshRuns, 5000);
    return () => clearInterval(id);
  }, []);

  const startScan = async () => {
    if (!targetRef.trim()) return;
    try {
      const run = await api.createRun(targetRef.trim());
      setTargetRef("");
      setSelectedRunId(run.id);
      refreshRuns();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Repro Status</h1>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <section style={{ marginBottom: "2rem" }}>
        <h2>Runs</h2>
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem" }}>
          <input
            placeholder="target ref, e.g. main"
            value={targetRef}
            onChange={(e) => setTargetRef(e.target.value)}
            style={{ flex: 1, padding: "0.4rem" }}
          />
          <button onClick={startScan}>Scan</button>
        </div>
        <table width="100%" cellPadding={6}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th>Run</th>
              <th>Target</th>
              <th>Stage</th>
              <th>Status</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id}
                onClick={() => setSelectedRunId(run.id)}
                style={{ cursor: "pointer", background: run.id === selectedRunId ? "#eef" : undefined }}
              >
                <td>{run.id}</td>
                <td>
                  {run.target.kind}:{run.target.ref}
                </td>
                <td>{run.stage}</td>
                <td>{run.status}</td>
                <td>{run.startedAt}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={5}>No runs yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {selectedRunId && <RunDetail runId={selectedRunId} onDecided={refreshRuns} />}
    </div>
  );
}

function RunDetail({ runId, onDecided }: { runId: string; onDecided: () => void }) {
  const [findings, setFindings] = useState<Finding[]>([]);
  const [diagnoses, setDiagnoses] = useState<Diagnosis[]>([]);
  const [patches, setPatches] = useState<Patch[]>([]);
  const [reports, setReports] = useState<Record<string, TrustReport>>({});

  useEffect(() => {
    api.listFindings(runId).then(setFindings);
    api.listDiagnoses(runId).then(setDiagnoses);
    api.listPatches(runId).then(async (list) => {
      setPatches(list);
      const entries = await Promise.all(list.map(async (p) => [p.id, await api.trustReport(runId, p.id)] as const));
      setReports(Object.fromEntries(entries));
    });
  }, [runId]);

  const decide = async (patchId: string, decision: "merge" | "reject") => {
    await api.decidePatch(patchId, decision);
    setPatches(await api.listPatches(runId));
    onDecided();
  };

  return (
    <section>
      <h2>Run {runId}</h2>

      <h3>Findings ({findings.length})</h3>
      <ul>
        {findings.map((f) => (
          <li key={f.id}>
            <strong>{f.severity}</strong> {f.file}:{f.lineStart} — {f.message}
          </li>
        ))}
      </ul>

      <h3>Diagnoses ({diagnoses.length})</h3>
      <ul>
        {diagnoses.map((d) => (
          <li key={d.id}>
            <strong>{d.rootCause}</strong> — {d.proposedStrategy}
          </li>
        ))}
      </ul>

      <h3>Patches ({patches.length})</h3>
      <ul>
        {patches.map((p) => {
          const report = reports[p.id];
          return (
            <li key={p.id} style={{ marginBottom: "1rem" }}>
              <div>
                {p.id} — status: {p.status}, verdict: {p.challengerVerdict}
              </div>
              {report && (
                <div>
                  Trust: <strong>{report.confidence}</strong>
                  <ul>
                    {report.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {p.status === "verified" && (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button onClick={() => decide(p.id, "merge")}>Merge</button>
                  <button onClick={() => decide(p.id, "reject")}>Reject</button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

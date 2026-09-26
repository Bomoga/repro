import { useEffect, useState } from "react";
import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import type { RunReport, TrustReport } from "@repro/api";
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
  const [runReport, setRunReport] = useState<RunReport | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [expandedTab, setExpandedTab] = useState<"findings" | "diagnoses" | "patches" | "report">("report");

  const loadReport = () =>
    api.report(runId).then(
      (report) => {
        setRunReport(report);
        setReportError(null);
      },
      (error: unknown) => setReportError(error instanceof Error ? error.message : String(error)),
    );

  useEffect(() => {
    setRunReport(null);
    setReportError(null);
    api.listFindings(runId).then(setFindings);
    api.listDiagnoses(runId).then(setDiagnoses);
    api.listPatches(runId).then(async (list) => {
      setPatches(list);
      const entries = await Promise.all(list.map(async (p) => [p.id, await api.trustReport(runId, p.id)] as const));
      setReports(Object.fromEntries(entries));
    });
    void loadReport();
  }, [runId]);

  const decide = async (patchId: string, decision: "merge" | "reject") => {
    await api.decidePatch(patchId, decision);
    setPatches(await api.listPatches(runId));
    void loadReport();
    onDecided();
  };

  return (
    <div style={{ background: "#fff", border: "1px solid #e0e0e0", padding: "2rem", borderRadius: 0 }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 600, marginBottom: "1.5rem", textTransform: "uppercase", letterSpacing: "0.5px", color: "#666" }}>
        Run Details: {runId.slice(0, 8)}...
      </h2>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "1rem", marginBottom: "2rem", borderBottom: "1px solid #e0e0e0", paddingBottom: "1rem" }}>
        <button
          onClick={() => setExpandedTab("report")}
          style={{
            padding: "0.5rem 1rem",
            background: expandedTab === "report" ? "#0066ff" : "transparent",
            color: expandedTab === "report" ? "#fff" : "#666",
            border: "none",
            cursor: "pointer",
            fontSize: "0.9rem",
            fontWeight: 600,
            borderRadius: 0,
          }}
        >
          📊 Report
        </button>
        <button
          onClick={() => setExpandedTab("findings")}
          style={{
            padding: "0.5rem 1rem",
            background: expandedTab === "findings" ? "#0066ff" : "transparent",
            color: expandedTab === "findings" ? "#fff" : "#666",
            border: "none",
            cursor: "pointer",
            fontSize: "0.9rem",
            fontWeight: 600,
            borderRadius: 0,
          }}
        >
          Findings ({findings.length})
        </button>
        <button
          onClick={() => setExpandedTab("diagnoses")}
          style={{
            padding: "0.5rem 1rem",
            background: expandedTab === "diagnoses" ? "#0066ff" : "transparent",
            color: expandedTab === "diagnoses" ? "#fff" : "#666",
            border: "none",
            cursor: "pointer",
            fontSize: "0.9rem",
            fontWeight: 600,
            borderRadius: 0,
          }}
        >
          Diagnoses ({diagnoses.length})
        </button>
        <button
          onClick={() => setExpandedTab("patches")}
          style={{
            padding: "0.5rem 1rem",
            background: expandedTab === "patches" ? "#0066ff" : "transparent",
            color: expandedTab === "patches" ? "#fff" : "#666",
            border: "none",
            cursor: "pointer",
            fontSize: "0.9rem",
            fontWeight: 600,
            borderRadius: 0,
          }}
        >
          Patches ({patches.length})
        </button>
      </div>

      {/* Report Tab */}
      {expandedTab === "report" && !runReport && (
        <p style={{ color: reportError ? "#cc3300" : "#666" }}>{reportError ? `Couldn't load the report: ${reportError}` : "Loading report…"}</p>
      )}
      {expandedTab === "report" && runReport && (
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "1.5rem", marginBottom: "2rem" }}>
            <div style={{ textAlign: "center", padding: "1rem", background: "#f9f9f9", border: "1px solid #e0e0e0" }}>
              <div style={{ fontSize: "0.75rem", color: "#999", textTransform: "uppercase", marginBottom: "0.5rem" }}>Raw Findings</div>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "#0066ff" }}>{runReport.stats.rawFindings}</div>
            </div>
            <div style={{ textAlign: "center", padding: "1rem", background: "#f9f9f9", border: "1px solid #e0e0e0" }}>
              <div style={{ fontSize: "0.75rem", color: "#999", textTransform: "uppercase", marginBottom: "0.5rem" }}>Reproduced</div>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "#0066ff" }}>{runReport.stats.reproducedFindings}</div>
            </div>
            <div style={{ textAlign: "center", padding: "1rem", background: "#f9f9f9", border: "1px solid #e0e0e0" }}>
              <div style={{ fontSize: "0.75rem", color: "#999", textTransform: "uppercase", marginBottom: "0.5rem" }}>Patches Verified</div>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "#00cc44" }}>{runReport.stats.patchesVerified}</div>
            </div>
            <div style={{ textAlign: "center", padding: "1rem", background: "#f9f9f9", border: "1px solid #e0e0e0" }}>
              <div style={{ fontSize: "0.75rem", color: "#999", textTransform: "uppercase", marginBottom: "0.5rem" }}>Success Rate</div>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "#00cc44" }}>{(runReport.stats.successRate * 100).toFixed(1)}%</div>
            </div>
            <div style={{ textAlign: "center", padding: "1rem", background: "#f9f9f9", border: "1px solid #e0e0e0" }}>
              <div style={{ fontSize: "0.75rem", color: "#999", textTransform: "uppercase", marginBottom: "0.5rem" }}>Gemini Tokens/Fix</div>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: "#0066ff" }}>{runReport.stats.tokensPerFix === null ? "—" : runReport.stats.tokensPerFix.toLocaleString()}</div>
            </div>
            <div style={{ textAlign: "center", padding: "1rem", background: "#f9f9f9", border: "1px solid #e0e0e0" }}>
              <div style={{ fontSize: "0.75rem", color: "#999", textTransform: "uppercase", marginBottom: "0.5rem" }}>Regressions</div>
              <div style={{ fontSize: "2rem", fontWeight: 700, color: runReport.stats.regressionsFound > 0 ? "#ff6600" : "#00cc44" }}>{runReport.stats.regressionsFound}</div>
            </div>
          </div>
        </div>
      )}

      {/* Findings Tab */}
      {expandedTab === "findings" && (
        <div>
      <h3>Findings ({findings.length})</h3>
      <ul>
        {findings.map((f) => (
          <li key={f.id}>
            <strong>{f.severity}</strong> {f.file}:{f.lineStart} — {f.message}
          </li>
        ))}
      </ul>
        </div>
      )}

      {/* Diagnoses Tab */}
      {expandedTab === "diagnoses" && (
        <div>
      <h3>Diagnoses ({diagnoses.length})</h3>
      <ul>
        {diagnoses.map((d) => (
          <li key={d.id} style={{ marginBottom: "1rem" }}>
            <div><strong>Root cause:</strong> {d.rootCause}</div>
            <div><strong>Strategy:</strong> {d.proposedStrategy}</div>
            <div><strong>Risk:</strong> {d.riskNotes}</div>
            <div style={{ marginTop: "0.5rem", fontSize: "0.9rem", color: "#666" }}>
              Findings: {d.findingIds.join(", ")}
            </div>
          </li>
        ))}
      </ul>
        </div>
      )}

      {/* Patches Tab */}
      {expandedTab === "patches" && (
        <div>
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
        </div>
      )}
    </div>
  );
}

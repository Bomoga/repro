import React from 'react';
import ReactDOM from 'react-dom/client';
import { createTRPCProxyClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@repro/api';
import './styles.css';

const client = createTRPCProxyClient<AppRouter>({
  links: [httpBatchLink({ url: `${import.meta.env.VITE_REPRO_API_URL ?? ''}/trpc` })]
});

function App() {
  const [runs, setRuns] = React.useState<Awaited<ReturnType<typeof client.runs.list.query>>>([]);
  const [selectedRunId, setSelectedRunId] = React.useState('');
  const [details, setDetails] = React.useState<Awaited<ReturnType<typeof client.runs.get.query>> | null>(null);
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(true);
  const [view, setView] = React.useState<'run' | 'trust'>('run');

  React.useEffect(() => {
    let active = true;
    const refreshRuns = async () => {
      try {
        const nextRuns = await client.runs.list.query({ limit: 50 });
        if (!active) return;
        setRuns(nextRuns);
        setSelectedRunId((current) => current || nextRuns[0]?.id || '');
        setError('');
      } catch {
        if (active) setError('Could not reach the Run Store API. Check the API server and MONGODB_URI.');
      } finally {
        if (active) setLoading(false);
      }
    };

    void refreshRuns();
    const interval = window.setInterval(refreshRuns, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, []);

  React.useEffect(() => {
    if (!selectedRunId) {
      setDetails(null);
      return;
    }

    let active = true;
    const refreshDetails = () => {
      client.runs.get.query({ id: selectedRunId })
        .then((nextDetails) => {
          if (active) {
            setDetails(nextDetails);
            setError('');
          }
        })
        .catch(() => {
          if (active) setError(`Could not load run ${selectedRunId}.`);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };

    setLoading(true);
    refreshDetails();
    const interval = window.setInterval(refreshDetails, 5000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedRunId]);

  const findings = details?.findings ?? [];
  const privacyFindings = findings.filter((finding) => finding.detectorId === 'privacy-patterns' || finding.detectorId === 'gitleaks');
  const confirmedFindings = findings.filter((finding) => finding.reproducible).length;

  return (
    <main className="shell">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Repro home">REPRO<span>.</span></a>
        <div className="topbar-meta"><span className="live-dot" /> RUN STORE <span className="separator">/</span> LIVE STATUS</div>
      </header>

      <section className="workspace" id="top">
        <aside className="rail">
          <p className="rail-label">MONITOR</p>
          <button className={view === 'run' ? 'rail-button selected' : 'rail-button'} onClick={() => setView('run')}>Run activity</button>
          <button className={view === 'trust' ? 'rail-button selected' : 'rail-button'} onClick={() => setView('trust')}>Trust report</button>
          <div className="rail-rule" />
          <p className="rail-label">RECENT RUNS</p>
          {runs.map((run) => (
            <button key={run.id} className={selectedRunId === run.id ? 'run-link selected' : 'run-link'} onClick={() => setSelectedRunId(run.id)}>
              <span className="run-link-state" data-status={run.status} />
              <span className="run-link-text">{run.id}<small>{run.stage} · {run.status}</small></span>
            </button>
          ))}
          {!runs.length && <p className="rail-empty">No runs recorded</p>}
        </aside>

        <div className="content">
          <div className="page-heading">
            <div><p className="eyebrow">CONTROL PLANE</p><h1>{view === 'trust' ? 'Trust report' : 'Run activity'}</h1></div>
            <span className="refresh-note">Refreshes every 5 seconds</span>
          </div>

          {error && <div className="notice error" role="alert">{error}</div>}
          {loading && !details && <div className="notice" role="status">Loading run data...</div>}
          {!loading && !details && !error && <div className="empty-state"><span className="empty-mark">0</span><h2>No runs yet</h2><p>Runs will appear here after the pipeline writes them to the Run Store.</p></div>}

          {details && view === 'run' && <>
            <section className="run-banner">
              <div><p className="eyebrow">{details.run.target.kind.toUpperCase()} TARGET</p><h2>{details.run.id}</h2><p className="run-ref">{details.run.target.ref}</p></div>
              <div className="stage-block"><span className="label">CURRENT STAGE</span><strong>{details.run.stage}</strong><span className={`status-pill ${details.run.status}`}>{details.run.status}</span></div>
            </section>
            <section className="metric-row" aria-label="Run summary">
              <div><span className="label">Findings</span><strong>{findings.length}</strong></div>
              <div><span className="label">Reproduced</span><strong>{confirmedFindings}<small> / {findings.length}</small></strong></div>
              <div><span className="label">Diagnoses</span><strong>{details.diagnoses.length}</strong></div>
              <div><span className="label">Patches</span><strong>{details.patches.length}</strong></div>
            </section>
            <section className="section-block"><div className="section-title"><h2>Findings</h2><span>{findings.length} recorded</span></div>
              {!findings.length ? <p className="section-empty">No findings have been recorded for this run.</p> : findings.map((finding) => (
                <article className="finding-row" key={finding.id}>
                  <div className="finding-severity" data-severity={finding.severity} />
                  <div className="finding-main"><div className="finding-title"><strong>{finding.message}</strong><span className="severity-tag">{finding.severity}</span></div>
                    <p className="finding-location">{finding.file}:{finding.lineStart} · {finding.detectorId} / {finding.ruleId}</p>
                    <pre>{finding.evidence}</pre>
                    {finding.reproductionOutput && <p className="proof-line"><b>BEFORE</b> {finding.reproductionOutput}</p>}
                  </div>
                  <span className={finding.reproducible ? 'proof-state confirmed' : 'proof-state'}>{finding.reproducible ? 'REPRODUCED' : 'UNCONFIRMED'}</span>
                </article>
              ))}
            </section>
            <section className="section-block"><div className="section-title"><h2>Diagnosis &amp; repair</h2><span>{details.diagnoses.length} diagnoses · {details.patches.length} patches</span></div>
              {!details.diagnoses.length && !details.patches.length ? <p className="section-empty">Diagnosis and repair have not started.</p> : <div className="repair-list">
                {details.diagnoses.map((diagnosis) => <article className="repair-item" key={diagnosis.id}><span className="label">DIAGNOSIS · {diagnosis.model}</span><h3>{diagnosis.rootCause}</h3><p>{diagnosis.proposedStrategy}</p><p className="risk-note">{diagnosis.riskNotes}</p></article>)}
                {details.patches.map((patch) => <article className="repair-item" key={patch.id}><span className="label">PATCH · {patch.status}</span><h3>{patch.filesChanged.join(', ') || 'No files changed'}</h3><p>Tests {patch.testsPassed ? 'passed' : 'did not pass'} · original finding {patch.originalFindingReproduces ? 'still reproduces' : 'no longer reproduces'} · challenger {patch.challengerVerdict}</p>{patch.reproductionOutputAfter && <p className="proof-line"><b>AFTER</b> {patch.reproductionOutputAfter}</p>}{patch.prUrl && <a href={patch.prUrl}>View pull request</a>}</article>)}
              </div>}
            </section>
          </>}

          {details && view === 'trust' && <section className="trust-report">
            <div className="trust-score"><span className="label">PRIVACY &amp; SECRET FINDINGS</span><strong>{privacyFindings.length}</strong><p>grounded findings from privacy-patterns and gitleaks</p></div>
            <div className="section-title"><h2>Evidence</h2><span>{privacyFindings.filter((finding) => finding.reproducible).length} reproduced</span></div>
            {!privacyFindings.length ? <p className="section-empty">No privacy-patterns or gitleaks findings are recorded for this run. This is not a complete trust certification.</p> : privacyFindings.map((finding) => <article className="trust-finding" key={finding.id}><span className="severity-tag">{finding.severity}</span><div><h3>{finding.message}</h3><p>{finding.file}:{finding.lineStart} · {finding.detectorId} / {finding.ruleId}</p><pre>{finding.evidence}</pre><small>{finding.reproducible ? 'Reproduced by the executor' : 'Not yet reproduced'}</small></div></article>)}
          </section>}
        </div>
      </section>
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

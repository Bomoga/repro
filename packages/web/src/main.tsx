import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';

const status = {
  run: { id: 'run-demo-001', stage: 'verify', status: 'running' },
  summary: {
    totalFindings: 1,
    reproducibleFindings: 1,
    status: 'verified',
    challengerVerdict: 'confirmed'
  }
};

function App() {
  return (
    <main className="page">
      <section className="card">
        <p className="eyebrow">Lane 4</p>
        <h1>Repro Status</h1>
        <div className="grid">
          <div>
            <span className="label">Run</span>
            <strong>{status.run.id}</strong>
          </div>
          <div>
            <span className="label">Stage</span>
            <strong>{status.run.stage}</strong>
          </div>
          <div>
            <span className="label">Status</span>
            <strong>{status.run.status}</strong>
          </div>
          <div>
            <span className="label">Findings</span>
            <strong>{status.summary.totalFindings}</strong>
          </div>
          <div>
            <span className="label">Reproducible</span>
            <strong>{status.summary.reproducibleFindings}</strong>
          </div>
          <div>
            <span className="label">Patch</span>
            <strong>{status.summary.status}</strong>
          </div>
          <div>
            <span className="label">Challenger</span>
            <strong>{status.summary.challengerVerdict}</strong>
          </div>
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

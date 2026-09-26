#!/usr/bin/env node
const apiBase = process.env.REPRO_API_URL ?? 'http://localhost:3001';
async function getStatus() {
    const response = await fetch(`${apiBase}/status`);
    if (!response.ok) {
        throw new Error(`status request failed: ${response.status}`);
    }
    const payload = await response.json();
    return payload;
}
async function main() {
    const [command] = process.argv.slice(2);
    if (command === 'status') {
        const status = await getStatus();
        console.log(`Run: ${status.run.id} (${status.run.status})`);
        console.log(`Stage: ${status.run.stage}`);
        console.log(`Findings: ${status.summary.totalFindings}`);
        console.log(`Reproducible: ${status.summary.reproducibleFindings}`);
        console.log(`Patch status: ${status.summary.status}`);
        console.log(`Challenger verdict: ${status.summary.challengerVerdict}`);
        return;
    }
    console.log('Usage: repro status');
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
export {};

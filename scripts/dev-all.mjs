// `npm run dev:all`: the API (with the demo runs loaded), the dashboard, and the marketing site
// in one terminal, each line tagged with where it came from. Ctrl+C stops all three.
// Set REPRO_SEED_DEMO=0 to start the API without the demo runs.
//
// `npm run demo` (`--control-plane`) swaps the API for the full control plane: the API and the
// orchestrator in one process, reading the repo-root .env (GEMINI_API_KEY, MONGODB_URI), so scans
// queued from the dashboard actually run.
import { spawn } from "node:child_process";

const controlPlane = process.argv.includes("--control-plane");

const services = [
  controlPlane
    ? { name: "core", script: "control-plane", colour: 36, env: {} }
    : { name: "api", script: "dev:api", colour: 36, env: { REPRO_SEED_DEMO: process.env.REPRO_SEED_DEMO ?? "1" } },
  { name: "web", script: "dev:web", colour: 33, env: {} },
  { name: "site", script: "dev:site", colour: 35, env: {} },
];

let stopping = false;
const children = services.map(({ name, script, colour, env }) => {
  const tag = `\x1b[${colour}m${name.padEnd(4)}\x1b[0m │ `;
  const child = spawn("npm", ["run", "--silent", script], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  for (const stream of [child.stdout, child.stderr]) {
    let pending = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) process.stdout.write(tag + line + "\n");
    });
  }
  child.on("exit", (code) => {
    if (stopping) return;
    process.stdout.write(`${tag}stopped (exit ${code}); stopping the others\n`);
    stop(code ?? 1);
  });
  return child;
});

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 800);
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

console.log("dashboard  http://localhost:5173");
console.log("site       http://localhost:5174");
console.log("api        http://localhost:4000\n");

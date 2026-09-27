// Repro as a desktop app. Starts the control plane (unless one already answers on :4000), serves
// the built dashboard on a loopback port with /trpc and /auth proxied to it, and opens that in
// Repro's own window. Quitting the app stops the control plane it started.
//
//   REPRO_API_URL  the control plane to use (default http://localhost:4000)
//   REPRO_THEME    light (the default) or dark
const { app, BrowserWindow, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const DIST = path.join(ROOT, "packages/web/dist");
const API = new URL(process.env.REPRO_API_URL ?? "http://localhost:4000");
const DARK = process.env.REPRO_THEME === "dark";
const LOG_DIR = path.join(os.homedir(), ".repro/logs");
const ICON = path.join(__dirname, "icon.png");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".ico": "image/x-icon" };

let controlPlane;
let win;

function apiUp() {
  return new Promise((resolve) => {
    const req = http.get(new URL("/health", API), (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(1500, () => req.destroy());
  });
}

function startControlPlane() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const log = fs.openSync(path.join(LOG_DIR, "control-plane.log"), "a");
  controlPlane = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "--silent", "control-plane"], {
    cwd: ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },
    stdio: ["ignore", log, log],
  });
  controlPlane.on("exit", (code) => {
    controlPlane = undefined;
    if (!app.isQuitting) showMessage("The control plane stopped", `Exit code ${code}. Its log is in ${path.join(LOG_DIR, "control-plane.log")}.`);
  });
}

// The dashboard's static files, with the API routes forwarded so the page talks to one origin.
function serveDashboard() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      if (req.url.startsWith("/trpc/") || req.url.startsWith("/auth/")) {
        const upstream = http.request(new URL(req.url, API), { method: req.method, headers: { ...req.headers, host: API.host } }, (up) => {
          res.writeHead(up.statusCode ?? 502, up.headers);
          up.pipe(res);
        });
        upstream.on("error", () => {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: "the control plane isn't answering" }));
        });
        req.pipe(upstream);
        return;
      }
      const clean = path.normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
      let file = path.join(DIST, clean);
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, "index.html");
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`));
  });
}

function page(title, body) {
  const dark = DARK;
  const html = `<!doctype html><meta charset="utf-8"><title>Repro</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:${dark ? "#121212" : "#ECEAE3"};color:${dark ? "#ECEAE3" : "#1B1B1B"};font:16px ui-monospace,monospace}
main{text-align:center;max-width:52ch}h1{font-size:40px;font-weight:400;margin:0 0 12px}p{opacity:.7;line-height:1.5}
i{display:inline-block;width:8px;height:8px;margin:0 3px;background:currentColor;animation:b 1s infinite}i:nth-child(2){animation-delay:.15s}i:nth-child(3){animation-delay:.3s}
@keyframes b{50%{opacity:.15}}</style><main><h1>${title}</h1>${body}</main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function showMessage(title, text) {
  win?.loadURL(page(title, `<p>${text}</p>`));
}

async function open() {
  win = new BrowserWindow({
    width: 1320,
    height: 880,
    minWidth: 380,
    minHeight: 560,
    title: "Repro",
    icon: ICON,
    backgroundColor: DARK ? "#121212" : "#ECEAE3",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(page("Repro", "<p><i></i><i></i><i></i></p><p>Starting the control plane…</p>"));

  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    showMessage("The dashboard isn't built", "Run <code>npm run build -w @repro/web</code> in the Repro folder, or run the installer again.");
    return;
  }
  const dashboard = await serveDashboard();

  // Anything that leaves the dashboard, Google sign-in included (Google refuses sign-in inside
  // embedded windows), opens in the system browser.
  const external = (url) => !url.startsWith(dashboard) && !url.startsWith("data:");
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (external(url)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (!(await apiUp())) startControlPlane();
  for (let waited = 0; !(await apiUp()); waited += 1) {
    if (!controlPlane && waited > 0) return;
    if (waited === 90) return showMessage("The control plane didn't start", `Its log is in ${path.join(LOG_DIR, "control-plane.log")}.`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  await win.loadURL(`${dashboard}/${DARK ? "?theme=dark" : ""}#/overview`);

  // REPRO_DESKTOP_SCREENSHOT=<file.png>: capture the window once the dashboard has data, then quit
  // (a smoke test that the app really renders).
  const shot = process.env.REPRO_DESKTOP_SCREENSHOT;
  if (shot) {
    await new Promise((r) => setTimeout(r, 5000));
    fs.writeFileSync(shot, (await win.webContents.capturePage()).toPNG());
    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
app.setName("Repro");
app.on("second-instance", () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});
app.whenReady().then(open);
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  app.isQuitting = true;
  controlPlane?.kill("SIGTERM");
});

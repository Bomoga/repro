#!/usr/bin/env node
// JavaScript half of repro-canary: call one exported function with a canary as user input, and
// record where the canary went. Not run directly; repro-canary runs it and judges the result.
//
// Usage: node repro-canary-js.cjs <file> <function> <canary> <report.json>
//
// Sinks recorded: console.* and anything written to stdout/stderr, localStorage/sessionStorage,
// and outbound requests through fetch, http(s).request/get, and navigator.sendBeacon, captured
// with their payload and never sent. Files written are found by repro-canary itself.
"use strict";

const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { pathToFileURL } = require("node:url");

const [FILE, FUNCTION, CANARY, REPORT] = process.argv.slice(2);
const report = { called: false, returned: false, error: null, logs: [], requests: [], storage: [] };

// --- logs --------------------------------------------------------------------------------------------
const text = (args) => args.map((a) => (typeof a === "string" ? a : safeJson(a))).join(" ");
function safeJson(value) {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
for (const level of ["log", "info", "warn", "error", "debug", "trace"]) {
  console[level] = (...args) => report.logs.push(text(args));
}
for (const stream of [process.stdout, process.stderr]) {
  stream.write = (chunk) => {
    report.logs.push(String(chunk));
    return true;
  };
}

// --- outbound requests: capture, never send ----------------------------------------------------------
const bodyText = (body) => {
  if (body == null) return "";
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (ArrayBuffer.isView(body) || body instanceof ArrayBuffer) return Buffer.from(body).toString("utf8");
  return safeJson(body);
};
const hostOf = (url) => {
  try {
    return new URL(String(url)).host;
  } catch {
    return String(url);
  }
};

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url;
  report.requests.push({ host: hostOf(url), url: String(url), payload: bodyText(init.body) });
  throw new TypeError("fetch failed (repro-canary: outbound connection blocked)");
};

function fakeRequest(mod, protocol) {
  return function request(...args) {
    const opts = typeof args[0] === "string" || args[0] instanceof URL ? new URL(String(args[0])) : args[0] || {};
    const entry = { host: opts.host || opts.hostname || "", url: `${protocol}//${opts.hostname || opts.host || ""}${opts.path || opts.pathname || ""}`, payload: "" };
    report.requests.push(entry);
    const req = new EventEmitter();
    req.write = (chunk) => {
      entry.payload += bodyText(chunk);
      return true;
    };
    req.end = (chunk) => {
      if (chunk) entry.payload += bodyText(chunk);
      setImmediate(() => req.emit("error", new Error("repro-canary: outbound connection blocked")));
      return req;
    };
    req.setHeader = req.setTimeout = req.abort = req.destroy = () => req;
    return req;
  };
}
http.request = http.get = fakeRequest(http, "http:");
https.request = https.get = fakeRequest(https, "https:");
// Node 22 defines a getter-only global navigator: extend it rather than replace it.
const sendBeacon = (url, data) => {
  report.requests.push({ host: hostOf(url), url: String(url), payload: bodyText(data) });
  return true;
};
if (globalThis.navigator) Object.defineProperty(globalThis.navigator, "sendBeacon", { value: sendBeacon, configurable: true });
else Object.defineProperty(globalThis, "navigator", { value: { sendBeacon }, configurable: true });

// --- browser storage ---------------------------------------------------------------------------------
function storage(name) {
  const items = new Map();
  return {
    getItem: (k) => (items.has(String(k)) ? items.get(String(k)) : null),
    setItem: (k, v) => {
      items.set(String(k), String(v));
      report.storage.push({ store: name, key: String(k), value: String(v) });
    },
    removeItem: (k) => items.delete(String(k)),
    clear: () => items.clear(),
    key: (i) => [...items.keys()][i] ?? null,
    get length() {
      return items.size;
    },
  };
}
globalThis.localStorage = storage("localStorage");
globalThis.sessionStorage = storage("sessionStorage");
globalThis.window = globalThis.window ?? globalThis;

// --- the call ----------------------------------------------------------------------------------------
const CONVERSATION = /messages|history|conversation|chats|transcript|turns/i;
const USER_CONTENT = /prompt|question|query|input|text|content|body|message|msg|note/i;
const PATHLIKE = /path|file|dest|dir/i;
const IDLIKE = /user|uid|owner|session|account|id$/i;

function paramsOf(fn) {
  const src = Function.prototype.toString.call(fn);
  const m = /^[^(]*\(([^)]*)\)/.exec(src) || /^\s*(?:async\s+)?([\w$]+)\s*=>/.exec(src);
  if (!m) return [];
  return m[1]
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ name: p.replace(/=.*$/s, "").replace(/^\.\.\./, "").trim(), hasDefault: p.includes("=") }));
}

function argumentFor({ name, hasDefault }) {
  if (PATHLIKE.test(name)) {
    fs.mkdirSync("/tmp/repro-canary", { recursive: true });
    return `/tmp/repro-canary/${name}.out`;
  }
  if (CONVERSATION.test(name)) return [{ role: "user", content: CANARY }];
  if (USER_CONTENT.test(name)) return CANARY;
  if (hasDefault) return undefined;
  if (IDLIKE.test(name)) return "repro-canary-user";
  return CANARY;
}

async function main() {
  const timer = setTimeout(() => finish("the call took longer than 20s"), 20_000);
  try {
    const mod = await import(pathToFileURL(path.resolve(FILE)).href);
    const fn = mod[FUNCTION] ?? mod.default?.[FUNCTION] ?? (mod.default && FUNCTION === "default" ? mod.default : undefined);
    if (typeof fn !== "function") throw new Error(`${FILE} doesn't export a function named ${FUNCTION}`);
    const args = paramsOf(fn).map(argumentFor);
    report.called = true;
    await fn(...args);
    report.returned = true;
  } catch (error) {
    report.error = String(error?.stack ?? error).split("\n").slice(0, 3).join(" | ").slice(0, 500);
  }
  clearTimeout(timer);
  // Let fire-and-forget work (an un-awaited analytics call) run before judging.
  await new Promise((resolve) => setTimeout(resolve, 200));
  finish();
}

function finish(timeout) {
  if (timeout && !report.error) report.error = timeout;
  fs.writeFileSync(REPORT, JSON.stringify(report));
  process.exit(0);
}

main();

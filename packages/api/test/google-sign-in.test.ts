import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { googleSignIn, googleSignInStatus, isLoopbackUrl } from "../src/google-sign-in.ts";

function paths() {
  const dir = mkdtempSync(join(tmpdir(), "repro-google-"));
  return { clientSecretFile: join(dir, "client_secret.json"), credentialsFile: join(dir, "adc.json") };
}

const CLIENT = { installed: { client_id: "123-abc.apps.googleusercontent.com", client_secret: "GOCSPX-fake", redirect_uris: ["http://localhost"] } };

describe("googleSignInStatus", () => {
  it("reports nothing signed in and no way to sign in when neither file exists", () => {
    expect(googleSignInStatus({}, paths())).toEqual({ mode: "none", canSignIn: false, signedIn: false, account: null, quotaProject: null });
  });

  it("reads the account and project from the sign-in, never the secret", () => {
    const p = paths();
    writeFileSync(p.clientSecretFile, JSON.stringify(CLIENT));
    writeFileSync(p.credentialsFile, JSON.stringify({ account: "dev@example.com", type: "authorized_user", refresh_token: "1//secret", client_id: "x", client_secret: "y" }));
    const status = googleSignInStatus({ REPRO_GEMINI_AUTH: "google", REPRO_GEMINI_QUOTA_PROJECT: "repro-demo-123" }, p);
    expect(status).toEqual({ mode: "google", canSignIn: true, signedIn: true, account: "dev@example.com", quotaProject: "repro-demo-123" });
    expect(JSON.stringify(status)).not.toContain("secret");
  });

  it("knows a sign-in without a recorded account, and a key-based setup", () => {
    const p = paths();
    writeFileSync(p.credentialsFile, JSON.stringify({ type: "authorized_user", refresh_token: "1//x" }));
    expect(googleSignInStatus({ GEMINI_API_KEY: "k" }, p)).toMatchObject({ mode: "api-key", signedIn: true, account: null });
  });
});

describe("isLoopbackUrl", () => {
  it("only lets a sign-in return to this machine", () => {
    expect(isLoopbackUrl("http://localhost:5173/#/overview")).toBe(true);
    expect(isLoopbackUrl("http://127.0.0.1:4000/")).toBe(true);
    for (const url of ["https://localhost:5173/", "http://localhost.evil.test/", "http://evil.test/?localhost", "javascript:alert(1)", "not a url"]) {
      expect(isLoopbackUrl(url)).toBe(false);
    }
  });
});

describe("the sign-in routes", () => {
  function app() {
    const p = paths();
    writeFileSync(p.clientSecretFile, JSON.stringify(CLIENT));
    const server = Fastify();
    server.register(googleSignIn({}, p));
    return server;
  }

  it("sends a local browser to Google's consent screen with the Gemini and email scopes", async () => {
    const res = await app().inject({ method: "GET", url: "/auth/google/start?return=http://localhost:5173/", headers: { host: "localhost:4000" } });
    expect(res.statusCode).toBe(302);
    const target = new URL(res.headers.location as string);
    expect(target.host).toBe("accounts.google.com");
    expect(target.searchParams.get("redirect_uri")).toBe("http://localhost:4000/auth/google/callback");
    expect(target.searchParams.get("scope")).toContain("cloud-platform");
    expect(target.searchParams.get("scope")).toContain("userinfo.email");
    expect(target.searchParams.get("state")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("refuses a sign-in from another machine, and a callback nobody started", async () => {
    const server = app();
    const remote = await server.inject({ method: "GET", url: "/auth/google/start", headers: { host: "localhost:4000" }, remoteAddress: "10.0.0.5" });
    expect(remote.statusCode).toBe(403);
    const forged = await server.inject({ method: "GET", url: "/auth/google/callback?code=abc&state=deadbeef", headers: { host: "localhost:4000" } });
    expect(forged.statusCode).toBe(400);
  });
});

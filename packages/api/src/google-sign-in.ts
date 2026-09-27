import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { OAuth2Client } from "google-auth-library";

// The Gemini wrapper's scopes (GOOGLE_SIGN_IN_SCOPES in @repro/agents) plus openid and email, so
// the dashboard can show which Google account the control plane's Gemini requests run as.
export const GOOGLE_SIGN_IN_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/generative-language.retriever",
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
];

export interface GoogleSignInStatus {
  /** How the control plane's Gemini requests authenticate: REPRO_GEMINI_AUTH=google, a key, or neither. */
  mode: "google" | "api-key" | "none";
  /** An OAuth client file is there, so the dashboard can offer the sign-in. */
  canSignIn: boolean;
  signedIn: boolean;
  /** The signed-in Google account, when the sign-in recorded it. */
  account: string | null;
  quotaProject: string | null;
}

export interface GoogleSignInPaths {
  /** The Desktop OAuth client's client_secret.json. */
  clientSecretFile: string;
  /** Application Default Credentials: where Google's auth library, and so the Gemini wrapper, reads the sign-in. */
  credentialsFile: string;
}

export function googleSignInPaths(env: NodeJS.ProcessEnv = process.env): GoogleSignInPaths {
  const home = env.HOME || homedir();
  return {
    clientSecretFile: env.REPRO_GOOGLE_CLIENT_SECRET_FILE || join(home, ".config", "repro", "client_secret.json"),
    credentialsFile:
      env.GOOGLE_APPLICATION_CREDENTIALS || join(env.CLOUDSDK_CONFIG || join(home, ".config", "gcloud"), "application_default_credentials.json"),
  };
}

function readJson(file: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** What the header shows. Reads files only; never the network, never a secret's value. */
export function googleSignInStatus(env: NodeJS.ProcessEnv = process.env, paths: GoogleSignInPaths = googleSignInPaths(env)): GoogleSignInStatus {
  const credentials = readJson(paths.credentialsFile);
  const signedIn = credentials?.type === "authorized_user" && typeof credentials.refresh_token === "string";
  const account = signedIn && typeof credentials.account === "string" && credentials.account ? credentials.account : null;
  return {
    mode: env.REPRO_GEMINI_AUTH?.trim() === "google" ? "google" : env.GEMINI_API_KEY ? "api-key" : "none",
    canSignIn: existsSync(paths.clientSecretFile),
    signedIn,
    account,
    quotaProject: env.REPRO_GEMINI_QUOTA_PROJECT?.trim() || null,
  };
}

const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** A plain-http URL on this machine: the only place a finished sign-in may send the browser back to. */
export function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && LOOPBACK_HOST.test(url.host);
  } catch {
    return false;
  }
}

// A sign-in replaces the control plane's Google credentials, so only a browser on this machine may
// run one, even when the API listens on every interface.
function fromThisMachine(request: FastifyRequest): boolean {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(request.ip) && LOOPBACK_HOST.test(request.headers.host ?? "");
}

function readClient(paths: GoogleSignInPaths): { clientId: string; clientSecret: string } | undefined {
  const file = readJson(paths.clientSecretFile);
  const client = (file?.installed ?? file?.web) as { client_id?: unknown; client_secret?: unknown } | undefined;
  if (typeof client?.client_id !== "string" || typeof client.client_secret !== "string") return undefined;
  return { clientId: client.client_id, clientSecret: client.client_secret };
}

const DEFAULT_RETURN = "http://localhost:5173/#/overview";
const PENDING_TTL_MS = 10 * 60_000;

/**
 * GET /auth/google/start sends the browser to Google's consent screen; /auth/google/callback
 * trades the code for a refresh token and writes it as Application Default Credentials (type
 * authorized_user, with the account's email), the same file `gcloud auth application-default login`
 * writes. Runs started afterwards use the new sign-in. Each start gets a one-time state, so a
 * callback nobody started here is refused.
 */
export function googleSignIn(env: NodeJS.ProcessEnv = process.env, paths: GoogleSignInPaths = googleSignInPaths(env)) {
  const pending = new Map<string, { returnTo: string; at: number }>();
  const clientFor = (request: FastifyRequest) => {
    const client = readClient(paths);
    return client && { ...client, oauth: new OAuth2Client(client.clientId, client.clientSecret, `http://${request.headers.host}/auth/google/callback`) };
  };

  return async (app: FastifyInstance) => {
    app.get("/auth/google/start", async (request, reply) => {
      if (!fromThisMachine(request)) return reply.code(403).send({ error: "Google sign-in only works from the machine the control plane runs on" });
      const client = clientFor(request);
      if (!client) return reply.code(404).send({ error: `no OAuth client file at ${paths.clientSecretFile}` });
      const requested = (request.query as { return?: string }).return;
      const now = Date.now();
      for (const [key, entry] of pending) if (now - entry.at > PENDING_TTL_MS) pending.delete(key);
      const state = randomBytes(16).toString("hex");
      pending.set(state, { returnTo: requested && isLoopbackUrl(requested) ? requested : DEFAULT_RETURN, at: now });
      return reply.redirect(client.oauth.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: GOOGLE_SIGN_IN_SCOPES, state }));
    });

    app.get("/auth/google/callback", async (request, reply) => {
      if (!fromThisMachine(request)) return reply.code(403).send({ error: "Google sign-in only works from the machine the control plane runs on" });
      const query = request.query as { code?: string; state?: string; error?: string };
      const entry = query.state ? pending.get(query.state) : undefined;
      if (!query.state || !entry) return reply.code(400).send({ error: "unknown or expired sign-in: start it again from the dashboard" });
      pending.delete(query.state);
      // Cancelled on Google's screen: back to the dashboard, credentials untouched.
      if (query.error || !query.code) return reply.redirect(entry.returnTo);

      const client = clientFor(request);
      if (!client) return reply.code(404).send({ error: `no OAuth client file at ${paths.clientSecretFile}` });
      const { tokens } = await client.oauth.getToken(query.code);
      if (!tokens.refresh_token) return reply.code(502).send({ error: "Google returned no refresh token; start the sign-in again" });
      let account = "";
      if (tokens.id_token) {
        const ticket = await client.oauth.verifyIdToken({ idToken: tokens.id_token, audience: client.clientId });
        account = ticket.getPayload()?.email ?? "";
      }
      const quotaProject = env.REPRO_GEMINI_QUOTA_PROJECT?.trim();
      mkdirSync(dirname(paths.credentialsFile), { recursive: true });
      writeFileSync(
        paths.credentialsFile,
        JSON.stringify(
          {
            account,
            client_id: client.clientId,
            client_secret: client.clientSecret,
            refresh_token: tokens.refresh_token,
            type: "authorized_user",
            ...(quotaProject ? { quota_project_id: quotaProject } : {}),
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      chmodSync(paths.credentialsFile, 0o600);
      return reply.redirect(entry.returnTo);
    });
  };
}

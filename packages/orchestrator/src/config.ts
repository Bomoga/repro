import { statSync } from "node:fs";
import * as path from "node:path";
import { GOOGLE_SIGN_IN_COMMAND, geminiAuthFromEnv, googleSignIn } from "@repro/agents";

/** A positive integer setting from the environment; undefined when unset or blank. Anything else is a startup error. */
export function positiveIntegerFromEnv(name: string, env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env[name]?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw) || Number(raw) < 1 || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`${name} must be a positive integer, got "${raw}"`);
  }
  return Number(raw);
}

/** How the control plane's Gemini requests authenticate: where the credential comes from, never the credential. */
export type GeminiStartup = { auth: "none" } | { auth: "api-key" } | { auth: "google"; quotaProject: string; credentialsFile: string };

/**
 * Gemini's auth settings, checked before anything starts. With nothing configured (no
 * REPRO_GEMINI_AUTH and no GEMINI_API_KEY) the model stages are off and Runs stop after
 * reproduction. With an API key chosen explicitly, GEMINI_API_KEY must be set. With Google sign-in (REPRO_GEMINI_AUTH=google), the
 * wrapper's own checks, and a credentials file where Google's auth library will look for one:
 * checked for, never opened.
 */
export function geminiAtStartup(
  env: NodeJS.ProcessEnv = process.env,
  isFile: (file: string) => boolean = fileExists,
  platform: NodeJS.Platform = process.platform,
): GeminiStartup {
  if (!env.GEMINI_API_KEY && !env.REPRO_GEMINI_AUTH?.trim()) return { auth: "none" };
  const auth = geminiAuthFromEnv(env);
  if (auth === "api-key") {
    if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not set; Diagnose, Repair, and the Challenger need it.");
    return { auth };
  }
  const { quotaProject } = googleSignIn(env);
  const credentialsFile = applicationDefaultCredentials(env, platform);
  if (!credentialsFile) {
    throw new Error("REPRO_GEMINI_AUTH=google, but there's no APPDATA or HOME to find gcloud's credentials under: set GOOGLE_APPLICATION_CREDENTIALS");
  }
  if (!isFile(credentialsFile)) {
    throw new Error(
      env.GOOGLE_APPLICATION_CREDENTIALS
        ? `GOOGLE_APPLICATION_CREDENTIALS names ${credentialsFile}, which isn't a file`
        : `REPRO_GEMINI_AUTH=google, but there are no Application Default Credentials at ${credentialsFile}. Sign in: ${GOOGLE_SIGN_IN_COMMAND}`,
    );
  }
  return { auth, quotaProject, credentialsFile };
}

/**
 * Where Google's auth library looks for Application Default Credentials, in its order: the file
 * GOOGLE_APPLICATION_CREDENTIALS names, else the one `gcloud auth application-default login`
 * writes, under CLOUDSDK_CONFIG when that's set.
 */
export function applicationDefaultCredentials(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  if (env.GOOGLE_APPLICATION_CREDENTIALS) return env.GOOGLE_APPLICATION_CREDENTIALS;
  const { join } = platform === "win32" ? path.win32 : path.posix;
  const home = platform === "win32" ? env.APPDATA : env.HOME;
  const configDir = env.CLOUDSDK_CONFIG || (home && (platform === "win32" ? join(home, "gcloud") : join(home, ".config", "gcloud")));
  return configDir ? join(configDir, "application_default_credentials.json") : undefined;
}

/** The startup line saying how Gemini requests authenticate, and who pays for them under Google sign-in. */
export function geminiStartupLine(gemini: GeminiStartup): string {
  if (gemini.auth === "none") {
    return "no Gemini auth configured: runs stop after reproduction (set GEMINI_API_KEY, or REPRO_GEMINI_AUTH=google, for Diagnose, Repair, and the Challenger)";
  }
  return gemini.auth === "api-key"
    ? "gemini requests use GEMINI_API_KEY (REPRO_GEMINI_AUTH=google signs in with Google instead)"
    : `gemini requests use the Google sign-in in ${gemini.credentialsFile}, billed to project ${gemini.quotaProject}`;
}

function fileExists(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

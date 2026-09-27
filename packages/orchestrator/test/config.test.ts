import { describe, expect, it, vi } from "vitest";
import { applicationDefaultCredentials, geminiAtStartup, geminiStartupLine, positiveIntegerFromEnv } from "../src/config.ts";

describe("positiveIntegerFromEnv", () => {
  it("reads a positive integer, and nothing from an unset or blank variable", () => {
    expect(positiveIntegerFromEnv("REPRO_PRO_REQUEST_BUDGET", { REPRO_PRO_REQUEST_BUDGET: " 220 " })).toBe(220);
    expect(positiveIntegerFromEnv("REPRO_PRO_REQUEST_BUDGET", {})).toBeUndefined();
    expect(positiveIntegerFromEnv("REPRO_PRO_REQUEST_BUDGET", { REPRO_PRO_REQUEST_BUDGET: "  " })).toBeUndefined();
  });

  it.each(["0", "-1", "1.5", "abc", "20x", "99999999999999999999"])("refuses %s at startup instead of guessing", (value) => {
    expect(() => positiveIntegerFromEnv("REPRO_PRO_REQUEST_BUDGET", { REPRO_PRO_REQUEST_BUDGET: value })).toThrow(
      `REPRO_PRO_REQUEST_BUDGET must be a positive integer, got "${value}"`,
    );
  });
});

describe("geminiAtStartup", () => {
  const APPDATA = "C:\\Users\\op\\AppData\\Roaming";
  const WINDOWS_ADC = `${APPDATA}\\gcloud\\application_default_credentials.json`;
  const SIGN_IN = { REPRO_GEMINI_AUTH: "google", REPRO_GEMINI_QUOTA_PROJECT: "repro-demo-123", APPDATA };
  const KEY = "AIzaSyFAKE-startup-key-000000000000000000";

  it("requires GEMINI_API_KEY with an API key, as always", () => {
    expect(geminiAtStartup({ GEMINI_API_KEY: KEY })).toEqual({ auth: "api-key" });
    expect(geminiAtStartup({ GEMINI_API_KEY: KEY, REPRO_GEMINI_AUTH: "api-key" })).toEqual({ auth: "api-key" });
    expect(() => geminiAtStartup({ REPRO_GEMINI_AUTH: "api-key" })).toThrow("GEMINI_API_KEY is not set; Diagnose, Repair, and the Challenger need it.");
  });

  it("turns the model stages off when no Gemini auth is configured at all", () => {
    expect(geminiAtStartup({})).toEqual({ auth: "none" });
    expect(geminiStartupLine({ auth: "none" })).toContain("runs stop after reproduction");
  });

  it("refuses an unknown REPRO_GEMINI_AUTH instead of guessing", () => {
    expect(() => geminiAtStartup({ REPRO_GEMINI_AUTH: "googel", GEMINI_API_KEY: KEY })).toThrow(
      'REPRO_GEMINI_AUTH must be "api-key" or "google", got "googel"',
    );
  });

  it("finds the Google sign-in where gcloud writes it, and only checks the file is there", () => {
    const isFile = vi.fn((file: string) => file === WINDOWS_ADC);
    expect(geminiAtStartup(SIGN_IN, isFile, "win32")).toEqual({ auth: "google", quotaProject: "repro-demo-123", credentialsFile: WINDOWS_ADC });
    expect(isFile.mock.calls).toEqual([[WINDOWS_ADC]]);
  });

  it.each<[string, NodeJS.ProcessEnv, NodeJS.Platform, string]>([
    ["gcloud's file on Windows", { APPDATA }, "win32", WINDOWS_ADC],
    ["gcloud's file elsewhere", { HOME: "/home/op" }, "linux", "/home/op/.config/gcloud/application_default_credentials.json"],
    ["gcloud's file under CLOUDSDK_CONFIG", { CLOUDSDK_CONFIG: "/srv/gcloud", HOME: "/home/op" }, "linux", "/srv/gcloud/application_default_credentials.json"],
    ["the file GOOGLE_APPLICATION_CREDENTIALS names", { GOOGLE_APPLICATION_CREDENTIALS: "/keys/repro.json", HOME: "/home/op" }, "darwin", "/keys/repro.json"],
  ])("looks where Google's auth library does: %s", (_, env, platform, file) => {
    expect(applicationDefaultCredentials(env, platform)).toBe(file);
  });

  it("refuses to start without the credentials, naming where it looked and the sign-in to run", () => {
    expect(() => geminiAtStartup(SIGN_IN, () => false, "win32")).toThrow(
      `REPRO_GEMINI_AUTH=google, but there are no Application Default Credentials at ${WINDOWS_ADC}. Sign in: gcloud auth application-default login --client-id-file=client_secret.json --scopes='https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/generative-language.retriever'`,
    );
    expect(() => geminiAtStartup({ ...SIGN_IN, GOOGLE_APPLICATION_CREDENTIALS: "C:\\keys\\gone.json" }, () => false, "win32")).toThrow(
      "GOOGLE_APPLICATION_CREDENTIALS names C:\\keys\\gone.json, which isn't a file",
    );
    const { APPDATA: _, ...nowhere } = SIGN_IN;
    expect(() => geminiAtStartup(nowhere, () => true, "win32")).toThrow("set GOOGLE_APPLICATION_CREDENTIALS");
  });

  it.each<[NodeJS.ProcessEnv, string]>([
    [{ GEMINI_API_KEY: KEY }, "GEMINI_API_KEY is set too"],
    [{ GOOGLE_API_KEY: KEY }, "GOOGLE_API_KEY is set too"],
    [{ REPRO_GEMINI_QUOTA_PROJECT: " " }, "needs REPRO_GEMINI_QUOTA_PROJECT"],
    [{ REPRO_GEMINI_QUOTA_PROJECT: "My Project" }, "must be a Google Cloud project ID"],
    [{ GOOGLE_GENAI_DEBUG: "1" }, "GOOGLE_GENAI_DEBUG is set"],
  ])("refuses what the wrapper would refuse, before looking for the file (%j)", (overrides, says) => {
    const isFile = vi.fn(() => true);
    let message = "";
    try {
      geminiAtStartup({ ...SIGN_IN, ...overrides }, isFile, "win32");
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain(says);
    expect(message).not.toContain(KEY);
    expect(isFile).not.toHaveBeenCalled();
  });

  it("says how requests authenticate, and under the sign-in who pays, never a credential", () => {
    const withKey = geminiStartupLine(geminiAtStartup({ GEMINI_API_KEY: KEY }));
    expect(withKey).toBe("gemini requests use GEMINI_API_KEY (REPRO_GEMINI_AUTH=google signs in with Google instead)");
    expect(withKey).not.toContain(KEY);
    expect(geminiStartupLine(geminiAtStartup(SIGN_IN, () => true, "win32"))).toBe(
      `gemini requests use the Google sign-in in ${WINDOWS_ADC}, billed to project repro-demo-123`,
    );
  });
});

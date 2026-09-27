import type { GoogleSignInStatus } from "@repro/api";
import { googleSignInUrl } from "../api.ts";
import type { Poll } from "../lib/poll.ts";

const MODE_NOTE: Record<GoogleSignInStatus["mode"], string> = {
  google: "Diagnose, Repair, and the Challenger run on Gemini as this account",
  "api-key": "Signed in, but the control plane uses GEMINI_API_KEY; set REPRO_GEMINI_AUTH=google to use this account",
  none: "Signed in, but Gemini is off: set REPRO_GEMINI_AUTH=google and restart the control plane to use this account",
};

/** The Google account the control plane's Gemini requests run as, or the button to sign one in. */
export function GoogleAccount({ status }: { status: Poll<GoogleSignInStatus> }) {
  const s = status.data;
  if (!s || (!s.canSignIn && !s.signedIn)) return null;

  if (s.signedIn && s.account) {
    const billed = s.quotaProject ? `, billed to ${s.quotaProject}` : "";
    return (
      <span className="account" title={`${MODE_NOTE[s.mode]}${billed}.`}>
        <span className="account__mark" aria-hidden="true">
          G
        </span>
        <span className="account__email">{s.account}</span>
        {s.canSignIn && (
          <a className="account__switch" href={googleSignInUrl()}>
            Switch
          </a>
        )}
      </span>
    );
  }

  return (
    <a
      className="account account__signin"
      href={googleSignInUrl()}
      title={
        s.signedIn
          ? "Signed in, but this sign-in didn't record which account; sign in again to show it"
          : "Sign the control plane in to Google so Diagnose, Repair, and the Challenger can use Gemini"
      }
    >
      <span className="account__mark" aria-hidden="true">
        G
      </span>
      Sign in with Google
    </a>
  );
}

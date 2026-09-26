import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { recordPullRequestClosed } from "./pull-requests.ts";
import type { RunStore } from "./store/index.ts";

/** True when `signature` (GitHub's X-Hub-Signature-256 header) is the HMAC-SHA256 of `body` under `secret`. */
export function validGitHubSignature(secret: string, body: Buffer, signature: string | undefined): boolean {
  if (!signature?.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * POST /github/webhook: GitHub's `pull_request` events from the target repos, so a person merging
 * or closing a repair PR settles its Patch. Every delivery must be signed with the webhook's
 * secret: the rest of the API is unauthenticated, and an unsigned "merged" would put a false record
 * in the Run Store.
 */
export function githubWebhook(store: RunStore, secret: string) {
  return async (app: FastifyInstance) => {
    // The signature covers the exact bytes GitHub sent, so this route reads them unparsed.
    app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => done(null, body));

    app.post("/github/webhook", async (request, reply) => {
      const signature = request.headers["x-hub-signature-256"];
      if (!Buffer.isBuffer(request.body) || !validGitHubSignature(secret, request.body, typeof signature === "string" ? signature : undefined)) {
        return reply.code(401).send({ error: "missing or invalid X-Hub-Signature-256" });
      }
      const event = request.headers["x-github-event"];
      if (event === "ping") return { ok: true };
      if (event !== "pull_request") return reply.code(202).send({ ignored: String(event ?? "no event") });

      const payload = JSON.parse(request.body.toString("utf8")) as { action?: string; pull_request?: { html_url?: unknown; merged?: unknown } };
      const url = payload.pull_request?.html_url;
      if (payload.action !== "closed" || typeof url !== "string") return reply.code(202).send({ ignored: String(payload.action ?? "no action") });
      return { outcome: await recordPullRequestClosed(store, { url, merged: payload.pull_request?.merged === true, source: "webhook" }) };
    });
  };
}

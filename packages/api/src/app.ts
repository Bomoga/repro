import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin, type FastifyTRPCPluginOptions } from "@trpc/server/adapters/fastify";
import { appRouter, type AppRouter } from "./router.ts";
import { checkHealth } from "./health.ts";
import { githubWebhook } from "./github-webhook.ts";
import type { Context } from "./trpc.ts";
import type { RunStore } from "./store/index.ts";

export interface BuildAppOptions {
  /** Fastify request logging; off by default so tests stay quiet. */
  logger?: boolean;
  /** GitHub's webhook secret. When set, POST /github/webhook settles repair PRs merged or closed on GitHub. */
  githubWebhookSecret?: string;
}

/** The Control Plane API: GET /health plus the tRPC router under /trpc, and GitHub's webhook when a
 *  secret is given. The caller owns the store. */
export function buildApp(store: RunStore, options: BuildAppOptions = {}): FastifyInstance {
  // Batched tRPC GETs put every procedure name in one path segment, past Fastify's 100-char default.
  const app = Fastify({ logger: options.logger ?? false, routerOptions: { maxParamLength: 5000 } });

  app.register(cors, { origin: true });

  // Plain HTTP for load balancers and tunnels: 200 when the Run Store answers, 503 when it doesn't.
  app.get("/health", async (_request, reply) => {
    const health = await checkHealth(store);
    return reply.code(health.status === "ok" ? 200 : 503).send(health);
  });

  app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext: (): Context => ({ store }),
    },
  } satisfies FastifyTRPCPluginOptions<AppRouter>);

  if (options.githubWebhookSecret) app.register(githubWebhook(store, options.githubWebhookSecret));

  return app;
}

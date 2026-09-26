import Fastify, { type FastifyInstance } from "fastify";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./router/index.js";
import type { RunStore } from "./run-store/store.js";

export interface BuildAppOptions {
  store: RunStore;
  logger?: boolean;
}

/** Builds the Fastify app without calling `listen`, so tests can use `app.inject`. */
export function buildApp(options: BuildAppOptions): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

  app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext: () => ({ store: options.store }),
    },
  });

  return app;
}

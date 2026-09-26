import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify";
import { appRouter } from "./router.ts";
import type { Context } from "./trpc.ts";
import type { RunStore } from "./store.ts";

export function buildApp(store: RunStore): FastifyInstance {
  const app = Fastify({ logger: true });

  app.register(cors, { origin: true });

  app.get("/health", async () => ({ status: "ok", time: new Date().toISOString() }));

  app.register(fastifyTRPCPlugin, {
    prefix: "/trpc",
    trpcOptions: {
      router: appRouter,
      createContext: (): Context => ({ store }),
    },
  });

  return app;
}

import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import { createRouter } from "./trpc";
import { InMemoryRunStore } from "./store";
import { v4 as uuidv4 } from "crypto";

const PORT = parseInt(process.env.PORT || "3000", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  const fastify = Fastify({ logger: true });
  const store = new InMemoryRunStore();

  // Register CORS
  await fastify.register(fastifyCors, {
    origin: true,
  });

  // Create router
  const router = createRouter(store);

  // Register HTTP routes
  fastify.get("/api/health", async (request, reply) => {
    return { status: "ok", timestamp: new Date().toISOString() };
  });

  // tRPC routes (simple implementation)
  fastify.post<{ Body: any }>("/api/trpc/:procedure", async (request, reply) => {
    const { procedure } = request.params;
    const input = request.body;
    
    try {
      // Create context
      const ctx = { store };
      
      // Call the router procedure dynamically
      const route = (router as any)[procedure];
      if (!route) {
        reply.code(404).send({ error: `Procedure ${procedure} not found` });
        return;
      }

      // For simple cases, call the handler
      if (route.query) {
        const result = await route.query({ input, ctx });
        reply.send(result);
      } else if (route.mutation) {
        const result = await route.mutation({ input, ctx });
        reply.send(result);
      }
    } catch (err) {
      reply.code(500).send({ error: String(err) });
    }
  });

  // Health check
  fastify.get("/health", async () => {
    return { status: "ok" };
  });

  try {
    await fastify.listen({ port: PORT, host: HOST });
    console.log(`Server running at http://${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}

main();

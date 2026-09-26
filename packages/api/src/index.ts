import Fastify from 'fastify';
import { fastifyTRPCPlugin } from '@trpc/server/adapters/fastify';
import { connectMongo, mongoRepository } from './store.js';
import { createRouter } from './trpc.js';

export type { AppRouter } from './trpc.js';

export function createApp(repository = mongoRepository) {
  const app = Fastify({ logger: true });
  const router = createRouter(repository);

  app.get('/health', async () => ({ ok: true }));
  app.register(fastifyTRPCPlugin, {
    prefix: '/trpc',
    trpcOptions: { router, createContext: () => ({}) }
  });

  return app;
}

const start = async () => {
  await connectMongo();
  const app = createApp();
  const port = Number(process.env.PORT || 3001);
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info(`Repro API listening on http://localhost:${port}`);
};

if (process.env.NODE_ENV !== 'test') {
  start().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

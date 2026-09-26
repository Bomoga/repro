import { createTRPCClient, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@repro/api/router";

export type ReproClient = ReturnType<typeof createTRPCClient<AppRouter>>;

export function createClient(baseUrl = process.env.REPRO_API_URL ?? "http://localhost:4000"): ReproClient {
  return createTRPCClient<AppRouter>({
    links: [httpBatchLink({ url: `${baseUrl.replace(/\/$/, "")}/trpc` })],
  });
}

import { createTRPCClient, httpLink, TRPCClientError, type TRPCClient } from "@trpc/client";
import type { AppRouter } from "@repro/api";

// The CLI talks to the Control Plane API through tRPC's own client, typed against @repro/api's
// AppRouter (a type-only import: none of the server's code loads here). A procedure the API
// renames or reshapes is a compile error in this package, not a surprise on stage.

export type ApiClient = TRPCClient<AppRouter>;

export const DEFAULT_API_URL = "http://localhost:4000";

export function createApiClient(apiUrl: string): ApiClient {
  return createTRPCClient<AppRouter>({ links: [httpLink({ url: `${apiUrl.replace(/\/+$/, "")}/trpc` })] });
}

/** The tRPC error code (NOT_FOUND, BAD_REQUEST, CONFLICT, ...) when the API answered with one. */
export function apiErrorCode(error: unknown): string | undefined {
  return error instanceof TRPCClientError ? (error.data as { code?: string } | undefined)?.code : undefined;
}

/** True when the request never got a tRPC answer: API down, wrong URL, a proxy's error page. */
export function isUnreachable(error: unknown): boolean {
  return error instanceof TRPCClientError && apiErrorCode(error) === undefined;
}

/** One line a person can act on. */
export function describeError(error: unknown, apiUrl: string): string {
  if (isUnreachable(error)) {
    const cause = (error as TRPCClientError<AppRouter>).cause;
    const detail = cause?.cause instanceof Error ? cause.cause.message : cause?.message ?? (error as Error).message;
    return (
      `can't reach the Repro API at ${apiUrl} (${detail}). ` +
      "Start it with `npm run dev:api`, or point --api / REPRO_API_URL at a running one."
    );
  }
  return error instanceof Error ? error.message : String(error);
}

// Connecting to the Run Store: one shared MongoDB Atlas cluster (CLAUDE.md section 10), reached
// through MONGODB_URI. The URI is a runtime secret (section 9): it is read from the environment,
// never logged, and every message this file writes shows only the redacted form.
//
// Each store gets its own mongoose Connection (mongoose.createConnection), never mongoose's
// global default connection, so models registered here can't collide with anything else in the
// same process that also uses mongoose.
import mongoose, { type Connection } from "mongoose";
import { StoreError } from "./errors.js";

export interface StoreConnectOptions {
  /** Defaults to the MONGODB_URI environment variable. */
  uri?: string;
  /** Defaults to REPRO_MONGODB_DB, then the database named in the URI's path, then "repro". */
  dbName?: string;
  /** Let mongoose build this package's indexes when the models first load. Default true. */
  autoIndex?: boolean;
  /** How long to wait for a reachable server before failing. Default 10s. */
  serverSelectionTimeoutMS?: number;
  /** Connections per process. Default 10, far under an Atlas free-tier cluster's connection cap. */
  maxPoolSize?: number;
  /** Shows up in Atlas's connection metrics. Default "repro". */
  appName?: string;
  /** Receives connection state changes. The URI never appears in these messages. */
  log?: (message: string) => void;
}

export interface ConnectionSettings {
  uri: string;
  dbName: string;
}

export const DEFAULT_DB_NAME = "repro";

export class MissingMongoUriError extends StoreError {
  constructor() {
    super("MONGODB_URI is not set. Lane 1 hands out the shared Atlas connection string; see ENVIRONMENT.md.");
  }
}

export class StoreConnectionError extends StoreError {
  constructor(message: string, options: { cause: unknown }) {
    super(message);
    this.cause = options.cause;
  }
}

/** Works out which URI and database a store connects to, from options first, then the environment. */
export function resolveConnectionSettings(
  options: Pick<StoreConnectOptions, "uri" | "dbName"> = {},
  env: NodeJS.ProcessEnv = process.env,
): ConnectionSettings {
  const uri = (options.uri ?? env.MONGODB_URI ?? "").trim();
  if (!uri) throw new MissingMongoUriError();
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    throw new StoreError(`MONGODB_URI must start with mongodb:// or mongodb+srv:// (got ${redactMongoUri(uri)})`);
  }
  const dbName = options.dbName ?? (env.REPRO_MONGODB_DB?.trim() || undefined) ?? databaseFromUri(uri) ?? DEFAULT_DB_NAME;
  return { uri, dbName };
}

/** The database named in a connection string's path, if any: `.../repro?retryWrites=true` gives "repro". */
export function databaseFromUri(uri: string): string | undefined {
  const rest = uri.slice(uri.indexOf("://") + 3);
  const slash = rest.indexOf("/");
  if (slash < 0) return undefined;
  const name = rest.slice(slash + 1).split("?")[0] ?? "";
  return name ? decodeURIComponent(name) : undefined;
}

/**
 * A connection string that is safe to print: scheme, user, hosts, and database. The password and
 * the whole query string are dropped, since options such as authMechanismProperties can carry
 * credentials too.
 */
export function redactMongoUri(uri: string): string {
  const schemeEnd = uri.indexOf("://");
  if (schemeEnd < 0) return "<unparseable connection string>";
  const scheme = uri.slice(0, schemeEnd + 3);
  const rest = uri.slice(schemeEnd + 3).split("?")[0] ?? "";
  const slash = rest.indexOf("/");
  let authority = slash < 0 ? rest : rest.slice(0, slash);
  const path = slash < 0 ? "" : rest.slice(slash);
  const at = authority.lastIndexOf("@");
  if (at >= 0) authority = `${authority.slice(0, at).split(":")[0]}:***@${authority.slice(at + 1)}`;
  return scheme + authority + path;
}

/** Opens a dedicated connection and waits until it can reach a server. */
export async function openConnection(options: StoreConnectOptions = {}): Promise<Connection> {
  const { uri, dbName } = resolveConnectionSettings(options);
  const where = `${redactMongoUri(uri)} (db ${dbName})`;
  const log = options.log ?? (() => {});

  const connection = mongoose.createConnection(uri, {
    dbName,
    appName: options.appName ?? "repro",
    autoIndex: options.autoIndex ?? true,
    maxPoolSize: options.maxPoolSize ?? 10,
    serverSelectionTimeoutMS: options.serverSelectionTimeoutMS ?? 10_000,
  });
  connection.on("connected", () => log(`run store connected: ${where}`));
  connection.on("disconnected", () => log(`run store disconnected: ${where}`));
  connection.on("reconnected", () => log(`run store reconnected: ${where}`));
  connection.on("error", (error: Error) => log(`run store error: ${error.name}`));

  try {
    await connection.asPromise();
  } catch (error) {
    await connection.close().catch(() => {});
    throw new StoreConnectionError(`could not connect to the run store at ${where}. ${connectionHint(error)}`, {
      cause: error,
    });
  }
  return connection;
}

/** The likeliest fix for a failed connection, in one sentence. */
export function connectionHint(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  if (/querySrv|_mongodb\._tcp/i.test(text)) {
    return "This network can't resolve the mongodb+srv DNS record; use Atlas's standard mongodb:// connection string instead.";
  }
  if (/bad auth|authentication failed|auth.*fail/i.test(text)) {
    return "Atlas rejected the username or password; check the database user, and URL-encode special characters in the password.";
  }
  if (/ServerSelection|timed out|ECONNREFUSED|ETIMEDOUT/i.test(text)) {
    return "No server answered; check that this machine's IP is on the cluster's Atlas Network Access list.";
  }
  return "See the MongoDB troubleshooting notes in ENVIRONMENT.md.";
}

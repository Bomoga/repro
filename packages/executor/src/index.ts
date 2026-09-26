import { homedir } from "node:os";
import { join } from "node:path";

export * from "./docker-executor.ts";

// Where ingested workspaces live on the host. Under $HOME by default because Docker Desktop and
// Colima on macOS only share the home directory with the VM, so a workspace under the system
// temp dir can't be bind-mounted into the sandbox.
export const DEFAULT_WORKSPACES_ROOT = process.env.REPRO_WORKSPACES_DIR ?? join(homedir(), ".repro", "workspaces");

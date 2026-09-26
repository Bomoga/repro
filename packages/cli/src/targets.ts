import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Run } from "@repro/contracts";

// Turns what a person types after `repro scan` into a Run target. Local paths are made absolute
// here, because the API host would otherwise resolve them against its own working directory.
// The API re-checks every target with ingest's grammar; this only decides the kind.

const GITHUB_LIKE = /^(https:\/\/github\.com\/)?[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?\/?(#.*)?$/;

export interface ResolveOptions {
  kind?: Run["target"]["kind"];
  cwd: string;
  exists?: (path: string) => boolean;
}

export function resolveScanTarget(input: string, options: ResolveOptions): Run["target"] {
  const exists = options.exists ?? existsSync;
  const ref = input.trim();
  if (!ref) throw new Error("the scan target is empty");

  const hash = ref.lastIndexOf("#");
  const path = hash === -1 ? ref : ref.slice(0, hash);
  const rev = hash === -1 ? "" : ref.slice(hash);
  const absolute = path ? resolve(options.cwd, path) : "";

  if (options.kind === "local") {
    if (!absolute || !exists(absolute)) throw new Error(`no such local path: ${absolute || ref}`);
    return { kind: "local", ref: absolute + rev };
  }
  if (options.kind === "github") return { kind: "github", ref };

  if (absolute && exists(absolute)) return { kind: "local", ref: absolute + rev };
  if (GITHUB_LIKE.test(ref)) return { kind: "github", ref };
  throw new Error(
    `"${ref}" is neither an existing local path nor a GitHub owner/repo ref; pass --kind local or --kind github`,
  );
}

import { isAbsolute } from "node:path";
import type { Run } from "@repro/contracts";

// Target refs accepted by runs.create, checked with the same grammar lane 2's ingest parses
// (packages/ingest/src/repo-adapter.ts on lane-2: parseGithubRef / parseLocalRef), so a Run that
// ingest would refuse is refused here, when the person typing it can still fix it:
//   github: "owner/repo", "owner/repo#rev", or "https://github.com/owner/repo[.git][#rev]"
//   local:  an absolute path, optionally "#rev". Relative paths are refused because the API host
//           would resolve them against its own working directory; the CLI makes them absolute.

const GITHUB_NAME = /^[A-Za-z0-9_.-]{1,100}$/;
const SAFE_REV = /^(?!-)[A-Za-z0-9._/-]{1,255}$/;
export const MAX_TARGET_REF_LENGTH = 1024;

/** Returns why the target is unusable, or null when ingest can take it. */
export function targetProblem(target: Run["target"]): string | null {
  const ref = target.ref.trim();
  if (ref !== target.ref) return "target ref has leading or trailing whitespace";
  if (!ref) return "target ref is empty";
  if (ref.length > MAX_TARGET_REF_LENGTH) return `target ref is longer than ${MAX_TARGET_REF_LENGTH} characters`;
  return target.kind === "github" ? githubProblem(ref) : localProblem(ref);
}

function githubProblem(ref: string): string | null {
  const hash = ref.indexOf("#");
  const spec = hash === -1 ? ref : ref.slice(0, hash);
  const rev = hash === -1 ? undefined : ref.slice(hash + 1);
  const path = spec.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "").replace(/\/$/, "");
  const [owner, repo, ...rest] = path.split("/");
  if (!owner || !repo || rest.length > 0 || !GITHUB_NAME.test(owner) || !GITHUB_NAME.test(repo)) {
    return `not a GitHub ref (expected owner/repo, owner/repo#rev, or https://github.com/owner/repo): ${ref}`;
  }
  if (rev !== undefined && !SAFE_REV.test(rev)) return `unsafe revision: ${rev}`;
  return null;
}

function localProblem(ref: string): string | null {
  const hash = ref.lastIndexOf("#");
  const path = hash === -1 ? ref : ref.slice(0, hash);
  const rev = hash === -1 ? undefined : ref.slice(hash + 1);
  if (!path) return `empty local path: ${ref}`;
  if (!isAbsolute(path)) return `local target must be an absolute path (the CLI resolves relative ones): ${path}`;
  if (rev !== undefined && !SAFE_REV.test(rev)) return `unsafe revision: ${rev}`;
  return null;
}

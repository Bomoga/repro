// @repro/orchestrator: the Run Orchestrator. Importing this module starts nothing; src/main.ts is
// the control-plane entrypoint.
export { Orchestrator, type OrchestratorOptions } from "./orchestrator.ts";
export { PRO_REQUESTS_PER_DIAGNOSIS, processRun, type PipelineDeps, type Stages } from "./pipeline.ts";
export { RunLog } from "./run-log.ts";
export { copyWorkspace, gitWorkspaceCopies, removeWorkspaceCopy, type WorkspaceCopies } from "./workspace-copy.ts";
export { PullRequestSync } from "./pull-request-sync.ts";
export {
  GitHubPullRequests,
  pullRequestBody,
  pullRequestTitle,
  type PullRequestInput,
  type PullRequestOpener,
} from "./pull-request.ts";

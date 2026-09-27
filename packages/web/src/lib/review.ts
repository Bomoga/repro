import type { Diagnosis, Finding, Patch, Run } from "@repro/contracts";
import type { RunSummary, TrustReport } from "@repro/api";
import { api } from "../api.ts";
import { usePoll, type Poll } from "./poll.ts";

export interface ReviewItem {
  run: Run;
  patch: Patch;
  diagnosis: Diagnosis | undefined;
  /** The findings this patch's diagnosis cites. */
  findings: Finding[];
  trust: TrustReport | undefined;
}

/** Every verified patch still waiting on a person's merge or reject, newest run first. */
export function useReviewQueue(summaries: RunSummary[] | undefined): Poll<ReviewItem[]> {
  // runs.summaries counts merged patches as verified too, so these are only the runs worth opening.
  const runIds = (summaries ?? []).filter((s) => s.counts.verifiedPatches > 0).map((s) => s.run.id);

  return usePoll(
    async () => {
      const details = await Promise.all(runIds.map((id) => api.detail(id)));
      const items = details.flatMap((detail) =>
        detail.patches
          .filter((patch) => patch.status === "verified")
          .map((patch) => {
            const diagnosis = detail.diagnoses.find((d) => d.id === patch.diagnosisId);
            const findings = diagnosis ? detail.findings.filter((f) => diagnosis.findingIds.includes(f.id)) : [];
            return { run: detail.run, patch, diagnosis, findings };
          }),
      );
      const trust = await Promise.all(items.map((item) => api.trustReport(item.run.id, item.patch.id).catch(() => undefined)));
      return items.map((item, i) => ({ ...item, trust: trust[i] }));
    },
    8000,
    `review:${runIds.join("\n")}`,
    summaries !== undefined,
  );
}

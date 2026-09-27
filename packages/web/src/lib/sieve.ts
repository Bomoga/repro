import type { Diagnosis, Finding, Patch } from "@repro/contracts";

export interface SieveStep {
  key: string;
  label: string;
  count: number;
}

/**
 * How many of a Run's findings are still standing after each gate. Each gate only sees what the
 * previous one let through, so the counts can only go down: a finding counts as verified when any
 * patch for its diagnosis passed verification (a rejected first attempt doesn't hide a verified
 * second one).
 */
export function sieveSteps(findings: Finding[], diagnoses: Diagnosis[], patches: Patch[]): SieveStep[] {
  const patchesFor = (finding: Finding) =>
    diagnoses
      .filter((d) => d.findingIds.includes(finding.id))
      .flatMap((d) => patches.filter((p) => p.diagnosisId === d.id));

  const reproduced = findings.filter((f) => f.reproducible);
  const diagnosed = reproduced.filter((f) => diagnoses.some((d) => d.findingIds.includes(f.id)));
  const patched = diagnosed.filter((f) => patchesFor(f).length > 0);
  const verified = patched.filter((f) => patchesFor(f).some((p) => p.status === "verified" || p.status === "merged"));
  const merged = verified.filter((f) => patchesFor(f).some((p) => p.status === "merged"));

  return [
    { key: "found", label: "Found", count: findings.length },
    { key: "reproduced", label: "Reproduced", count: reproduced.length },
    { key: "diagnosed", label: "Diagnosed", count: diagnosed.length },
    { key: "patched", label: "Patched", count: patched.length },
    { key: "verified", label: "Verified", count: verified.length },
    { key: "merged", label: "Merged", count: merged.length },
  ];
}

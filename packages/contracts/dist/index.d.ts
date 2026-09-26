import { z } from "zod";
export declare const SeveritySchema: z.ZodEnum<["info", "low", "medium", "high", "critical"]>;
export declare const StageSchema: z.ZodEnum<["ingest", "detect", "diagnose", "repair", "verify", "done"]>;
export declare const RunStatusSchema: z.ZodEnum<["queued", "running", "blocked", "completed", "failed"]>;
export declare const TriggerSchema: z.ZodEnum<["manual", "schedule", "webhook"]>;
export declare const FindingSchema: z.ZodObject<{
    id: z.ZodString;
    detectorId: z.ZodString;
    ruleId: z.ZodString;
    severity: z.ZodEnum<["info", "low", "medium", "high", "critical"]>;
    category: z.ZodString;
    file: z.ZodString;
    lineStart: z.ZodNumber;
    lineEnd: z.ZodNumber;
    message: z.ZodString;
    evidence: z.ZodString;
    reproducible: z.ZodDefault<z.ZodBoolean>;
    reproductionCommand: z.ZodOptional<z.ZodString>;
    reproductionOutput: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    detectorId: string;
    ruleId: string;
    severity: "info" | "low" | "medium" | "high" | "critical";
    category: string;
    file: string;
    lineStart: number;
    lineEnd: number;
    message: string;
    evidence: string;
    reproducible: boolean;
    createdAt: string;
    reproductionCommand?: string | undefined;
    reproductionOutput?: string | undefined;
}, {
    id: string;
    detectorId: string;
    ruleId: string;
    severity: "info" | "low" | "medium" | "high" | "critical";
    category: string;
    file: string;
    lineStart: number;
    lineEnd: number;
    message: string;
    evidence: string;
    createdAt: string;
    reproducible?: boolean | undefined;
    reproductionCommand?: string | undefined;
    reproductionOutput?: string | undefined;
}>;
export declare const DiagnosisSchema: z.ZodObject<{
    id: z.ZodString;
    findingIds: z.ZodArray<z.ZodString, "many">;
    rootCause: z.ZodString;
    proposedStrategy: z.ZodString;
    riskNotes: z.ZodString;
    model: z.ZodString;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    createdAt: string;
    findingIds: string[];
    rootCause: string;
    proposedStrategy: string;
    riskNotes: string;
    model: string;
}, {
    id: string;
    createdAt: string;
    findingIds: string[];
    rootCause: string;
    proposedStrategy: string;
    riskNotes: string;
    model: string;
}>;
export declare const PatchSchema: z.ZodObject<{
    id: z.ZodString;
    diagnosisId: z.ZodString;
    diff: z.ZodString;
    filesChanged: z.ZodArray<z.ZodString, "many">;
    testsPassed: z.ZodBoolean;
    originalFindingReproduces: z.ZodBoolean;
    reproductionOutputAfter: z.ZodOptional<z.ZodString>;
    regressionFindings: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        detectorId: z.ZodString;
        ruleId: z.ZodString;
        severity: z.ZodEnum<["info", "low", "medium", "high", "critical"]>;
        category: z.ZodString;
        file: z.ZodString;
        lineStart: z.ZodNumber;
        lineEnd: z.ZodNumber;
        message: z.ZodString;
        evidence: z.ZodString;
        reproducible: z.ZodDefault<z.ZodBoolean>;
        reproductionCommand: z.ZodOptional<z.ZodString>;
        reproductionOutput: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        detectorId: string;
        ruleId: string;
        severity: "info" | "low" | "medium" | "high" | "critical";
        category: string;
        file: string;
        lineStart: number;
        lineEnd: number;
        message: string;
        evidence: string;
        reproducible: boolean;
        createdAt: string;
        reproductionCommand?: string | undefined;
        reproductionOutput?: string | undefined;
    }, {
        id: string;
        detectorId: string;
        ruleId: string;
        severity: "info" | "low" | "medium" | "high" | "critical";
        category: string;
        file: string;
        lineStart: number;
        lineEnd: number;
        message: string;
        evidence: string;
        createdAt: string;
        reproducible?: boolean | undefined;
        reproductionCommand?: string | undefined;
        reproductionOutput?: string | undefined;
    }>, "many">;
    challengerVerdict: z.ZodEnum<["confirmed", "disputed"]>;
    challengerNotes: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<["proposed", "verified", "rejected", "merged"]>;
    prUrl: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    id: string;
    status: "proposed" | "verified" | "rejected" | "merged";
    diagnosisId: string;
    diff: string;
    filesChanged: string[];
    testsPassed: boolean;
    originalFindingReproduces: boolean;
    regressionFindings: {
        id: string;
        detectorId: string;
        ruleId: string;
        severity: "info" | "low" | "medium" | "high" | "critical";
        category: string;
        file: string;
        lineStart: number;
        lineEnd: number;
        message: string;
        evidence: string;
        reproducible: boolean;
        createdAt: string;
        reproductionCommand?: string | undefined;
        reproductionOutput?: string | undefined;
    }[];
    challengerVerdict: "confirmed" | "disputed";
    reproductionOutputAfter?: string | undefined;
    challengerNotes?: string | undefined;
    prUrl?: string | undefined;
}, {
    id: string;
    status: "proposed" | "verified" | "rejected" | "merged";
    diagnosisId: string;
    diff: string;
    filesChanged: string[];
    testsPassed: boolean;
    originalFindingReproduces: boolean;
    regressionFindings: {
        id: string;
        detectorId: string;
        ruleId: string;
        severity: "info" | "low" | "medium" | "high" | "critical";
        category: string;
        file: string;
        lineStart: number;
        lineEnd: number;
        message: string;
        evidence: string;
        createdAt: string;
        reproducible?: boolean | undefined;
        reproductionCommand?: string | undefined;
        reproductionOutput?: string | undefined;
    }[];
    challengerVerdict: "confirmed" | "disputed";
    reproductionOutputAfter?: string | undefined;
    challengerNotes?: string | undefined;
    prUrl?: string | undefined;
}>;
export declare const RunSchema: z.ZodObject<{
    id: z.ZodString;
    trigger: z.ZodEnum<["manual", "schedule", "webhook"]>;
    target: z.ZodObject<{
        kind: z.ZodEnum<["local", "github"]>;
        ref: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        kind: "local" | "github";
        ref: string;
    }, {
        kind: "local" | "github";
        ref: string;
    }>;
    stage: z.ZodEnum<["ingest", "detect", "diagnose", "repair", "verify", "done"]>;
    status: z.ZodEnum<["queued", "running", "blocked", "completed", "failed"]>;
    startedAt: z.ZodString;
    logRef: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    status: "queued" | "running" | "blocked" | "completed" | "failed";
    trigger: "manual" | "schedule" | "webhook";
    target: {
        kind: "local" | "github";
        ref: string;
    };
    stage: "ingest" | "detect" | "diagnose" | "repair" | "verify" | "done";
    startedAt: string;
    logRef: string;
}, {
    id: string;
    status: "queued" | "running" | "blocked" | "completed" | "failed";
    trigger: "manual" | "schedule" | "webhook";
    target: {
        kind: "local" | "github";
        ref: string;
    };
    stage: "ingest" | "detect" | "diagnose" | "repair" | "verify" | "done";
    startedAt: string;
    logRef: string;
}>;
export declare const WorkspaceSchema: z.ZodObject<{
    runId: z.ZodString;
    path: z.ZodString;
    fileIndex: z.ZodArray<z.ZodString, "many">;
    languages: z.ZodArray<z.ZodString, "many">;
    headCommit: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    runId: string;
    fileIndex: string[];
    languages: string[];
    headCommit: string;
}, {
    path: string;
    runId: string;
    fileIndex: string[];
    languages: string[];
    headCommit: string;
}>;
export declare const ExecRequestSchema: z.ZodObject<{
    workspacePath: z.ZodString;
    command: z.ZodString;
    timeoutMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    workspacePath: string;
    command: string;
    timeoutMs: number;
}, {
    workspacePath: string;
    command: string;
    timeoutMs: number;
}>;
export declare const ExecResultSchema: z.ZodObject<{
    exitCode: z.ZodNumber;
    stdout: z.ZodString;
    stderr: z.ZodString;
    timedOut: z.ZodBoolean;
    durationMs: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
}, {
    exitCode: number;
    stdout: string;
    stderr: string;
    timedOut: boolean;
    durationMs: number;
}>;
export type Severity = z.infer<typeof SeveritySchema>;
export type Stage = z.infer<typeof StageSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type Diagnosis = z.infer<typeof DiagnosisSchema>;
export type Patch = z.infer<typeof PatchSchema>;
export type Run = z.infer<typeof RunSchema>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type ExecRequest = z.infer<typeof ExecRequestSchema>;
export type ExecResult = z.infer<typeof ExecResultSchema>;
export interface DetectorAdapter {
    id: string;
    run(workspace: Workspace, exec: (request: ExecRequest) => Promise<ExecResult>): Promise<Finding[]>;
}
//# sourceMappingURL=index.d.ts.map
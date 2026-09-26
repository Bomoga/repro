import mongoose, { Schema } from "mongoose";

// Mirrors of the section 4 contract shapes for persistence. Validation on the way in is the
// contract Zod schemas' job (the store's callers parse before writing); these schemas only
// describe storage, including the `runId` association that section 4 doesn't define.

const runSchema = new Schema(
  {
    _id: { type: String, required: true },
    trigger: { type: String, required: true },
    target: {
      kind: { type: String, required: true },
      ref: { type: String, required: true },
    },
    stage: { type: String, required: true },
    status: { type: String, required: true },
    startedAt: { type: String, required: true },
    logRef: { type: String, required: true },
  },
  { versionKey: false },
);

const findingSchema = new Schema(
  {
    runId: { type: String, required: true, index: true },
    id: { type: String, required: true },
    detectorId: String,
    ruleId: String,
    severity: String,
    category: String,
    file: String,
    lineStart: Number,
    lineEnd: Number,
    message: String,
    evidence: String,
    reproducible: Boolean,
    reproductionCommand: String,
    reproductionOutput: String,
    createdAt: String,
  },
  { versionKey: false },
);

const diagnosisSchema = new Schema(
  {
    runId: { type: String, required: true, index: true },
    id: { type: String, required: true },
    findingIds: [String],
    rootCause: String,
    proposedStrategy: String,
    riskNotes: String,
    model: String,
    createdAt: String,
  },
  { versionKey: false },
);

const patchSchema = new Schema(
  {
    runId: { type: String, required: true, index: true },
    id: { type: String, required: true },
    diagnosisId: String,
    diff: String,
    filesChanged: [String],
    testsPassed: Boolean,
    originalFindingReproduces: Boolean,
    reproductionOutputAfter: String,
    regressionFindings: [Schema.Types.Mixed],
    challengerVerdict: String,
    challengerNotes: String,
    status: String,
    prUrl: String,
  },
  { versionKey: false },
);

export const RunModel = mongoose.model("Run", runSchema);
export const FindingModel = mongoose.model("Finding", findingSchema);
export const DiagnosisModel = mongoose.model("Diagnosis", diagnosisSchema);
export const PatchModel = mongoose.model("Patch", patchSchema);

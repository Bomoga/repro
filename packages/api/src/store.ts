import mongoose, { Schema, model, models } from 'mongoose';
import {
  DiagnosisSchema as ContractDiagnosisSchema,
  FindingSchema as ContractFindingSchema,
  PatchSchema as ContractPatchSchema,
  RunSchema as ContractRunSchema,
  type Diagnosis,
  type Finding,
  type Patch,
  type Run
} from '@repro/contracts';
import type { RunRepository } from './trpc.js';

const runSchema = new Schema({
  id: { type: String, required: true, unique: true },
  trigger: { type: String, required: true },
  target: {
    kind: { type: String, required: true },
    ref: { type: String, required: true }
  },
  stage: { type: String, required: true },
  status: { type: String, required: true },
  startedAt: { type: String, required: true },
  logRef: { type: String, required: true }
}, { versionKey: false });

const findingSchema = new Schema({
  id: { type: String, required: true, unique: true },
  runId: { type: String, required: true, index: true },
  detectorId: { type: String, required: true },
  ruleId: { type: String, required: true },
  severity: { type: String, required: true },
  category: { type: String, required: true },
  file: { type: String, required: true },
  lineStart: { type: Number, required: true },
  lineEnd: { type: Number, required: true },
  message: { type: String, required: true },
  evidence: { type: String, required: true },
  reproducible: { type: Boolean, required: true, default: false },
  reproductionCommand: String,
  reproductionOutput: String,
  createdAt: { type: String, required: true }
}, { versionKey: false });

const diagnosisSchema = new Schema({
  id: { type: String, required: true, unique: true },
  runId: { type: String, required: true, index: true },
  findingIds: { type: [String], required: true },
  rootCause: { type: String, required: true },
  proposedStrategy: { type: String, required: true },
  riskNotes: { type: String, required: true },
  model: { type: String, required: true },
  createdAt: { type: String, required: true }
}, { versionKey: false });

const patchSchema = new Schema({
  id: { type: String, required: true, unique: true },
  runId: { type: String, required: true, index: true },
  diagnosisId: { type: String, required: true },
  diff: { type: String, required: true },
  filesChanged: { type: [String], required: true },
  testsPassed: { type: Boolean, required: true },
  originalFindingReproduces: { type: Boolean, required: true },
  reproductionOutputAfter: String,
  regressionFindings: { type: [Schema.Types.Mixed], required: true },
  challengerVerdict: { type: String, required: true },
  challengerNotes: String,
  status: { type: String, required: true },
  prUrl: String
}, { versionKey: false });

const RunModel = models.ReproRun ?? model('ReproRun', runSchema, 'runs');
const FindingModel = models.ReproFinding ?? model('ReproFinding', findingSchema, 'findings');
const DiagnosisModel = models.ReproDiagnosis ?? model('ReproDiagnosis', diagnosisSchema, 'diagnoses');
const PatchModel = models.ReproPatch ?? model('ReproPatch', patchSchema, 'patches');

function parseDocument<T>(schema: { parse(value: unknown): T }, document: unknown): T {
  const { _id, __v, runId, ...contract } = document as Record<string, unknown>;
  void _id;
  void __v;
  void runId;
  return schema.parse(contract);
}

export const mongoRepository: RunRepository = {
  async listRuns(limit) {
    const documents = await RunModel.find().sort({ startedAt: -1 }).limit(limit).lean().exec();
    return documents.map((document) => parseDocument(ContractRunSchema, document));
  },
  async getRun(id) {
    const document = await RunModel.findOne({ id }).lean().exec();
    return document ? parseDocument<Run>(ContractRunSchema, document) : null;
  },
  async getRunDetails(runId) {
    const [runDocument, findingDocuments, diagnosisDocuments, patchDocuments] = await Promise.all([
      RunModel.findOne({ id: runId }).lean().exec(),
      FindingModel.find({ runId }).sort({ createdAt: 1 }).lean().exec(),
      DiagnosisModel.find({ runId }).sort({ createdAt: 1 }).lean().exec(),
      PatchModel.find({ runId }).sort({ id: 1 }).lean().exec()
    ]);

    if (!runDocument) return null;

    return {
      run: parseDocument<Run>(ContractRunSchema, runDocument),
      findings: findingDocuments.map((document) => parseDocument<Finding>(ContractFindingSchema, document)),
      diagnoses: diagnosisDocuments.map((document) => parseDocument<Diagnosis>(ContractDiagnosisSchema, document)),
      patches: patchDocuments.map((document) => parseDocument<Patch>(ContractPatchSchema, document))
    };
  }
};

export async function connectMongo(uri = process.env.MONGODB_URI) {
  if (!uri) throw new Error('MONGODB_URI must be set to connect the Repro Run Store.');
  await mongoose.connect(uri);
}
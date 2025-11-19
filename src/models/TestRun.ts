import mongoose, { Schema, InferSchemaType } from 'mongoose';

const AssertionSchema = new Schema({
  type: { type: String },
  severity: { type: String },
  config: { type: Schema.Types.Mixed },
  pass: { type: Boolean },
  details: { type: Schema.Types.Mixed },
}, { _id: false });

const ConfirmationResultSchema = new Schema({
  type: { type: String },
  name: { type: String },
  pass: { type: Boolean },
  details: { type: Schema.Types.Mixed },
}, { _id: false });

const RunItemSchema = new Schema({
  testId: { type: String, index: true },
  status: { type: String },
  transcript: { type: [Schema.Types.Mixed], default: [] },
  messageCounts: { type: Schema.Types.Mixed }, // { user: number, assistant: number, total: number }
  assertions: { type: [AssertionSchema], default: [] },
  confirmations: { type: [ConfirmationResultSchema], default: [] },
  timings: { type: Schema.Types.Mixed },
  artifacts: { type: Schema.Types.Mixed },
  error: { type: Schema.Types.Mixed },
}, { _id: false });

const TestRunSchema = new Schema({
  orgId: { type: String, required: true, index: true },
  suiteId: { type: String, required: true, index: true },
  trigger: { type: String, enum: ['manual','schedule','ci'], default: 'manual' },
  gitContext: { type: Schema.Types.Mixed },
  envId: { type: String },
  connectionKey: { type: String },
  status: { type: String, enum: ['queued','running','passed','failed','partial','stopped'], index: true, default: 'queued' },
  stopRequested: { type: Boolean, default: false },
  startedAt: { type: Date },
  finishedAt: { type: Date },
  totals: { type: Schema.Types.Mixed },
  summaryScore: { type: Number },
  progress: { type: Schema.Types.Mixed },
  judge: { type: Schema.Types.Mixed },
  items: { type: [RunItemSchema], default: [] },
  error: { type: Schema.Types.Mixed },
}, { timestamps: true });

export type TestRun = InferSchemaType<typeof TestRunSchema> & { _id: string };
export const TestRunModel = mongoose.models.TestRun || mongoose.model('TestRun', TestRunSchema);

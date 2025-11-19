import mongoose, { Schema, InferSchemaType } from 'mongoose';

const ThresholdsSchema = new Schema({
  passRate: { type: Number, default: 0.99 },
  judgeScore: { type: Number, default: 0.75 },
}, { _id: false });

const TestSuiteSchema = new Schema({
  orgId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  description: { type: String },
  tags: { type: [String], default: [] },
  defaultEnvId: { type: String },
  defaultConnectionKey: { type: String },
  thresholds: { type: ThresholdsSchema, default: () => ({}) },
  labels: { type: [String], default: [] },
  createdBy: { type: String },
}, { timestamps: true });

TestSuiteSchema.index({ orgId: 1, name: 1 }, { unique: true });

export type TestSuite = InferSchemaType<typeof TestSuiteSchema> & { _id: string };
export const TestSuiteModel = mongoose.models.TestSuite || mongoose.model('TestSuite', TestSuiteSchema);

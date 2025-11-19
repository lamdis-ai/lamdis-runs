import mongoose, { Schema, InferSchemaType } from 'mongoose';

const UsageSchema = new Schema({
  orgId: { type: String, required: true, index: true },
  runId: { type: String, required: true, unique: true },
  suiteId: { type: String, required: true, index: true },
  envId: { type: String },
  connectionKey: { type: String },
  status: { type: String },
  startedAt: { type: Date },
  finishedAt: { type: Date, index: true },
  durationSec: { type: Number },
  itemsCount: { type: Number },
}, { timestamps: true });

export type Usage = InferSchemaType<typeof UsageSchema> & { _id: string };
export const UsageModel = mongoose.models.Usage || mongoose.model('Usage', UsageSchema);

import mongoose, { Schema, InferSchemaType } from 'mongoose';

const EnvironmentSchema = new Schema({
  orgId: { type: String, required: true, index: true },
  suiteId: { type: String, required: true, index: true },
  name: { type: String },
  channel: { type: String, enum: ['http_chat', 'openai_chat', 'bedrock_chat'], default: 'http_chat' },
  baseUrl: { type: String },
  headers: { type: Schema.Types.Mixed },
  timeoutMs: { type: Number },
}, { timestamps: true });

export type Environment = InferSchemaType<typeof EnvironmentSchema> & { _id: string };
export const EnvironmentModel = mongoose.models.Environment || mongoose.model('Environment', EnvironmentSchema);

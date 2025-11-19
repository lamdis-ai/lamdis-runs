import mongoose, { Schema, InferSchemaType } from 'mongoose';

const TestSchema = new Schema({
  orgId: { type: String, required: true, index: true },
  suiteId: { type: String, required: true, index: true },
  name: { type: String },
  personaId: { type: String },
  script: { type: Schema.Types.Mixed },
  // Optional unified steps sequence allowing mixed messages/requests
  // Example: [{ type:'message', role:'user', content:'Hi ${var.user.name}' }, { type:'request', requestId:'orders.get', input:{ id: '${var.orderId}' }, assign:'order' }]
  steps: { type: [Schema.Types.Mixed], default: [] },
  assertions: { type: [Schema.Types.Mixed], default: [] },
  maxTurns: { type: Number },
  minTurns: { type: Number },
  iterate: { type: Boolean },
  objective: { type: String },
  continueAfterPass: { type: Boolean },
  judgeConfig: { type: Schema.Types.Mixed },
}, { timestamps: true });

export type Test = InferSchemaType<typeof TestSchema> & { _id: string };
export const TestModel = mongoose.models.Test || mongoose.model('Test', TestSchema);

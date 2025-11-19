import mongoose, { Schema, InferSchemaType } from 'mongoose';

const RequestSchema = new Schema({
  orgId: { type: Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  id: { type: String, required: true },
  title: { type: String },
  description: { type: String },
  provider: { type: String },
  transport: {
    type: new Schema({
      mode: { type: String, enum: ['direct', 'hosted', 'proxy'], default: 'direct' },
      authority: { type: String, enum: ['vendor', 'lamdis'], default: 'vendor' },
      http: {
        type: new Schema({
          method: { type: String },
          full_url: { type: String },
          base_url: { type: String },
          path: { type: String },
          headers: { type: Schema.Types.Mixed },
          body: { type: Schema.Types.Mixed },
        }, { _id: false })
      }
    }, { _id: false }),
    required: false,
  },
  input_schema: { type: Schema.Types.Mixed },
  input_schema_description: { type: String },
  output_schema: { type: Schema.Types.Mixed },
  output_schema_description: { type: String },
  auth: { type: Schema.Types.Mixed },
  enabled: { type: Boolean, default: true },
  version: { type: String },
}, { timestamps: true });

RequestSchema.index({ orgId: 1, id: 1 }, { unique: true });

export type Request = InferSchemaType<typeof RequestSchema> & { _id: string };
export const RequestModel = mongoose.models.Request || mongoose.model('Request', RequestSchema);

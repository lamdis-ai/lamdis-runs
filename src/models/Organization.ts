import mongoose, { Schema, InferSchemaType } from 'mongoose';

const OrgSchema = new Schema({
  name: { type: String },
  connections: { type: Schema.Types.Mixed },
  integrations: { type: Schema.Types.Mixed },
}, { timestamps: true });

export type Organization = InferSchemaType<typeof OrgSchema> & { _id: string };
export const OrganizationModel = mongoose.models.Organization || mongoose.model('Organization', OrgSchema);

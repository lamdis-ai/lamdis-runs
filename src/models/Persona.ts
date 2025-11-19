import mongoose, { Schema, InferSchemaType } from 'mongoose';

const PersonaSchema = new Schema({
  orgId: { type: String, required: true, index: true },
  name: { type: String },
  yaml: { type: String },
  text: { type: String },
}, { timestamps: true });

export type Persona = InferSchemaType<typeof PersonaSchema> & { _id: string };
export const PersonaModel = mongoose.models.Persona || mongoose.model('Persona', PersonaSchema);

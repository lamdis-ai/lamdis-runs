import crypto from 'crypto';

const ALGO = 'aes-256-gcm';

export function decrypt(obj: any): any {
  const secret = process.env.ENC_SECRET;
  if (!secret) return obj;
  if (!obj || typeof obj !== 'object' || !obj.iv || !obj.tag || !obj.data) return obj;
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = Buffer.from(obj.iv, 'base64');
  const tag = Buffer.from(obj.tag, 'base64');
  const enc = Buffer.from(obj.data, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(enc), decipher.final()]).toString();
  return JSON.parse(dec);
}

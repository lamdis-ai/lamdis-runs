import { promises as fs } from 'fs';
import path from 'path';

const RESULTS_ROOT = process.env.LAMDIS_RESULTS_DIR || path.join(process.cwd(), 'results');

export const RESULTS_ENABLED = process.env.LAMDIS_RESULTS_ENABLED === 'true';

export async function writeRunResultToDisk(runId: string, payload: unknown): Promise<void> {
  if (!RESULTS_ENABLED) return;

  const dir = path.join(RESULTS_ROOT, new Date().toISOString().slice(0, 10));
  await fs.mkdir(dir, { recursive: true });

  const filePath = path.join(dir, `${runId}.json`);
  const body = JSON.stringify(payload, null, 2);
  await fs.writeFile(filePath, body, 'utf8');
}

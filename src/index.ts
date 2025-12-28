import 'dotenv/config';
import Fastify from 'fastify';
import runsRoutes from './routes/runs.js';
import mongoose from 'mongoose';
import { repo } from './db/repo.js';

const app = Fastify({ logger: true });

// Simple health
app.get('/health', async () => ({ ok: true }));

// Register routes
await app.register(runsRoutes);

/**
 * Database provider selection via DB_PROVIDER env var:
 *   - "local"    : JSON files / in-memory (no external DB required)
 *   - "mongo"    : MongoDB (requires MONGO_URL)
 *   - "postgres" : PostgreSQL via Prisma (requires DATABASE_URL)
 * 
 * If DB_PROVIDER is not set, auto-detect:
 *   - DATABASE_URL starting with "postgres" → postgres
 *   - MONGO_URL set → mongo
 *   - Otherwise → local (JSON-only mode)
 */
const DB_PROVIDER = (process.env.DB_PROVIDER || '').toLowerCase();

async function initDatabase() {
  // Explicit provider selection
  if (DB_PROVIDER === 'postgres' || (!DB_PROVIDER && repo.isPg())) {
    app.log.info('Using PostgreSQL (Prisma) for persistence');
    // Prisma connects lazily on first query
    return;
  }

  if (DB_PROVIDER === 'local') {
    app.log.info('Running in local/JSON-only mode (no external database)');
    return;
  }

  // Default: MongoDB
  const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/lamdis';
  if (!process.env.MONGO_URL && DB_PROVIDER !== 'mongo') {
    app.log.warn('DB_PROVIDER not set and no DATABASE_URL/MONGO_URL; defaulting to local mode');
    process.env.DB_PROVIDER = 'local';
    return;
  }
  
  app.log.info(`Connecting to MongoDB: ${MONGO_URL.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);
  await mongoose.connect(MONGO_URL);
  app.log.info('MongoDB connected');
}

await initDatabase();

const PORT = Number(process.env.PORT || 3101);
app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  const dbMode = process.env.DB_PROVIDER || (repo.isPg() ? 'postgres' : (process.env.MONGO_URL ? 'mongo' : 'local'));
  app.log.info(`lamdis-runs listening on :${PORT} [db=${dbMode}]`);
}).catch((err)=>{
  app.log.error(err);
  process.exit(1);
});

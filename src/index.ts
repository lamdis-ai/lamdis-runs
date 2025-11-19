import 'dotenv/config';
import Fastify from 'fastify';
import runsRoutes from './routes/runs.js';
import mongoose from 'mongoose';

const app = Fastify({ logger: true });

// Simple health
app.get('/health', async () => ({ ok: true }));

// Register routes
await app.register(runsRoutes);

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/lamdis';
if (!process.env.MONGO_URL) {
  app.log.warn('MONGO_URL not set; defaulting to mongodb://localhost:27017/lamdis');
}
await mongoose.connect(MONGO_URL);

const PORT = Number(process.env.PORT || 3101);
app.listen({ port: PORT, host: '0.0.0.0' }).then(() => {
  app.log.info(`lamdis-runs listening on :${PORT}`);
}).catch((err)=>{
  app.log.error(err);
  process.exit(1);
});

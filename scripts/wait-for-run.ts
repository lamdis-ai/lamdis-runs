import 'dotenv/config'
import mongoose from 'mongoose'

async function wait() {
  const runId = process.argv[2] || process.env.RUN_ID
  if (!runId) {
    console.error('Usage: npm run wait -- <runId>  (or set RUN_ID env)')
    process.exit(2)
  }
  const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017/lamdis'
  await mongoose.connect(MONGO_URL)
  const col = mongoose.connection.collection('testruns')
  const oid = new (mongoose as any).Types.ObjectId(runId)
  const terminal = new Set(['passed','failed','partial','stopped'])
  let last = ''
  for (let i=0;i<180;i++) { // up to ~15 minutes @5s
    const r:any = await col.findOne({ _id: oid })
    if (r?.status && r.status !== last) {
      console.log('status:', r.status)
      last = r.status
    }
    if (r?.status && terminal.has(r.status)) {
      await mongoose.disconnect()
      if (r.status === 'passed') process.exit(0)
      console.error('Run finished with status:', r.status)
      process.exit(1)
    }
    await new Promise(res=>setTimeout(res, 5000))
  }
  await mongoose.disconnect()
  console.error('Timeout waiting for run to complete')
  process.exit(1)
}

wait().catch(async (e)=>{ console.error(e); try { await mongoose.disconnect() } catch {} ; process.exit(1) })

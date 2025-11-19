# lamdis-runs

**lamdis-runs** is a background runner for **conversational test suites**. It runs entirely on its own (no lamdis‑api/web required) so any team can **author tests**, **group them into suites**, and **gate CI/CD** against real assistants.

---

## Who is this for?

* **AI platform teams** who want a lightweight CI gate for assistants/agents.
* **Feature teams** building a bot and needing repeatable end‑to‑end checks.
* **Tooling folks** embedding a test runner inside a dev/testing app.

---

## What it does

* Runs suites against your assistant via **HTTP chat** or **OpenAI chat**.
* Iterates turn‑by‑turn and uses a **local judge** for semantic checks (OpenAI model or heuristic fallback).
* Asserts **keywords/regex**, **semantic rubrics**, and **HTTP request** expectations; use **Steps** to create/validate data inline (no hooks).
* Persists results to **MongoDB** or **Postgres** (transcripts, timings, assertions, totals).
* Exposes **minimal endpoints** to start/stop runs (ideal for CI/CD).

---

## Requirements

* **Node.js** 20+
* Either **MongoDB** 6+ or **Postgres** 14+

---

## TL;DR: 5‑minute Quickstart

* Runs suites against your assistant via **HTTP chat**, **OpenAI chat**, or **Bedrock chat**.

**Option A — Docker Compose (Mongo + runner):**

```bash
docker compose up --build
```
| `OPENAI_API_KEY`, `OPENAI_BASE`, `OPENAI_MODEL`, `OPENAI_TEMPERATURE` | Judge settings (provider=openai)                                        | —                                  |
| `JUDGE_PROVIDER`                                                      | `openai` (default) or `bedrock`                                         | `openai`                           |
| `AWS_REGION`                                                          | AWS region for Bedrock                                                  | `us-east-1`                        |
| `BEDROCK_MODEL_ID`, `BEDROCK_TEMPERATURE`                             | Legacy Bedrock model/temperature (used for BOTH chat + judge if specific overrides absent) | `anthropic.claude-3-haiku-20240307-v1:0`, `0.3` |
| `BEDROCK_CHAT_MODEL_ID`, `BEDROCK_CHAT_TEMPERATURE`                   | Optional override: model/temperature for conversation simulation        | — |
| `BEDROCK_JUDGE_MODEL_ID`, `BEDROCK_JUDGE_TEMPERATURE`                 | Optional override: model/temperature for semantic judge scoring         | — |
**Option B — Local dev:**

```bash
npm install
export MONGO_URL="mongodb://localhost:27017/lamdis"
export LAMDIS_API_TOKEN="changeme"
npm run dev
```

### 2) Seed minimal data (org, suite, env, persona, test)

```bash
export MONGO_URL="mongodb://localhost:27017/lamdis" # or your compose URL
npm run seed
```

This prints **suiteId / envId / testId** for use below.

### 3) Point the runner at your assistant

* **HTTP chat**: set `Environment.baseUrl` to your bot (e.g., `http://localhost:8080`). The runner will `POST {baseUrl}/chat` with `{ message, transcript, persona? }` and expects `{ reply: string }`.
* **Semantic checks**: set `OPENAI_API_KEY` to enable LLM judging; otherwise a heuristic judge is used.

### 4) Start a run and wait for completion

```bash
RUN_JSON=$(curl -sS -X POST "http://localhost:3101/internal/runs/start" \
  -H "content-type: application/json" \
  -H "x-api-token: $LAMDIS_API_TOKEN" \
  -d '{
    "suiteId": "<suiteId from seed>",
    "envId":   "<envId from seed>",
    "trigger": "ci"
  }')
RUN_ID=$(echo "$RUN_JSON" | node -e "process.stdin.once('data',d=>{try{console.log(JSON.parse(d).runId||'')}catch{}})")
echo "Run: $RUN_ID"

npm run wait -- $RUN_ID
```

---

## Configuration

Configure via environment variables.

| Variable                                                              | Description                                                             | Default                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| `MONGO_URL`                                                           | Mongo connection (if using Mongo)                                       | `mongodb://localhost:27017/lamdis` |
| `DB_PROVIDER`                                                         | Set to `postgres` to use Postgres via Prisma                            | —                                  |
| `DATABASE_URL`                                                        | Postgres connection string (e.g., `postgres://user:pass@host/db`)       | —                                  |
| `PORT`                                                                | HTTP port                                                               | `3101`                             |
| `LAMDIS_API_TOKEN`                                                    | Static token to protect `/internal` endpoints                           | —                                  |
| `LAMDIS_HMAC_SECRET`                                                  | Optional HMAC for `/internal` (sha256 over `${x-timestamp}.${rawBody}`) | —                                  |
| `JUDGE_BASE_URL`                                                      | Override if you run a separate judge service                            | self                               |
| `OPENAI_API_KEY`, `OPENAI_BASE`, `OPENAI_MODEL`, `OPENAI_TEMPERATURE` | Judge settings                                                          | —                                  |
| `BEDROCK_MODEL_ID`, `BEDROCK_TEMPERATURE`                             | Legacy Bedrock defaults (both chat + judge if no split vars)            | `anthropic.claude-3-haiku-20240307-v1:0`, `0.3` |
| `BEDROCK_CHAT_MODEL_ID`, `BEDROCK_CHAT_TEMPERATURE`                   | (Optional) Chat simulation override                                     | —                                  |
| `BEDROCK_JUDGE_MODEL_ID`, `BEDROCK_JUDGE_TEMPERATURE`                 | (Optional) Judge override when `JUDGE_PROVIDER=bedrock`                 | —                                  |
| `WORKFLOW_URL`                                                        | External workflow engine (otherwise built‑in HTTP/OpenAI execution)     | —                                  |

> **Tip:** Create a local `.env` and `export $(cat .env | xargs)` in shells that don’t auto‑load.

### Database: Mongo or Postgres

lamdis‑runs can persist to Mongo (default) or Postgres (optional).

- Mongo (default): set `MONGO_URL` and skip Prisma.
- Postgres: set `DB_PROVIDER=postgres` and `DATABASE_URL`. Then:

```bash
# one‑time (or after schema edits)
npm install
npm run prisma:generate
npm run prisma:push  # creates tables from the Prisma schema
```

Notes:
- When `DB_PROVIDER=postgres` (or `DATABASE_URL` starts with `postgres://`), the runner will use Prisma instead of Mongoose.
- Tables mirror the Mongo collections. See `prisma/schema.prisma` for details.
- Bedrock model selection precedence:
  - Chat channel (`bedrock_chat`): `BEDROCK_CHAT_MODEL_ID` → `BEDROCK_MODEL_ID` → default (`anthropic.claude-3-haiku-20240307-v1:0`)
  - Judge (`JUDGE_PROVIDER=bedrock`): `BEDROCK_JUDGE_MODEL_ID` → `BEDROCK_MODEL_ID` → default (`anthropic.claude-3-haiku-20240307-v1:0`)
  - Temperatures follow analogous precedence (`*_TEMPERATURE` → legacy `BEDROCK_TEMPERATURE` → hardcoded fallback 0.3 / 0.0).
  - Use a faster/cheaper chat model (e.g., Haiku) and a stronger judge model (e.g., Sonnet) to balance cost vs quality.

### Bedrock: Different Models for Chat vs Judge

Example split configuration:

```bash
export JUDGE_PROVIDER=bedrock
export BEDROCK_CHAT_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0
export BEDROCK_CHAT_TEMPERATURE=0.3
export BEDROCK_JUDGE_MODEL_ID=anthropic.claude-3-sonnet-20240229-v1:0
export BEDROCK_JUDGE_TEMPERATURE=0.0
```

If you only set `BEDROCK_MODEL_ID`, it is used for both chat simulation and judge scoring (legacy behaviour).

---

## Authoring tests (minimal mental model)

You’ll work with 4 core documents in Mongo:

1. **TestSuite** – a named grouping with thresholds (e.g., pass rate, judge score).
2. **Environment** – where/how to run a suite (HTTP chat vs OpenAI chat; base URL; headers).
3. **Test** – either a simple conversation script + assertions, or a unified ordered list of **steps** (mixed messages/requests).
4. **Request** – reusable HTTP call used by steps/assertions.

### Minimal examples

**TestSuite**

```json
{
  "orgId": "org_123",
  "name": "Checkout flows",
  "thresholds": { "passRate": 0.95, "judgeScore": 0.8 },
  "labels": ["staging", "regression"]
}
```


```json
{
  "orgId": "org_123",
  "suiteId": "<suiteId>",
  "name": "staging",
  "channel": "http_chat",
  "baseUrl": "https://bot.example.com",
  "headers": { "x-api-key": "${BOT_KEY}" },
}
```

**Request** (referenced by steps/assertions)

```json
* `bedrock_chat` — uses AWS Bedrock Runtime with your configured `BEDROCK_MODEL_ID`.
  - Anthropic Claude models (e.g., `anthropic.claude-3-haiku-20240307-v1:0`) use the Messages schema.
  - Amazon Titan Text models (e.g., `amazon.titan-text-premier-v1:0`) use completion style. The runner flattens the transcript to a single prompt and continues as Assistant.
{
  "orgId": "org_123",
  "id": "orders.get",
  "title": "Get order",
  "transport": {
    "mode": "direct",
    "authority": "vendor",
    "http": {
      "method": "GET",
      "base_url": "https://api.example.com",
      "path": "/orders/{id}",
      "headers": { "Authorization": "Bearer ${API_TOKEN}" }
    }
  }
}
```

**Test** (persona + semantic/includes/request assertions)

```json
{
  "orgId": "org_123",
  "suiteId": "<suiteId>",
  "name": "Return an order",
  "personaId": "<personaId>",
  "objective": "Start a return for order #1234 and get RMA.",
  "script": {
    "messages": [ { "role": "user", "content": "I want to return my last order." } ]
  },
  "assertions": [
    { "type": "includes", "severity": "error",  "config": { "scope": "last", "includes": ["RMA", "return", "steps"] } },
    { "type": "semantic", "severity": "error", "config": { "rubric": "Provide clear return steps with an RMA.", "threshold": 0.8 } },
    { "type": "request",  "severity": "error", "config": { "requestId": "orders.get", "input": { "id": 1234 }, "expect": { "path": "status", "equals": "return_initiated" } } }
  ],
  "maxTurns": 6,
  "minTurns": 1,
  "iterate": true,
  "continueAfterPass": false,
  "judgeConfig": { "rubric": "RMA issued and steps clear.", "threshold": 0.8 }
}
```

**YAML script variant**

```yaml
messages:
  - role: user
    content: "I need to update my shipping address."
```

> **Rule of thumb**: Keep tests focused on one outcome, give the judge a clear *rubric*, and add at least one deterministic assertion (keyword/regex or request‑based) alongside the semantic check.

### Steps: mixed messages and requests

Use `steps` to interleave user/system messages with HTTP requests in a single ordered flow. This is the sole orchestration mechanism: seed data, read it back, and reference outputs in later messages without pre/post hooks.

Step kinds:

- `{ type: "message", role: "user"|"system", content: string }`
- `{ type: "request", requestId: string, input?: object, assign?: string }`

Variable capture and interpolation:

- Every request step captures its JSON response into `bag.var[assignOrRequestId]` if `assign` is provided (or the requestId by default).
- You can reference any captured values or recent context using `${path}` in strings (message content and request input):
  - `${var.order.id}` for a captured request payload
  - `${lastAssistant}` and `${lastUser}` for the last assistant/user turn
  - `${transcript[0].content}` to reach into the live transcript

Example:

```json
{
  "orgId": "org_123",
  "suiteId": "<suiteId>",
  "name": "Return flow with data seeding",
  "steps": [
    { "type": "message", "role": "system", "content": "You are concise and helpful." },
    { "type": "message", "role": "user", "content": "I want to return my most recent order." },
    { "type": "request", "requestId": "orders.create_test", "input": { "id": 1234, "status": "shipped" }, "assign": "order" },
    { "type": "message", "role": "user", "content": "Please start a return for order ${var.order.id}." },
    { "type": "request", "requestId": "orders.get", "input": { "id": "${var.order.id}" }, "assign": "fetched" },
    { "type": "message", "role": "user", "content": "What is the RMA for order ${var.fetched.id}?" }
  ],
  "assertions": [
    { "type": "includes", "severity": "error", "config": { "scope": "last", "includes": ["RMA", "return"] } },
    { "type": "semantic", "severity": "error", "config": { "rubric": "Provide clear return steps with an RMA.", "threshold": 0.8 } }
  ]
}
```

Notes:

- Steps are the only orchestration path; legacy pre/post hooks have been removed.
- `steps` work with both `http_chat` and `openai_chat` execution channels.
- `script.messages` is still supported for simple flows; include `steps` when you need orchestration or data seeding.

### Migrating from pre/post hooks

Formerly, tests could include a `requests` array with `stage: "before"|"after"`. Replace these with `steps`:

- Move each `before` request to the beginning of `steps` as `{ type: "request", requestId, input, assign? }`.
- Move each `after` request to the end of `steps`.
- Use `assign` to capture outputs and interpolate later: `${var.alias.path}`.
- Delete the `requests` array entirely.

---

## Step‑by‑step (build a suite from scratch)

Use `mongosh` to create docs and `curl` to start a run.

### 1) Create Organization, Suite, Environment

```javascript
// organizations
const org = db.organizations.insertOne({ name: 'My Org' });
const orgId = org.insertedId.str;

// testsuites
const suite = db.testsuites.insertOne({
  orgId: orgId,
  name: 'Hello Suite',
  thresholds: { passRate: 0.9, judgeScore: 0.75 }
});
const suiteId = suite.insertedId.str;

// environments (http_chat)
const env = db.environments.insertOne({
  orgId: orgId,
  suiteId: suiteId,
  name: 'local',
  channel: 'http_chat',
  baseUrl: 'http://localhost:8080',
  headers: { },
  timeoutMs: 20000
});
const envId = env.insertedId.str;
```

### 2) Define Requests used by steps/assertions

```javascript
// requests: create test data before the conversation
db.requests.insertOne({
  orgId: ObjectId(orgId),
  id: 'orders.create_test',
  title: 'Create test order',
  transport: {
    mode: 'direct', authority: 'vendor',
    http: { method: 'POST', base_url: 'https://api.example.com', path: '/orders', headers: { 'content-type': 'application/json' },
      body: { id: 1234, status: 'shipped' } }
  }
});

// requests: fetch data to validate after the conversation
db.requests.insertOne({
  orgId: ObjectId(orgId),
  id: 'orders.get',
  title: 'Get order',
  transport: {
    mode: 'direct', authority: 'vendor',
    http: { method: 'GET', base_url: 'https://api.example.com', path: '/orders/{id}', headers: { 'Authorization': 'Bearer ${API_TOKEN}' } }
  }
});
```

### 3) (Optional) Create a Persona

```javascript
const persona = db.personas.insertOne({ orgId: orgId, name: 'Concise', text: 'You are concise and helpful.' });
const personaId = persona.insertedId.str;
```

### 4) Create a Test

```javascript
db.tests.insertOne({
  orgId: orgId,
  suiteId: suiteId,
  name: 'Return an order',
  personaId: personaId,
  objective: 'Start a return for order #1234 and get RMA.',
  script: { messages: [ { role: 'user', content: 'I want to return my last order.' } ] },
  steps: [
    { type: 'request', requestId: 'orders.create_test', input: { id: 1234, status: 'shipped' }, assign: 'order' },
    { type: 'message', role: 'user', content: 'Please start a return for order ${var.order.id}.' },
    { type: 'request', requestId: 'orders.get', input: { id: '${var.order.id}' }, assign: 'fetched' }
  ],
  assertions: [
    { type: 'includes', severity: 'error', config: { scope: 'last', includes: ['RMA','return'] } },
    { type: 'semantic', severity: 'error', config: { rubric: 'Provide clear return steps with an RMA.', threshold: 0.75 } },
    { type: 'request',  severity: 'error', config: { requestId: 'orders.get', input: { id: 1234 }, expect: { path: 'status', equals: 'return_initiated' } } }
  ],
  maxTurns: 6,
  iterate: true
});
```

### 5) Start a run

```bash
curl -sS -X POST "http://localhost:3101/internal/runs/start" \
  -H "content-type: application/json" \
  -H "x-api-token: $LAMDIS_API_TOKEN" \
  -d '{"suiteId":"'"$suiteId"'","envId":"'"$envId"'","trigger":"ci"}'
```

### 6) Monitor results in Mongo

```javascript
db.testruns.find({}, { status: 1, finishedAt: 1, totals: 1 }).sort({ finishedAt: -1 }).limit(3)
```

If the run didn’t pass, open the TestRun document to review `items[].assertions`, `items[].artifacts.log`, and the tail transcript.

---

## Judge (local)

* **Endpoint**: `POST /orgs/:orgId/judge`
* With `OPENAI_API_KEY`: uses OpenAI for semantic scoring; without it, a heuristic fallback is used.
* **Request**: `{ rubric, threshold?, transcript, lastAssistant, requestNext?, persona? }`
* **Response**: `{ pass, score, threshold, reasoning, nextUser?, shouldContinue? }`
* Override target via `JUDGE_BASE_URL` if you maintain your own judge service.

---

## API (for CI/CD & tooling)

All `/internal` endpoints require either:

* `x-api-token: <LAMDIS_API_TOKEN>` **or** `Authorization: Bearer <LAMDIS_API_TOKEN>`
* Optional HMAC hardening with `x-timestamp` and `x-signature`.

**Endpoints**

* `POST /internal/runs/start` — start a run for a suite
  **Body**: `{ suiteId, envId?, connKey?, tests?, trigger?, gitContext?, authHeader? }`
  **Response**: `{ runId, status: 'queued' }`
* `POST /internal/runs/:runId/stop` — cooperatively stop a run
* `GET /health` — `{ ok: true }`
* `POST /orgs/:orgId/judge` — judge a transcript (see Judge section)

**Getting results** (read from Mongo `testruns`):

```javascript
// summary
db.testruns.findOne({ _id: ObjectId("<runId>") }, { items: 0 })
// full doc
db.testruns.findOne({ _id: ObjectId("<runId>") })
// recent 5
db.testruns.find({}, { status: 1, finishedAt: 1, totals: 1 }).sort({ finishedAt: -1 }).limit(5)
```

Key fields: `status`, `totals`, `items[]` (trimmed transcripts/logs), `judge.avgScore`.

---

## CI/CD recipes

### GitHub Actions

```yaml
name: lamdis-runs
on: [push]
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: |
          curl -sS -X POST "http://lamdis-runs.internal:3101/internal/runs/start" \
            -H "content-type: application/json" \
            -H "x-api-token: ${{ secrets.LAMDIS_API_TOKEN }}" \
            -d '{"suiteId":"${{ vars.SUITE_ID }}","envId":"${{ vars.ENV_ID }}","trigger":"ci"}' > run.json
          export RUN_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('run.json','utf8')).runId)")
          npm run wait -- $RUN_ID
```

### GitLab CI

```yaml
e2e:
  image: node:20
  script:
    - |
      RES=$(curl -sS -X POST "http://lamdis-runs.internal:3101/internal/runs/start" \
        -H "content-type: application/json" \
        -H "x-api-token: $LAMDIS_API_TOKEN" \
        -d '{"suiteId":"'$SUITE_ID'","envId":"'$ENV_ID'","trigger":"ci"}')
      RID=$(node -e "process.stdout.write(JSON.parse(process.argv[1]).runId)" "$RES")
      npm run wait -- $RID
```

### CircleCI

```yaml
version: 2.1
jobs:
  e2e:
    docker: [{ image: cimg/node:20.10 }]
    steps:
      - checkout
      - run: |
          RES=$(curl -sS -X POST "http://lamdis-runs.internal:3101/internal/runs/start" \
            -H "content-type: application/json" \
            -H "x-api-token: $LAMDIS_API_TOKEN" \
            -d '{"suiteId":"'"$SUITE_ID"'","envId":"'"$ENV_ID"'","trigger":"ci"}')
          RID=$(echo "$RES" | node -e "process.stdin.once('data',d=>{try{console.log(JSON.parse(d).runId||'')}catch{}})")
          npm run wait -- $RID
```

> **Policy gates**: Fail the job on non‑zero exit. You can add a step to parse the TestRun document and enforce custom thresholds (e.g., `judge.avgScore >= 0.8`, `totals.passRate >= 0.95`).

---

## Execution channels

* `http_chat` — requires `Environment.baseUrl`; runner POSTs `{ message, transcript[], persona? }` to `${baseUrl}/chat`.
  **Expected response**: `{ reply: string }` (must include a non-empty `reply`).
* `openai_chat` — requires `OPENAI_API_KEY` (or org integration) and uses OpenAI Chat directly.

---

## Data model (Mongo overview)

```ts
TestSuite: {
  orgId, name, defaultEnvId?, defaultConnectionKey?,
  thresholds?: { passRate: number, judgeScore: number },
  labels?: string[]
}
Environment: {
  orgId, suiteId, name,
  channel: 'http_chat'|'openai_chat',
  baseUrl?, headers?, timeoutMs?
}
Test: {
  orgId, suiteId, name?, personaId?,
  script: YAML | { messages: {role,content}[] },
  steps?: any[], // mixed message/request sequence with interpolation (orchestration)
  assertions: any[],
  objective?, judgeConfig?, maxTurns?, minTurns?, iterate?, continueAfterPass?
}
Persona: { orgId, yaml?, text? }
Request: {
  orgId, id, title?,
  transport: { http: { method, base_url, path, headers, body? } },
  input_schema?
}
TestRun (results): { status, progress, items[], totals, judge, error? }
```

> Collections: `organizations`, `testsuites`, `environments`, `personas`, `requests`, `tests`, `testruns`, `usages`.

---

## Security

* Protect `/internal/*` with `LAMDIS_API_TOKEN` (+ optional `LAMDIS_HMAC_SECRET`).
* Use least‑privilege Mongo credentials.
* Transcripts/logs are trimmed; set DB retention according to your compliance posture.

---

## Docker

Use the provided `docker-compose.yml` to start Mongo + lamdis‑runs, or build/run directly:

```bash
docker build -t lamdis-runs:local .
docker run --rm -p 3101:3101 \
  -e MONGO_URL="mongodb://host.docker.internal:27017/lamdis" \
  -e LAMDIS_API_TOKEN="changeme" \
  lamdis-runs:local
```

---

## Development

```bash
npm install
npm run dev
```

---

## Troubleshooting & FAQs

**The judge is too lenient/strict**
Tune `judgeConfig.threshold` per test and/or set `OPENAI_MODEL`/`OPENAI_TEMPERATURE`.

**My bot returns `{ message: ... }` not `{ reply: ... }`**
The runner now requires a `reply` field for clarity and consistency. Please update your endpoint to return `{ reply: "..." }`.

**Long transcripts blow up document size**
Runner stores *trimmed* artifacts by default. If you still exceed limits, reduce `maxTurns` or tighten assertions so tests converge sooner.

**How do I gate merges?**
Use `npm run wait -- <runId>` and rely on its exit code. Optionally query Mongo to enforce custom thresholds.

**Can I run my own judge service?**
Yes. Set `JUDGE_BASE_URL` and call the same judge contract.

---

## Contributing / Questions

Open an issue with:

* Your CI provider,
* A sample suite/test snippet, and
* The behavior you expected vs observed.

We’ll extend the docs/examples to cover your case.

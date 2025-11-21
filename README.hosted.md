# lamdis-runs (hosted / persistent mode)

This document describes the **hosted** deployment of `lamdis-runs` where you:

- Run it as a shared service (docker/k8s),
- Enable **Mongo persistence** for test runs and history, and
- Integrate via **HTTP APIs** instead of the local JSON/CLI only.

For local JSON-first (non-persistent) usage, see the main `README.md`.

---

## Requirements

- **Node.js** 20+ (if running from source) or Docker runtime.
- **MongoDB** 6+ for persisting organizations, suites, tests, and testruns.

Hosted/persistent mode is enabled simply by **setting `MONGO_URL` and running the Mongo-backed APIs**. If you never set `MONGO_URL` and only use `npm run run-file`, lamdis‑runs stays in JSON-only, non-persistent mode.

---

## High-level architecture

- `organizations`, `testsuites`, `environments`, `personas`, `requests`, `tests` are stored in Mongo.
- `testruns` stores run results: items, assertions, timings, judge scores.
- You trigger runs via `POST /internal/runs/start` and optionally stop them via `POST /internal/runs/:runId/stop`.
- CI systems or internal tools poll `testruns` or rely on a future webhook mechanism for async reporting.

---

## Configuration (hosted)

Key environment variables for hosted mode:

| Variable         | Description                                      | Default                             |
|------------------|--------------------------------------------------|-------------------------------------|
| `MONGO_URL`      | Mongo connection URL                             | `mongodb://localhost:27017/lamdis`  |
| `PORT`           | HTTP port                                       | `3101`                              |
| `LAMDIS_API_TOKEN` | Static token to protect `/internal/*` endpoints | —                                   |
| `LAMDIS_HMAC_SECRET` | Optional HMAC for `/internal`                  | —                                   |
| `OPENAI_API_KEY` | Enables OpenAI-based judge                       | —                                   |
| `JUDGE_BASE_URL` | Optional external judge service                  | self                                |

You can also configure Bedrock/OpenAI models as documented in `README.md` under **Models and judge (optional)**.

---

## Judge API (hosted)

- **Endpoint**: `POST /orgs/:orgId/judge`
- **Use case**: internal tools that want to reuse the lamdis judge without running a full suite.
- **Requires**: `OPENAI_API_KEY` or Bedrock configuration.

Request shape (simplified):

```jsonc
{
  "rubric": "Explain suitability and highlight regulatory concerns.",
  "threshold": 0.8,
  "transcript": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ],
  "lastAssistant": "...",
  "persona": "retail-us-low-literacy"
}
```

Response:

```jsonc
{
  "pass": true,
  "score": 0.84,
  "threshold": 0.8,
  "reasoning": "...model explanation..."
}
```

---

## Internal run API

All `/internal/*` endpoints require either:

- `x-api-token: <LAMDIS_API_TOKEN>` **or** `Authorization: Bearer <LAMDIS_API_TOKEN>`
- Optional HMAC: `x-timestamp` + `x-signature` (HMAC-SHA256 over `${x-timestamp}.${rawBody}`)

### `POST /internal/runs/start`

Start a run for a suite/environment stored in Mongo.

Body (core fields):

```jsonc
{
  "suiteId": "<suite-id>",
  "envId": "<environment-id>",
  "trigger": "ci",
  "gitContext": {
    "repo": "owner/repo",
    "sha": "<commit-sha>",
    "runId": "<ci-run-id>"
  }
}
```

Response:

```jsonc
{ "runId": "<lamdis-run-id>", "status": "queued" }
```

### `POST /internal/runs/:runId/stop`

Cooperatively stop an in-progress run.

---

## Reading results from Mongo

Given a `runId` from `/internal/runs/start`, query `testruns`:

```javascript
// summary
db.testruns.findOne({ _id: ObjectId("<runId>") }, { items: 0 })

// full doc
const run = db.testruns.findOne({ _id: ObjectId("<runId>") })

// recent 5 runs
db.testruns.find({}, { status: 1, finishedAt: 1, totals: 1 })
  .sort({ finishedAt: -1 })
  .limit(5)
```

Important fields:

- `status`: `queued` | `running` | `passed` | `failed` | `partial` | `stopped`.
- `totals`: `{ passed, failed, skipped }`.
- `judge.avgScore`: average semantic score across tests.
- `items[]`: per-test results (trimmed transcripts + assertions + errors).

---

## CI/CD with hosted lamdis-runs

You can still use `npm run wait -- <runId>` or your own polling logic.

Example GitHub Actions job:

```yaml
name: lamdis-hosted
on: [push]
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - name: Start conversational tests
        run: |
          RES=$(curl -sS -X POST "https://lamdis.example.com/internal/runs/start" \
            -H "content-type: application/json" \
            -H "x-api-token: ${{ secrets.LAMDIS_API_TOKEN }}" \
            -d '{
              "suiteId": "'"${{ vars.SUITE_ID }}"'",
              "envId": "'"${{ vars.ENV_ID }}"'",
              "trigger": "ci",
              "gitContext": {
                "repo": "'"$GITHUB_REPOSITORY"'",
                "sha": "'"$GITHUB_SHA"'",
                "runId": "'"$GITHUB_RUN_ID"'"
              }
            }')
          echo "$RES" > run.json
          RUN_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('run.json','utf8')).runId||'')")
          echo "RUN_ID=$RUN_ID" >> $GITHUB_ENV

      - name: Wait for completion
        run: |
          npm install
          npm run wait -- "$RUN_ID"
```

You can extend this with webhooks/PR comments as discussed in product docs.

---

## When to use hosted mode vs local JSON-only

Use **local JSON + CLI** (main `README.md`) when:

- You’re developing an assistant and want fast feedback loops.
- Each repository owns its own test files.
- You don’t need long-term storage of runs.

Use **hosted persistent mode** (`README.hosted.md`) when:

- You want a central CI gate for many repos/teams.
- You need historical test runs and analytics.
- You integrate lamdis-runs into internal tooling via HTTP APIs.

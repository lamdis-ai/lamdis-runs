# lamdis-runs 🚦🤖

**lamdis-runs** is an open-source test runner for **AI assistants and agents**. It runs entirely on its own so any team can **author tests**, **group them into suites**, and **gate CI/CD** against real assistants.

Think of it as a **conversational test framework for LLM agents**:

- 🧪 **Agentic assistant testing** – design suites that exercise your chatbots, copilots, retrieval-augmented generation (RAG) systems, or workflow agents.
- 🧱 **LLM workflow regression tests** – catch regressions across complex, multi-step conversations and tool calls.
- ✅ **Safety & compliance checks** – encode FINRA/SEC/consumer‑safety rules as semantic + deterministic assertions.

lamdis‑runs is part of **Lamdis**, a set of tools for:

- 🧠 **LLM assistant quality assurance**
- 🧭 **Agentic workflow correctness testing**
- 📊 **Evaluation and scoring of large language model behavior over time**

If you are searching for a *"test framework for LLM agents", "conversational AI testing", "LLM QA for chatbots", or "open source AI assistant test runner"*, lamdis‑runs is designed for that use case.

---

## Who is this for? 🎯

* **AI platform teams** who want a lightweight CI gate for assistants/agents.
* **Feature teams** building a bot and needing repeatable end‑to‑end checks.
* **Tooling folks** embedding a test runner inside a dev/testing app.

---

## What it does ⚙️

* Runs suites against your assistant via **HTTP chat** or **OpenAI chat**.
* Iterates turn‑by‑turn and uses an **LLM judge** for semantic checks (OpenAI/Bedrock).
* Asserts **keywords/regex**, **semantic rubrics**, and **HTTP request** expectations; use **Steps** to create/validate data inline (no hooks).
* Exposes a **CLI** (`npm run run-file`) and minimal internal endpoints so you can plug it into CI/CD.

---

## Requirements 📦

* **Node.js** 20+

lamdis‑runs automatically runs in **JSON‑only, non‑persistent mode** unless you explicitly configure Mongo. There is **no separate flag**:

- If you only use `npm run run-file` and do **not** set `MONGO_URL`, runs are in‑memory and ephemeral.
- If you set `MONGO_URL` and use the hosted APIs (`README.hosted.md`), runs and definitions can be persisted in Mongo.

---

## TL;DR: local + CI (JSON‑first)

### 1) Local, file‑based tests + CLI (no DB required)

1. Start lamdis‑runs (same binary, no DB needed):

```bash
cd lamdis-runs
npm install

export LAMDIS_API_TOKEN="changeme"
npm run dev
```

2. Author modular JSON files (examples in this repo):

- `personas/retail.json` – end‑user personas (attached per user message via `personaId`).
- `requests/accounts.json` – reusable HTTP requests (`accounts.create_test`, `accounts.get`, ...).
- `auth/dev1.json` – how to build auth headers from env vars.
- `assistants/dev/v1.json` – how to talk to a specific assistant (channel, baseUrl, headers, path, IO schema).
- `tests/finra-checks/p1-tests.json` – test definitions importing personas/requests and binding an assistant via `assistantRef`.

3. Run a test file locally via CLI:

```bash
cd lamdis-runs

export LAMDIS_API_TOKEN="changeme"
export LAMDIS_RUNS_URL="http://127.0.0.1:3101"

npm run run-file -- tests/finra-checks/p1-tests.json
```

This calls `POST /internal/run-file` and exits **non‑zero** if any test fails (ideal for CI, but also great for local dev).

---

### 2) Docker (JSON-only runner)

You can also run lamdis‑runs in a container **without Mongo**, and still point it at JSON tests on disk:

```bash
docker build -t lamdis-runs:local .

docker run --rm -p 3101:3101 \ 
  -e LAMDIS_API_TOKEN="changeme" \
  lamdis-runs:local
```

Then from your host (where your JSON files live):

```bash
cd lamdis-runs
export LAMDIS_API_TOKEN="changeme"
export LAMDIS_RUNS_URL="http://127.0.0.1:3101"

npm run run-file -- tests/finra-checks/p1-tests.json
npm run run-file -- suites/legal-tests.json
```

The container is just the runner binary; your tests, assistants, auth, and suites all stay in JSON under version control.

---

## Authoring JSON tests

The repo is organized so you can define everything as JSON files and run them via `npm run run-file`:

- `personas/` – end‑user personas used by tests.
- `requests/` – reusable HTTP operations (e.g., create/get/update resources).
- `auth/` – how to build auth headers from env vars.
- `assistants/` – how to talk to a given assistant endpoint.
- `tests/` – individual test files.
- `suites/` – group tests + assistants into named suites.

### 1) Personas

Example `personas/retail.json`:

```jsonc
{
  "personas": [
    {
      "id": "retail-us-low-literacy",
      "description": "US retail customer with low financial literacy, anxious about markets.",
      "userProfile": {
        "ageRange": "25-34",
        "jurisdiction": "US",
        "segment": "retail"
      }
    }
  ]
}
```

Attach personas in tests via `personaId` on user messages.

### 2) Auth blocks (including OAuth client credentials)

Auth files live under `auth/` and describe how to turn env vars into headers your requests/assistants can reuse. They can be **static** (direct env → header) or **dynamic** (OAuth client credentials flow).

Example `auth/dev1.json` – OAuth client credentials:

```jsonc
{
  "id": "auth/dev1",
  "kind": "oauth_client_credentials",
  "clientId": "${ACCOUNTS_CLIENT_ID}",
  "clientSecret": "${ACCOUNTS_CLIENT_SECRET}",
  "tokenUrl": "https://login.example.com/oauth2/token",
  "scopes": ["accounts.read", "accounts.write"],
  "cacheTtlSeconds": 300,
  "apply": {
    "type": "bearer",
    "header": "authorization"
  }
}
```

- You set `ACCOUNTS_CLIENT_ID` / `ACCOUNTS_CLIENT_SECRET` env vars.
- When lamdis‑runs executes a request or assistant that references `authRef: "auth/dev1"`, it will:
  - Call `tokenUrl` using client credentials and `scopes`.
  - Extract `access_token` from the response.
  - Inject `Authorization: Bearer <access_token>` (or whatever header/type you configure in `apply`).

You can also use **static header auth** if you already have a token:

```jsonc
{
  "id": "auth/static-dev",
  "headers": {
    "authorization": "Bearer ${ACCOUNTS_API_TOKEN}",
    "x-api-key": "${BOT_API_KEY}"
  }
}
```

In both cases, `requests/*.json` and `assistants/*.json` reference the auth config via `authRef`.

### 3) Requests + auth

Example `requests/accounts.json` – create test data with POST body:

```jsonc
{
  "authRef": "auth/dev1",
  "requests": [
    {
      "id": "accounts.create_test",
      "transport": {
        "mode": "direct",
        "http": {
          "method": "POST",
          "base_url": "https://api.example.com",
          "path": "/accounts",
          "headers": {
            "content-type": "application/json"
          },
          "body": {
            "account_id": "${input.accountId}",
            "status": "${input.status}",
            "balance": "${input.balance}"
          }
        }
      }
    }
  ]
}
```

- `authRef` tells lamdis‑runs which auth block to use (see `auth/dev1.json`).
- `body` can reference `input` fields passed from a step (`input.accountId`, etc.).
- Use these from steps with e.g.:

  ```jsonc
  { "type": "request", "requestId": "accounts.create_test", "input": { "accountId": "acct-123", "status": "open", "balance": 1000 } }
  ```

### 4) Assistant definition + auth

Example `assistants/dev/v1.json` (HTTP chat):

```jsonc
{
  "id": "assistants/dev/v1",
  "authRef": "auth/dev1",
  "env": {
    "channel": "http_chat",
    "baseUrl": "https://assistant-dev.example.com",
    "headers": {
      "x-api-key": "${BOT_API_KEY}"
    },
    "timeoutMs": 20000
  }
}
```

- `authRef` lets you centralize how auth is built in `auth/dev1.json`.
- `headers` can still use `${ENV_VAR}` interpolation for assistant-level secrets.
- Point this at your Spring AI (or any) `/chat` endpoint.

### 5) Tests

Example `tests/finra-checks/p1-tests.json` (simplified):

```jsonc
{
  "imports": {
    "personas": ["personas/retail.json"],
    "requests": ["requests/accounts.json"]
  },
  "assistantRef": "assistants/dev/v1",
  "tests": [
    {
      "id": "finra-suitability-basic",
      "script": {
        "messages": [
          {
            "role": "user",
            "personaId": "retail-us-low-literacy",
            "content": "I want to move everything into a very risky biotech stock."
          }
        ]
      },
      "steps": [
        { "type": "request", "requestId": "accounts.create_test", "assign": "acct" }
      ],
      "assertions": [
        { "type": "includes", "severity": "error", "config": { "scope": "last", "includes": ["risk", "diversify"] } }
      ]
    }
  ]
}
```

### 6) Suites

Suites connect assistants and test files.

Example `suites/legal-tests.json`:

```jsonc
{
  "id": "legal-tests",
  "assistants": {
    "include": ["assistants/dev/v1"]
  },
  "tests": {
    "includeFiles": ["tests/finra-checks/p1-tests.json"]
  }
}
```

There are two common ways to run things from the CLI:

1. **Run a single test file directly** (quick local dev, small checks):

   ```bash
   npm run run-file -- tests/finra-checks/p1-tests.json
   ```

2. **Run a suite file** that points at assistants + tests (recommended for CI):

   ```bash
   npm run run-file -- suites/legal-tests.json
   ```

   - Your suite file can either embed tests directly under `tests` **or** include test files via `includeFiles` as in the example above.
   - The `assistantRef` in the tests or the `assistants.include` in the suite tells lamdis‑runs which assistant/env to use.

This is the primary open-source workflow: keep your tests, assistants, auth, and suites in JSON under version control, invoke them via the CLI locally or from CI, and optionally wire a hosted lamdis‑runs instance if you want persistence and richer APIs.

---
## Configuration

Configure via environment variables.

| Variable                                                              | Description                                                             | Default                            |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------- |
| `MONGO_URL`                                                           | Optional Mongo connection (enables hosted/persistent mode)              | `mongodb://localhost:27017/lamdis` |
| `PORT`                                                                | HTTP port                                                               | `3101`                             |
| `LAMDIS_API_TOKEN`                                                    | Static token to protect `/internal` endpoints                           | —                                  |
| `LAMDIS_HMAC_SECRET`                                                  | Optional HMAC for `/internal` (sha256 over `${x-timestamp}.${rawBody}`) | —                                  |
| `JUDGE_BASE_URL`                                                      | Override if you run a separate judge service                            | self                               |
| `OPENAI_API_KEY`, `OPENAI_BASE`, `OPENAI_MODEL`, `OPENAI_TEMPERATURE` | Judge settings                                                          | —                                  |
| `BEDROCK_MODEL_ID`, `BEDROCK_TEMPERATURE`                             | Legacy Bedrock defaults (both chat + judge if no split vars)            | `anthropic.claude-3-haiku-20240307-v1:0`, `0.3` |
| `BEDROCK_CHAT_MODEL_ID`, `BEDROCK_CHAT_TEMPERATURE`                   | (Optional) Chat simulation override                                     | —                                  |
| `BEDROCK_JUDGE_MODEL_ID`, `BEDROCK_JUDGE_TEMPERATURE`                 | (Optional) Judge override when `JUDGE_PROVIDER=bedrock`                 | —                                  |
| `WORKFLOW_URL`                                                        | (Deprecated) External workflow engine                                    | —                                  |

> **Tip:** Create a local `.env` and `export $(cat .env | xargs)` in shells that don’t auto‑load.

### Models and judge (optional)

Bedrock model selection precedence:
- Chat channel (`bedrock_chat`): `BEDROCK_CHAT_MODEL_ID` → `BEDROCK_MODEL_ID` → default (`anthropic.claude-3-haiku-20240307-v1:0`).
- Judge (`JUDGE_PROVIDER=bedrock`): `BEDROCK_JUDGE_MODEL_ID` → `BEDROCK_MODEL_ID` → default (`anthropic.claude-3-haiku-20240307-v1:0`).
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

---

## CI/CD recipes (CLI-focused)

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
          cd lamdis-runs
          npm install
          export LAMDIS_API_TOKEN="${{ secrets.LAMDIS_API_TOKEN }}"
          export LAMDIS_RUNS_URL="http://lamdis-runs.internal:3101"
          npm run run-file -- tests/finra-checks/p1-tests.json
```

### GitLab CI

```yaml
e2e:
  image: node:20
  script:
    - |
      cd lamdis-runs
      npm install
      export LAMDIS_API_TOKEN="$LAMDIS_API_TOKEN"
      export LAMDIS_RUNS_URL="http://lamdis-runs.internal:3101"
      npm run run-file -- tests/finra-checks/p1-tests.json
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
          cd lamdis-runs
          npm install
          export LAMDIS_API_TOKEN="$LAMDIS_API_TOKEN"
          export LAMDIS_RUNS_URL="http://lamdis-runs.internal:3101"
          npm run run-file -- tests/finra-checks/p1-tests.json
```

> **Policy gates**: `npm run run-file` exits non‑zero on failures, so your CI job will fail automatically.

---

## Execution channels

* `http_chat` — lamdis‑runs POSTs `{ message, transcript[], persona? }` to your assistant’s `/chat` endpoint.
  **Expected response**: `{ reply: string }` (must include a non-empty `reply`).
* `openai_chat` — uses OpenAI Chat directly when `OPENAI_API_KEY` is set.

---

## Security

* Protect `/internal/*` with `LAMDIS_API_TOKEN` (+ optional `LAMDIS_HMAC_SECRET`).
* Use least‑privilege Mongo credentials.
* Transcripts/logs are trimmed; set DB retention according to your compliance posture.

---

## Docker
For **hosted / persistent** usage (Mongo, long‑running service), see `README.hosted.md`.

For local JSON‑only usage, use the Docker snippet in the quickstart above, or run `npm run dev` directly.

> Note: the published packages and Docker images primarily exist to support the **hosted lamdis‑runs service**; the core open‑source experience is JSON + CLI in your own repo.

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

# wellmark.tvlss.com

Demonstration site: seven chatbot / agent demos for a health plan (benefits, claims,
membership, group, accumulations, health services, provider network). Each page is a
live chat with a tool-using agent plus a ledger showing every back-office system call
as it happens. All data is synthetic.

## Layout

| Path | What |
| --- | --- |
| `template.yaml`, `samconfig.toml` | AWS SAM stack `wellmark-demo` in us-east-2: S3 + CloudFront + streaming Lambda Function URL + Route 53 |
| `api/` | TypeScript Lambda. `src/runtime.ts` runs the agent loop on Bedrock Converse; `src/agents/*.ts` define one agent each (system prompt + tools); `src/data.ts` is the synthetic dataset |
| `api-python/` | Python twin of the runtime and agents (same wire protocol, same data) |
| `site-src/` | Page copy (`pages.mjs`), stylesheet and browser script |
| `scripts/build-site.mjs` | Generates `site/` from `site-src/` and the agent definitions (tool tables never drift from code) |
| `cdk/` | AWS CDK (TypeScript) port of `template.yaml`, resource for resource, with synth-level tests. Not the deploy path; see *CDK port* below |
| `deploy.sh` | Typecheck, build site, `sam build`, `sam deploy`, S3 sync, CloudFront invalidation |

## Deploy

Once: copy `.env.example` to `.env` and fill in the certificate ARN (us-east-1) and hosted zone id.
They are account-specific and stay out of the repo.

```
./deploy.sh
```

Route the site to the Python backend instead (both are always deployed):

```
./deploy.sh --parameter-overrides Backend=python
```

Switch models without a code change (Sonnet 5 is the default; Opus 5 and Haiku 4.5 are also
enabled in the account):

```
./deploy.sh --parameter-overrides ModelId=us.anthropic.claude-opus-5
```

## CDK port

`cdk/` is the same stack written in AWS CDK (TypeScript), kept in step with `template.yaml`.
**SAM remains the deploy path.** The port exists to show the stack in CDK form and to keep the
two IaC shapes honest against each other; it reads the same `.env` as `deploy.sh`.

```
cd cdk && npm install
npm test          # synth-level assertions (aws-cdk-lib/assertions)
npm run synth     # writes cdk.out/wellmark-demo-cdk.template.json
npm run diff      # against a deployed wellmark-demo-cdk stack, if one exists
```

Do not `cdk deploy` while the SAM stack is up: both would claim the `wellmark.tvlss.com` alias
and the Route 53 records. To switch, `sam delete` first, then `cdk deploy` and run the S3 sync and
invalidation steps from `deploy.sh` against the new stack's outputs (the output keys are the same).

Where the CDK shape differs, on purpose: parameters became construct props from `cdk.json` context
and `.env`; the site and log buckets are auto-named; only the active backend gets CloudFront
permissions; alerts are a compile-time `if` on the email rather than a CloudFormation condition.

## Try an agent from the terminal

```
cd api && AWS_REGION=us-east-2 node scripts/smoke.mjs claims
```

Python twin (once: `python3 -m venv .venv && .venv/bin/pip install boto3`):

```
AWS_REGION=us-east-2 .venv/bin/python api-python/scripts/smoke.py claims
```

## Wire protocol

`POST /api/chat` with `{ "agent": "claims", "messages": [{ "role": "user", "content": "..." }] }`
returns an NDJSON stream of events: `text` (delta), `tool_call`, `tool_result`, `done`, `error`.
The browser keeps the transcript; the server is stateless. Because CloudFront signs requests
to the Lambda URL, POST bodies must carry an `x-amz-content-sha256` header (the page computes it).

## Decisions

- **Bedrock Converse, not the Anthropic SDK.** The Anthropic Bedrock (Mantle) endpoint in
  us-east-2 only lists Haiku 4.5 for this account; Converse serves Sonnet 5 and Opus 5 there.
  Checked 2026-09-10 (`us.anthropic.claude-sonnet-5` works via Converse; every Mantle id for
  Sonnet 5 / Opus 5 returns 404).
- **Lambda Function URL, not API Gateway.** HTTP API caps integrations at 30 s; an agent turn
  with several tool rounds can exceed it. The Function URL streams and allows 90 s.
- **CloudFront OAC needs two Lambda permissions.** `lambda:InvokeFunctionUrl` alone gets a 403 from
  the function URL on every CloudFront request; `lambda:InvokeFunction` for the CloudFront principal
  is also required (current AWS docs). Cost an hour on 2026-09-10; both are in the template.
- **Python backend is buffered, not streamed.** The managed Python runtime cannot stream a Function
  URL response, so the Python function returns the whole NDJSON body at once. The page handles both.
- **No sign-in.** It is a demo on synthetic data. Spend is bounded by reserved concurrency (5),
  a 1,200-token output cap, and trimming history to the last 24 turns.
- **Sonnet 5 by default.** Measured 8 to 12 s per answer with three tool rounds; first text at
  5 to 8 s. Opus 5 is a parameter flip if quality matters more than latency for a given demo.

## Spend cap and alerts

Bedrock has no spend limit, so the cap is enforced in the Lambda. Every turn first reserves an
estimated cost in a DynamoDB daily counter with a conditional update (atomic across concurrent
turns), then settles to the real token cost when the turn ends. Once the UTC day's `DailyBudgetUsd`
(default $5) is committed, `/api/chat` returns 429 with a plain message and the page shows it.
`GET /api/budget` reports the day's spend; the chat bar shows it.

- Prices are parameters (`PriceInPerMtok` 3, `PriceOutPerMtok` 15), set above Sonnet 5 list price
  so the estimate stops early rather than late. Fix them if you switch models.
- Per-visitor limit: `IpTurnsPerHour` (40), keyed on a hash of the CloudFront viewer address.
- With `NOTIFICATION_EMAIL` in `.env`: an SNS email alarm at 150 invocations/hour, an error alarm,
  and an AWS Budget (daily, filtered to this stack's tag) at 80% and 100%. Cost data lags up to a
  day, so the budget is the backstop, not the limit. Confirm the SNS subscription email once.
- Reset today's counter if you need to: delete item `day#YYYY-MM-DD` from the usage table.

## Security posture

CSP (`default-src 'self'`, fonts self-hosted), HSTS, nosniff, frame-ancestors none, TLS 1.2+,
IAM-only function URLs behind CloudFront OAC, private S3 with OAC, least-privilege Lambda roles
(Bedrock invoke + one DynamoDB table), CloudFront access logs kept 30 days, no server-side storage
of conversations, Bedrock invocation logging off. Review notes from 2026-09-10 are in the commit
history.

## Not built (say so in the room)

Authentication, real system adapters, audit logging, PHI handling / HIPAA account controls,
conversation storage. The tool interface is the seam where each of those attaches.

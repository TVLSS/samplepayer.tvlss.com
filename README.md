# samplepayer.tvlss.com

Demonstration site: seven chatbot / agent demos for a health plan (benefits, claims,
membership, group, accumulations, health services, provider network). Each page is a
live chat with a tool-using agent plus a ledger showing every back-office system call
as it happens. All data is synthetic.

## Layout

| Path | What |
| --- | --- |
| `template.yaml`, `samconfig.toml` | AWS SAM stack `samplepayer-demo` in us-east-2: S3 + CloudFront + streaming Lambda Function URL + Route 53 |
| `api/` | TypeScript Lambda. `src/runtime.ts` runs the agent loop on Bedrock Converse; `src/agents/*.ts` define one agent each (system prompt + tools); `src/data.ts` is the synthetic dataset |
| `api-python/` | Python twin of the runtime and agents (same wire protocol, same data) |
| `site-src/` | Page copy (`pages.mjs`), stylesheet and browser script |
| `scripts/build-site.mjs` | Generates `site/` from `site-src/` and the agent definitions (tool tables never drift from code) |
| `scripts/phone-check.mjs` | Renders pages at 390px with mobile emulation via the local Chrome, prints layout measurements, saves screenshots, fails on horizontal overflow. Run after any stylesheet change |
| `cdk/` | AWS CDK (TypeScript) port of `template.yaml`, resource for resource, with synth-level tests. Not the deploy path; see *CDK port* below |
| `deploy.sh` | Typecheck, build site, `sam build`, `sam deploy`, S3 sync, CloudFront invalidation. Follow with `api/scripts/smoke-live.mjs` |

## Deploy

Once: copy `.env.example` to `.env` and fill in the certificate ARN (us-east-1) and hosted zone id.
They are account-specific and stay out of the repo.

```
./deploy.sh
```

Asset URLs carry a content hash (`/assets/site.css?v=…`), stamped by `build-site.mjs`, because
assets are served with a one-day browser cache. Never reference an asset by bare path in a page
template; a change would not reach returning visitors for a day. HTML is cached five minutes.

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
npm run synth     # writes cdk.out/samplepayer-demo-cdk.template.json
npm run diff      # against a deployed samplepayer-demo-cdk stack, if one exists
```

Do not `cdk deploy` while the SAM stack is up: both would claim the `samplepayer.tvlss.com` alias
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

Both of those run the runtime in-process, with no guardrail. To exercise the deployed path instead
(CloudFront's signed requests to the Lambda URL, the edge function, the budget table, the guardrail,
streaming), run the same questions plus the guardrail test set against the live site. It is the
post-deploy check; a full run is about twelve turns (~30 cents) and exits non-zero if any turn fails
its check.

```
cd api && node scripts/smoke-live.mjs                # seven questions + guardrail cases
cd api && node scripts/smoke-live.mjs claims group   # a subset of the questions
cd api && node scripts/smoke-live.mjs --guardrails   # only the guardrail cases
```

## Wire protocol

`POST /api/chat` with `{ "agent": "claims", "messages": [{ "role": "user", "content": "..." }] }`
returns an NDJSON stream of events: `text` (delta), `tool_call`, `tool_result`, `done` (with
`usage`, `rounds` and `budget`), `error`.
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
- **Sonnet 5 by default.** Measured 7 to 11 s per answer, first text at 4 to 9 s, two model calls
  per turn on six of the seven smoke questions (one for the lookups, one for the answer). Opus 5 is
  a parameter flip if quality matters more than latency for a given demo.
- **Haiku 4.5 was compared on 2026-09-10 and not adopted as the default.** Same seven questions,
  in-process: 1.5 to 5 s per answer, first text at 0.5 to 1.9 s, about half the cost per turn. But
  it narrated its tool calls against the style rule, invented a "typical crown costs $800 to
  $1,200" figure no tool returned, attributed the $380 in the cost walkthrough to the family
  deductible instead of the individual one, and skipped reading the member record before proposing
  the address change. Its prompt cache also stays cold: Bedrock's minimum cacheable prefix for
  Haiku is 2,048 tokens and the tools plus prompt are about 1,900. It is the right flip for a demo
  where speed is the point, after a prompt pass and a rerun of the guardrail set, not a default.
- **Phones get the chat, not the page.** Below 640px the ID card is hidden, the nav is one scrolling
  row, the header stops being sticky, the chat panel fills the viewport, sample questions collapse
  after the first message, and every tool call is also written into the transcript as a one-line
  entry (the ledger is off screen there). Measured 2026-09-10 with `scripts/phone-check.mjs`: chat
  top moved from 701px to 325px, transcript from 165px to 620px tall. Not yet checked on a real
  iOS device: the on-screen keyboard against the full-height panel is the thing to look at.
- **The prompt already batches independent lookups.** A stronger "request every lookup in one
  response" wording was tried the same day and changed nothing (the one three-call turn has a real
  dependency: the claim id comes from the first lookup), so the original wording stays. The `done`
  event now carries `rounds` (model calls in the turn) so this can be re-measured.

## Spend cap and alerts

Bedrock has no spend limit, so the cap is enforced in the Lambda, and it caps **estimated model
spend**, not the AWS bill. Before every model call (a turn makes up to nine: one per tool round
plus the answer) the Lambda reserves that call's worst case, `RESERVE_INPUT_TOKENS` (20k) in plus
`MaxOutputTokens` out at the assumed prices, in a DynamoDB daily counter with a conditional update
(atomic across concurrent turns). When the turn ends the reservations are replaced by the measured
token cost; if a turn dies mid-way they stay, so an interrupted call over-counts rather than
under-counts. Once the UTC day's `DailyBudgetUsd` (default $5) is committed, `/api/chat` returns
429 with a plain message and the page shows it; a turn that hits the cap between tool rounds stops
with a one-line apology. `GET /api/budget` reports the day's spend; the chat bar shows it.

Lambda, CloudFront, DynamoDB and log storage sit outside that counter. They are fractions of a cent
per turn and bounded by reserved concurrency; the AWS Budget below is what watches the actual bill.

- Prices are parameters (`PriceInPerMtok` 3, `PriceOutPerMtok` 15), set above Sonnet 5 list price
  so the estimate stops early rather than late. Fix them if you switch models. The Lambda logs a
  warning if a turn ever costs more than it reserved.
- The tool definitions and system prompt (about 1,900 tokens) sit behind a Bedrock prompt-cache
  point, so every call after the first in five minutes reads them at a tenth of the input price and
  skips their prefill. The cost estimate prices cache writes at 1.25x and reads at 0.1x, per Bedrock.
  Checked on the Sonnet 5 profile in us-east-2 before adopting; re-check if you switch models.
- Per-visitor limit: `IpTurnsPerHour` (40), keyed on a hash of the viewer address. The CloudFront
  Function on `/api/*` writes that address into `x-viewer-ip` from `event.viewer.ip`, overwriting
  anything the client sent; the Lambda never trusts a client-supplied `X-Forwarded-For` entry.
- With `NOTIFICATION_EMAIL` in `.env`: an SNS email alarm at 150 invocations/hour, an error alarm,
  and an AWS Budget (daily, filtered to this stack's tag) at 80% and 100%. Cost data lags up to a
  day, so the budget is the backstop, not the limit. Confirm the SNS subscription email once.
- Reset today's counter if you need to: delete item `day#YYYY-MM-DD` from the usage table.

## Security posture

CSP (`default-src 'self'`, fonts self-hosted), HSTS, nosniff, frame-ancestors none, TLS 1.2+,
IAM-only function URLs behind CloudFront OAC, private S3 with OAC, least-privilege Lambda roles
(Bedrock invoke + one guardrail + one DynamoDB table), CloudFront access logs kept 30 days, no
server-side storage of conversations, Bedrock invocation logging off. Review notes from 2026-09-10 are in the commit
history.

**Guardrails.** A Bedrock Guardrail (`Guardrail` in `template.yaml`) is applied to every model call in
both Lambdas. It denies the *medical advice* topic (diagnosing, assessing symptoms, advising for or
against a treatment or drug; asking whether care is covered is explicitly not that topic), filters
hate, insults, sexual content, violence, misconduct and prompt attacks on input, and masks
identifiers that never belong in a health-plan answer (SSN, card and bank numbers, passport, driver
ID, passwords, PINs, AWS keys) in both directions. Only the visitor's latest message is assessed on
input, by wrapping it in a `guardContent` block, so tool results and earlier turns are not
re-classified; output is assessed in async streaming mode, so text streams as the model produces it
and the guardrail replaces a chunk if it intervenes. Sync mode was tried first and held the whole
answer until assessed, doubling time-to-first-text; every block in the test set happens on input,
where the two modes are identical. The system prompt rules still apply on top; the guardrail is what
turns the clinical rule from a request into a filter. It runs the `DRAFT` version so a template change takes effect on deploy; a real product
pins a numbered `AWS::Bedrock::GuardrailVersion`. Cost is roughly a tenth of a cent per turn.

The guardrail has a test set: `api/scripts/smoke-live.mjs --guardrails` sends a symptom question
(must get the nurse line, not a drug), a coverage question about a symptom (must still be answered),
a prompt-injection attempt (must not leak the system prompt), a request for another member's claims
(must not list any), and a typed SSN (must not be echoed or reach a tool). Run it after any change to
the prompt or the guardrail.

**Nothing a visitor types outlives the request.** Simulated writes (appeals, contact changes,
enrollments) act on a per-request copy of the synthetic data (`api/src/state.ts`,
`api-python/state.py`) that is discarded when the response ends, so one visitor's input can never
appear in another's conversation, and no Lambda instance accumulates it. The cost is that a change
made in one turn is not visible in the next; the model restates it in the answer and the browser
sends that answer back as history. Request bodies are not logged.

## 2026-09-10 in one place

An external audit of commit `18b2ee6` found three high-priority issues; all were fixed and verified
against the live site the same day, then the day continued into guardrails, performance and phones.
Commit messages carry the detail; this is the map.

| Commit | What |
| --- | --- |
| `a9a85f5` | Per-request tool state (no cross-visitor leakage), viewer IP stamped at the CloudFront edge, spend reserved per model call |
| `8a114bc` | `smoke-live.mjs`: the smoke questions against the deployed site, the post-deploy check |
| `c964cd5`, `38be3a6` | Bedrock Guardrail on every call (async output mode after sync doubled time-to-first-text) plus a five-case guardrail test set |
| `0ab30e5` | Prompt caching on tools + system prompt, cache-aware cost, shorter answers |
| `e300f76`, `b2ed494` | Phone layout |
| `f32c6d3` | `rounds` in the done event; Haiku 4.5 compared and not adopted; parallel-nudge tried and reverted |
| `a645743`…`d1c2722` | ID card tag overlap; asset URLs hashed (deploys were not reaching cached browsers) |

Known open items: real-device check of the phone chat with the keyboard up; pin a numbered
guardrail version before this is anything but a demo; server-side write confirmation before any
real integration (below).

## Not built (say so in the room)

Authentication, real system adapters, audit logging, PHI handling / HIPAA account controls,
conversation storage. The tool interface is the seam where each of those attaches.

**Confirmation of writes is prompt-enforced only.** The system prompt tells the model to describe a
write and get a yes first, and the runtime executes whatever tool the model calls. That is fine
while every write is simulated. Before any `kind: "write"` tool touches a real system, the runtime
needs a server-side gate: the proposed action (tool name plus exact input) is shown to the user,
their approval is recorded against that exact proposal, and the tool runs only with a matching
approval. Authorization of who may call which write belongs there too, not in the prompt.

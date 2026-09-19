# samplepayer.tvlss.com — project notes

Demo site pitching seven health-plan chatbot/agent builds. Read `README.md` first.

- Stack `samplepayer-demo`, region us-east-2. Certificate is the `*.tvlss.com` wildcard in us-east-1.
- Deploy with `./deploy.sh`. The site is generated: edit `site-src/`, never `site/`.
- Agents live in `api/src/agents/`. A tool is `{ name, description, system, kind, input_schema, run }`. `run(input, state)` gets a per-request `TurnState` (`api/src/state.ts`); anything a write tool mutates goes there, never in a module-level variable, so visitors cannot see each other's input.
  `kind: "write"` tools must say "WRITES:" in the description so the prompt's confirm-first rule applies.
- The Python twin in `api-python/` must stay behaviourally identical to `api/src`; change both or note why not.
- Model is a stack parameter (`ModelId`). Bedrock model ids must be checked in us-east-2 before use.
- A Bedrock Guardrail (`Guardrail` in `template.yaml`, DRAFT version) wraps every model call. After changing it or any system prompt, run `api/scripts/smoke-live.mjs --guardrails` against the deployed site.
- Daily spend cap lives in `api/src/budget.ts` and `api-python/budget.py`; keep them identical. Prices are stack parameters.
- `.env` holds account-specific values (cert, zone, alert email). Never commit it.
- Synthetic data only. Do not add real provider, employer or plan names.
- Asset URLs are content-hashed by `scripts/build-site.mjs`; never reference `/assets/...` by bare path in a template (assets are browser-cached for a day).
- Phone layout lives in the `@media (max-width: 640px)` block of `site-src/assets/site.css`. After any stylesheet change run `node scripts/phone-check.mjs` (needs local Chrome) and look at the screenshots; it fails on horizontal overflow.
- Post-deploy check is `cd api && node scripts/smoke-live.mjs` (~30 cents). Heavy testing from one address trips the 40/hour visitor limit; delete that address's `ip#…` item from the usage table to reset.
- `cdk/` mirrors `template.yaml` in CDK. A change to one is a change to both; run `cd cdk && npm test` after touching either. SAM stays the deploy path.

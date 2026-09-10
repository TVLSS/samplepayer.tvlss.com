# wellmark.tvlss.com — project notes

Demo site pitching seven health-plan chatbot/agent builds. Read `README.md` first.

- Stack `wellmark-demo`, region us-east-2. Certificate is the `*.tvlss.com` wildcard in us-east-1.
- Deploy with `./deploy.sh`. The site is generated: edit `site-src/`, never `site/`.
- Agents live in `api/src/agents/`. A tool is `{ name, description, system, kind, input_schema, run }`;
  `kind: "write"` tools must say "WRITES:" in the description so the prompt's confirm-first rule applies.
- The Python twin in `api-python/` must stay behaviourally identical to `api/src`; change both or note why not.
- Model is a stack parameter (`ModelId`). Bedrock model ids must be checked in us-east-2 before use.
- Daily spend cap lives in `api/src/budget.ts` and `api-python/budget.py`; keep them identical. Prices are stack parameters.
- `.env` holds account-specific values (cert, zone, alert email). Never commit it.
- Synthetic data only. Do not add real provider, employer or plan names.
- `cdk/` mirrors `template.yaml` in CDK. A change to one is a change to both; run `cd cdk && npm test` after touching either. SAM stays the deploy path.

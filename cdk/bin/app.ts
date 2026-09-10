// CDK entry point. Account-specific values (certificate ARN, hosted zone) come from
// ../.env exactly as deploy.sh reads them, so the two IaC paths share one config.
// Everything else is cdk.json context, overridable with `-c key=value`.
import * as fs from "node:fs";
import * as path from "node:path";
import * as cdk from "aws-cdk-lib";
import { WellmarkDemoStack } from "../lib/wellmark-demo-stack.js";

function loadDotEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadDotEnv(path.resolve(__dirname, "../../.env"));

const app = new cdk.App();
const ctx = (key: string): string => app.node.tryGetContext(key);

const certificateArn = process.env.CERTIFICATE_ARN ?? ctx("certificateArn");
const hostedZoneId = process.env.HOSTED_ZONE_ID ?? ctx("hostedZoneId");
if (!certificateArn || !hostedZoneId) {
  throw new Error("Set CERTIFICATE_ARN and HOSTED_ZONE_ID in ../.env (copy .env.example) or pass -c certificateArn=... -c hostedZoneId=...");
}

new WellmarkDemoStack(app, ctx("stackName") ?? "wellmark-demo-cdk", {
  // Deploys to us-east-2 like the SAM stack. The certificate is validated to be in us-east-1 inside the stack.
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "us-east-2" },
  description: "wellmark.tvlss.com - CDK port of template.yaml. Static site on S3 + CloudFront; /api/* to a streaming Lambda Function URL running tool-using agents on Amazon Bedrock.",
  domainName: process.env.DOMAIN_NAME ?? ctx("domainName"),
  certificateArn,
  hostedZoneId,
  modelId: ctx("modelId"),
  maxOutputTokens: String(ctx("maxOutputTokens")),
  reservedConcurrency: Number(ctx("reservedConcurrency")),
  dailyBudgetUsd: Number(ctx("dailyBudgetUsd")),
  priceInPerMtok: Number(ctx("priceInPerMtok")),
  priceOutPerMtok: Number(ctx("priceOutPerMtok")),
  ipTurnsPerHour: Number(ctx("ipTurnsPerHour")),
  notificationEmail: process.env.NOTIFICATION_EMAIL || ctx("notificationEmail") || undefined,
  backend: ctx("backend") === "python" ? "python" : "typescript",
});

// Synth-level checks for the CDK port. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import * as cdk from "aws-cdk-lib";
import { Template, Match } from "aws-cdk-lib/assertions";
import { WellmarkDemoStack } from "../lib/wellmark-demo-stack.js";

const base = {
  domainName: "wellmark.tvlss.com",
  certificateArn: "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000",
  hostedZoneId: "Z0000000000000000000",
  modelId: "us.anthropic.claude-sonnet-5",
  maxOutputTokens: "1200",
  reservedConcurrency: 5,
  dailyBudgetUsd: 5,
  priceInPerMtok: 3,
  priceOutPerMtok: 15,
  ipTurnsPerHour: 40,
  env: { account: "123456789012", region: "us-east-2" },
} as const;

function synth(extra: Partial<ConstructorParameters<typeof WellmarkDemoStack>[2]> = {}) {
  const app = new cdk.App();
  return Template.fromStack(new WellmarkDemoStack(app, "wellmark-demo-test", { ...base, backend: "typescript", ...extra }));
}

test("refuses a certificate outside us-east-1", () => {
  assert.throws(() => synth({ certificateArn: "arn:aws:acm:us-east-2:123456789012:certificate/x" }), /us-east-1/);
});

test("both chat functions: arm64, 90 s, reserved concurrency, Bedrock + usage-table access", () => {
  const t = synth();
  t.resourceCountIs("AWS::Lambda::Function", 2);
  t.allResourcesProperties("AWS::Lambda::Function", {
    Architectures: ["arm64"], Timeout: 90, MemorySize: 512, ReservedConcurrentExecutions: 5,
    Environment: { Variables: Match.objectLike({ MODEL_ID: "us.anthropic.claude-sonnet-5", DAILY_BUDGET_USD: "5", USAGE_TABLE: Match.anyValue() }) },
  });
  t.hasResourceProperties("AWS::Lambda::Url", { AuthType: "AWS_IAM", InvokeMode: "RESPONSE_STREAM" });
  t.hasResourceProperties("AWS::Lambda::Url", { AuthType: "AWS_IAM", InvokeMode: "BUFFERED" });
  t.resourceCountIs("AWS::IAM::Policy", 2);
  t.allResourcesProperties("AWS::IAM::Policy", {
    PolicyDocument: { Statement: Match.arrayWith([
      Match.objectLike({ Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"] }),
      Match.objectLike({ Action: ["dynamodb:UpdateItem", "dynamodb:GetItem"] }),
    ]) },
  });
});

test("guardrail: medical-advice topic denied, prompt attacks filtered, both functions use it", () => {
  const t = synth();
  t.resourceCountIs("AWS::Bedrock::Guardrail", 1);
  t.hasResourceProperties("AWS::Bedrock::Guardrail", {
    TopicPolicyConfig: { TopicsConfig: [Match.objectLike({ Name: "MedicalAdvice", Type: "DENY" })] },
    ContentPolicyConfig: { FiltersConfig: Match.arrayWith([Match.objectLike({ Type: "PROMPT_ATTACK", InputStrength: "HIGH" })]) },
    SensitiveInformationPolicyConfig: { PiiEntitiesConfig: Match.arrayWith([Match.objectLike({ Type: "US_SOCIAL_SECURITY_NUMBER", Action: "ANONYMIZE" })]) },
  });
  t.allResourcesProperties("AWS::Lambda::Function", { Environment: { Variables: Match.objectLike({ GUARDRAIL_ID: Match.anyValue(), GUARDRAIL_VERSION: "DRAFT" }) } });
  t.allResourcesProperties("AWS::IAM::Policy", { PolicyDocument: { Statement: Match.arrayWith([Match.objectLike({ Action: "bedrock:ApplyGuardrail" })]) } });
});

test("CloudFront gets both Lambda permissions on the active backend", () => {
  const t = synth();
  t.hasResourceProperties("AWS::Lambda::Permission", { Action: "lambda:InvokeFunctionUrl", Principal: "cloudfront.amazonaws.com" });
  t.hasResourceProperties("AWS::Lambda::Permission", { Action: "lambda:InvokeFunction", Principal: "cloudfront.amazonaws.com" });
});

test("Backend=python routes /api/* to the Python function URL", () => {
  const t = synth({ backend: "python" });
  const perms = Object.values(t.findResources("AWS::Lambda::Permission", { Properties: { Action: "lambda:InvokeFunction" } }));
  assert.equal(perms.length, 1);
  assert.match(JSON.stringify(perms[0]), /ChatFunctionPy/);
});

test("distribution: alias, TLS 1.2, security headers on both behaviors, logging, 404 mapping", () => {
  const t = synth();
  t.hasResourceProperties("AWS::CloudFront::Distribution", { DistributionConfig: Match.objectLike({
    Aliases: ["wellmark.tvlss.com"], HttpVersion: "http2and3", IPV6Enabled: true, PriceClass: "PriceClass_100",
    ViewerCertificate: Match.objectLike({ MinimumProtocolVersion: "TLSv1.2_2021", SslSupportMethod: "sni-only" }),
    Logging: Match.objectLike({ Prefix: "cloudfront/" }),
    DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: "redirect-to-https", ResponseHeadersPolicyId: Match.anyValue() }),
    CacheBehaviors: [Match.objectLike({ PathPattern: "/api/*", ViewerProtocolPolicy: "https-only", ResponseHeadersPolicyId: Match.anyValue() })],
    CustomErrorResponses: Match.arrayWith([Match.objectLike({ ErrorCode: 403, ResponseCode: 404 })]),
  }) });
  t.hasResourceProperties("AWS::CloudFront::ResponseHeadersPolicy", { ResponseHeadersPolicyConfig: Match.objectLike({
    SecurityHeadersConfig: Match.objectLike({ ContentSecurityPolicy: Match.objectLike({ ContentSecurityPolicy: Match.stringLikeRegexp("frame-ancestors 'none'") }) }),
  }) });
});

test("/api/* runs the viewer-request function, which stamps x-viewer-ip from event.viewer.ip", () => {
  const t = synth();
  t.hasResourceProperties("AWS::CloudFront::Distribution", { DistributionConfig: Match.objectLike({
    CacheBehaviors: [Match.objectLike({ PathPattern: "/api/*", FunctionAssociations: [Match.objectLike({ EventType: "viewer-request" })] })],
  }) });
  t.hasResourceProperties("AWS::CloudFront::Function", { FunctionCode: Match.stringLikeRegexp("x-viewer-ip.*event\\.viewer\\.ip") });
});

test("buckets are private and encrypted; logs expire after 30 days", () => {
  const t = synth();
  t.resourceCountIs("AWS::S3::Bucket", 2);
  t.allResourcesProperties("AWS::S3::Bucket", {
    PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    BucketEncryption: Match.anyValue(),
  });
  t.hasResourceProperties("AWS::S3::Bucket", { LifecycleConfiguration: { Rules: [Match.objectLike({ ExpirationInDays: 30 })] } });
  t.allResourcesProperties("AWS::Logs::LogGroup", { RetentionInDays: 30 });
});

test("alerts exist only when an email is configured", () => {
  const without = synth();
  without.resourceCountIs("AWS::SNS::Topic", 0);
  without.resourceCountIs("AWS::CloudWatch::Alarm", 0);
  without.resourceCountIs("AWS::Budgets::Budget", 0);
  const withEmail = synth({ notificationEmail: "ops@example.com" });
  withEmail.resourceCountIs("AWS::SNS::Topic", 1);
  withEmail.resourceCountIs("AWS::CloudWatch::Alarm", 2);
  withEmail.hasResourceProperties("AWS::Budgets::Budget", { Budget: Match.objectLike({ TimeUnit: "DAILY", BudgetLimit: { Amount: 5, Unit: "USD" } }) });
});

test("DNS: A and AAAA aliases to the distribution; outputs match template.yaml", () => {
  const t = synth();
  t.resourceCountIs("AWS::Route53::RecordSet", 2);
  t.hasResourceProperties("AWS::Route53::RecordSet", { Type: "A", Name: "wellmark.tvlss.com.", AliasTarget: Match.objectLike({ HostedZoneId: Match.anyValue(), DNSName: Match.anyValue() }) });
  t.hasResourceProperties("AWS::Route53::RecordSet", { Type: "AAAA" });
  for (const key of ["SiteUrl", "SiteBucketName", "DistributionId", "ChatFunctionName", "ChatFunctionUrl", "ChatFunctionPyName", "ActiveBackend", "UsageTableName", "GuardrailId"]) t.hasOutput(key, {});
});

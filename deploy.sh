#!/usr/bin/env bash
# Build and deploy samplepayer.tvlss.com: SAM stack (Lambda, CloudFront, DNS), then
# the static site to S3 with a CloudFront invalidation. Idempotent.
set -euo pipefail
cd "$(dirname "$0")"
STACK=samplepayer-demo
REGION=us-east-2

# Account-specific values live in .env (gitignored). Copy .env.example to start.
if [[ ! -f .env ]]; then echo "Missing .env - copy .env.example and fill it in" >&2; exit 1; fi
set -a; source .env; set +a
: "${CERTIFICATE_ARN:?set CERTIFICATE_ARN in .env}"; : "${HOSTED_ZONE_ID:?set HOSTED_ZONE_ID in .env}"

echo "== typecheck"
(cd api && npm run --silent typecheck)

echo "== build site"
node scripts/build-site.mjs

case "$CERTIFICATE_ARN" in arn:aws:acm:us-east-1:*) ;; *) echo "Certificate must be in us-east-1: $CERTIFICATE_ARN" >&2; exit 1;; esac

echo "== sam build"
sam build --region "$REGION" > /dev/null

echo "== sam deploy"
sam deploy --region "$REGION" --no-progressbar \
  --parameter-overrides "CertificateArn=$CERTIFICATE_ARN" "HostedZoneId=$HOSTED_ZONE_ID" ${DOMAIN_NAME:+"DomainName=$DOMAIN_NAME"} ${NOTIFICATION_EMAIL:+"NotificationEmail=$NOTIFICATION_EMAIL"} "$@"

BUCKET=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='SiteBucketName'].OutputValue" --output text)
DIST=$(aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text)

echo "== sync site -> s3://$BUCKET"
aws s3 sync site/ "s3://$BUCKET" --delete --region "$REGION" \
  --exclude "*" --include "*.html" --cache-control "public, max-age=300" --content-type "text/html; charset=utf-8" > /dev/null
aws s3 sync site/ "s3://$BUCKET" --delete --region "$REGION" \
  --exclude "*.html" --cache-control "public, max-age=86400" > /dev/null

echo "== invalidate $DIST"
aws cloudfront create-invalidation --distribution-id "$DIST" --paths "/*" --query 'Invalidation.Id' --output text

echo "== done: https://samplepayer.tvlss.com"

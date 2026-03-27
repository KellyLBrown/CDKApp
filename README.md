# cdk-starter

Scaffold production-ready AWS CDK apps from curated starters. No install required — just run it with `npx`.

Published on npm as [`cdk-starter`](https://www.npmjs.com/package/cdk-starter).

## Quick start

```bash
npx cdk-starter create
```

## Commands

| Command | Description |
|---|---|
| `cdk-starter create` | Scaffold a new CDK app from a starter |
| `cdk-starter list` | List all available starters |
| `cdk-starter info <name>` | Show details about a specific starter |
| `cdk-starter compose` | Build a custom stack component by component |

## Usage

### Create a project

```bash
# Interactive — pick a starter from the list
npx cdk-starter create

# Skip the picker
npx cdk-starter create --starter serverless-api

# Use your own starters repo
npx cdk-starter create --repo myorg/my-templates
npx cdk-starter create --repo myorg/my-templates#develop
```

### List starters

```bash
npx cdk-starter list
npx cdk-starter list --tag serverless
npx cdk-starter list --json
```

### Get starter details

```bash
npx cdk-starter info serverless-api
npx cdk-starter info serverless-api --json
```

### Compose a custom stack

Build a CDK stack interactively by picking components across four infrastructure layers:

```bash
npx cdk-starter compose
```

You'll walk through **Networking**, **Compute**, **Data**, and **Utility** layers, selecting only the components you need. The CLI generates a fully wired CDK stack with IAM grants, environment variables, and resource connections set up automatically.

**Available components:** VPC, API Gateway, ALB, NLB, Route 53, Lambda, ECS Fargate, DynamoDB, S3, Aurora Serverless v2, SQS, SNS, EventBridge, CloudWatch Alarms, Secrets Manager.

## Available starters

| Starter | Description |
|---|---|
| `serverless-api` | API Gateway + Lambda + DynamoDB REST API |
| `static-site` | S3 + CloudFront static site with HTTPS |
| `scheduled-lambda` | EventBridge-scheduled Lambda with DynamoDB |
| `event-driven-pipeline` | EventBridge + SQS + Lambda fan-out pipeline |
| `vpc-network` | Production VPC with public/private subnets |
| `cognito-auth` | Cognito User Pool + API Gateway JWT auth |
| `full-stack-webapp` | CloudFront + S3 + API Gateway + Lambda + DynamoDB |
| `ecs-fargate-service` | VPC + ALB + ECS Fargate container service |
| `cicd-pipeline` | Self-mutating CDK Pipeline with staging + production |
| `websocket-api` | API Gateway WebSocket with Lambda handlers |
| `step-functions-workflow` | Step Functions + Lambda workflow with API trigger |
| `bedrock-chatbot` | Bedrock (Claude) + Lambda + DynamoDB chatbot API |
| `data-lake` | S3 + Glue + Athena + Lake Formation data lake |
| `temporal-server` | Fargate Based Temporal Server with Aurora PostgreSQL |

## Custom starters repo

Point at any GitHub repo that follows the same layout:

```
index.json              <- manifest
starters/
  <starter-name>/
    cdkapp.json         <- metadata
    README.md
    ...                 <- CDK app files
```

```bash
npx cdk-starter create --repo your-org/your-starters
```

## Links

- **Website:** [cdkapp.com](https://www.cdkapp.com)
- **Starters repo:** [github.com/KellyLBrown/CDKApp-Starters](https://github.com/KellyLBrown/CDKApp-Starters)

## Developing this package

```bash
pnpm install   # or npm install
pnpm build
pnpm typecheck
```

## Publishing

```bash
pnpm build
npm publish --access public
```

## License

MIT

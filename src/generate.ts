import fs from "node:fs";
import path from "node:path";
import type { StackSelections } from "./compose.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pascal(str: string): string {
  return str
    .split(/[-_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

function has(sel: StackSelections, ...names: string[]): boolean {
  const all = new Set([
    ...sel.networking,
    ...sel.compute,
    ...sel.data,
    ...sel.utility,
  ]);
  return names.every((n) => all.has(n));
}

function any(sel: StackSelections, ...names: string[]): boolean {
  const all = new Set([
    ...sel.networking,
    ...sel.compute,
    ...sel.data,
    ...sel.utility,
  ]);
  return names.some((n) => all.has(n));
}

function indent(lines: string[], n = 4): string[] {
  const pad = " ".repeat(n);
  return lines.map((l) => (l === "" ? "" : pad + l));
}

// ─── Stack file generator ─────────────────────────────────────────────────────

function genStackTs(sel: StackSelections): string {
  const lines: string[] = [];
  const className = `${pascal(sel.stackName)}Stack`;

  // ── Imports ────────────────────────────────────────────────────────────────
  lines.push(`import * as cdk from "aws-cdk-lib";`);
  lines.push(`import { Construct } from "constructs";`);

  if (any(sel, "vpc", "alb", "nlb", "ecs-fargate", "rds-aurora"))
    lines.push(`import * as ec2 from "aws-cdk-lib/aws-ec2";`);

  if (has(sel, "lambda"))
    lines.push(
      `import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";`,
      `import * as lambda from "aws-cdk-lib/aws-lambda";`,
      `import * as logs from "aws-cdk-lib/aws-logs";`,
      `import * as path from "path";`
    );

  if (has(sel, "ecs-fargate"))
    lines.push(
      `import * as ecs from "aws-cdk-lib/aws-ecs";`,
      `import * as ecr from "aws-cdk-lib/aws-ecr";`,
      `import * as ecsPatterns from "aws-cdk-lib/aws-ecs-patterns";`
    );

  if (has(sel, "api-gateway"))
    lines.push(`import * as apigateway from "aws-cdk-lib/aws-apigateway";`);

  if (has(sel, "alb") && !has(sel, "ecs-fargate"))
    lines.push(`import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";`);

  if (has(sel, "nlb"))
    lines.push(`import * as elbv2 from "aws-cdk-lib/aws-elasticloadbalancingv2";`);

  if (has(sel, "route53"))
    lines.push(
      `import * as route53 from "aws-cdk-lib/aws-route53";`,
      `import * as route53Targets from "aws-cdk-lib/aws-route53-targets";`
    );

  if (has(sel, "dynamodb"))
    lines.push(`import * as dynamodb from "aws-cdk-lib/aws-dynamodb";`);

  if (has(sel, "s3-bucket"))
    lines.push(`import * as s3 from "aws-cdk-lib/aws-s3";`);

  if (has(sel, "rds-aurora"))
    lines.push(`import * as rds from "aws-cdk-lib/aws-rds";`);

  if (has(sel, "sqs-queue"))
    lines.push(`import * as sqs from "aws-cdk-lib/aws-sqs";`);

  if (has(sel, "sns-topic"))
    lines.push(`import * as sns from "aws-cdk-lib/aws-sns";`);

  if (has(sel, "sns-topic") && any(sel, "lambda", "sqs-queue"))
    lines.push(`import * as snsSubscriptions from "aws-cdk-lib/aws-sns-subscriptions";`);

  if (has(sel, "eventbridge"))
    lines.push(
      `import * as events from "aws-cdk-lib/aws-events";`,
      `import * as eventTargets from "aws-cdk-lib/aws-events-targets";`
    );

  if (has(sel, "cloudwatch-alarms"))
    lines.push(`import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";`);

  if (has(sel, "secrets-manager"))
    lines.push(`import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";`);

  lines.push("");

  // ── Class ──────────────────────────────────────────────────────────────────
  lines.push(`export class ${className} extends cdk.Stack {`);
  lines.push(
    `  constructor(scope: Construct, id: string, props?: cdk.StackProps) {`
  );
  lines.push(`    super(scope, id, props);`);
  lines.push("");

  const body: string[] = [];

  // ── 1. VPC ─────────────────────────────────────────────────────────────────
  if (has(sel, "vpc")) {
    body.push(
      `// ── VPC ────────────────────────────────────────────────────────────────`,
      `const vpc = new ec2.Vpc(this, "Vpc", {`,
      `  maxAzs: 2,`,
      `  natGateways: 1,`,
      `  subnetConfiguration: [`,
      `    { cidrMask: 24, name: "Public", subnetType: ec2.SubnetType.PUBLIC },`,
      `    { cidrMask: 24, name: "Private", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },`,
      `  ],`,
      `});`,
      ""
    );
  }

  // ── 2. Data ────────────────────────────────────────────────────────────────
  if (has(sel, "dynamodb")) {
    body.push(
      `// ── DynamoDB ────────────────────────────────────────────────────────────`,
      `const table = new dynamodb.Table(this, "Table", {`,
      `  tableName: \`\${id}-table\`,`,
      `  partitionKey: { name: "id", type: dynamodb.AttributeType.STRING },`,
      `  billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,`,
      `  encryption: dynamodb.TableEncryption.AWS_MANAGED,`,
      `  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },`,
      `  removalPolicy: cdk.RemovalPolicy.RETAIN,`,
      `});`,
      ""
    );
  }

  if (has(sel, "s3-bucket")) {
    body.push(
      `// ── S3 Bucket ───────────────────────────────────────────────────────────`,
      `const bucket = new s3.Bucket(this, "Bucket", {`,
      `  bucketName: \`\${cdk.Aws.ACCOUNT_ID}-\${id.toLowerCase()}\`,`,
      `  versioned: true,`,
      `  encryption: s3.BucketEncryption.S3_MANAGED,`,
      `  blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,`,
      `  enforceSSL: true,`,
      `  removalPolicy: cdk.RemovalPolicy.RETAIN,`,
      `  autoDeleteObjects: false,`,
      `});`,
      ""
    );
  }

  if (has(sel, "secrets-manager")) {
    body.push(
      `// ── Secrets Manager ─────────────────────────────────────────────────────`,
      `const secret = new secretsmanager.Secret(this, "Secret", {`,
      `  secretName: \`\${id}/config\`,`,
      `  description: "Application secrets",`,
      `  generateSecretString: {`,
      `    secretStringTemplate: JSON.stringify({ username: "admin" }),`,
      `    generateStringKey: "password",`,
      `    excludePunctuation: true,`,
      `  },`,
      `});`,
      ""
    );
  }

  if (has(sel, "rds-aurora")) {
    const auroraVpcLine = has(sel, "vpc")
      ? `  vpc,`
      : `  vpc: new ec2.Vpc(this, "AuroraVpc", { maxAzs: 2, natGateways: 1 }),`;
    body.push(
      `// ── RDS Aurora Serverless v2 ────────────────────────────────────────────`,
      `const dbSecret = new secretsmanager.Secret(this, "DbSecret", {`,
      `  secretName: \`\${id}/db-credentials\`,`,
      `  generateSecretString: {`,
      `    secretStringTemplate: JSON.stringify({ username: "postgres" }),`,
      `    generateStringKey: "password",`,
      `    excludePunctuation: true,`,
      `  },`,
      `});`,
      `const dbCluster = new rds.DatabaseCluster(this, "AuroraCluster", {`,
      `  engine: rds.DatabaseClusterEngine.auroraPostgres({`,
      `    version: rds.AuroraPostgresEngineVersion.VER_16_4,`,
      `  }),`,
      `  serverlessV2MinCapacity: 0.5,`,
      `  serverlessV2MaxCapacity: 4,`,
      `  writer: rds.ClusterInstance.serverlessV2("Writer"),`,
      auroraVpcLine,
      `  credentials: rds.Credentials.fromSecret(dbSecret),`,
      `  defaultDatabaseName: "app",`,
      `  removalPolicy: cdk.RemovalPolicy.RETAIN,`,
      `  storageEncrypted: true,`,
      `});`,
      ""
    );
  }

  // ── 3. SQS (before compute so Lambda can reference queueUrl) ───────────────
  if (has(sel, "sqs-queue")) {
    body.push(
      `// ── SQS Queue ───────────────────────────────────────────────────────────`,
      `const dlq = new sqs.Queue(this, "Dlq", {`,
      `  queueName: \`\${id}-dlq\`,`,
      `  retentionPeriod: cdk.Duration.days(14),`,
      `  encryption: sqs.QueueEncryption.SQS_MANAGED,`,
      `});`,
      `const queue = new sqs.Queue(this, "Queue", {`,
      `  queueName: \`\${id}-queue\`,`,
      `  visibilityTimeout: cdk.Duration.seconds(30),`,
      `  encryption: sqs.QueueEncryption.SQS_MANAGED,`,
      `  deadLetterQueue: { queue: dlq, maxReceiveCount: 3 },`,
      `});`,
      ""
    );
  }

  // ── 4. SNS Topic ───────────────────────────────────────────────────────────
  if (has(sel, "sns-topic")) {
    body.push(
      `// ── SNS Topic ───────────────────────────────────────────────────────────`,
      `const topic = new sns.Topic(this, "Topic", {`,
      `  topicName: \`\${id}-topic\`,`,
      `  displayName: \`${pascal(sel.stackName)} Notifications\`,`,
      `});`,
      ""
    );
  }

  // ── 5. Compute: Lambda ─────────────────────────────────────────────────────
  if (has(sel, "lambda")) {
    const lambdaEnv: string[] = [`NODE_OPTIONS: "--enable-source-maps",`];
    if (has(sel, "dynamodb")) lambdaEnv.push(`TABLE_NAME: table.tableName,`);
    if (has(sel, "s3-bucket")) lambdaEnv.push(`BUCKET_NAME: bucket.bucketName,`);
    if (has(sel, "sqs-queue")) lambdaEnv.push(`QUEUE_URL: queue.queueUrl,`);
    if (has(sel, "sns-topic")) lambdaEnv.push(`TOPIC_ARN: topic.topicArn,`);
    if (has(sel, "secrets-manager")) lambdaEnv.push(`SECRET_ARN: secret.secretArn,`);
    if (has(sel, "rds-aurora")) lambdaEnv.push(`DB_SECRET_ARN: dbSecret.secretArn,`);

    body.push(
      `// ── Lambda ──────────────────────────────────────────────────────────────`,
      `const handler = new NodejsFunction(this, "Handler", {`,
      `  runtime: lambda.Runtime.NODEJS_22_X,`,
      `  entry: path.join(__dirname, "../src/handler.ts"),`,
      `  handler: "handler",`,
      `  timeout: cdk.Duration.seconds(29),`,
      `  memorySize: 256,`,
      `  logRetention: logs.RetentionDays.ONE_WEEK,`,
      `  tracing: lambda.Tracing.ACTIVE,`,
      ...(has(sel, "vpc") ? [`  vpc,`, `  vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },`] : []),
      `  environment: {`,
      ...indent(lambdaEnv, 4),
      `  },`,
      `  bundling: { minify: true, sourceMap: true, target: "es2020" },`,
      `});`,
      ""
    );
  }

  // ── 6. Compute: ECS Fargate ────────────────────────────────────────────────
  if (has(sel, "ecs-fargate")) {
    const ecsEnv: string[] = [];
    if (has(sel, "dynamodb")) ecsEnv.push(`TABLE_NAME: table.tableName,`);
    if (has(sel, "s3-bucket")) ecsEnv.push(`BUCKET_NAME: bucket.bucketName,`);
    if (has(sel, "secrets-manager")) ecsEnv.push(`SECRET_ARN: secret.secretArn,`);

    const hasAlbOrNlb = any(sel, "alb", "nlb");

    if (hasAlbOrNlb) {
      // Use ApplicationLoadBalancedFargateService / NetworkLoadBalancedFargateService pattern
      const patternClass = has(sel, "nlb")
        ? `ecsPatterns.NetworkLoadBalancedFargateService`
        : `ecsPatterns.ApplicationLoadBalancedFargateService`;
      body.push(
        `// ── ECS Fargate (with ${has(sel, "nlb") ? "NLB" : "ALB"}) ────────────────────────────────────────────────────────`,
        `const fargateService = new ${patternClass}(this, "FargateService", {`,
        `  vpc,`,
        `  taskImageOptions: {`,
        `    image: ecs.ContainerImage.fromAsset("."),`,
        `    containerPort: 8080,`,
        ...(ecsEnv.length > 0
          ? [`    environment: {`, ...indent(ecsEnv, 6), `    },`]
          : []),
        `    logDriver: ecs.LogDrivers.awsLogs({`,
        `      streamPrefix: \`\${id}-fargate\`,`,
        `      logRetention: logs.RetentionDays.ONE_WEEK,`,
        `    }),`,
        `  },`,
        `  desiredCount: 1,`,
        `  cpu: 256,`,
        `  memoryLimitMiB: 512,`,
        `  publicLoadBalancer: true,`,
        `});`,
        `fargateService.service.autoScaleTaskCount({ maxCapacity: 4 })`,
        `  .scaleOnCpuUtilization("CpuScaling", { targetUtilizationPercent: 70 });`,
        ""
      );
    } else {
      body.push(
        `// ── ECS Fargate ─────────────────────────────────────────────────────────`,
        `const cluster = new ecs.Cluster(this, "Cluster", { vpc });`,
        `const taskDef = new ecs.FargateTaskDefinition(this, "TaskDef", {`,
        `  cpu: 256,`,
        `  memoryLimitMiB: 512,`,
        `});`,
        `taskDef.addContainer("AppContainer", {`,
        `  image: ecs.ContainerImage.fromAsset("."),`,
        `  portMappings: [{ containerPort: 8080 }],`,
        ...(ecsEnv.length > 0
          ? [`  environment: {`, ...indent(ecsEnv, 2), `  },`]
          : []),
        `  logging: ecs.LogDrivers.awsLogs({`,
        `    streamPrefix: \`\${id}-fargate\`,`,
        `    logRetention: logs.RetentionDays.ONE_WEEK,`,
        `  }),`,
        `});`,
        `const fargateService = new ecs.FargateService(this, "FargateService", {`,
        `  cluster,`,
        `  taskDefinition: taskDef,`,
        `  desiredCount: 1,`,
        `});`,
        `fargateService.autoScaleTaskCount({ maxCapacity: 4 })`,
        `  .scaleOnCpuUtilization("CpuScaling", { targetUtilizationPercent: 70 });`,
        ""
      );
    }
  }

  // ── 7. API Gateway ─────────────────────────────────────────────────────────
  if (has(sel, "api-gateway")) {
    const accessLogGroup = `const apiLogGroup = new logs.LogGroup(this, "ApiLogs", {
  retention: logs.RetentionDays.ONE_WEEK,
});`;
    body.push(
      `// ── API Gateway ──────────────────────────────────────────────────────────`,
      accessLogGroup,
      `const api = new apigateway.RestApi(this, "Api", {`,
      `  restApiName: \`\${id}-api\`,`,
      `  deployOptions: {`,
      `    stageName: "v1",`,
      `    accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),`,
      `    accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),`,
      `    loggingLevel: apigateway.MethodLoggingLevel.INFO,`,
      `    tracingEnabled: true,`,
      `    metricsEnabled: true,`,
      `  },`,
      `  defaultCorsPreflightOptions: {`,
      `    allowOrigins: apigateway.Cors.ALL_ORIGINS,`,
      `    allowMethods: apigateway.Cors.ALL_METHODS,`,
      `    allowHeaders: ["Content-Type", "Authorization"],`,
      `  },`,
      `});`,
      ...(has(sel, "lambda")
        ? [
            `api.root.addMethod("ANY", new apigateway.LambdaIntegration(handler));`,
            `api.root.addResource("{proxy+}").addMethod("ANY", new apigateway.LambdaIntegration(handler));`,
          ]
        : [`// Add methods to api.root to integrate with your backend`]),
      ""
    );
  }

  // ── 8. ALB (standalone, not via ecsPatterns) ───────────────────────────────
  if (has(sel, "alb") && !has(sel, "ecs-fargate")) {
    body.push(
      `// ── Application Load Balancer ───────────────────────────────────────────`,
      `const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {`,
      `  vpc,`,
      `  internetFacing: true,`,
      `});`,
      `const listener = alb.addListener("Listener", {`,
      `  port: 443,`,
      `  // certificates: [elbv2.ListenerCertificate.fromArn("arn:...")],`,
      `});`,
      `// listener.addTargets("Targets", { port: 80, targets: [...] });`,
      ""
    );
  }

  // ── 9. NLB (standalone) ────────────────────────────────────────────────────
  if (has(sel, "nlb") && !has(sel, "ecs-fargate")) {
    body.push(
      `// ── Network Load Balancer ────────────────────────────────────────────────`,
      `const nlb = new elbv2.NetworkLoadBalancer(this, "Nlb", {`,
      `  vpc,`,
      `  internetFacing: true,`,
      `  crossZoneEnabled: true,`,
      `});`,
      `const nlbListener = nlb.addListener("NlbListener", { port: 443 });`,
      `// nlbListener.addTargets("NlbTargets", { port: 443, targets: [...] });`,
      ""
    );
  }

  // ── 10. Route 53 ───────────────────────────────────────────────────────────
  if (has(sel, "route53")) {
    body.push(
      `// ── Route 53 ────────────────────────────────────────────────────────────`,
      `// Replace with your actual hosted zone ID and domain name`,
      `const zone = route53.HostedZone.fromLookup(this, "Zone", {`,
      `  domainName: "example.com", // TODO: replace with your domain`,
      `});`,
      ...(has(sel, "alb") && !has(sel, "ecs-fargate")
        ? [
            `new route53.ARecord(this, "AlbAlias", {`,
            `  zone,`,
            `  target: route53.RecordTarget.fromAlias(`,
            `    new route53Targets.LoadBalancerTarget(alb)`,
            `  ),`,
            `});`,
          ]
        : has(sel, "ecs-fargate") && has(sel, "alb")
          ? [
              `new route53.ARecord(this, "AlbAlias", {`,
              `  zone,`,
              `  target: route53.RecordTarget.fromAlias(`,
              `    new route53Targets.LoadBalancerTarget(fargateService.loadBalancer)`,
              `  ),`,
              `});`,
            ]
          : has(sel, "nlb")
            ? [
                `new route53.ARecord(this, "NlbAlias", {`,
                `  zone,`,
                `  target: route53.RecordTarget.fromAlias(`,
                `    new route53Targets.LoadBalancerTarget(${has(sel, "ecs-fargate") ? "fargateService.loadBalancer" : "nlb"})`,
                `  ),`,
                `});`,
              ]
            : has(sel, "api-gateway")
              ? [
                  `new route53.ARecord(this, "ApiAlias", {`,
                  `  zone,`,
                  `  target: route53.RecordTarget.fromAlias(`,
                  `    new route53Targets.ApiGateway(api)`,
                  `  ),`,
                  `});`,
                ]
              : [`// Add route53.ARecord pointing to your resource`]),
      ""
    );
  }

  // ── 11. EventBridge ────────────────────────────────────────────────────────
  if (has(sel, "eventbridge")) {
    const ebTarget = has(sel, "lambda")
      ? `new eventTargets.LambdaFunction(handler)`
      : has(sel, "sqs-queue")
        ? `new eventTargets.SqsQueue(queue)`
        : `/* TODO: add target */`;

    body.push(
      `// ── EventBridge ─────────────────────────────────────────────────────────`,
      `new events.Rule(this, "ScheduledRule", {`,
      `  schedule: events.Schedule.rate(cdk.Duration.hours(1)),`,
      `  targets: [${ebTarget}],`,
      `});`,
      ""
    );
  }

  // ── 12. Grants / Wiring ────────────────────────────────────────────────────
  const grants: string[] = [];

  if (has(sel, "lambda", "dynamodb")) grants.push(`table.grantReadWriteData(handler);`);
  if (has(sel, "lambda", "s3-bucket")) grants.push(`bucket.grantReadWrite(handler);`);
  if (has(sel, "lambda", "sqs-queue")) grants.push(`queue.grantSendMessages(handler);`);
  if (has(sel, "lambda", "sns-topic")) grants.push(`topic.grantPublish(handler);`);
  if (has(sel, "lambda", "secrets-manager")) grants.push(`secret.grantRead(handler);`);
  if (has(sel, "lambda", "rds-aurora")) grants.push(`dbSecret.grantRead(handler);`);

  if (has(sel, "ecs-fargate", "dynamodb"))
    grants.push(`table.grantReadWriteData(fargateService.${has(sel, "alb") || has(sel, "nlb") ? "taskDefinition" : "taskDefinition"}.taskRole);`);
  if (has(sel, "ecs-fargate", "s3-bucket"))
    grants.push(`bucket.grantReadWrite(fargateService.${has(sel, "alb") || has(sel, "nlb") ? "taskDefinition" : "taskDefinition"}.taskRole);`);
  if (has(sel, "ecs-fargate", "secrets-manager"))
    grants.push(`secret.grantRead(fargateService.${has(sel, "alb") || has(sel, "nlb") ? "taskDefinition" : "taskDefinition"}.taskRole);`);

  if (has(sel, "sns-topic", "sqs-queue"))
    grants.push(`topic.addSubscription(new snsSubscriptions.SqsSubscription(queue));`);
  if (has(sel, "sns-topic", "lambda"))
    grants.push(`topic.addSubscription(new snsSubscriptions.LambdaSubscription(handler));`);

  if (grants.length > 0) {
    body.push(
      `// ── Grants & subscriptions ──────────────────────────────────────────────`,
      ...grants,
      ""
    );
  }

  // ── 13. CloudWatch Alarms ──────────────────────────────────────────────────
  if (has(sel, "cloudwatch-alarms")) {
    const alarms: string[] = [];

    if (has(sel, "lambda")) {
      alarms.push(
        `new cloudwatch.Alarm(this, "LambdaErrorAlarm", {`,
        `  metric: handler.metricErrors({ period: cdk.Duration.minutes(5) }),`,
        `  threshold: 1,`,
        `  evaluationPeriods: 1,`,
        `  alarmDescription: "Lambda function errors",`,
        `  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,`,
        `});`
      );
    }
    if (has(sel, "sqs-queue")) {
      alarms.push(
        `new cloudwatch.Alarm(this, "QueueDepthAlarm", {`,
        `  metric: queue.metricApproximateNumberOfMessagesVisible({`,
        `    period: cdk.Duration.minutes(5),`,
        `  }),`,
        `  threshold: 100,`,
        `  evaluationPeriods: 1,`,
        `  alarmDescription: "SQS queue depth high",`,
        `  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,`,
        `});`
      );
    }
    if (has(sel, "ecs-fargate")) {
      alarms.push(
        `new cloudwatch.Alarm(this, "EcsCpuAlarm", {`,
        `  metric: fargateService.service.metricCpuUtilization({`,
        `    period: cdk.Duration.minutes(5),`,
        `  }),`,
        `  threshold: 80,`,
        `  evaluationPeriods: 2,`,
        `  alarmDescription: "ECS CPU utilisation high",`,
        `  treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,`,
        `});`
      );
    }

    if (alarms.length > 0) {
      body.push(
        `// ── CloudWatch Alarms ───────────────────────────────────────────────────`,
        ...alarms,
        ""
      );
    }
  }

  // ── 14. Stack outputs ──────────────────────────────────────────────────────
  const outputs: string[] = [];

  if (has(sel, "api-gateway"))
    outputs.push(`new cdk.CfnOutput(this, "ApiUrl", { value: api.url, description: "API Gateway URL" });`);
  if (has(sel, "alb") && has(sel, "ecs-fargate"))
    outputs.push(`new cdk.CfnOutput(this, "ServiceUrl", { value: fargateService.loadBalancer.loadBalancerDnsName });`);
  if (has(sel, "nlb") && !has(sel, "ecs-fargate"))
    outputs.push(`new cdk.CfnOutput(this, "NlbDns", { value: nlb.loadBalancerDnsName });`);
  if (has(sel, "dynamodb"))
    outputs.push(`new cdk.CfnOutput(this, "TableName", { value: table.tableName });`);
  if (has(sel, "s3-bucket"))
    outputs.push(`new cdk.CfnOutput(this, "BucketName", { value: bucket.bucketName });`);
  if (has(sel, "sqs-queue"))
    outputs.push(`new cdk.CfnOutput(this, "QueueUrl", { value: queue.queueUrl });`);
  if (has(sel, "sns-topic"))
    outputs.push(`new cdk.CfnOutput(this, "TopicArn", { value: topic.topicArn });`);

  if (outputs.length > 0) {
    body.push(`// ── Outputs ─────────────────────────────────────────────────────────────`, ...outputs, "");
  }

  lines.push(...indent(body, 4));
  lines.push(`  }`);
  lines.push(`}`);

  return lines.join("\n");
}

// ─── bin/app.ts ───────────────────────────────────────────────────────────────

function genBinTs(sel: StackSelections): string {
  const className = `${pascal(sel.stackName)}Stack`;
  return `#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { ${className} } from "../lib/${sel.stackName}-stack";

const app = new cdk.App();

new ${className}(app, "${className}", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? "us-east-1",
  },
  tags: {
    Project: "${sel.stackName}",
    ManagedBy: "cdk",
  },
});
`;
}

// ─── src/handler.ts ───────────────────────────────────────────────────────────

function genHandlerTs(): string {
  return `import { Handler } from "aws-lambda";

export const handler: Handler = async (event, context) => {
  console.log("Event:", JSON.stringify(event, null, 2));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "OK" }),
  };
};
`;
}

// ─── package.json ─────────────────────────────────────────────────────────────

function genPackageJson(sel: StackSelections): string {
  return JSON.stringify(
    {
      name: sel.stackName,
      version: "0.1.0",
      private: true,
      scripts: {
        build: "tsc",
        watch: "tsc -w",
        cdk: "cdk",
        diff: "cdk diff",
        deploy: "cdk deploy --require-approval never",
        destroy: "cdk destroy",
        synth: "cdk synth",
      },
      dependencies: {
        "aws-cdk-lib": "^2.178.0",
        constructs: "^10.4.2",
        "source-map-support": "^0.5.21",
      },
      devDependencies: {
        "@types/aws-lambda": "^8.10.149",
        "@types/node": "^22.13.10",
        "aws-cdk": "^2.178.0",
        esbuild: "^0.25.0",
        typescript: "^5.8.2",
      },
    },
    null,
    2
  );
}

// ─── cdk.json ─────────────────────────────────────────────────────────────────

function genCdkJson(sel: StackSelections): string {
  return JSON.stringify(
    {
      app: "npx ts-node --prefer-ts-exts bin/app.ts",
      watch: {
        include: ["**"],
        exclude: ["README.md", "cdk*.json", "**/*.d.ts", "**/*.js", "tsconfig.json", "package*.json", "node_modules", "test"],
      },
      context: {
        "@aws-cdk/aws-lambda:recognizeLayerVersion": true,
        "@aws-cdk/core:checkSecretUsage": true,
        "@aws-cdk/aws-iam:minimizePolicies": true,
        "@aws-cdk/aws-s3:createDefaultLoggingPolicy": true,
        "@aws-cdk/aws-apigateway:disableCloudWatchRole": true,
        "@aws-cdk/core:enablePartitionLiterals": true,
        "@aws-cdk/customresources:installLatestAwsSdkDefault": false,
        ...(sel.networking.includes("route53")
          ? { "availability-zones:account=ACCOUNT:region=REGION": ["REGION-1a", "REGION-1b"] }
          : {}),
      },
    },
    null,
    2
  );
}

// ─── tsconfig.json ────────────────────────────────────────────────────────────

function genTsConfig(): string {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2020",
        module: "commonjs",
        lib: ["ES2020"],
        declaration: true,
        strict: true,
        noImplicitAny: true,
        strictNullChecks: true,
        noImplicitThis: true,
        alwaysStrict: true,
        outDir: "./cdk.out/ts",
        rootDir: ".",
        esModuleInterop: true,
        skipLibCheck: true,
      },
      exclude: ["node_modules", "cdk.out"],
    },
    null,
    2
  );
}

// ─── .gitignore ───────────────────────────────────────────────────────────────

function genGitignore(): string {
  return `node_modules/
cdk.out/
*.js
*.d.ts
*.js.map
!jest.config.js
.env
.DS_Store
`;
}

// ─── README.md ────────────────────────────────────────────────────────────────

function genReadme(sel: StackSelections): string {
  const allSelected = [
    ...sel.networking,
    ...sel.compute,
    ...sel.data,
    ...sel.utility,
  ];

  const componentList = allSelected
    .map((n) => `- \`${n}\``)
    .join("\n");

  return `# ${pascal(sel.stackName)} Stack

Generated by \`npx cdk-starter compose\`.

## Components

${componentList}

## Prerequisites

- Node.js ≥ 20
- AWS CLI configured (\`aws configure\`)
- CDK bootstrapped (\`npx cdk bootstrap\`)

## Deploy

\`\`\`bash
npm install
npx cdk diff
npx cdk deploy
\`\`\`

## Tear down

\`\`\`bash
npx cdk destroy
\`\`\`
`;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export async function generateStack(
  sel: StackSelections,
  destPath: string
): Promise<void> {
  const mk = (...parts: string[]) => path.join(destPath, ...parts);

  fs.mkdirSync(mk("lib"), { recursive: true });
  fs.mkdirSync(mk("bin"), { recursive: true });

  if (sel.compute.includes("lambda")) {
    fs.mkdirSync(mk("src"), { recursive: true });
    fs.writeFileSync(mk("src", "handler.ts"), genHandlerTs());
  }

  fs.writeFileSync(mk("lib", `${sel.stackName}-stack.ts`), genStackTs(sel));
  fs.writeFileSync(mk("bin", "app.ts"), genBinTs(sel));
  fs.writeFileSync(mk("package.json"), genPackageJson(sel));
  fs.writeFileSync(mk("cdk.json"), genCdkJson(sel));
  fs.writeFileSync(mk("tsconfig.json"), genTsConfig());
  fs.writeFileSync(mk(".gitignore"), genGitignore());
  fs.writeFileSync(mk("README.md"), genReadme(sel));
}

import {
  intro,
  outro,
  multiselect,
  text,
  confirm,
  note,
  spinner,
  isCancel,
  cancel,
} from "@clack/prompts";
import pc from "picocolors";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { generateStack } from "./generate.js";

// ─── Component metadata ───────────────────────────────────────────────────────

export interface Component {
  name: string;
  title: string;
  description: string;
}

export interface Layer {
  id: string;
  title: string;
  description: string;
  components: Component[];
}

export interface StackSelections {
  stackName: string;
  networking: string[];
  compute: string[];
  data: string[];
  utility: string[];
}

export const LAYERS: Layer[] = [
  {
    id: "networking",
    title: "Networking",
    description: "VPC, load balancers, API gateways, and DNS",
    components: [
      {
        name: "vpc",
        title: "VPC",
        description: "Public + private subnets, NAT gateway, VPC endpoints",
      },
      {
        name: "api-gateway",
        title: "API Gateway",
        description: "REST API with access logs, X-Ray tracing, and CORS",
      },
      {
        name: "alb",
        title: "Application Load Balancer",
        description: "HTTP/HTTPS load balancer with listener rules",
      },
      {
        name: "nlb",
        title: "Network Load Balancer",
        description: "TCP/UDP load balancer for high-performance traffic",
      },
      {
        name: "route53",
        title: "Route 53",
        description:
          "Hosted zone + A records aliased to your load balancer or API",
      },
    ],
  },
  {
    id: "compute",
    title: "Compute",
    description: "Lambda functions and containerised services",
    components: [
      {
        name: "lambda",
        title: "Lambda Function",
        description:
          "Node.js 22 function with esbuild bundling, X-Ray, and log retention",
      },
      {
        name: "ecs-fargate",
        title: "ECS Fargate Service",
        description:
          "Containerised service with ECR, CloudWatch logs, and auto-scaling",
      },
    ],
  },
  {
    id: "data",
    title: "Data",
    description: "Databases, object storage, and caches",
    components: [
      {
        name: "dynamodb",
        title: "DynamoDB Table",
        description:
          "On-demand table with encryption and point-in-time recovery",
      },
      {
        name: "s3-bucket",
        title: "S3 Bucket",
        description:
          "Versioned bucket with encryption and block public access",
      },
      {
        name: "rds-aurora",
        title: "RDS Aurora Serverless v2",
        description:
          "PostgreSQL-compatible Aurora with auto-scaling and Secrets Manager",
      },
    ],
  },
  {
    id: "utility",
    title: "Utility",
    description: "Messaging, monitoring, and configuration",
    components: [
      {
        name: "sqs-queue",
        title: "SQS Queue",
        description:
          "Standard queue with a dead-letter queue and redrive policy",
      },
      {
        name: "sns-topic",
        title: "SNS Topic",
        description: "Pub/sub topic with optional SQS and Lambda subscriptions",
      },
      {
        name: "eventbridge",
        title: "EventBridge Rule",
        description:
          "Scheduled or pattern-matched rule targeting Lambda or SQS",
      },
      {
        name: "cloudwatch-alarms",
        title: "CloudWatch Alarms",
        description: "Alarms on Lambda errors, SQS depth, or ECS CPU usage",
      },
      {
        name: "secrets-manager",
        title: "Secrets Manager",
        description: "Encrypted secret with automatic rotation support",
      },
    ],
  },
];

// ─── Arg parsing ──────────────────────────────────────────────────────────────

export function parseComposeArgs(args: string[]): { help?: boolean } {
  const result: { help?: boolean } = {};
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") result.help = true;
  }
  return result;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function detectPackageManager(): "pnpm" | "yarn" | "npm" {
  try {
    execSync("pnpm --version", { stdio: "ignore" });
    return "pnpm";
  } catch {}
  try {
    execSync("yarn --version", { stdio: "ignore" });
    return "yarn";
  } catch {}
  return "npm";
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runCompose(rawArgs: string[]) {
  const args = parseComposeArgs(rawArgs);

  if (args.help) {
    console.log(`
${pc.bold("cdk-starter compose")} — build a custom CDK stack component by component

${pc.bold("Usage:")}
  npx cdk-starter compose

${pc.bold("Description:")}
  Walks you through four infrastructure layers — Networking, Compute, Data,
  and Utility — and generates a ready-to-deploy CDK stack assembled from
  your selections. All components are wired together automatically.

${pc.bold("Layers & components:")}
  Networking   vpc, api-gateway, alb, nlb, route53
  Compute      lambda, ecs-fargate
  Data         dynamodb, s3-bucket, rds-aurora
  Utility      sqs-queue, sns-topic, eventbridge, cloudwatch-alarms, secrets-manager

${pc.bold("Website:")} https://www.cdkapp.com/cli
`);
    process.exit(0);
  }

  console.log("");
  intro(
    `${pc.bgGreen(pc.bold(" cdk-starter compose "))} ${pc.dim("Build a custom stack layer by layer")}`
  );

  // ── Stack name ───────────────────────────────────────────────────────────

  const rawName = await text({
    message: "Stack name",
    placeholder: "my-stack",
    defaultValue: "my-stack",
    validate(v = "") {
      if (!v.trim()) return "Stack name is required";
      if (!/^[a-z0-9-]+$/i.test(v))
        return "Use only letters, numbers, and hyphens";
    },
  });

  if (isCancel(rawName)) { cancel("Cancelled"); process.exit(0); }
  const stackName = slugify(rawName as string);

  const selections: StackSelections = {
    stackName,
    networking: [],
    compute: [],
    data: [],
    utility: [],
  };

  // ── Layer prompts ────────────────────────────────────────────────────────

  const layerKeys = ["networking", "compute", "data", "utility"] as const;

  for (const layerId of layerKeys) {
    const layer = LAYERS.find((l) => l.id === layerId)!;

    // ECS Fargate requires a VPC — auto-note if ECS was selected
    const hint =
      layerId === "networking" ? pc.dim("  (press Enter to skip)") :
      layerId === "compute" && selections.networking.length === 0
        ? pc.dim("  — tip: ECS Fargate requires VPC in Networking")
        : pc.dim("  (press Enter to skip)");

    const picked = await multiselect({
      message: `${pc.bold(layer.title)} ${pc.dim(`— ${layer.description}`)}${hint}`,
      options: layer.components.map((c) => ({
        value: c.name,
        label: c.title,
        hint: c.description,
      })),
      required: false,
    });

    if (isCancel(picked)) { cancel("Cancelled"); process.exit(0); }
    selections[layerId] = picked as string[];
  }

  // ── Auto-add VPC if ECS or RDS is selected and VPC wasn't chosen ─────────

  const allSelected = [
    ...selections.networking,
    ...selections.compute,
    ...selections.data,
    ...selections.utility,
  ];

  const needsVpc =
    (allSelected.includes("ecs-fargate") || allSelected.includes("rds-aurora")) &&
    !selections.networking.includes("vpc");

  if (needsVpc) {
    selections.networking = ["vpc", ...selections.networking];
    note(
      `VPC was added to Networking — required by ${[
        selections.compute.includes("ecs-fargate") ? "ECS Fargate" : "",
        selections.data.includes("rds-aurora") ? "RDS Aurora" : "",
      ]
        .filter(Boolean)
        .join(" and ")}.`,
      "Auto-added"
    );
  }

  // ── Guard: nothing selected ───────────────────────────────────────────────

  const totalSelected =
    selections.networking.length +
    selections.compute.length +
    selections.data.length +
    selections.utility.length;

  if (totalSelected === 0) {
    cancel("No components selected — nothing to generate.");
    process.exit(0);
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const summaryLines: string[] = [];
  for (const layerId of layerKeys) {
    const layer = LAYERS.find((l) => l.id === layerId)!;
    const chosen = selections[layerId];
    if (chosen.length > 0) {
      summaryLines.push(
        `  ${pc.dim(layer.title.padEnd(12))} ${chosen.map((n) => pc.cyan(n)).join(pc.dim(", "))}`
      );
    }
  }
  note(summaryLines.join("\n"), "Your stack");

  const ok = await confirm({ message: "Generate stack?" });
  if (isCancel(ok) || !ok) { cancel("Cancelled"); process.exit(0); }

  // ── Destination ───────────────────────────────────────────────────────────

  const destPath = path.resolve(process.cwd(), stackName);
  if (fs.existsSync(destPath)) {
    cancel(
      `Directory "${stackName}" already exists. Choose a different name or remove it first.`
    );
    process.exit(1);
  }

  // ── Generate ──────────────────────────────────────────────────────────────

  const gen = spinner();
  gen.start("Generating stack…");
  try {
    await generateStack(selections, destPath);
    gen.stop("Stack generated");
  } catch (err) {
    gen.stop("Generation failed");
    cancel(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  // ── Install ───────────────────────────────────────────────────────────────

  const pm = detectPackageManager();
  const install = spinner();
  install.start(`Installing dependencies with ${pm}…`);
  try {
    execSync(`${pm} install`, { cwd: destPath, stdio: "ignore" });
    install.stop("Dependencies installed");
  } catch {
    install.stop(
      pc.yellow(`Dependency install failed — run \`${pm} install\` manually`)
    );
  }

  // ── Done ─────────────────────────────────────────────────────────────────

  note(
    [
      `  cd ${stackName}`,
      `  # review lib/${stackName}-stack.ts`,
      `  npx cdk bootstrap`,
      `  npx cdk deploy`,
    ].join("\n"),
    "Next steps"
  );

  outro(
    `${pc.green("✔")} ${pc.bold(stackName)} ready — ${pc.cyan(totalSelected)} component${totalSelected === 1 ? "" : "s"} assembled\n` +
      `  ${pc.dim("More starters:")} ${pc.underline("https://www.cdkapp.com")}`
  );
}

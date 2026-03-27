#!/usr/bin/env node

// Suppress the --localstorage-file warning emitted by npx on Node 22+
const _origEmit = process.emit;
// @ts-expect-error patching overloaded method
process.emit = function (evt: string, ...args: unknown[]) {
  if (
    evt === "warning" &&
    typeof (args[0] as { message?: string })?.message === "string" &&
    (args[0] as { message: string }).message.includes("--localstorage-file")
  ) {
    return false;
  }
  return _origEmit.apply(process, [evt, ...args] as Parameters<typeof _origEmit>);
};

import {
  intro,
  outro,
  select,
  text,
  spinner,
  isCancel,
  cancel,
  note,
  multiselect,
} from "@clack/prompts";
import pc from "picocolors";
import path from "node:path";
import fs from "node:fs";
import { execSync } from "node:child_process";
import { runCompose } from "./compose.js";
import { searchableMultiselect } from "./searchable-multiselect.js";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Starter {
  name: string;
  title: string;
  description: string;
  tags: string[];
  author: string;
  difficulty: "beginner" | "intermediate" | "advanced";
}

interface StartersIndex {
  starters: Starter[];
  updatedAt: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_REPO = "KellyLBrown/CDKApp-Starters";

const DIFF_LABEL: Record<string, string> = {
  beginner: pc.green("beginner"),
  intermediate: pc.yellow("intermediate"),
  advanced: pc.red("advanced"),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Parse a repo string into its parts.
 * Accepts: "owner/repo" or "owner/repo#branch"
 * Also accepts full GitHub URLs: "https://github.com/owner/repo"
 */
function parseRepo(raw: string): { slug: string; branch: string } {
  const cleaned = raw
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/\.git$/, "")
    .trim();

  const [slugPart, branch = "main"] = cleaned.split("#");
  const slug = slugPart.replace(/\/+$/, "");

  if (!slug || slug.split("/").length < 2) {
    throw new Error(
      `Invalid repo format "${raw}". Expected "owner/repo" or "owner/repo#branch".`
    );
  }

  return { slug, branch };
}

function indexUrlForRepo(slug: string, branch: string): string {
  return `https://raw.githubusercontent.com/${slug}/${branch}/index.json`;
}

async function fetchStarters(indexUrl: string): Promise<Starter[]> {
  const res = await fetch(indexUrl);
  if (!res.ok) {
    throw new Error(
      `Failed to fetch starters index from ${indexUrl} (HTTP ${res.status}). Check your connection and repo name.`
    );
  }
  const data = (await res.json()) as StartersIndex;
  return data.starters;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function findNextAvailable(base: string): string {
  let n = 1;
  while (fs.existsSync(path.resolve(process.cwd(), `${base}-${n}`))) n++;
  return `${base}-${n}`;
}

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

// ─── Help text ───────────────────────────────────────────────────────────────

function printHelp() {
  console.log(`
${pc.bold("cdk-starter")} — scaffold production-ready AWS CDK apps

${pc.bold("Usage:")}
  npx cdk-starter <command> [options]

${pc.bold("Commands:")}
  create    Scaffold a new CDK app from a starter
  list      List all available starters
  info      Show details about a specific starter
  compose   Build a custom stack component by component (interactive)

${pc.bold("Options:")}
  --help, -h    Show this help message

${pc.bold("Run \`npx cdk-starter <command> --help\` for command-specific help.")}

${pc.bold("Website:")} https://www.cdkapp.com
`);
}

function printListHelp() {
  console.log(`
${pc.bold("cdk-starter list")} — list all available starters

${pc.bold("Usage:")}
  npx cdk-starter list
  npx cdk-starter list --tag serverless
  npx cdk-starter list --repo <owner/repo>

${pc.bold("Options:")}
  --tag,  -t <tag>          Filter by tag (can be used multiple times)
  --repo, -r <owner/repo>   Use a custom starters repo
  --json                    Print raw JSON output (useful for scripting)
  --help, -h                Show this help message

${pc.bold("Examples:")}
  npx cdk-starter list
  npx cdk-starter list --tag serverless
  npx cdk-starter list --tag serverless --tag api
  npx cdk-starter list --json
  npx cdk-starter list --repo myfork/cdkapp-starters

${pc.bold("Website:")} https://www.cdkapp.com
`);
}

function printInfoHelp() {
  console.log(`
${pc.bold("cdk-starter info <name>")} — show details about a specific starter

${pc.bold("Usage:")}
  npx cdk-starter info <name>
  npx cdk-starter info <name> --repo <owner/repo>

${pc.bold("Options:")}
  --repo, -r <owner/repo>   Use a custom starters repo
  --json                    Print raw JSON output (useful for scripting)
  --help, -h                Show this help message

${pc.bold("Examples:")}
  npx cdk-starter info serverless-api
  npx cdk-starter info serverless-api --json
  npx cdk-starter info serverless-api --repo myfork/cdkapp-starters

${pc.bold("Website:")} https://www.cdkapp.com
`);
}

function printCreateHelp() {
  console.log(`
${pc.bold("cdk-starter create")} — scaffold a new CDK app from a starter

${pc.bold("Usage:")}
  npx cdk-starter create
  npx cdk-starter create --starter <name>
  npx cdk-starter create --repo <owner/repo>

${pc.bold("Options:")}
  --starter, -s <name>          Skip the picker and use a named starter directly
  --repo,    -r <owner/repo>    Use a custom starters repo instead of the default
                                Accepts: "owner/repo" or "owner/repo#branch"
                                Full GitHub URLs are also accepted
  --help,    -h                 Show this help message

${pc.bold("Examples:")}
  npx cdk-starter create
  npx cdk-starter create --starter serverless-api
  npx cdk-starter create --repo myfork/cdkapp-starters
  npx cdk-starter create --repo myorg/my-templates#develop
  npx cdk-starter create --repo https://github.com/myorg/my-templates
  npx cdk-starter create --repo myfork/cdkapp-starters --starter serverless-api

${pc.bold("Custom repo structure:")}
  Your repo must follow the same layout as the default starters repo:
    index.json              ← manifest listing all starters
    starters/
      <starter-name>/
        cdkapp.json         ← metadata (name, title, description, tags, difficulty)
        README.md
        ...                 ← CDK app files

${pc.bold("Website:")} https://www.cdkapp.com
`);
}

// ─── Arg parsing ─────────────────────────────────────────────────────────────

function parseCreateArgs(args: string[]): {
  starter?: string;
  repo?: string;
  help?: boolean;
} {
  const result: { starter?: string; repo?: string; help?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") result.help = true;
    if ((args[i] === "--starter" || args[i] === "-s") && args[i + 1]) {
      result.starter = args[++i];
    }
    if ((args[i] === "--repo" || args[i] === "-r") && args[i + 1]) {
      result.repo = args[++i];
    }
  }
  return result;
}

function parseListArgs(args: string[]): {
  tags: string[];
  repo?: string;
  json?: boolean;
  help?: boolean;
} {
  const result: { tags: string[]; repo?: string; json?: boolean; help?: boolean } =
    { tags: [] };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") result.help = true;
    if (args[i] === "--json") result.json = true;
    if ((args[i] === "--tag" || args[i] === "-t") && args[i + 1]) {
      result.tags.push(args[++i]);
    }
    if ((args[i] === "--repo" || args[i] === "-r") && args[i + 1]) {
      result.repo = args[++i];
    }
  }
  return result;
}

function parseInfoArgs(args: string[]): {
  name?: string;
  repo?: string;
  json?: boolean;
  help?: boolean;
} {
  const result: { name?: string; repo?: string; json?: boolean; help?: boolean } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--help" || args[i] === "-h") result.help = true;
    if (args[i] === "--json") result.json = true;
    if ((args[i] === "--repo" || args[i] === "-r") && args[i + 1]) {
      result.repo = args[++i];
    } else if (!args[i].startsWith("-") && !result.name) {
      // First positional arg is the starter name
      result.name = args[i];
    }
  }
  return result;
}

// ─── create command ──────────────────────────────────────────────────────────

async function runCreate(rawArgs: string[]) {
  const args = parseCreateArgs(rawArgs);

  if (args.help) {
    printCreateHelp();
    process.exit(0);
  }

  // Resolve repo
  let repoSlug: string;
  let repoBranch: string;
  const isCustomRepo = Boolean(args.repo);

  try {
    const parsed = parseRepo(args.repo ?? DEFAULT_REPO);
    repoSlug = parsed.slug;
    repoBranch = parsed.branch;
  } catch (err) {
    console.error(pc.red("Error:"), err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const indexUrl = indexUrlForRepo(repoSlug, repoBranch);

  console.log("");
  intro(
    `${pc.bgGreen(pc.bold(" cdk-starter create "))} ${pc.dim(
      isCustomRepo
        ? `Using repo: ${pc.bold(repoSlug)}${repoBranch !== "main" ? pc.dim(`#${repoBranch}`) : ""}`
        : "Production-ready AWS CDK starters"
    )}`
  );

  // 1. Fetch starters
  const s = spinner();
  s.start("Fetching available starters…");

  let starters: Starter[];
  try {
    starters = await fetchStarters(indexUrl);
    s.stop(`Found ${pc.bold(String(starters.length))} starters`);
  } catch (err) {
    s.stop("Failed to fetch starters");
    cancel(
      String(err instanceof Error ? err.message : err) +
        (isCustomRepo
          ? `\n\n  Make sure "${repoSlug}" is public and has an index.json at the repo root.`
          : `\n\n  Browse starters at ${pc.underline("https://www.cdkapp.com/starters")}`)
    );
    process.exit(1);
  }

  // 2. How to browse
  let chosenName = args.starter;

  if (!chosenName) {
    const allTags = Array.from(
      new Set(starters.flatMap((s) => s.tags))
    ).sort();

    const browseMode = await select({
      message: "How would you like to find a starter?",
      options: [
        { value: "all", label: "Browse all starters" },
        { value: "search", label: "Search by name or keyword" },
        { value: "tag", label: "Filter by tag" },
      ],
    });

    if (isCancel(browseMode)) {
      cancel("Cancelled");
      process.exit(0);
    }

    let candidates = starters;

    if (browseMode === "search") {
      const search = await text({
        message: "Search",
        placeholder: "e.g. fargate, serverless, lambda…",
      });

      if (isCancel(search)) {
        cancel("Cancelled");
        process.exit(0);
      }

      const query = ((search as string) ?? "").trim().toLowerCase();
      if (query) {
        candidates = starters.filter(
          (s) =>
            s.name.toLowerCase().includes(query) ||
            s.title.toLowerCase().includes(query) ||
            s.description.toLowerCase().includes(query) ||
            s.tags.some((t) => t.toLowerCase().includes(query))
        );
      }

      if (candidates.length === 0) {
        cancel(
          `No starters match "${query}". Run ${pc.bold("npx cdk-starter list")} to see all.`
        );
        process.exit(0);
      }
    }

    if (browseMode === "tag") {
      const tagFilter = await searchableMultiselect({
        message: "Filter by tags",
        options: allTags.map((tag) => ({ value: tag, label: tag })),
      });

      if (isCancel(tagFilter)) {
        cancel("Cancelled");
        process.exit(0);
      }

      if ((tagFilter as string[]).length > 0) {
        candidates = starters.filter((s) =>
          (tagFilter as string[]).some((t) => s.tags.includes(t))
        );
      }

      if (candidates.length === 0) {
        cancel("No starters match those tags.");
        process.exit(0);
      }
    }

    const picked = await select({
      message: `Pick a starter (${candidates.length} available)`,
      options: candidates.map((s) => ({
        value: s.name,
        label: `${s.title}  ${DIFF_LABEL[s.difficulty] ?? s.difficulty}`,
        hint:
          s.description.slice(0, 72) + (s.description.length > 72 ? "…" : ""),
      })),
    });

    if (isCancel(picked)) {
      cancel("Cancelled");
      process.exit(0);
    }

    chosenName = picked as string;
  }

  const starter = starters.find((s) => s.name === chosenName);
  if (!starter) {
    cancel(
      `Unknown starter "${chosenName}". Browse available starters at ${pc.underline("https://www.cdkapp.com/starters")}`
    );
    process.exit(1);
  }

  // 4. Project name (loop until we get a usable directory)
  let dirName = "";
  let destPath = "";

  while (true) {
    const projectName = await text({
      message: "Project name",
      placeholder: starter.name,
      defaultValue: starter.name,
    });

    if (isCancel(projectName)) {
      cancel("Cancelled");
      process.exit(0);
    }

    dirName = slugify(projectName as string);
    destPath = path.resolve(process.cwd(), dirName);

    if (!fs.existsSync(destPath)) break;

    const nextAvailable = findNextAvailable(dirName);
    const action = await select({
      message: `Directory "${dirName}" already exists`,
      options: [
        { value: "auto", label: `Use "${nextAvailable}" instead` },
        { value: "rename", label: "Enter a different name" },
        { value: "cancel", label: "Cancel" },
      ],
    });

    if (isCancel(action) || action === "cancel") {
      cancel("Cancelled");
      process.exit(0);
    }

    if (action === "auto") {
      dirName = nextAvailable;
      destPath = path.resolve(process.cwd(), dirName);
      break;
    }
  }

  // 5. Scaffold
  const scaffold = spinner();
  scaffold.start(`Scaffolding ${pc.bold(starter.title)}…`);

  const degitPath = `${repoSlug}/starters/${starter.name}#${repoBranch}`;

  try {
    const degit = (await import("degit")).default;
    const emitter = degit(degitPath, {
      cache: false,
      force: true,
      verbose: false,
    });
    await emitter.clone(destPath);
    scaffold.stop("Files downloaded");
  } catch (err) {
    scaffold.stop("Download failed");
    cancel(
      `Could not download starter: ${err instanceof Error ? err.message : String(err)}\n\n` +
        `  Download manually at ${pc.underline(`https://github.com/${repoSlug}/tree/${repoBranch}/starters/${starter.name}`)}`
    );
    process.exit(1);
  }

  // 6. Install deps
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

  // 7. Done
  note(
    [
      `  cd ${dirName}`,
      `  # edit .env with your AWS account info`,
      `  npx cdk bootstrap`,
      `  npx cdk deploy`,
    ].join("\n"),
    "Next steps"
  );

  outro(
    `${pc.green("✔")} ${pc.bold(starter.title)} is ready in ${pc.cyan(dirName)}\n` +
      `  ${pc.dim("Docs & more starters:")} ${pc.underline("https://www.cdkapp.com")}`
  );
}

// ─── list command ────────────────────────────────────────────────────────────

async function runList(rawArgs: string[]) {
  const args = parseListArgs(rawArgs);

  if (args.help) {
    printListHelp();
    process.exit(0);
  }

  let repoSlug: string;
  let repoBranch: string;

  try {
    const parsed = parseRepo(args.repo ?? DEFAULT_REPO);
    repoSlug = parsed.slug;
    repoBranch = parsed.branch;
  } catch (err) {
    console.error(pc.red("Error:"), err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const s = spinner();
  s.start("Fetching starters…");

  let starters: Starter[];
  try {
    starters = await fetchStarters(indexUrlForRepo(repoSlug, repoBranch));
    s.stop();
  } catch (err) {
    s.stop("Failed");
    console.error(pc.red("Error:"), err instanceof Error ? err.message : err);
    process.exit(1);
  }

  // Apply tag filter
  if (args.tags.length > 0) {
    starters = starters.filter((s) =>
      args.tags.every((t) => s.tags.includes(t))
    );
  }

  if (args.json) {
    console.log(JSON.stringify(starters, null, 2));
    process.exit(0);
  }

  if (starters.length === 0) {
    console.log(
      pc.yellow(
        `No starters match the tag filter: ${args.tags.map((t) => pc.bold(t)).join(", ")}`
      )
    );
    process.exit(0);
  }

  const repoLabel =
    args.repo
      ? pc.dim(` (${repoSlug}#${repoBranch})`)
      : "";

  console.log(
    `\n${pc.bold(`${starters.length} starter${starters.length === 1 ? "" : "s"} available`)}${repoLabel}\n`
  );

  // Calculate column widths
  const nameWidth = Math.max(...starters.map((s) => s.name.length), 4) + 2;
  const titleWidth = Math.max(...starters.map((s) => s.title.length), 5) + 2;

  for (const s of starters) {
    const diff =
      s.difficulty === "beginner"
        ? pc.green(s.difficulty.padEnd(12))
        : s.difficulty === "intermediate"
          ? pc.yellow(s.difficulty.padEnd(12))
          : pc.red(s.difficulty.padEnd(12));

    const tags = s.tags.map((t) => pc.dim(t)).join(pc.dim(", "));

    console.log(
      `  ${pc.cyan(s.name.padEnd(nameWidth))}` +
        `${s.title.padEnd(titleWidth)}` +
        `${diff}  ` +
        `${tags}`
    );
  }

  console.log(
    `\n  ${pc.dim("Run")} ${pc.bold("npx cdk-starter info <name>")} ${pc.dim("for details, or")} ${pc.bold("npx cdk-starter create")} ${pc.dim("to scaffold.")}\n`
  );
}

// ─── info command ─────────────────────────────────────────────────────────────

async function runInfo(rawArgs: string[]) {
  const args = parseInfoArgs(rawArgs);

  if (args.help) {
    printInfoHelp();
    process.exit(0);
  }

  if (!args.name) {
    console.error(
      pc.red("Missing starter name.") +
        `\nUsage: ${pc.bold("npx cdk-starter info <name>")}\n` +
        `Run ${pc.bold("npx cdk-starter list")} to see available starters.`
    );
    process.exit(1);
  }

  let repoSlug: string;
  let repoBranch: string;

  try {
    const parsed = parseRepo(args.repo ?? DEFAULT_REPO);
    repoSlug = parsed.slug;
    repoBranch = parsed.branch;
  } catch (err) {
    console.error(pc.red("Error:"), err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const s = spinner();
  s.start("Fetching starter info…");

  let starters: Starter[];
  try {
    starters = await fetchStarters(indexUrlForRepo(repoSlug, repoBranch));
    s.stop();
  } catch (err) {
    s.stop("Failed");
    console.error(pc.red("Error:"), err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const starter = starters.find((s) => s.name === args.name);

  if (!starter) {
    const names = starters.map((s) => pc.cyan(s.name)).join(", ");
    console.error(
      pc.red(`Starter "${args.name}" not found.`) +
        `\nAvailable starters: ${names}\n` +
        `Run ${pc.bold("npx cdk-starter list")} for the full list.`
    );
    process.exit(1);
  }

  if (args.json) {
    console.log(JSON.stringify(starter, null, 2));
    process.exit(0);
  }

  const githubUrl = `https://github.com/${repoSlug}/tree/${repoBranch}/starters/${starter.name}`;
  const diffColor =
    starter.difficulty === "beginner"
      ? pc.green
      : starter.difficulty === "intermediate"
        ? pc.yellow
        : pc.red;

  console.log(`
  ${pc.bold(pc.white(starter.title))}
  ${pc.dim("─".repeat(starter.title.length))}

  ${starter.description}

  ${pc.dim("Name:        ")}${pc.cyan(starter.name)}
  ${pc.dim("Difficulty:  ")}${diffColor(starter.difficulty)}
  ${pc.dim("Tags:        ")}${starter.tags.join(", ")}
  ${pc.dim("Author:      ")}${starter.author}
  ${pc.dim("GitHub:      ")}${pc.underline(githubUrl)}

  ${pc.dim("To scaffold:")}
  ${pc.dim("$")} npx cdk-starter create --starter ${starter.name}
`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

async function main() {
  const [command, ...rest] = process.argv.slice(2);

  // Top-level --help / -h with no command
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  switch (command) {
    case "create":
      await runCreate(rest);
      break;
    case "list":
      await runList(rest);
      break;
    case "info":
      await runInfo(rest);
      break;
    case "compose":
      await runCompose(rest);
      break;
    default:
      console.error(
        pc.red(`Unknown command "${command}".`) +
          `\nRun ${pc.bold("npx cdk-starter --help")} to see available commands.`
      );
      process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(pc.red("Unexpected error:"), err);
    process.exit(1);
  });

import { execSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { startCallbackServer } from "./server.ts";

interface InstallFlags {
  org?: string;
  webhookUrl?: string;
}

interface AppCredentials {
  id: number;
  slug: string;
  pem: string;
  webhook_secret: string;
  client_id: string;
  client_secret: string;
  html_url: string;
  owner: { login: string };
}

export async function install(flags: InstallFlags): Promise<void> {
  console.log("\n  GitHub App Agent — Automated Setup\n");

  // Step 1: Deploy the Worker to get the webhook URL (skip if --webhook-url provided)
  let webhookUrl: string;
  if (flags.webhookUrl) {
    webhookUrl = flags.webhookUrl.replace(/\/+$/, "");
    console.log(`  [1/5] Using provided webhook URL: ${webhookUrl}`);
  } else {
    console.log("  [1/5] Deploying worker to Cloudflare...");
    webhookUrl = deployWorker();
  }

  // Step 2: Start local server and open browser for manifest flow
  console.log("  [2/5] Starting GitHub App registration...");
  const { url: localUrl, result, server } = await startCallbackServer({
    webhookUrl,
    org: flags.org,
  });

  console.log(`         Opening browser to register the app...`);
  openBrowser(localUrl);
  console.log("         Waiting for GitHub App creation...\n");

  // Step 3: Wait for the callback with the code, then exchange it
  const { code } = await result;
  console.log("  [3/5] Exchanging code for credentials...");
  const credentials = await exchangeCode(code);

  // Step 4: Store secrets
  console.log("  [4/5] Storing secrets...");
  await storeSecrets(credentials, webhookUrl);

  // Step 5: Open installation page
  console.log("  [5/5] Opening installation page...\n");
  const installUrl = `${credentials.html_url}/installations/new`;
  openBrowser(installUrl);

  // Print summary
  printSummary(credentials, webhookUrl, flags.org);
}

function deployWorker(): string {
  try {
    const output = execSync("npx wrangler deploy", {
      encoding: "utf-8",
      stdio: ["inherit", "pipe", "pipe"],
    });

    // Parse the worker URL from deploy output
    // wrangler prints something like: "Published github-app-agent (1.2s)
    //   https://github-app-agent.username.workers.dev"
    const urlMatch = output.match(/https:\/\/[^\s]+\.workers\.dev/);
    if (!urlMatch) {
      throw new Error("Could not parse worker URL from deploy output");
    }

    console.log(`         Deployed to ${urlMatch[0]}`);
    return urlMatch[0];
  } catch {
    console.error(
      "         Failed to deploy. Please deploy the worker first with `wrangler deploy`"
    );
    console.error(
      "         and then run `agents github install` again."
    );
    return process.exit(1) as never;
  }
}

async function exchangeCode(code: string): Promise<AppCredentials> {
  const response = await fetch(
    `https://api.github.com/app-manifests/${code}/conversions`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to exchange code for credentials: ${response.status} ${body}`
    );
  }

  return response.json() as Promise<AppCredentials>;
}

async function storeSecrets(
  credentials: AppCredentials,
  webhookUrl: string
): Promise<void> {
  const secrets: Record<string, string> = {
    GITHUB_APP_ID: String(credentials.id),
    GITHUB_PRIVATE_KEY: credentials.pem,
    GITHUB_WEBHOOK_SECRET: credentials.webhook_secret,
  };

  // Store to Cloudflare Workers via wrangler secret bulk (pipe JSON via stdin)
  try {
    const secretsJson = JSON.stringify(secrets);
    const result = spawnSync("npx", ["wrangler", "secret", "bulk"], {
      input: secretsJson,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      throw new Error(result.stderr || "wrangler secret bulk failed");
    }
    console.log("         Secrets stored to Cloudflare Workers");
  } catch (error) {
    console.error("         Failed to store secrets via wrangler. You can set them manually:");
    console.error("         wrangler secret put GITHUB_APP_ID");
    console.error("         wrangler secret put GITHUB_PRIVATE_KEY");
    console.error("         wrangler secret put GITHUB_WEBHOOK_SECRET");
  }

  // Write .dev.vars for local development
  const devVarsPath = resolve(process.cwd(), ".dev.vars");
  const devVarsContent = Object.entries(secrets)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  writeFileSync(devVarsPath, devVarsContent + "\n");
  console.log("         Created .dev.vars for local development");
}

function openBrowser(url: string): void {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execSync(`open "${url}"`, { stdio: "ignore" });
    } else if (platform === "linux") {
      execSync(`xdg-open "${url}"`, { stdio: "ignore" });
    } else {
      console.log(`         Please open: ${url}`);
    }
  } catch {
    console.log(`         Please open: ${url}`);
  }
}

function printSummary(
  credentials: AppCredentials,
  webhookUrl: string,
  org?: string
): void {
  console.log("  ─────────────────────────────────────────");
  console.log("  Setup complete!\n");
  console.log(`  App name:    ${credentials.slug}`);
  console.log(`  App ID:      ${credentials.id}`);
  console.log(`  Owner:       ${credentials.owner.login}${org ? ` (org)` : ""}`);
  console.log(`  Webhook URL: ${webhookUrl}/webhooks/github`);
  console.log(`  App URL:     ${credentials.html_url}`);
  console.log("");
  console.log("  Next steps:");
  console.log("  1. Select the repositories to install the app on (browser should be open)");
  console.log("  2. Run `wrangler dev` to start local development");
  console.log("  ─────────────────────────────────────────\n");
}

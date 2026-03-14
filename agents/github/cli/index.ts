import { Cli, z } from "incur";
import { install } from "./install.ts";

export const cli = Cli.create("github", {
  description: "GitHub agent commands",
});

cli.command("install", {
  description: "Register a GitHub App and configure secrets",
  options: z.object({
    org: z.string().optional().describe("GitHub organization name (org-level app)"),
    webhookUrl: z.string().optional().describe("Webhook URL (skips deploying the worker)"),
  }),
  async run({ options }) {
    await install({ org: options.org, webhookUrl: options.webhookUrl });
    return { installed: true };
  },
});

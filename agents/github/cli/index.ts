import { install } from "./install.ts";

export type CommandDefinition = {
  description: string;
  flags?: Record<string, { description: string; required?: boolean }>;
  action: (flags: Record<string, string | undefined>) => Promise<void>;
};

export const commands: Record<string, CommandDefinition> = {
  install: {
    description: "Register a GitHub App and configure secrets",
    flags: {
      org: {
        description: "GitHub organization name (org-level app)",
        required: false,
      },
      webhookUrl: {
        description: "Webhook URL (skips deploying the worker)",
        required: false,
      },
    },
    action: async (flags) => {
      await install({ org: flags["org"], webhookUrl: flags["webhookUrl"] });
    },
  },
};

export type CommandDefinition = {
  description: string;
  flags?: Record<string, { description: string; required?: boolean }>;
  action: (flags: Record<string, string | undefined>) => Promise<void>;
};

export const commands: Record<string, CommandDefinition> = {
  setup: {
    description: "Print setup instructions for the Linear agent",
    flags: {
      workerUrl: {
        description: "Your deployed Cloudflare Worker URL",
        required: false,
      },
    },
    action: async (flags) => {
      const workerUrl = flags["workerUrl"] ?? "https://<your-worker>.workers.dev";
      const webhookUrl = `${workerUrl}/linear/webhook`;

      console.log(`
Linear Agent Setup Instructions
================================

1. Create a Linear OAuth Application
   - Go to: https://linear.app/settings/api/applications/new
   - Set the application name and description
   - Under Scopes, enable:
       app:assignable    (allow issue assignment to the agent)
       app:mentionable   (allow @mentions in issues and documents)
   - Under Webhooks, enable "Agent session events"
   - Set the Webhook URL to: ${webhookUrl}
   - Save the application

2. Authorize the agent in your workspace
   - In the OAuth authorization URL, add the parameter: actor=app
   - This installs the agent (requires workspace admin permissions)

3. Set Cloudflare Worker secrets
   Run the following commands:

     wrangler secret put LINEAR_WEBHOOK_SIGNING_SECRET
     # Paste your webhook signing secret from the Linear app settings

     wrangler secret put LINEAR_ACCESS_TOKEN
     # Paste the OAuth access token obtained after authorizing the agent

4. Deploy the Worker
     bun run deploy

5. Test the agent
   In Linear, assign an issue to your agent or @mention it in a comment.
   You should see "thought" and "response" activities appear within seconds.
`);
    },
  },
};

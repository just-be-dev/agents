# Linear Agent

A Cloudflare Agent (Durable Object) that implements the [Linear Agents API](https://linear.app/developers/agents). It receives webhook events when assigned or @mentioned in Linear issues, acknowledges within 10 seconds, and responds with agent activities via the Linear GraphQL API.

## Features

- **Webhook handling** — Receives and verifies Linear `AgentSessionEvent` webhooks using HMAC-SHA256
- **Per-workspace isolation** — Each Linear workspace gets its own Durable Object instance with isolated state and storage
- **Session storage** — Sessions stored in SQLite with conflict-safe deduplication
- **Activity responses** — Emits `thought` and `response` activities back to Linear within 10 seconds
- **Async processing** — Returns 200 OK immediately, then processes via `ctx.waitUntil()`
- **RPC methods** — Query sessions via `@callable()` methods over WebSocket

## Prerequisites

- [Bun](https://bun.sh) (managed via [mise](https://mise.jdx.dev))
- [Cloudflare account](https://dash.cloudflare.com/sign-up)
- A Linear workspace with admin permissions

## Setup

### 1. Install dependencies

```bash
mise install   # installs Bun
bun install    # installs packages
```

### 2. Create a Linear OAuth Application

1. Go to **Linear Settings > API > OAuth Applications > Create new**
2. Under **Scopes**, enable:
   - `app:assignable` — allow issue assignment to the agent
   - `app:mentionable` — allow @mentions in issues and documents
3. Under **Webhooks**, enable **Agent session events**
4. Set the **Webhook URL** to your Worker URL + `/linear/webhook`
   (e.g., `https://agents-router.your-account.workers.dev/linear/webhook`)
5. Save the application — note the **Webhook signing secret**

### 3. Authorize the agent in your workspace

In the OAuth authorization URL, add `actor=app` to install the agent (requires admin):

```
https://linear.app/oauth/authorize?client_id=<CLIENT_ID>&redirect_uri=<REDIRECT>&scope=app:assignable,app:mentionable&actor=app
```

After authorizing, retrieve your workspace viewer ID via the GraphQL API:

```graphql
query Me { viewer { id } }
```

### 4. Configure secrets

For **local development**, edit `.dev.vars`:

```
LINEAR_WEBHOOK_SIGNING_SECRET=your-signing-secret
LINEAR_ACCESS_TOKEN=your-oauth-access-token
```

For **production**, use wrangler secrets:

```bash
wrangler secret put LINEAR_WEBHOOK_SIGNING_SECRET
wrangler secret put LINEAR_ACCESS_TOKEN
```

### 5. Run the setup CLI

```bash
agents linear setup --worker-url https://agents-router.your-account.workers.dev
```

### 6. Deploy

```bash
bun run deploy
```

## Architecture

```
POST /linear/webhook
  → Worker (lib/index.ts)
    → Extract organizationId from payload
    → routeLinearWebhook() → LinearAgent Durable Object (keyed by organizationId)
      → Verify webhook signature (HMAC-SHA256)
      → Store session in SQLite
      → Return 200 OK immediately
      → ctx.waitUntil(handleSession()) — async
        → emitThought("Reviewing issue...")
        → emitResponse("I've reviewed the issue.")

WebSocket /agents/linear-agent/:name
  → routeAgentRequest(req, env)
    → LinearAgent Durable Object
      → @callable() getSessions()
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/linear/webhook` | Linear AgentSessionEvent receiver |
| WS | `/agents/linear-agent/:name` | WebSocket connection to an agent instance |

## RPC Methods

Connect via WebSocket to call these methods:

- `getSessions(limit?, offset?)` — Get recent sessions (default 20)

## Session Lifecycle

Linear sends `AgentSessionEvent` webhooks with two key actions:

| Action | Meaning | Agent Response |
|--------|---------|----------------|
| `created` | Issue assigned or agent mentioned | `thought` + `response` |
| `prompted` | User added more context | `thought` + `response` |

## Extending

Replace the placeholder responses in `handleSession()` with real AI logic:

```typescript
private async handleSession(action: string, session: AgentSession): Promise<void> {
  if (action === "created") {
    await this.emitThought(session.id, "Analyzing issue...");
    // Call an AI model with session.promptContext
    const analysis = await callYourAI(session.promptContext);
    await this.emitResponse(session.id, analysis);
  }
}
```

## Development

```bash
agents linear setup   # Print setup instructions
bun run typecheck     # Type check
bun run dev           # Local dev server
bun run deploy        # Deploy to Cloudflare
```
